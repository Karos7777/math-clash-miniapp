package com.karos.mathclash.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import com.karos.mathclash.R
import com.karos.mathclash.game.BoardResult
import com.karos.mathclash.game.GameMode
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.game.SessionState
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.GhostButton
import com.karos.mathclash.ui.parts.PrimaryButton
import com.karos.mathclash.ui.parts.StarRow
import com.karos.mathclash.ui.parts.formatDuration
import com.karos.mathclash.ui.parts.label
import com.karos.mathclash.ui.theme.LocalClashColors

/** What comes up the moment the last number lands correctly. */
@Composable
fun SolvedOverlay(session: SessionState, viewModel: MathClashViewModel) {
    val result = session.result ?: return
    Scrim {
        ClashCard(modifier = Modifier.widthIn(max = 380.dp)) {
            Text(
                stringResource(R.string.result_title),
                style = MaterialTheme.typography.headlineMedium,
                color = LocalClashColors.current.text,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                session.difficulty.label(),
                style = MaterialTheme.typography.bodyMedium,
                color = LocalClashColors.current.textMuted,
            )
            Spacer(Modifier.height(18.dp))
            StarRow(result.stars)
            Spacer(Modifier.height(18.dp))
            ResultRows(result)
            Spacer(Modifier.height(22.dp))
            val lastOfItsKind = session.mode is GameMode.Daily
            PrimaryButton(
                text = if (lastOfItsKind) {
                    stringResource(R.string.action_home)
                } else {
                    stringResource(R.string.action_next)
                },
                onClick = viewModel::nextBoard,
                modifier = Modifier.fillMaxWidth(),
            )
            if (!lastOfItsKind) {
                Spacer(Modifier.height(8.dp))
                GhostButton(
                    text = stringResource(R.string.action_home),
                    onClick = viewModel::openHome,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** The report at the end of a five board focus run. */
@Composable
fun RunSummaryOverlay(session: SessionState, viewModel: MathClashViewModel) {
    val colors = LocalClashColors.current
    val results = session.runResults
    val totalTime = results.sumOf { it.seconds }
    val totalScore = results.sumOf { it.score }
    val delta = session.focusAfter - session.focusBefore

    Scrim {
        ClashCard(modifier = Modifier.widthIn(max = 400.dp)) {
            Text(
                stringResource(R.string.focus_done_title),
                style = MaterialTheme.typography.headlineMedium,
                color = colors.text,
            )
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                SummaryFigure(formatDuration(totalTime), stringResource(R.string.focus_total_time))
                SummaryFigure(totalScore.toString(), stringResource(R.string.focus_total_score))
                SummaryFigure(
                    session.focusAfter.toString(),
                    stringResource(R.string.stats_focus_index),
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (delta > 0) {
                    stringResource(R.string.focus_index_up, delta)
                } else {
                    stringResource(R.string.focus_index_flat)
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (delta > 0) colors.success else colors.textMuted,
            )
            Spacer(Modifier.height(16.dp))
            results.forEachIndexed { index, board ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${index + 1}. ${board.difficulty.label()}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                        modifier = Modifier.weight(1f),
                    )
                    StarRow(board.stars, size = 13)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        formatDuration(board.seconds),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.text,
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
            PrimaryButton(
                text = stringResource(R.string.action_home),
                onClick = viewModel::openHome,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun SummaryFigure(value: String, label: String) {
    val colors = LocalClashColors.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.headlineSmall, color = colors.text)
        Text(label, style = MaterialTheme.typography.labelSmall, color = colors.textMuted)
    }
}

@Composable
private fun ResultRows(result: BoardResult) {
    val colors = LocalClashColors.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ResultRow(stringResource(R.string.result_time), formatDuration(result.seconds))
        ResultRow(stringResource(R.string.result_score), result.score.toString())
        ResultRow(stringResource(R.string.result_hints), result.hintsUsed.toString())
        ResultRow(stringResource(R.string.result_slips), result.mistakes.toString())
        if (result.personalBest) {
            Text(
                stringResource(R.string.result_personal_best),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.success,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ResultRow(label: String, value: String) {
    val colors = LocalClashColors.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = colors.textMuted)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = colors.text)
    }
}

@Composable
private fun Scrim(content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val progress by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(260),
        label = "overlay",
    )
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.62f * progress))
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier.graphicsLayer {
                alpha = progress
                scaleX = 0.92f + 0.08f * progress
                scaleY = 0.92f + 0.08f * progress
            },
        ) {
            content()
        }
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = LocalClashColors.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, color = colors.text) },
        text = { Text(text, color = colors.textMuted) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirm, color = colors.accent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_cancel), color = colors.textMuted)
            }
        },
        containerColor = colors.card,
    )
}
