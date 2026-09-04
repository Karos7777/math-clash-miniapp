package com.karos.mathclash.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.karos.mathclash.R
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.game.AppState
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.FocusDial
import com.karos.mathclash.ui.parts.ScreenHeader
import com.karos.mathclash.ui.parts.Sparkline
import com.karos.mathclash.ui.parts.StatTile
import com.karos.mathclash.ui.parts.formatDuration
import com.karos.mathclash.ui.parts.formatLongDuration
import com.karos.mathclash.ui.parts.label
import com.karos.mathclash.ui.parts.shapeLabel
import com.karos.mathclash.ui.theme.LocalClashColors
import kotlin.math.roundToInt

@Composable
fun StatsScreen(state: AppState, viewModel: MathClashViewModel) {
    val colors = LocalClashColors.current
    val profile = state.profile

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = stringResource(R.string.stats_title),
            onBack = viewModel::openHome,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            if (!profile.hasHistory) {
                ClashCard {
                    Text(
                        stringResource(R.string.stats_empty_title),
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.text,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        stringResource(R.string.stats_empty_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                    )
                }
                Spacer(Modifier.height(24.dp))
                return@Column
            }

            ClashCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FocusDial(
                        value = profile.focusIndex.roundToInt(),
                        caption = stringResource(R.string.stats_focus_index),
                    )
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            StatTile(
                                value = profile.solved.toString(),
                                label = stringResource(R.string.stats_solved),
                                accent = colors.accent,
                            )
                            StatTile(
                                value = profile.streak.toString(),
                                label = stringResource(R.string.stats_streak),
                                accent = colors.violet,
                            )
                            StatTile(
                                value = profile.bestStreak.toString(),
                                label = stringResource(R.string.stats_best_streak),
                                accent = colors.success,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            StatTile(
                                value = formatLongDuration(profile.totalSeconds),
                                label = stringResource(R.string.stats_time),
                                accent = colors.text,
                            )
                            StatTile(
                                value = profile.totalScore.toString(),
                                label = stringResource(R.string.stats_score),
                                accent = colors.text,
                            )
                        }
                    }
                }
                if (profile.recentRatings.size >= 3) {
                    Spacer(Modifier.height(16.dp))
                    Sparkline(
                        values = profile.recentRatings,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.stats_by_level),
                style = MaterialTheme.typography.titleMedium,
                color = colors.text,
            )
            Spacer(Modifier.height(10.dp))
            Difficulty.entries.forEach { difficulty ->
                val stats = profile.statsFor(difficulty)
                ClashCard(modifier = Modifier.padding(bottom = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                difficulty.label(),
                                style = MaterialTheme.typography.titleMedium,
                                color = colors.text,
                            )
                            Text(
                                difficulty.shapeLabel(),
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textFaint,
                            )
                        }
                        Text(
                            text = if (stats.solved == 0) {
                                stringResource(R.string.stats_level_empty)
                            } else {
                                stringResource(
                                    R.string.stats_level_row,
                                    stats.solved,
                                    formatDuration(stats.bestSeconds ?: 0),
                                )
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (stats.solved == 0) colors.textFaint else colors.textMuted,
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
