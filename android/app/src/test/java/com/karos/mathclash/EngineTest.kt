package com.karos.mathclash

import com.karos.mathclash.engine.BoardSpec
import com.karos.mathclash.game.BoardPlay
import com.karos.mathclash.game.CalendarDay
import com.karos.mathclash.game.HintResult
import com.karos.mathclash.engine.DailyChallenge
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Expression
import com.karos.mathclash.engine.Generator
import com.karos.mathclash.engine.LineStatus
import com.karos.mathclash.engine.Op
import com.karos.mathclash.engine.Precedence
import com.karos.mathclash.engine.Puzzle
import com.karos.mathclash.engine.Scoring
import com.karos.mathclash.engine.Solver
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ExpressionTest {

    @Test
    fun `multiplication binds tighter than addition`() {
        assertEquals(14, eval(intArrayOf(2, 3, 4), listOf(Op.ADD, Op.MUL), Precedence.STANDARD))
        assertEquals(-1, eval(intArrayOf(1, 2, 3, 4), listOf(Op.SUB, Op.MUL, Op.ADD), Precedence.STANDARD))
    }

    @Test
    fun `left to right ignores precedence`() {
        assertEquals(20, eval(intArrayOf(2, 3, 4), listOf(Op.ADD, Op.MUL), Precedence.LEFT_TO_RIGHT))
    }

    @Test
    fun `division is exact, not rounded`() {
        assertNull(eval(intArrayOf(9, 2), listOf(Op.DIV), Precedence.STANDARD))
        // 12 / 8 x 2 is a whole 3 even though the middle step is not whole
        assertEquals(3, eval(intArrayOf(12, 8, 2), listOf(Op.DIV, Op.MUL), Precedence.STANDARD))
        assertNull(Expression.evaluateStrict(intArrayOf(12, 8, 2), listOf(Op.DIV, Op.MUL), Precedence.STANDARD))
    }

    private fun eval(values: IntArray, ops: List<Op>, precedence: Precedence) =
        Expression.evaluateInt(values, ops, precedence)
}

class GeneratorTest {

    @Test
    fun `every level produces a solvable board with a single answer`() {
        for (difficulty in Difficulty.entries) {
            val rounds = if (difficulty.size == 4) 3 else 8
            repeat(rounds) { round ->
                val puzzle = Generator.generate(
                    difficulty.config(Precedence.STANDARD),
                    Random(round * 7919L + difficulty.ordinal),
                )
                val label = "${difficulty.id}#$round"
                assertTrue("$label: the intended answer does not satisfy the board",
                    puzzle.spec.isSolved(puzzle.solution.toIntArray()))
                assertFalse("$label: a fresh board already counts as solved",
                    puzzle.spec.isSolved(puzzle.emptyAssignment()))
                assertEquals("$label: tray plus givens must be the whole bank",
                    puzzle.bank.sorted(), (puzzle.tray + puzzle.givens.values).sorted())

                val result = Solver.solve(puzzle.spec, puzzle.emptyAssignment(), limit = 2)
                assertTrue("$label: the solver cannot finish the board", result.hasSolution)
                if (puzzle.uniqueSolution) {
                    assertTrue("$label: claimed one answer, found ${result.count}",
                        result.exhausted && result.count == 1)
                }
            }
        }
    }

    @Test
    fun `targets stay inside the range the level promises`() {
        for (difficulty in Difficulty.entries) {
            val config = difficulty.config(Precedence.STANDARD)
            val puzzle = Generator.generate(config, Random(4242L + difficulty.ordinal))
            (puzzle.spec.rowTargets + puzzle.spec.colTargets).forEach { target ->
                assertTrue(
                    "${difficulty.id}: target $target outside ${config.minTarget}..${config.maxTarget}",
                    target in config.minTarget..config.maxTarget,
                )
            }
        }
    }

    @Test
    fun `the same seed always builds the same board`() {
        val seed = DailyChallenge.seedFor(2026, 9, 4)
        val first = Generator.generate(Difficulty.MEDIUM.config(Precedence.STANDARD), Random(seed))
        val second = Generator.generate(Difficulty.MEDIUM.config(Precedence.STANDARD), Random(seed))
        assertEquals(first.solution, second.solution)
        assertEquals(first.givens, second.givens)
        assertEquals(first.spec.rowTargets, second.spec.rowTargets)
        assertEquals(first.spec.colTargets, second.spec.colTargets)
    }

    @Test
    fun `the daily ladder covers the whole week`() {
        val week = (1..7).map { DailyChallenge.difficultyFor(it) }
        assertEquals(7, week.size)
        assertTrue("the week should get harder", week.last().ordinal > week.first().ordinal)
    }
}

class SolverTest {

