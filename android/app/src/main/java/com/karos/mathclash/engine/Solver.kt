package com.karos.mathclash.engine

/**
 * @param count solutions found, capped at the requested limit.
 * @param first the first solution found, or null when there is none.
 * @param exhausted false when the search hit its node budget and gave up, so
 *   [count] is then a lower bound rather than the truth.
 */
class SolveResult(val count: Int, val first: IntArray?, val exhausted: Boolean) {
    val hasSolution: Boolean get() = count > 0
}

/**
 * Counts or finds ways to finish a board.
 *
 * A cell-by-cell search is hopeless on a 4x4 (16! orderings), so the search runs
 * a row at a time:
 *
 *  1. every row is expanded into the list of number tuples that satisfy its own
 *     equation — a few hundred, out of tens of thousands of orderings;
 *  2. the same is done per column, and those are indexed by prefix;
 *  3. rows are then chosen top to bottom, and a partial board is dropped the
 *     moment a column prefix is one no valid column can start with.
 *
 * Step 3 is what makes it quick: a wrong number in row 0 is usually refuted long
 * before the bottom of the board is reached.
 */
object Solver {

    /** Cell values are packed 16 bits apart when a column prefix becomes a Long key. */
    private const val PACK_SHIFT = 16

    /**
     * @param assignment the board as it stands; [BoardSpec.EMPTY] marks a free
     *   cell. Givens and player moves alike count as fixed.
     * @param limit stop after this many solutions (2 is enough to test uniqueness).
     * @param nodeBudget guard so a pathological board cannot hang the caller.
     */
    fun solve(
        spec: BoardSpec,
        assignment: IntArray,
        limit: Int = 2,
        nodeBudget: Long = 3_000_000L,
    ): SolveResult {
        require(limit >= 1) { "limit must be positive" }
        require(assignment.size == spec.cellCount) { "assignment must cover the board" }
        val n = spec.size
        val pool = remainingPool(spec, assignment) ?: return SolveResult(0, null, true)

        val rowCandidates = Array(n) { line -> lineCandidates(spec, assignment, pool, line, vertical = false) }
        if (rowCandidates.any { it.isEmpty() }) return SolveResult(0, null, true)

        val colPrefixes = Array(n) { line ->
            val candidates = lineCandidates(spec, assignment, pool, line, vertical = true)
            if (candidates.isEmpty()) return SolveResult(0, null, true)
            prefixIndex(candidates, n)
        }

        val search = Search(n, rowCandidates, colPrefixes, pool.counts, limit, nodeBudget)
        search.run()

        val first = search.first?.let { rows ->
            val board = assignment.copyOf()
            for (r in 0 until n) for (c in 0 until n) board[spec.indexOf(r, c)] = rows[r][c]
            board
        }
        return SolveResult(search.count, first, search.exhausted)
    }

    /** A single completion of the board, or null when there is none. */
    fun findSolution(spec: BoardSpec, assignment: IntArray, nodeBudget: Long = 3_000_000L): IntArray? =
        solve(spec, assignment, limit = 1, nodeBudget = nodeBudget).first

    /** True when exactly one completion exists and the search proved it. */
    fun isUnique(spec: BoardSpec, assignment: IntArray, nodeBudget: Long = 3_000_000L): Boolean {
        val result = solve(spec, assignment, limit = 2, nodeBudget = nodeBudget)
        return result.exhausted && result.count == 1
    }

    /**
     * One way to fill a line: the whole tuple, plus which pool slot each free
     * cell of the line draws from. Cells that were already filled draw nothing,
     * which is what keeps banks with repeated numbers honest.
     */
    private class LineCandidate(val values: IntArray, val slots: IntArray)

    /** Distinct numbers still in hand, with how many of each. */
    private class Pool(val values: IntArray, val counts: IntArray)

    /** The bank minus everything on the board, or null if the board uses a number the bank does not have. */
    private fun remainingPool(spec: BoardSpec, assignment: IntArray): Pool? {
        val left = HashMap<Int, Int>()
        spec.bank.forEach { left[it] = (left[it] ?: 0) + 1 }
        for (value in assignment) {
            if (value == BoardSpec.EMPTY) continue
            val count = left[value] ?: return null
            if (count == 1) left.remove(value) else left[value] = count - 1
        }
        val values = left.keys.sorted().toIntArray()
        return Pool(values, IntArray(values.size) { left[values[it]]!! })
    }

