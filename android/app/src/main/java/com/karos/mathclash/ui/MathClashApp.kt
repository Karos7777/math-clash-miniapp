package com.karos.mathclash.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.karos.mathclash.data.ThemeChoice
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.game.Route
import com.karos.mathclash.ui.screens.GameScreen
import com.karos.mathclash.ui.screens.HomeScreen
import com.karos.mathclash.ui.screens.RulesScreen
import com.karos.mathclash.ui.screens.SettingsScreen
import com.karos.mathclash.ui.screens.StatsScreen
import com.karos.mathclash.ui.theme.LocalClashColors
import com.karos.mathclash.ui.theme.MathClashTheme

@Composable
fun MathClashApp(viewModel: MathClashViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    val dark = when (state.settings.theme) {
        ThemeChoice.SYSTEM -> isSystemInDarkTheme()
        ThemeChoice.DARK -> true
        ThemeChoice.LIGHT -> false
    }

    MathClashTheme(darkTheme = dark) {
        // The clock only runs while the board is actually in front of the player.
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.onScreenResumed() }
        LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { viewModel.onScreenPaused() }

        BackHandler(enabled = state.route != Route.HOME) { viewModel.onBack() }

        Surface(
            modifier = Modifier.fillMaxSize(),
            color = LocalClashColors.current.screen,
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
            ) {
                Crossfade(
                    targetState = state.route,
                    animationSpec = tween(220),
                    label = "route",
                ) { route ->
                    when (route) {
                        Route.HOME -> HomeScreen(state, viewModel)
                        Route.GAME -> GameScreen(state, viewModel)
                        Route.STATS -> StatsScreen(state, viewModel)
                        Route.RULES -> RulesScreen(state, viewModel)
                        Route.SETTINGS -> SettingsScreen(state, viewModel)
                    }
                }
            }
        }
    }
}
