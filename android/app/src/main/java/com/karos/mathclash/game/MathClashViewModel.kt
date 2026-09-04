package com.karos.mathclash.game

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.karos.mathclash.R
import com.karos.mathclash.data.LevelStats
import com.karos.mathclash.data.PlayerStore
import com.karos.mathclash.data.Profile
import com.karos.mathclash.data.Settings
import com.karos.mathclash.engine.BoardSpec
import com.karos.mathclash.engine.DailyChallenge
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Generator
import com.karos.mathclash.engine.Scoring
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * Holds the whole app: which screen is showing, the board being played, the
 * clock, and the save file. One place, because everything here is small and
 * shares the same lifetime.
 */
class MathClashViewModel(application: Application) : AndroidViewModel(application) {

    private val store = PlayerStore(application)

    private val _state = MutableStateFlow(
        AppState(
            settings = store.loadSettings(),
            profile = store.loadProfile(),
        )
    )
    val state: StateFlow<AppState> = _state.asStateFlow()

    private var play: BoardPlay? = null
    private var buildJob: Job? = null
    private var timerJob: Job? = null
    private var startedAt = 0L
    private var accumulated = 0
    private var bannerCounter = 0L

    init {
        refreshToday()
    }

    // ---------------------------------------------------------------- routing

    fun openHome() {
        stopTimer()
        buildJob?.cancel()
        play = null
        refreshToday()
        _state.update { it.copy(route = Route.HOME, session = null) }
    }

    fun open(route: Route) {
        _state.update { it.copy(route = route) }
    }

    /** The system back gesture. Returns false when there is nothing left to close. */
    fun onBack(): Boolean {
        val current = _state.value
        return when (current.route) {
            Route.HOME -> false
            Route.GAME -> { openHome(); true }
            else -> { _state.update { it.copy(route = Route.HOME) }; true }
        }
    }

    private fun refreshToday() {
        val today = CalendarDay.today()
        _state.update {
            it.copy(
                todayEpochDay = today.epochDay,
                dailyDifficulty = DailyChallenge.difficultyFor(today.isoDayOfWeek),
            )
        }
    }

    // ---------------------------------------------------------------- starting

    fun startPractice(difficulty: Difficulty) {
        beginSession(GameMode.Practice(difficulty), difficulty, index = 0, count = 0, seed = null)
    }

    fun startFocusRun() {
        val ladder = focusLadder(_state.value.profile.suggestedDifficulty())
        beginSession(GameMode.FocusRun(ladder), ladder.first(), index = 0, count = ladder.size, seed = null)
    }

    fun startDaily() {
        refreshToday()
        val today = CalendarDay.today()
        val difficulty = DailyChallenge.difficultyFor(today.isoDayOfWeek)
        val seed = DailyChallenge.seedFor(today.year, today.month, today.dayOfMonth)
        beginSession(
            GameMode.Daily(today.epochDay, difficulty),
            difficulty,
            index = 0,
            count = 1,
            seed = seed,
        )
    }

    /** Five boards that start below the player's level and finish above it. */
    private fun focusLadder(base: Difficulty): List<Difficulty> {
        val below = Difficulty.entries.getOrNull(base.ordinal - 1) ?: base
        val above = base.next ?: base
        return listOf(below, base, base, above, above)
    }

    private fun beginSession(mode: GameMode, difficulty: Difficulty, index: Int, count: Int, seed: Long?) {
        val previous = _state.value.session
        val carried = if (index == 0) emptyList() else previous?.runResults.orEmpty()
        val focusBefore = if (index == 0) _state.value.profile.focusIndex.roundToInt()
        else previous?.focusBefore ?: 0

        stopTimer()
        buildJob?.cancel()
        play = null
        _state.update {
            it.copy(
                route = Route.GAME,
                session = SessionState(
                    mode = mode,
                    difficulty = difficulty,
                    boardIndex = index,
                    boardCount = count,
                    hintsLeft = difficulty.hints,
                    runResults = carried,
                    focusBefore = focusBefore,
                ),
            )
        }

        buildJob = viewModelScope.launch {
            val precedence = _state.value.settings.precedence
            val puzzle = withContext(Dispatchers.Default) {
                Generator.generate(
                    difficulty.config(precedence),
                    if (seed != null) Random(seed) else Random(Random.nextLong()),
                )
            }
            val board = BoardPlay(puzzle)
            play = board
            accumulated = 0
            _state.update { current ->
                val session = current.session ?: return@update current
                current.copy(session = session.copy(puzzle = puzzle, board = board.snapshot()))
            }
            resumeTimer()
        }
    }

