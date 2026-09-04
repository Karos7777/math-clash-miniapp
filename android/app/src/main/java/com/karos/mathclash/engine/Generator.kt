package com.karos.mathclash.engine

import kotlin.random.Random

/**
 * Builds boards.
 *
 * Working backwards is what makes this tractable: the numbers are dealt first,
 * then each line is given the operators that make it land on a clean whole
 * target. Only then is the board handed to the [Solver], which decides how many
 * cells have to be revealed before exactly one answer remains.
 *
 * Generation is a pure function of the [Random] it is handed, so the daily
 * puzzle can be rebuilt from its date on any device.
 */
object Generator {

    private const val MAX_ATTEMPTS = 400
    /** Below this many attempts left, stop insisting every allowed operator shows up. */
    private const val COVERAGE_ATTEMPTS = 300

    fun generate(config: PuzzleConfig, random: Random = Random.Default): Puzzle {
        var relaxed: Draft? = null

        for (attempt in 0 until MAX_ATTEMPTS) {
            val draft = draft(config, random, demandEveryOperator = attempt < COVERAGE_ATTEMPTS) ?: continue
            if (relaxed == null) relaxed = draft

            val pinned = pinDown(draft, config, random) ?: continue
            val trimmed = if (draft.spec.size <= 3) trim(draft, pinned, random) else pinned
            val givens = addExtras(draft, trimmed, config.extraGivens, random)
            return Puzzle(draft.spec, givens, draft.solution, config.difficulty, uniqueSolution = true)
        }

        // Nothing pinned down in time: still hand back a playable board. Any
        // completion satisfying all lines wins, so a second answer costs the
        // player nothing but a missing "one true solution" badge.
        val draft = relaxed ?: additionOnly(config, random)
        val givens = addExtras(draft, emptyMap(), config.extraGivens, random)
        return Puzzle(draft.spec, givens, draft.solution, config.difficulty, uniqueSolution = false)
    }

    private class Draft(val spec: BoardSpec, val solution: List<Int>)

    /** Deals the numbers, then fits operators to them. Null when the deal admits no clean line. */
    private fun draft(config: PuzzleConfig, random: Random, demandEveryOperator: Boolean): Draft? {
        val n = config.size
        val numbers = config.bank.shuffled(random)
        val rowOps = ArrayList<List<Op>>(n)
        val rowTargets = ArrayList<Int>(n)
        val colOps = ArrayList<List<Op>>(n)
        val colTargets = ArrayList<Int>(n)

        for (row in 0 until n) {
            val values = IntArray(n) { numbers[row * n + it] }
            val line = fitLine(values, config, random) ?: return null
            rowOps.add(line.ops)
            rowTargets.add(line.target)
        }
        for (col in 0 until n) {
            val values = IntArray(n) { numbers[it * n + col] }
            val line = fitLine(values, config, random) ?: return null
            colOps.add(line.ops)
            colTargets.add(line.target)
        }

        if (demandEveryOperator) {
            val used = (rowOps + colOps).flatten().toSet()
            if (!used.containsAll(config.ops)) return null
        }

        val spec = BoardSpec(
            size = n,
            rowOps = rowOps,
            colOps = colOps,
            rowTargets = rowTargets,
            colTargets = colTargets,
            bank = config.bank.sorted(),
            precedence = config.precedence,
        )
        return Draft(spec, numbers)
    }

    private class Line(val ops: List<Op>, val target: Int)

    /**
     * Picks operators for one already-dealt line. Every option is scored, then
     * drawn by weight, so boards lean interesting without every line turning
     * into the same shape.
     */
    private fun fitLine(values: IntArray, config: PuzzleConfig, random: Random): Line? {
        val options = ArrayList<Line>()
        val weights = ArrayList<Double>()
        var total = 0.0

        for (ops in operatorCombinations(config.ops, values.size - 1)) {
            val target = Expression.evaluateStrict(values, ops, config.precedence) ?: continue
            if (target < config.minTarget || target > config.maxTarget) continue
            val weight = weightOf(ops)
            options.add(Line(ops, target))
            weights.add(weight)
            total += weight
        }
        if (options.isEmpty()) return null

        var roll = random.nextDouble() * total
        for (i in options.indices) {
            roll -= weights[i]
            if (roll <= 0.0) return options[i]
        }
        return options.last()
    }

