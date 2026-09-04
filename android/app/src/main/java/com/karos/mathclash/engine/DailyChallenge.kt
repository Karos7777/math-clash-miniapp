package com.karos.mathclash.engine

/**
 * One board a day, the same one for everybody, rebuilt from the date rather
 * than downloaded. The week ramps up: a gentle Monday, a brutal Sunday.
 */
object DailyChallenge {

    fun seedFor(year: Int, month: Int, dayOfMonth: Int): Long =
        year * 10_000L + month * 100L + dayOfMonth

    /** @param dayOfWeek 1 = Monday .. 7 = Sunday, matching java.time. */
    fun difficultyFor(dayOfWeek: Int): Difficulty = when (dayOfWeek) {
        1 -> Difficulty.EASY
        2 -> Difficulty.MEDIUM
        3 -> Difficulty.MEDIUM
        4 -> Difficulty.HARD
        5 -> Difficulty.HARD
        6 -> Difficulty.EXPERT
        else -> Difficulty.INSANE
    }
}