    fun nextBoard() {
        val session = _state.value.session ?: return
        when (val mode = session.mode) {
            is GameMode.Practice ->
                beginSession(mode, mode.difficulty, session.boardIndex + 1, 0, null)

            is GameMode.FocusRun -> {
                val next = session.boardIndex + 1
                if (next >= mode.ladder.size) openHome()
                else beginSession(mode, mode.ladder[next], next, mode.ladder.size, null)
            }

            is GameMode.Daily -> openHome()
        }
    }

    // ------------------------------------------------------------------ moves

    fun onCellTap(cell: Int) {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null || session.hintPending) return

        val armed = session.selectedValue
        when {
            armed != null && !board.isLocked(cell) -> placeNumber(cell, armed)

            !board.isLocked(cell) && board.valueAt(cell) != BoardSpec.EMPTY -> {
                board.clear(cell)
                publish(session.copy(selectedCell = cell, selectedValue = null))
            }

            else -> publish(session.copy(selectedCell = cell, selectedValue = null))
        }
    }

    fun onTrayTap(value: Int) {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null || session.hintPending) return
        if (board.remaining(value) <= 0) return

        val target = session.selectedCell
        if (target != null && !board.isLocked(target)) {
            placeNumber(target, value)
        } else {
            val armed = if (session.selectedValue == value) null else value
            publish(session.copy(selectedValue = armed))
        }
    }

    private fun placeNumber(cell: Int, value: Int) {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (!board.place(cell, value)) return
        publish(session.copy(selectedCell = nextEmptyCell(cell), selectedValue = null))
        checkFinished()
    }

    /** After a move the cursor walks on, so a run of placements needs no re-aiming. */
    private fun nextEmptyCell(from: Int): Int? {
        val board = play ?: return null
        val puzzle = _state.value.session?.puzzle ?: return null
        for (step in 1..puzzle.cellCount) {
            val candidate = (from + step) % puzzle.cellCount
            if (!board.isLocked(candidate) && board.valueAt(candidate) == BoardSpec.EMPTY) return candidate
        }
        return null
    }

    fun undo() {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null || session.hintPending) return
        if (board.undo()) publish(session.copy(selectedValue = null))
    }

    fun restartBoard() {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null) return
        board.restart()
        publish(session.copy(selectedCell = null, selectedValue = null))
    }

    fun useHint() {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null || session.hintPending) return
        if (session.hintsLeft <= 0) {
            publish(session.copy(banner = banner(R.string.hint_none)))
            return
        }

        publish(session.copy(hintPending = true, selectedValue = null))
        viewModelScope.launch {
            val outcome = withContext(Dispatchers.Default) { board.hint(session.hintsLeft) }
            val current = _state.value.session ?: return@launch
            val updated = when (outcome) {
                is HintResult.Revealed -> current.copy(
                    hintsLeft = current.hintsLeft - 1,
                    selectedCell = outcome.cell,
                    banner = banner(R.string.hint_opened),
                )

                is HintResult.UndidFirst -> current.copy(
                    hintsLeft = if (outcome.cell != null) current.hintsLeft - 1 else current.hintsLeft,
                    selectedCell = outcome.cell ?: current.selectedCell,
                    banner = banner(R.string.hint_rescued, outcome.cleared.size),
                )

                HintResult.Spent -> current.copy(banner = banner(R.string.hint_none))
                HintResult.Unavailable -> current.copy(banner = banner(R.string.hint_nothing))
            }
            publish(updated.copy(hintPending = false))
            checkFinished()
        }
    }

    fun dismissBanner() {
        val session = _state.value.session ?: return
        publish(session.copy(banner = null))
    }

    private fun banner(message: Int, arg: Int? = null) = Banner(++bannerCounter, message, arg)

    /** Copies the live board into the immutable state the UI renders. */
    private fun publish(session: SessionState) {
        val board = play ?: return
        _state.update { it.copy(session = session.copy(board = board.snapshot())) }
    }

    // ----------------------------------------------------------------- ending

    private fun checkFinished() {
        val board = play ?: return
        val session = _state.value.session ?: return
        if (session.result != null) return
        if (board.snapshot().solved) finishBoard(session, board)
    }

    private fun finishBoard(session: SessionState, board: BoardPlay) {
        pauseTimer()
        val seconds = max(1, currentSeconds())
        val reward = Scoring.reward(session.difficulty, seconds, board.hintsUsed, board.mistakes)

        val profile = _state.value.profile
        val levelStats = profile.statsFor(session.difficulty)
        val personalBest = levelStats.bestSeconds == null || seconds < levelStats.bestSeconds
        val updatedProfile = profile.record(
            difficulty = session.difficulty,
            seconds = seconds,
            reward = reward.score,
            rating = reward.rating,
            today = _state.value.todayEpochDay,
            isDaily = session.mode is GameMode.Daily,
        )
        store.saveProfile(updatedProfile)

        val result = BoardResult(
            difficulty = session.difficulty,
            seconds = seconds,
            score = reward.score,
            stars = reward.stars,
            hintsUsed = board.hintsUsed,
            mistakes = board.mistakes,
            personalBest = personalBest && levelStats.solved > 0,
        )

        _state.update {
            it.copy(
                profile = updatedProfile,
                session = session.copy(
                    board = board.snapshot(),
                    elapsedSeconds = seconds,
                    result = result,
                    runResults = session.runResults + result,
                    runFinished = session.isLastBoard && session.mode is GameMode.FocusRun,
                    focusAfter = updatedProfile.focusIndex.roundToInt(),
                ),
            )
        }
    }

    private fun Profile.record(
        difficulty: Difficulty,
        seconds: Int,
        reward: Int,
        rating: Double,
        today: Long,
        isDaily: Boolean,
    ): Profile {
        val stats = statsFor(difficulty)
        val streak = when (lastPlayedEpochDay) {
            today -> max(1, this.streak)
            today - 1 -> this.streak + 1
            else -> 1
        }
        return copy(
            solved = solved + 1,
            totalScore = totalScore + reward,
            totalSeconds = totalSeconds + seconds,
            streak = streak,
            bestStreak = max(bestStreak, streak),
            focusIndex = Scoring.updatedFocusIndex(focusIndex, rating, solved),
            lastPlayedEpochDay = today,
            dailyDoneEpochDay = if (isDaily) today else dailyDoneEpochDay,
            levels = levels + (
                difficulty to LevelStats(
                    solved = stats.solved + 1,
                    bestSeconds = stats.bestSeconds?.let { min -> if (seconds < min) seconds else min } ?: seconds,
                    bestScore = max(stats.bestScore, reward),
                )
                ),
            recentRatings = (recentRatings + rating.roundToInt()).takeLast(RECENT_KEPT),
        )
    }

    // ---------------------------------------------------------------- settings

    fun updateSettings(settings: Settings) {
        store.saveSettings(settings)
        _state.update { it.copy(settings = settings) }
    }

    fun resetProgress() {
        store.resetProgress()
        _state.update { it.copy(profile = store.loadProfile()) }
    }

    // ------------------------------------------------------------------- time

    private fun currentSeconds(): Int {
        val running = if (timerJob?.isActive == true) {
            ((SystemClock.elapsedRealtime() - startedAt) / 1000L).toInt()
        } else {
            0
        }
        return accumulated + running
    }

    fun onScreenResumed() {
        val session = _state.value.session ?: return
        if (session.isReady && session.result == null) resumeTimer()
    }

    fun onScreenPaused() {
        pauseTimer()
    }

    private fun resumeTimer() {
        if (timerJob?.isActive == true) return
        startedAt = SystemClock.elapsedRealtime()
        timerJob = viewModelScope.launch {
            while (isActive) {
                val seconds = currentSeconds()
                _state.update { current ->
                    val session = current.session ?: return@update current
                    if (session.elapsedSeconds == seconds) current
                    else current.copy(session = session.copy(elapsedSeconds = seconds))
                }
                delay(TICK_MILLIS)
            }
        }
    }

    private fun pauseTimer() {
        if (timerJob?.isActive == true) {
            accumulated += ((SystemClock.elapsedRealtime() - startedAt) / 1000L).toInt()
        }
        timerJob?.cancel()
        timerJob = null
    }

    private fun stopTimer() {
        timerJob?.cancel()
        timerJob = null
        accumulated = 0
    }

    private companion object {
        const val TICK_MILLIS = 250L
        const val RECENT_KEPT = 24
    }
}