    private fun weightOf(ops: List<Op>): Double {
        var weight = 1.0
        if (ops.any { it.isMultiplicative }) weight += 0.9
        if (ops.any { it == Op.DIV }) weight += 0.5
        if (ops.distinct().size > 1) weight += 0.7
        return weight
    }

    private fun operatorCombinations(alphabet: List<Op>, slots: Int): List<List<Op>> {
        var combos = listOf(emptyList<Op>())
        repeat(slots) {
            combos = combos.flatMap { prefix -> alphabet.map { prefix + it } }
        }
        return combos
    }

    /**
     * Reveals cells one at a time until a single answer is left. Null when the
     * board needs more help than the difficulty allows — a sign the deal was
     * too loose, so the caller deals again.
     */
    private fun pinDown(draft: Draft, config: PuzzleConfig, random: Random): Map<Int, Int>? {
        val assignment = IntArray(draft.spec.cellCount) { BoardSpec.EMPTY }
        val revealed = LinkedHashMap<Int, Int>()

        while (true) {
            val result = Solver.solve(draft.spec, assignment)
            if (result.exhausted) {
                if (result.count == 1) return revealed
                if (result.count == 0) return null // the deal contradicts itself; start over
            }
            if (revealed.size >= config.maxGivens) return null
            val free = (0 until draft.spec.cellCount).filter { assignment[it] == BoardSpec.EMPTY }
            val cell = free.randomOrNull(random) ?: return null
            assignment[cell] = draft.solution[cell]
            revealed[cell] = draft.solution[cell]
        }
    }

    /** Drops revealed cells a later reveal made redundant, so the board stays as bare as it can. */
    private fun trim(draft: Draft, revealed: Map<Int, Int>, random: Random): Map<Int, Int> {
        val kept = LinkedHashMap(revealed)
        for (cell in revealed.keys.shuffled(random)) {
            if (kept.size <= 1) break
            val trial = LinkedHashMap(kept).apply { remove(cell) }
            if (Solver.isUnique(draft.spec, assignmentOf(draft.spec, trial))) kept.remove(cell)
        }
        return kept
    }

    /** Extra free cells for the gentler difficulties. More information can never add answers. */
    private fun addExtras(draft: Draft, revealed: Map<Int, Int>, extras: Int, random: Random): Map<Int, Int> {
        if (extras <= 0) return revealed
        val result = LinkedHashMap(revealed)
        val free = (0 until draft.spec.cellCount).filter { it !in result }.shuffled(random)
        for (cell in free.take(extras)) result[cell] = draft.solution[cell]
        return result
    }

    private fun assignmentOf(spec: BoardSpec, revealed: Map<Int, Int>): IntArray =
        IntArray(spec.cellCount) { revealed[it] ?: BoardSpec.EMPTY }

    /** The board that always exists: every line is a sum. Only used if everything else fails. */
    private fun additionOnly(config: PuzzleConfig, random: Random): Draft {
        val n = config.size
        val numbers = config.bank.shuffled(random)
        val ops = List(n - 1) { Op.ADD }
        val rowTargets = (0 until n).map { row -> (0 until n).sumOf { numbers[row * n + it] } }
        val colTargets = (0 until n).map { col -> (0 until n).sumOf { numbers[it * n + col] } }
        val spec = BoardSpec(
            size = n,
            rowOps = List(n) { ops },
            colOps = List(n) { ops },
            rowTargets = rowTargets,
            colTargets = colTargets,
            bank = config.bank.sorted(),
            precedence = config.precedence,
        )
        return Draft(spec, numbers)
    }

    private fun <T> List<T>.randomOrNull(random: Random): T? =
        if (isEmpty()) null else this[random.nextInt(size)]
}
