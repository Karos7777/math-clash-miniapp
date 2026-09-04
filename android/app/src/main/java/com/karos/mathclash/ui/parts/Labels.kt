package com.karos.mathclash.ui.parts

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.karos.mathclash.R
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Precedence

@Composable
fun Difficulty.label(): String = stringResource(
    when (this) {
        Difficulty.WARMUP -> R.string.difficulty_warmup
        Difficulty.EASY -> R.string.difficulty_easy
        Difficulty.MEDIUM -> R.string.difficulty_medium
        Difficulty.HARD -> R.string.difficulty_hard
        Difficulty.EXPERT -> R.string.difficulty_expert
        Difficulty.INSANE -> R.string.difficulty_insane
    }
)

/** e.g. `3×3 · + − ×` — the board size and which operators can turn up on it. */
@Composable
fun Difficulty.shapeLabel(): String = stringResource(R.string.difficulty_shape, size, operatorsLabel())

fun Difficulty.operatorsLabel(): String =
    config(Precedence.STANDARD).ops.joinToString(" ") { it.symbol }

/** `2:07`, or `41:07` for a long sitting. */
fun formatDuration(totalSeconds: Int): String {
    val safe = if (totalSeconds < 0) 0 else totalSeconds
    val hours = safe / 3600
    val minutes = (safe % 3600) / 60
    val seconds = safe % 60
    return if (hours > 0) {
        "$hours:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
    } else {
        "$minutes:${seconds.toString().padStart(2, '0')}"
    }
}

fun formatLongDuration(totalSeconds: Long): String =
    formatDuration(totalSeconds.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
