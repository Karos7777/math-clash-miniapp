package com.karos.mathclash.data

import android.content.Context
import android.content.SharedPreferences
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Precedence

/**
 * Local save file. Small enough that shared preferences is the right tool: a
 * handful of counters, one row per level, and the settings.
 */
class PlayerStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun loadSettings(): Settings = Settings(
        precedence = if (prefs.getBoolean(KEY_LEFT_TO_RIGHT, false)) {
            Precedence.LEFT_TO_RIGHT
        } else {
            Precedence.STANDARD
        },
        theme = runCatching { ThemeChoice.valueOf(prefs.getString(KEY_THEME, null) ?: "") }
            .getOrDefault(ThemeChoice.SYSTEM),
        haptics = prefs.getBoolean(KEY_HAPTICS, true),
    )

    fun saveSettings(settings: Settings) {
        prefs.edit()
            .putBoolean(KEY_LEFT_TO_RIGHT, settings.precedence == Precedence.LEFT_TO_RIGHT)
            .putString(KEY_THEME, settings.theme.name)
            .putBoolean(KEY_HAPTICS, settings.haptics)
            .apply()
    }

    fun loadProfile(): Profile {
        val levels = Difficulty.entries.associateWith { difficulty ->
            LevelStats(
                solved = prefs.getInt(levelKey(difficulty, "solved"), 0),
                bestSeconds = prefs.getInt(levelKey(difficulty, "best"), 0).takeIf { it > 0 },
                bestScore = prefs.getInt(levelKey(difficulty, "score"), 0),
            )
        }.filterValues { it.solved > 0 }

        return Profile(
            solved = prefs.getInt(KEY_SOLVED, 0),
            totalScore = prefs.getLong(KEY_TOTAL_SCORE, 0),
            totalSeconds = prefs.getLong(KEY_TOTAL_SECONDS, 0),
            streak = prefs.getInt(KEY_STREAK, 0),
            bestStreak = prefs.getInt(KEY_BEST_STREAK, 0),
            focusIndex = prefs.getFloat(KEY_FOCUS, 0f).toDouble(),
            lastPlayedEpochDay = prefs.getLong(KEY_LAST_DAY, 0),
            dailyDoneEpochDay = prefs.getLong(KEY_DAILY_DAY, 0),
            levels = levels,
            recentRatings = (prefs.getString(KEY_RECENT, "") ?: "")
                .split(',')
                .mapNotNull { it.trim().toIntOrNull() },
        )
    }

    fun saveProfile(profile: Profile) {
        val editor = prefs.edit()
            .putInt(KEY_SOLVED, profile.solved)
            .putLong(KEY_TOTAL_SCORE, profile.totalScore)
            .putLong(KEY_TOTAL_SECONDS, profile.totalSeconds)
            .putInt(KEY_STREAK, profile.streak)
            .putInt(KEY_BEST_STREAK, profile.bestStreak)
            .putFloat(KEY_FOCUS, profile.focusIndex.toFloat())
            .putLong(KEY_LAST_DAY, profile.lastPlayedEpochDay)
            .putLong(KEY_DAILY_DAY, profile.dailyDoneEpochDay)
            .putString(KEY_RECENT, profile.recentRatings.joinToString(","))
        Difficulty.entries.forEach { difficulty ->
            val stats = profile.statsFor(difficulty)
            editor.putInt(levelKey(difficulty, "solved"), stats.solved)
            editor.putInt(levelKey(difficulty, "best"), stats.bestSeconds ?: 0)
            editor.putInt(levelKey(difficulty, "score"), stats.bestScore)
        }
        editor.apply()
    }

    /** Wipes progress but keeps the settings the player chose. */
    fun resetProgress() {
        val settings = loadSettings()
        prefs.edit().clear().apply()
        saveSettings(settings)
    }

    private fun levelKey(difficulty: Difficulty, suffix: String) = "level_${difficulty.id}_$suffix"

    private companion object {
        const val FILE = "math_clash_player"
        const val KEY_LEFT_TO_RIGHT = "left_to_right"
        const val KEY_THEME = "theme"
        const val KEY_HAPTICS = "haptics"
        const val KEY_SOLVED = "solved"
        const val KEY_TOTAL_SCORE = "total_score"
        const val KEY_TOTAL_SECONDS = "total_seconds"
        const val KEY_STREAK = "streak"
        const val KEY_BEST_STREAK = "best_streak"
        const val KEY_FOCUS = "focus_index"
        const val KEY_LAST_DAY = "last_day"
        const val KEY_DAILY_DAY = "daily_day"
        const val KEY_RECENT = "recent"
    }
}
