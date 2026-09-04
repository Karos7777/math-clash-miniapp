package com.karos.mathclash.engine

/**
 * The shape of a board without any answer attached: operators, targets and the
 * pool of numbers. The solver works on this, which is what lets the generator
 * test a board it has not finished building yet.
 *
 * ```
 *   7 x 3 - 4 = 17
 *   +   -   x
 *   2 + 9 - 1 = 10
 *   x   +   -
 *   5 - 8 + 6 =  3
 *   =   =   =
 *  45   4  17
 * ```
 *
 * Every number of [bank] is placed exactly once, so each cell answers to a row
 * equation and a column equation at the same time — that crossing is the puzzle.
 */
class BoardSpec(
    val size: Int,
    val rowOps: List<List<Op>>,
    val colOps: List<List<Op>>,
    val rowTargets: List<Int>,
    val colTargets: List<Int>,
    val bank: List<Int>,
    val precedence: Precedence,
) {
    val cellCount: Int = size * size

    init {
        require(size >= 2) { "a board needs at least two rows" }
        require(rowOps.size == size && colOps.size == size) { "one operator line per row and column" }
        require(rowOps.all { it.size == size - 1 } && colOps.all { it.size == size - 1 }) {
            "each line needs size - 1 operators"
        }
        require(rowTargets.size == size && colTargets.size == size) { "one target per line" }
        require(bank.size == cellCount) { "the bank must fill the board exactly" }
    }

    fun indexOf(row: Int, col: Int): Int = row * size + col

    fun opsOf(line: Int, vertical: Boolean): List<Op> = if (vertical) colOps[line] else rowOps[line]

    fun targetOf(line: Int, vertical: Boolean): Int = if (vertical) colTargets[line] else rowTargets[line]

    fun valuesOf(assignment: IntArray, line: Int, vertical: Boolean): IntArray =
        if (vertical) IntArray(size) { assignment[indexOf(it, line)] }
        else IntArray(size) { assignment[indexOf(line, it)] }

    /** Status of one line, for the board UI and for win detection. */
    fun lineState(assignment: IntArray, line: Int, vertical: Boolean): LineState {
        val target = targetOf(line, vertical)
        val values = valuesOf(assignment, line, vertical)
        if (values.any { it == EMPTY }) return LineState(target, null, LineStatus.INCOMPLETE)
        val value = Expression.evaluateInt(values, opsOf(line, vertical), precedence)
        return LineState(target, value, if (value == target) LineStatus.SOLVED else LineStatus.WRONG)
    }

    /** True when every cell is filled and all `2 * size` equations hold. */
    fun isSolved(assignment: IntArray): Boolean {
        if (assignment.any { it == EMPTY }) return false
        for (line in 0 until size) {
            if (lineState(assignment, line, vertical = false).status != LineStatus.SOLVED) return false
            if (lineState(assignment, line, vertical = true).status != LineStatus.SOLVED) return false
        }
        return true
    }

    companion object {
        /** Marker for a cell no number has been dropped into yet. */
        const val EMPTY = -1
    }
}

/** A board plus the answer it was built from and the cells revealed for free. */
class Puzzle(
    val spec: BoardSpec,
    val givens: Map<Int, Int>,
    val solution: List<Int>,
    val difficulty: Difficulty,
    val uniqueSolution: Boolean,
) {
    val size: Int get() = spec.size
    val cellCount: Int get() = spec.cellCount
    val bank: List<Int> get() = spec.bank
    val precedence: Precedence get() = spec.precedence

    init {
        require(solution.size == spec.cellCount) { "the solution must fill the board exactly" }
        require(givens.all { (cell, value) -> solution[cell] == value }) {
            "revealed cells must agree with the solution"
        }
    }

    /** The numbers still to be placed on a fresh board, in the order they are shown. */
    val tray: List<Int> = buildTray(spec.bank, givens.values)

    /** A fresh board: givens in place, every other cell empty. */
    fun emptyAssignment(): IntArray = IntArray(spec.cellCount) { givens[it] ?: BoardSpec.EMPTY }

    fun isGiven(cell: Int): Boolean = givens.containsKey(cell)

    companion object {
        private fun buildTray(bank: List<Int>, revealed: Collection<Int>): List<Int> {
            val left = bank.toMutableList()
            revealed.forEach { left.remove(it) }
            return left.sorted()
        }
    }
}

enum class LineStatus { INCOMPLETE, SOLVED, WRONG }

/** [value] is null while the line is unfinished, or when it lands on a fraction. */
data class LineState(val target: Int, val value: Int?, val status: LineStatus)