    /** Exhaustive reference: try every arrangement of the numbers still in hand. */
    private fun bruteForce(spec: BoardSpec, assignment: IntArray): Int {
        val free = assignment.indices.filter { assignment[it] == BoardSpec.EMPTY }
        val pool = spec.bank.toMutableList()
        assignment.filter { it != BoardSpec.EMPTY }.forEach { pool.remove(it) }
        if (pool.size != free.size) return 0
        pool.sort()
        val board = assignment.copyOf()
        val used = BooleanArray(pool.size)
        var count = 0

        fun place(index: Int) {
            if (index == free.size) {
                if (spec.isSolved(board)) count++
                return
            }
            var previous = Int.MIN_VALUE
            for (p in pool.indices) {
                if (used[p] || pool[p] == previous) continue
                previous = pool[p]
                used[p] = true
                board[free[index]] = pool[p]
                place(index + 1)
                board[free[index]] = BoardSpec.EMPTY
                used[p] = false
            }
        }
        place(0)
        return count
    }

    @Test
    fun `pruned search agrees with exhaustive search`() {
        for (difficulty in listOf(Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD)) {
            repeat(3) { round ->
                val puzzle = Generator.generate(difficulty.config(Precedence.STANDARD), Random(1000L + round))
                val empty = puzzle.emptyAssignment()
                val expected = bruteForce(puzzle.spec, empty)
                val actual = Solver.solve(puzzle.spec, empty, limit = Int.MAX_VALUE, nodeBudget = 50_000_000L)
                assertTrue("${difficulty.id}#$round: search gave up", actual.exhausted)
                assertEquals("${difficulty.id}#$round", expected, actual.count)
            }
        }
    }

    @Test
    fun `a board played into a dead end reports no answer`() {
        val puzzle = Generator.generate(Difficulty.MEDIUM.config(Precedence.STANDARD), Random(11))
        val board = puzzle.emptyAssignment()
        val free = board.indices.filter { board[it] == BoardSpec.EMPTY }
        // swap two numbers so no arrangement of the rest can rescue the board
        val a = free[0]
        val b = free.first { puzzle.solution[it] != puzzle.solution[a] }
        board[a] = puzzle.solution[b]
        board[b] = puzzle.solution[a]
        val brute = bruteForce(puzzle.spec, board)
        val solved = Solver.solve(puzzle.spec, board, limit = 2)
        assertEquals(brute, solved.count)
        if (brute == 0) assertNull(solved.first)
    }
}

class BoardPlayTest {

    @Test
    fun `playing the answer solves the board and empties the tray`() {
        for (difficulty in Difficulty.entries) {
            val puzzle = Generator.generate(difficulty.config(Precedence.STANDARD), Random(500L + difficulty.ordinal))
            val play = BoardPlay(puzzle, Random(1))
            puzzle.solution.indices.forEach { cell ->
                if (!play.isLocked(cell)) {
                    assertTrue("${difficulty.id}: a legal move was rejected", play.place(cell, puzzle.solution[cell]))
                }
            }
            val snapshot = play.snapshot()
            assertTrue("${difficulty.id}: a correct board was not recognised", snapshot.solved)
            assertTrue("${difficulty.id}: numbers left over", snapshot.tray.all { it.remaining == 0 })
            assertTrue("${difficulty.id}: a line is not green",
                snapshot.rows.all { it.status == LineStatus.SOLVED })
            assertEquals("${difficulty.id}: a clean solve counted mistakes", 0, snapshot.mistakes)
        }
    }

    @Test
    fun `givens cannot be touched and undo walks the board back`() {
        val puzzle = puzzleWithGivens()
        val play = BoardPlay(puzzle, Random(2))
        puzzle.givens.keys.forEach { cell ->
            assertFalse(play.place(cell, puzzle.bank.first()))
            assertFalse(play.clear(cell))
        }
        puzzle.solution.indices.forEach { cell ->
            if (!play.isLocked(cell)) play.place(cell, puzzle.solution[cell])
        }
        var undone = 0
        while (play.undo()) undone++
        assertEquals(puzzle.tray.size, undone)
        assertEquals(puzzle.givens.size, play.snapshot().filledCells)
    }

    @Test
    fun `a hint opens a cell and locks it`() {
        val puzzle = Generator.generate(Difficulty.HARD.config(Precedence.STANDARD), Random(7))
        val play = BoardPlay(puzzle, Random(1))
        val outcome = play.hint(hintsLeft = 2)
        assertTrue("expected a revealed cell but got $outcome",
            outcome is HintResult.Revealed)
        val cell = (outcome as HintResult.Revealed).cell
        assertTrue(play.isLocked(cell))
        assertFalse("a hint must not be undoable", play.undo())
        assertTrue("the board stopped being solvable", play.isSalvageable())
    }

    @Test
    fun `a hint digs the player out of a dead end`() {
        val puzzle = Generator.generate(Difficulty.MEDIUM.config(Precedence.STANDARD), Random(11))
        val play = BoardPlay(puzzle, Random(2))
        val free = puzzle.solution.indices.filter { !play.isLocked(it) }
        val a = free[0]
        val b = free.first { puzzle.solution[it] != puzzle.solution[a] }
        play.place(a, puzzle.solution[b])
        play.place(b, puzzle.solution[a])
        var index = 2
        while (play.isSalvageable() && index < free.size) {
            play.place(free[index], puzzle.solution[free[(index + 1) % free.size]])
            index++
        }
        assertFalse("could not steer the board into a dead end", play.isSalvageable())
        val outcome = play.hint(hintsLeft = 3)
        assertTrue("expected a rescue but got $outcome",
            outcome is HintResult.UndidFirst)
        assertTrue("the board is still stuck after the rescue", play.isSalvageable())
    }

