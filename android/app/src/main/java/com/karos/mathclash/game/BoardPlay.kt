package com.karos.mathclash.game

import com.karos.mathclash.engine.BoardSpec
import com.karos.mathclash.engine.LineState
import com.karos.mathclash.engine.LineStatus
import com.karos.mathclash.engine.Puzzle
import com.karos.mathclash.engine.Solver
import kotlin.random.Random

/** One number sitting in the tray at the bottom of the board. */
data class TraySlot(val value: Int, val remaining: Int)

/** Everything the board UI draws, as one comparable value. */
data class BoardSnapshot(
    val cells: List<Int>,
    val tray: List<TraySlot>,
    val rows: List<LineState>,
    val cols: List<LineState>,
    val locked: Set<Int>,
    val revealed: Set<Int>,
    val solved: Boolean,
    val hintsUsed: Int,
    val mistakes: Int,
    val canUndo: Boolean,
    val filledCells: Int,
    val lastChanged: Int?,
)

sealed interface HintResult {
    /** A cell was filled in and locked. */
    data class Revealed(val cell: Int, val value: Int) : HintResult

    /** Moves had to be taken back first because the board had been played into a dead end. */
    data class UndidFirst(val cleared: List<Int>, val cell: Int?, val value: Int?) : HintResult

    /** No hints left on this board. */
    data object Spent : HintResult

    /** The board is already full, or the search could not finish in time. */
    data object Unavailable : HintResult
}

/**
 * A board being played: what is on it, what is left in the tray, and every way
 * the player can change that.
 *
 * Deliberately free of Android so the rules can be unit tested on their own.
 */
class BoardPlay(val puzzle: Puzzle, private val random: Random = Random.Default) {

    private val spec: BoardSpec = puzzle.spec
    private val cells: IntArray = puzzle.emptyAssignment()
    private val history = ArrayList<Move>()
    private val revealed = LinkedHashSet<Int>()
    private var lineStatuses = statuses()
    private var lastChanged: Int? = null

    var hintsUsed: Int = 0
        private set

    /** How often a line has been completed with the wrong numbers in it. */
    var mistakes: Int = 0
        private set

    private class Move(val cell: Int, val previous: Int, val value: Int, val fromHint: Boolean)

    fun snapshot(): BoardSnapshot = BoardSnapshot(
        cells = cells.toList(),
        tray = tray(),
        rows = List(spec.size) { spec.lineState(cells, it, vertical = false) },
        cols = List(spec.size) { spec.lineState(cells, it, vertical = true) },
        locked = puzzle.givens.keys + revealed,
        revealed = revealed.toSet(),
        solved = spec.isSolved(cells),
        hintsUsed = hintsUsed,
        mistakes = mistakes,
        canUndo = history.lastOrNull()?.fromHint == false,
        filledCells = cells.count { it != BoardSpec.EMPTY },
        lastChanged = lastChanged,
    )

    fun isLocked(cell: Int): Boolean = puzzle.isGiven(cell) || cell in revealed

    fun valueAt(cell: Int): Int = cells[cell]

    /** How many of [value] are still in the tray. */
    fun remaining(value: Int): Int =
        puzzle.bank.count { it == value } - cells.count { it == value }

    /** Drops a number into a cell, swapping out whatever was there. */
    fun place(cell: Int, value: Int): Boolean {
        if (cell !in cells.indices || isLocked(cell)) return false
        val previous = cells[cell]
        if (previous == value) return false
        if (remaining(value) <= 0) return false
        apply(Move(cell, previous, value, fromHint = false))
        return true
    }

    /** Takes a number back off the board and into the tray. */
    fun clear(cell: Int): Boolean {
        if (cell !in cells.indices || isLocked(cell)) return false
        if (cells[cell] == BoardSpec.EMPTY) return false
        apply(Move(cell, cells[cell], BoardSpec.EMPTY, fromHint = false))
        return true
    }

    /** Takes back the last move. A revealed cell stays put — a hint cannot be un-asked. */
    fun undo(): Boolean {
        val move = history.lastOrNull() ?: return false
        if (move.fromHint) return false
        history.removeAt(history.lastIndex)
        cells[move.cell] = move.previous
        lastChanged = move.cell
        refreshMistakes()
        return true
    }

    /** Clears every number the player put down, leaving givens and hints. */
    fun restart() {
        for (index in cells.indices) {
            if (!isLocked(index)) cells[index] = BoardSpec.EMPTY
        }
        history.clear()
        lastChanged = null
        lineStatuses = statuses()
    }

    /**
     * Fills in one correct cell.
     *
     * If the board has been played into a corner — no arrangement of what is
     * left can finish it — the most recent moves are taken back first, until
     * the board can be saved, and the player is told which ones went.
     */
    fun hint(hintsLeft: Int): HintResult {
        if (hintsLeft <= 0) return HintResult.Spent

        val cleared = ArrayList<Int>()
        var solution = Solver.findSolution(spec, cells)
        while (solution == null && history.isNotEmpty()) {
            val move = history.removeAt(history.lastIndex)
            if (move.fromHint) {
                history.add(move)
                break
            }
            cells[move.cell] = move.previous
            if (move.cell !in cleared) cleared.add(move.cell)
            solution = Solver.findSolution(spec, cells)
        }
        if (solution == null) {
            refreshMistakes()
            return HintResult.Unavailable
        }

        val target = chooseCellToReveal()
        if (target == null) {
            refreshMistakes()
            return if (cleared.isEmpty()) HintResult.Unavailable
            else HintResult.UndidFirst(cleared, null, null)
        }

        val value = solution[target]
        hintsUsed++
        revealed.add(target)
        apply(Move(target, cells[target], value, fromHint = true))
        return if (cleared.isEmpty()) HintResult.Revealed(target, value)
        else HintResult.UndidFirst(cleared, target, value)
    }

    /** True when the player could still finish from here. */
    fun isSalvageable(): Boolean = Solver.findSolution(spec, cells) != null

    private fun apply(move: Move) {
        cells[move.cell] = move.value
        history.add(move)
        lastChanged = move.cell
        refreshMistakes()
    }

    /** A hint is most useful where the fewest cells are missing. */
    private fun chooseCellToReveal(): Int? {
        val empty = cells.indices.filter { cells[it] == BoardSpec.EMPTY }
        if (empty.isEmpty()) return null
        val ranked = empty.groupBy { cell ->
            val row = cell / spec.size
            val col = cell % spec.size
            val rowGaps = (0 until spec.size).count { cells[spec.indexOf(row, it)] == BoardSpec.EMPTY }
            val colGaps = (0 until spec.size).count { cells[spec.indexOf(it, col)] == BoardSpec.EMPTY }
            minOf(rowGaps, colGaps)
        }
        val best = ranked.keys.min()
        val choices = ranked.getValue(best)
        return choices[random.nextInt(choices.size)]
    }

    private fun tray(): List<TraySlot> =
        puzzle.bank.distinct().sorted().map { TraySlot(it, remaining(it)) }

    private fun statuses(): List<LineStatus> =
        List(spec.size) { spec.lineState(cells, it, vertical = false).status } +
            List(spec.size) { spec.lineState(cells, it, vertical = true).status }

    /** Counts a mistake each time a line is completed with the wrong numbers in it. */
    private fun refreshMistakes() {
        val updated = statuses()
        for (i in updated.indices) {
            if (updated[i] == LineStatus.WRONG && lineStatuses[i] != LineStatus.WRONG) mistakes++
        }
        lineStatuses = updated
    }
}
