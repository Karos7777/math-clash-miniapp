package com.karos.mathclash.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.karos.mathclash.R
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.game.AppState
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.game.Route
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.FocusDial
import com.karos.mathclash.ui.parts.GhostButton
import com.karos.mathclash.ui.parts.PrimaryButton
import com.karos.mathclash.ui.parts.Sparkline
import com.karos.mathclash.ui.parts.StatTile
import com.karos.mathclash.ui.parts.formatLongDuration
import com.karos.mathclash.ui.parts.label
import com.karos.mathclash.ui.parts.shapeLabel
import com.karos.mathclash.ui.theme.LocalClashColors
import kotlin.math.roundToInt

@Composable
fun HomeScreen(state: AppState, viewModel: MathClashViewModel) {
    val colors = LocalClashColors.current
    var level by remember(state.profile.solved) {
        mutableStateOf(state.profile.suggestedDifficulty())
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp),
    ) {
        Spacer(Modifier.height(18.dp))
        Text(
            stringResource(R.string.app_name),
            style = MaterialTheme.typography.displaySmall,
            color = colors.text,
        )
        Text(
            stringResource(R.string.app_tagline),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textMuted,
        )

        Spacer(Modifier.height(18.dp))
        ClashCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FocusDial(
                    value = state.profile.focusIndex.roundToInt(),
                    caption = stringResource(R.string.home_focus_title),
                    diameter = 108.dp,
                )
                Spacer(Modifier.width(14.dp))
                Text(
                    text = stringResource(R.string.home_focus_caption),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                    modifier = Modifier.weight(1f),
                )
            }
            if (state.profile.recentRatings.size >= 3) {
                Spacer(Modifier.height(12.dp))
                Sparkline(
                    values = state.profile.recentRatings,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(34.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                StatTile(
                    value = state.profile.solved.toString(),
                    label = stringResource(R.string.home_stat_solved),
                    accent = colors.accent,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    value = state.profile.streak.toString(),
                    label = stringResource(R.string.home_stat_streak),
                    accent = colors.violet,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    value = compactScore(state.profile.totalScore),
                    label = stringResource(R.string.home_stat_score),
                    accent = colors.success,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(Modifier.height(14.dp))
        ModeCard(
            title = stringResource(R.string.home_mode_focus),
            caption = stringResource(R.string.home_mode_focus_caption),
            accent = colors.accent,
            onClick = viewModel::startFocusRun,
        )

        Spacer(Modifier.height(14.dp))
        ClashCard {
            Text(
                stringResource(R.string.home_mode_practice),
                style = MaterialTheme.typography.titleLarge,
                color = colors.text,
            )
            Text(
                stringResource(R.string.home_mode_practice_caption),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
            )
            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Difficulty.entries.forEach { difficulty ->
                    LevelChip(
                        difficulty = difficulty,
                        selected = difficulty == level,
                        onClick = { level = difficulty },
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                level.shapeLabel(),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
            )
            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                text = stringResource(R.string.home_play),
                onClick = { viewModel.startPractice(level) },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(14.dp))
        ModeCard(
            title = stringResource(R.string.home_mode_daily),
            caption = if (state.dailyDone) {
                stringResource(R.string.home_daily_done)
            } else {
                "${state.dailyDifficulty.label()} · ${stringResource(R.string.home_mode_daily_caption)}"
            },
            accent = if (state.dailyDone) colors.success else colors.violet,
            onClick = viewModel::startDaily,
        )

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GhostButton(
                text = stringResource(R.string.home_stats),
                onClick = { viewModel.open(Route.STATS) },
                modifier = Modifier.weight(1f),
            )
            GhostButton(
                text = stringResource(R.string.home_rules),
                onClick = { viewModel.open(Route.RULES) },
                modifier = Modifier.weight(1f),
            )
            GhostButton(
                text = stringResource(R.string.home_settings),
                onClick = { viewModel.open(Route.SETTINGS) },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(12.dp))
        if (state.profile.totalSeconds > 0) {
            Text(
                text = "${stringResource(R.string.stats_time)}: ${formatLongDuration(state.profile.totalSeconds)}",
                style = MaterialTheme.typography.labelSmall,
                color = colors.textFaint,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ModeCard(title: String, caption: String, accent: Color, onClick: () -> Unit) {
    val colors = LocalClashColors.current
    ClashCard(onClick = onClick, padding = PaddingValues(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(38.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(accent),
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = colors.text)
                Text(caption, style = MaterialTheme.typography.bodySmall, color = colors.textMuted)
            }
            Text("›", style = MaterialTheme.typography.headlineMedium, color = colors.textFaint)
        }
    }
}

@Composable
private fun LevelChip(difficulty: Difficulty, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalClashColors.current
    val shape = RoundedCornerShape(13.dp)
    Box(
        modifier = Modifier
            .clip(shape)
            .background(if (selected) colors.accent else colors.cellEmpty)
            .border(1.dp, if (selected) colors.accent else colors.outline, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        Text(
            text = difficulty.label(),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) Color.White else colors.textMuted,
        )
    }
}

private fun compactScore(score: Long): String = when {
    score >= 1_000_000 -> "${score / 100_000 / 10.0}M"
    score >= 10_000 -> "${score / 1000}k"
    else -> score.toString()
}
