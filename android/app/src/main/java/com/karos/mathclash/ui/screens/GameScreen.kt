package com.karos.mathclash.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.karos.mathclash.R
import com.karos.mathclash.engine.LineStatus
import com.karos.mathclash.game.AppState
import com.karos.mathclash.game.GameMode
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.game.SessionState
import com.karos.mathclash.ui.parts.BoardView
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.GhostButton
import com.karos.mathclash.ui.parts.ScreenHeader
import com.karos.mathclash.ui.parts.StatStrip
import com.karos.mathclash.ui.parts.TrayView
import com.karos.mathclash.ui.parts.formatDuration
import com.karos.mathclash.ui.parts.label
import com.karos.mathclash.ui.theme.LocalClashColors
import kotlinx.coroutines.delay

@Composable
fun GameScreen(state: AppState, viewModel: MathClashViewModel) {
    val session = state.session ?: return
    val colors = LocalClashColors.current
    var askLeave by remember { mutableStateOf(false) }
    var askRestart by remember { mutableStateOf(false) }

    BackHandler(enabled = true) {
        val played = session.board?.let { it.filledCells - (session.puzzle?.givens?.size ?: 0) } ?: 0
        if (session.result == null && played > 0) askLeave = true else viewModel.openHome()
    }

    // A short buzz whenever a line closes, if the player asked for it.
    val solvedLines = (session.board?.rows.orEmpty() + session.board?.cols.orEmpty())
        .count { it.status == LineStatus.SOLVED }
    val haptics = LocalHapticFeedback.current
    var lastSolvedLines by remember { mutableStateOf(0) }
    LaunchedEffect(solvedLines) {
        if (solvedLines > lastSolvedLines && state.settings.haptics) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        }
        lastSolvedLines = solvedLines
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(
                title = session.difficulty.label(),
                subtitle = subtitleFor(session),
                onBack = {
                    val played = session.board?.let {
                        it.filledCells - (session.puzzle?.givens?.size ?: 0)
                    } ?: 0
                    if (session.result == null && played > 0) askLeave = true else viewModel.openHome()
                },
            )

            StatStrip(
                items = listOf(
                    formatDuration(session.elapsedSeconds) to stringResource(R.string.game_time),
                    "$solvedLines/${(session.puzzle?.size ?: 0) * 2}" to stringResource(R.string.game_lines),
                    "${session.hintsLeft}" to stringResource(R.string.game_hints),
                    "${session.board?.mistakes ?: 0}" to stringResource(R.string.game_slips),
                ),
                modifier = Modifier.padding(horizontal = 18.dp),
            )

            val puzzle = session.puzzle
            val board = session.board
            if (puzzle == null || board == null) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator(color = colors.accent)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        stringResource(R.string.game_building),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                    )
                }
                return@Column
            }

            BoardView(
                puzzle = puzzle,
                board = board,
                selectedCell = session.selectedCell,
                onCellTap = viewModel::onCellTap,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )

            HelpLine(session)

            TrayView(
                tray = board.tray,
                selectedValue = session.selectedValue,
                onValueTap = viewModel::onTrayTap,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp),
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                GhostButton(
                    text = stringResource(R.string.action_undo),
                    onClick = viewModel::undo,
                    enabled = board.canUndo && session.result == null,
                    modifier = Modifier.weight(1f),
                )
                GhostButton(
                    text = "${stringResource(R.string.action_hint)} · ${session.hintsLeft}",
                    onClick = viewModel::useHint,
                    enabled = session.hintsLeft > 0 && !session.hintPending && session.result == null,
                    tint = colors.accent,
                    modifier = Modifier.weight(1.2f),
                )
                GhostButton(
                    text = stringResource(R.string.action_restart),
                    onClick = { askRestart = true },
                    enabled = session.result == null && board.canUndo,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        BannerStrip(session, viewModel)

        if (session.result != null && !session.runFinished) {
            SolvedOverlay(session, viewModel)
        }
        if (session.runFinished && session.result != null) {
            RunSummaryOverlay(session, viewModel)
        }
    }

    if (askLeave) {
        ConfirmDialog(
            title = stringResource(R.string.confirm_leave_title),
            text = stringResource(R.string.confirm_leave_text),
            confirm = stringResource(R.string.action_leave),
            onConfirm = {
                askLeave = false
                viewModel.openHome()
            },
            onDismiss = { askLeave = false },
        )
    }
    if (askRestart) {
        ConfirmDialog(
            title = stringResource(R.string.confirm_restart_title),
            text = stringResource(R.string.confirm_restart_text),
            confirm = stringResource(R.string.action_restart),
            onConfirm = {
                askRestart = false
                viewModel.restartBoard()
            },
            onDismiss = { askRestart = false },
        )
    }
}

@Composable
private fun subtitleFor(session: SessionState): String = when (session.mode) {
    is GameMode.FocusRun -> stringResource(
        R.string.game_board_of,
        session.boardIndex + 1,
        session.boardCount,
    )

    is GameMode.Daily -> stringResource(R.string.home_mode_daily)
    is GameMode.Practice -> stringResource(R.string.home_mode_practice)
}

@Composable
private fun HelpLine(session: SessionState) {
    val colors = LocalClashColors.current
    val armed = session.selectedValue
    val text = when {
        armed != null -> stringResource(R.string.game_help_place, armed)
        session.board?.tray?.none { it.remaining > 0 } == true -> stringResource(R.string.game_tray_empty)
        session.board?.filledCells != session.puzzle?.givens?.size -> stringResource(R.string.game_help_take)
        else -> stringResource(R.string.game_help_pick)
    }
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = colors.textMuted,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 6.dp),
    )
}

@Composable
private fun BoxScope.BannerStrip(
    session: SessionState,
    viewModel: MathClashViewModel,
) {
    val colors = LocalClashColors.current
    val banner = session.banner
    LaunchedEffect(banner?.id) {
        if (banner != null) {
            delay(2600)
            viewModel.dismissBanner()
        }
    }
    AnimatedVisibility(
        visible = banner != null,
        enter = fadeIn() + scaleIn(initialScale = 0.92f),
        exit = fadeOut(),
        modifier = Modifier
            .align(Alignment.TopCenter)
            .padding(top = 92.dp, start = 24.dp, end = 24.dp),
    ) {
        val text = banner?.let {
            if (it.arg != null) stringResource(it.message, it.arg) else stringResource(it.message)
        }.orEmpty()
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(colors.cardRaised)
                .clickable { viewModel.dismissBanner() }
                .padding(horizontal = 18.dp, vertical = 12.dp),
        ) {
            Text(text, style = MaterialTheme.typography.bodyMedium, color = colors.text)
        }
    }
}
