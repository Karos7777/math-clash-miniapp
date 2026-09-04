package com.karos.mathclash.game

import com.karos.mathclash.data.Profile
import com.karos.mathclash.data.Settings
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Puzzle

enum class Route { HOME, GAME, STATS, RULES, SETTINGS }

sealed interface GameMode {
    /** Endless boards at one level. */
    data class Practice(val difficulty: Difficulty) : GameMode

    /** A fixed ladder of boards under one clock. */
    data class FocusRun(val ladder: List<Difficulty>) : GameMode

    /** Today's board, the same one on every device. */
    data class Daily(val epochDay: Long, val difficulty: Difficulty) : GameMode
}

data class BoardResult(
    val difficulty: Difficulty,
    val seconds: Int,
    val score: Int,
    val stars: Int,
    val hintsUsed: Int,
    val mistakes: Int,
    val personalBest: Boolean,
)

/** A short message shown over the board; [id] makes repeats of the same text land. */
data class Banner(val id: Long, val message: Int, val arg: Int? = null)

data class SessionState(
    val mode: GameMode,
    val difficulty: Difficulty,
    val boardIndex: Int = 0,
    /** 0 means the mode never ends on its own. */
    val boardCount: Int = 0,
    val puzzle: Puzzle? = null,
    val board: BoardSnapshot? = null,
    val elapsedSeconds: Int = 0,
    val hintsLeft: Int = 0,
    val selectedCell: Int? = null,
    val selectedValue: Int? = null,
    val hintPending: Boolean = false,
    val banner: Banner? = null,
    val result: BoardResult? = null,
    val runResults: List<BoardResult> = emptyList(),
    val runFinished: Boolean = false,
    val focusBefore: Int = 0,
    val focusAfter: Int = 0,
) {
    val isReady: Boolean get() = puzzle != null && board != null
    val isLastBoard: Boolean get() = boardCount > 0 && boardIndex + 1 >= boardCount
}

data class AppState(
    val route: Route = Route.HOME,
    val settings: Settings = Settings(),
    val profile: Profile = Profile(),
    val session: SessionState? = null,
    val todayEpochDay: Long = 0,
    val dailyDifficulty: Difficulty = Difficulty.EASY,
) {
    val dailyDone: Boolean get() = profile.dailyDoneEpochDay == todayEpochDay && todayEpochDay != 0L
}