    private fun puzzleWithGivens(): Puzzle =
        generateSequence(0) { it + 1 }
            .map { Generator.generate(Difficulty.EASY.config(Precedence.STANDARD), Random(300L + it)) }
            .first { it.givens.isNotEmpty() }
}

class ScoringTest {

    @Test
    fun `finishing faster is worth more`() {
        val quick = Scoring.reward(Difficulty.MEDIUM, seconds = 60, hintsUsed = 0, mistakes = 0)
        val slow = Scoring.reward(Difficulty.MEDIUM, seconds = 600, hintsUsed = 0, mistakes = 0)
        assertTrue(quick.score > slow.score)
        assertEquals(3, quick.stars)
    }

    @Test
    fun `hints and wrong lines cost score but never take it below zero`() {
        val clean = Scoring.reward(Difficulty.HARD, 200, hintsUsed = 0, mistakes = 0)
        val helped = Scoring.reward(Difficulty.HARD, 200, hintsUsed = 2, mistakes = 5)
        assertTrue(helped.score < clean.score)
        assertTrue(helped.score > 0)
    }

    @Test
    fun `the first board sets the focus index instead of averaging against zero`() {
        val first = Scoring.updatedFocusIndex(current = 0.0, rating = 120.0, boardsPlayed = 0)
        assertEquals(120.0, first, 0.001)
        val later = Scoring.updatedFocusIndex(current = 120.0, rating = 60.0, boardsPlayed = 20)
        assertTrue(later in 60.0..120.0)
    }

    @Test
    fun `a harder level is worth more for the same time`() {
        val easy = Scoring.reward(Difficulty.EASY, 120, 0, 0)
        val insane = Scoring.reward(Difficulty.INSANE, 120, 0, 0)
        assertTrue(insane.score > easy.score)
        assertNotNull(easy)
    }
}

class CalendarDayTest {

    @Test
    fun `epoch day matches the civil calendar`() {
        assertEquals(0L, CalendarDay.epochDayOf(1970, 1, 1))
        assertEquals(-1L, CalendarDay.epochDayOf(1969, 12, 31))
        assertEquals(1L, CalendarDay.epochDayOf(1970, 1, 2))
        assertEquals(19_000L, CalendarDay.epochDayOf(2022, 1, 8))
        assertEquals(20_700L, CalendarDay.epochDayOf(2026, 9, 4))
        // a leap day and the day after it
        assertEquals(CalendarDay.epochDayOf(2024, 2, 29) + 1, CalendarDay.epochDayOf(2024, 3, 1))
        // century rules: 1900 was not a leap year, 2000 was
        assertEquals(CalendarDay.epochDayOf(1900, 2, 28) + 1, CalendarDay.epochDayOf(1900, 3, 1))
        assertEquals(CalendarDay.epochDayOf(2000, 2, 28) + 2, CalendarDay.epochDayOf(2000, 3, 1))
    }

    @Test
    fun `consecutive days are consecutive numbers across a year boundary`() {
        var previous = CalendarDay.epochDayOf(2025, 12, 30)
        for ((y, m, d) in listOf(Triple(2025, 12, 31), Triple(2026, 1, 1), Triple(2026, 1, 2))) {
            val current = CalendarDay.epochDayOf(y, m, d)
            assertEquals("$y-$m-$d", previous + 1, current)
            previous = current
        }
    }

    @Test
    fun `weekdays are numbered from monday`() {
        val zone = java.util.TimeZone.getTimeZone("UTC")
        // 2026-08-31 is a Monday, so the week runs through to Sunday 2026-09-06.
        val monday = CalendarDay.epochDayOf(2026, 8, 31)
        val week = (0..6).map { offset ->
            val midday = (monday + offset) * 86_400_000L + 12 * 3_600_000L
            CalendarDay.today(midday, zone).isoDayOfWeek
        }
        assertEquals(listOf(1, 2, 3, 4, 5, 6, 7), week)

        val friday = CalendarDay.today((monday + 4) * 86_400_000L + 12 * 3_600_000L, zone)
        assertEquals(2026, friday.year)
        assertEquals(9, friday.month)
        assertEquals(4, friday.dayOfMonth)
        assertEquals(monday + 4, friday.epochDay)
    }

    @Test
    fun `today agrees with itself`() {
        val day = CalendarDay.today()
        assertEquals(day.epochDay, CalendarDay.epochDayOf(day.year, day.month, day.dayOfMonth))
        assertTrue(day.isoDayOfWeek in 1..7)
        assertTrue(day.month in 1..12)
        assertTrue(day.dayOfMonth in 1..31)
    }
}
