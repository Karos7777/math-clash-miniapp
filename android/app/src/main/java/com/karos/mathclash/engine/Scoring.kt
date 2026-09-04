package com.karos.mathclash.engine

import kotlin.math.max
import kotlin.math.roundToInt

/** What a finished board is worth, and what it says about the run. */
class Reward(val score: Int, val stars: Int, val rating: Double)

object Scoring {

    /** Fastest and slowest the clock is allowed to move the score. */
    private const val MIN_PACE = 0.3
    private const val MAX_PACE = 2.0

    fun reward(difficulty: Difficulty, seconds: Int, hintsUsed: Int, mistakes: Int): Reward {
        val pace = pace(difficulty, seconds)
        val cleanliness = cleanliness(hintsUsed, mistakes)
        val score = (1000.0 * difficulty.scoreWeight * pace * cleanliness).roundToInt()
        return Reward(score, stars(difficulty, seconds, hintsUsed), 100.0 * pace * cleanliness)
    }

    /** How the time compares with par: 1.0 is exactly on par, 2.0 is twice as fast. */
    fun pace(difficulty: Difficulty, seconds: Int): Double =
        (difficulty.parSeconds.toDouble() / max(1, seconds)).coerceIn(MIN_PACE, MAX_PACE)

    private fun cleanliness(hintsUsed: Int, mistakes: Int): Double =
        (1.0 - 0.18 * hintsUsed - 0.04 * mistakes).coerceAtLeast(0.35)

    fun stars(difficulty: Difficulty, seconds: Int, hintsUsed: Int): Int = when {
        hintsUsed == 0 && seconds <= difficulty.parSeconds * 0.8 -> 3
        hintsUsed <= 1 && seconds <= difficulty.parSeconds * 1.7 -> 2
        else -> 1
    }

    /**
     * The focus index: a rolling read on pace and accuracy over recent boards,
     * where 100 means "on par, no help". It is a training log, not a test score.
     */
    fun updatedFocusIndex(current: Double, rating: Double, boardsPlayed: Int): Double {
        // The very first board sets the mark rather than being averaged against zero.
        if (boardsPlayed <= 0) return rating.coerceIn(0.0, 200.0)
        // Move fast while there is little history, then settle down.
        val weight = if (boardsPlayed < 5) 0.5 else 0.28
        return (current * (1 - weight) + rating * weight).coerceIn(0.0, 200.0)
    }
}
