package com.karos.mathclash.data

import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Precedence

enum class ThemeChoice { SYSTEM, DARK, LIGHT }

data class Settings(
    val precedence: Precedence = Precedence.STANDARD,
    val theme: ThemeChoice = ThemeChoice.SYSTEM,
    val haptics: Boolean = true,
)

data class LevelStats(
    val solved: Int = 0,
    val bestSeconds: Int? = null,
    val bestScore: Int = 0,
)

/** Everything the player has to show for their time, kept on the device. */
data class Profile(
    val solved: Int = 0,
    val totalScore: Long = 0,
    val totalSeconds: Long = 0,
    val streak: Int = 0,
    val bestStreak: Int = 0,
    val focusIndex: Double = 0.0,
    val lastPlayedEpochDay: Long = 0,
    val dailyDoneEpochDay: Long = 0,
    val levels: Map<Difficulty, LevelStats> = emptyMap(),
    /** Ratings of the most recent boards, oldest first, for the trend line. */
    val recentRatings: List<Int> = emptyList(),
) {
    fun statsFor(difficulty: Difficulty): LevelStats = levels[difficulty] ?: LevelStats()

    val hasHistory: Boolean get() = solved > 0

    /** The hardest level ever solved decides what the practice card offers next. */
    fun suggestedDifficulty(): Difficulty {
        val cleared = Difficulty.entries.filter { statsFor(it).solved > 0 }
        val hardest = cleared.maxByOrNull { it.ordinal } ?: return Difficulty.EASY
        return if (statsFor(hardest).solved >= 3) hardest.next ?: hardest else hardest
    }
}