    /**
     * Every tuple satisfying one line: cells already filled stay put, the rest
     * are drawn from the pool.
     */
    private fun lineCandidates(
        spec: BoardSpec,
        assignment: IntArray,
        pool: Pool,
        line: Int,
        vertical: Boolean,
    ): List<LineCandidate> {
        val n = spec.size
        val ops = spec.opsOf(line, vertical)
        val target = spec.targetOf(line, vertical)
        val fixed = spec.valuesOf(assignment, line, vertical)
        val freeCount = fixed.count { it == BoardSpec.EMPTY }
        val counts = pool.counts.copyOf()
        val values = IntArray(n)
        val slots = IntArray(freeCount)
        val out = ArrayList<LineCandidate>()

        fun place(position: Int, freeSeen: Int) {
            if (position == n) {
                if (Expression.evaluateInt(values, ops, spec.precedence) == target) {
                    out.add(LineCandidate(values.copyOf(), slots.copyOf()))
                }
                return
            }
            val given = fixed[position]
            if (given != BoardSpec.EMPTY) {
                values[position] = given
                place(position + 1, freeSeen)
                return
            }
            for (slot in pool.values.indices) {
                if (counts[slot] == 0) continue
                counts[slot]--
                values[position] = pool.values[slot]
                slots[freeSeen] = slot
                place(position + 1, freeSeen + 1)
                counts[slot]++
            }
        }

        place(0, 0)
        return out
    }

    /** For each prefix length, the set of prefixes some valid line starts with. */
    private fun prefixIndex(candidates: List<LineCandidate>, size: Int): Array<HashSet<Long>> =
        Array(size) { depth ->
            val set = HashSet<Long>()
            for (candidate in candidates) {
                var packed = 0L
                for (i in 0..depth) packed = (packed shl PACK_SHIFT) or candidate.values[i].toLong()
                set.add(packed)
            }
            set
        }

    private class Search(
        private val size: Int,
        private val rowCandidates: Array<List<LineCandidate>>,
        private val colPrefixes: Array<Array<HashSet<Long>>>,
        poolCounts: IntArray,
        private val limit: Int,
        private val nodeBudget: Long,
    ) {
        var count: Int = 0
        var first: Array<IntArray>? = null
        var exhausted: Boolean = true

        private val counts = poolCounts.copyOf()
        private val chosen = arrayOfNulls<IntArray>(size)
        private var nodes = 0L

        fun run() = step(0)

        private fun step(row: Int) {
            if (row == size) {
                count++
                if (first == null) first = Array(size) { chosen[it]!!.copyOf() }
                return
            }
            for (candidate in rowCandidates[row]) {
                if (++nodes > nodeBudget) {
                    exhausted = false
                    return
                }
                if (!take(candidate.slots)) continue
                chosen[row] = candidate.values
                if (columnsCanStillWork(row)) step(row + 1)
                chosen[row] = null
                give(candidate.slots)
                if (count >= limit || !exhausted) return
            }
        }

        /**
         * Rows 0..[filled] are on the board, so each column now shows a prefix
         * of that length: it has to be one some valid column actually starts
         * with. At the last row this is a full column check, not just a prefix.
         */
        private fun columnsCanStillWork(filled: Int): Boolean {
            for (col in 0 until size) {
                var packed = 0L
                for (row in 0..filled) packed = (packed shl PACK_SHIFT) or chosen[row]!![col].toLong()
                if (packed !in colPrefixes[col][filled]) return false
            }
            return true
        }

        private fun take(slots: IntArray): Boolean {
            for (i in slots.indices) {
                val slot = slots[i]
                if (counts[slot] == 0) {
                    for (j in 0 until i) counts[slots[j]]++
                    return false
                }
                counts[slot]--
            }
            return true
        }

        private fun give(slots: IntArray) {
            for (slot in slots) counts[slot]++
        }
    }
}
