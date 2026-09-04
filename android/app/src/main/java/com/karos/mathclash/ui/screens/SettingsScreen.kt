package com.karos.mathclash.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.karos.mathclash.BuildConfig
import com.karos.mathclash.R
import com.karos.mathclash.data.ThemeChoice
import com.karos.mathclash.engine.Precedence
import com.karos.mathclash.game.AppState
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.GhostButton
import com.karos.mathclash.ui.parts.ScreenHeader
import com.karos.mathclash.ui.theme.LocalClashColors

@Composable
fun SettingsScreen(state: AppState, viewModel: MathClashViewModel) {
    val colors = LocalClashColors.current
    val settings = state.settings
    var askReset by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(title = stringResource(R.string.settings_title), onBack = viewModel::openHome)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            ClashCard {
                Text(
                    stringResource(R.string.settings_order),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                )
                Spacer(Modifier.height(10.dp))
                ChoiceRow(
                    title = stringResource(R.string.settings_order_standard),
                    caption = stringResource(R.string.settings_order_standard_caption),
                    selected = settings.precedence == Precedence.STANDARD,
                    onClick = {
                        viewModel.updateSettings(settings.copy(precedence = Precedence.STANDARD))
                    },
                )
                Spacer(Modifier.height(8.dp))
                ChoiceRow(
                    title = stringResource(R.string.settings_order_ltr),
                    caption = stringResource(R.string.settings_order_ltr_caption),
                    selected = settings.precedence == Precedence.LEFT_TO_RIGHT,
                    onClick = {
                        viewModel.updateSettings(settings.copy(precedence = Precedence.LEFT_TO_RIGHT))
                    },
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    stringResource(R.string.settings_order_note),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textFaint,
                )
            }

            Spacer(Modifier.height(14.dp))
            ClashCard {
                Text(
                    stringResource(R.string.settings_theme),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemeChip(
                        label = stringResource(R.string.settings_theme_system),
                        selected = settings.theme == ThemeChoice.SYSTEM,
                        modifier = Modifier.weight(1f),
                    ) { viewModel.updateSettings(settings.copy(theme = ThemeChoice.SYSTEM)) }
                    ThemeChip(
                        label = stringResource(R.string.settings_theme_dark),
                        selected = settings.theme == ThemeChoice.DARK,
                        modifier = Modifier.weight(1f),
                    ) { viewModel.updateSettings(settings.copy(theme = ThemeChoice.DARK)) }
                    ThemeChip(
                        label = stringResource(R.string.settings_theme_light),
                        selected = settings.theme == ThemeChoice.LIGHT,
                        modifier = Modifier.weight(1f),
                    ) { viewModel.updateSettings(settings.copy(theme = ThemeChoice.LIGHT)) }
                }
            }

            Spacer(Modifier.height(14.dp))
            ClashCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.settings_haptics),
                            style = MaterialTheme.typography.titleMedium,
                            color = colors.text,
                        )
                        Text(
                            stringResource(R.string.settings_haptics_caption),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textMuted,
                        )
                    }
                    Switch(
                        checked = settings.haptics,
                        onCheckedChange = { viewModel.updateSettings(settings.copy(haptics = it)) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = colors.accent,
                            uncheckedTrackColor = colors.cellEmpty,
                            uncheckedBorderColor = colors.outline,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            ClashCard {
                Text(
                    stringResource(R.string.settings_reset),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                )
                Text(
                    stringResource(R.string.settings_reset_caption),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
                Spacer(Modifier.height(12.dp))
                GhostButton(
                    text = stringResource(R.string.action_reset),
                    onClick = { askReset = true },
                    tint = colors.danger,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(18.dp))
            Text(
                text = stringResource(R.string.settings_about, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.labelSmall,
                color = colors.textFaint,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(24.dp))
        }
    }

    if (askReset) {
        ConfirmDialog(
            title = stringResource(R.string.settings_reset_confirm),
            text = stringResource(R.string.settings_reset_confirm_text),
            confirm = stringResource(R.string.action_reset),
            onConfirm = {
                askReset = false
                viewModel.resetProgress()
            },
            onDismiss = { askReset = false },
        )
    }
}

@Composable
private fun ChoiceRow(title: String, caption: String, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalClashColors.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) colors.accentSoft else Color.Transparent)
            .border(1.dp, if (selected) colors.accent else colors.outline, shape)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .clip(RoundedCornerShape(50))
                .background(if (selected) colors.accent else Color.Transparent)
                .border(2.dp, if (selected) colors.accent else colors.outline, RoundedCornerShape(50)),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = colors.text)
            Text(caption, style = MaterialTheme.typography.bodySmall, color = colors.textMuted)
        }
    }
}

@Composable
private fun ThemeChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = LocalClashColors.current
    val shape = RoundedCornerShape(13.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(if (selected) colors.accent else colors.cellEmpty)
            .border(1.dp, if (selected) colors.accent else colors.outline, shape)
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) Color.White else colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}
