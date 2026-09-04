package com.karos.mathclash.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.karos.mathclash.R
import com.karos.mathclash.engine.Difficulty
import com.karos.mathclash.engine.Generator
import com.karos.mathclash.engine.Precedence
import com.karos.mathclash.game.AppState
import com.karos.mathclash.game.BoardPlay
import com.karos.mathclash.game.MathClashViewModel
import com.karos.mathclash.ui.parts.BoardView
import com.karos.mathclash.ui.parts.ClashCard
import com.karos.mathclash.ui.parts.ScreenHeader
import com.karos.mathclash.ui.theme.LocalClashColors
import kotlin.random.Random

@Composable
fun RulesScreen(state: AppState, viewModel: MathClashViewModel) {
    val colors = LocalClashColors.current
    val precedence = state.settings.precedence

    // A real solved board, built here rather than drawn, so the illustration can
    // never drift away from the rules it is illustrating.
    val example = remember(precedence) {
        val puzzle = Generator.generate(
            Difficulty.EASY.config(precedence),
            Random(EXAMPLE_SEED),
        )
        val play = BoardPlay(puzzle)
        puzzle.solution.indices.forEach { cell ->
            if (!play.isLocked(cell)) play.place(cell, puzzle.solution[cell])
        }
        puzzle to play.snapshot()
    }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(title = stringResource(R.string.rules_title), onBack = viewModel::openHome)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Section(stringResource(R.string.rules_goal_title), stringResource(R.string.rules_goal_body))

            ClashCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    stringResource(R.string.rules_example_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                )
                Spacer(Modifier.height(12.dp))
                BoardView(
                    puzzle = example.first,
                    board = example.second,
                    selectedCell = null,
                    onCellTap = {},
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(320.dp),
                )
            }
            Spacer(Modifier.height(16.dp))

            Section(stringResource(R.string.rules_cross_title), stringResource(R.string.rules_cross_body))
            val orderRule = if (precedence == Precedence.STANDARD) {
                stringResource(R.string.rules_order_standard)
            } else {
                stringResource(R.string.rules_order_ltr)
            }
            val orderSwitch = stringResource(R.string.rules_order_switch)
            Section(stringResource(R.string.rules_order_title), "$orderRule $orderSwitch")
            Section(stringResource(R.string.rules_controls_title), stringResource(R.string.rules_controls_body))
            Section(stringResource(R.string.rules_train_title), stringResource(R.string.rules_train_body))
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Section(title: String, body: String) {
    val colors = LocalClashColors.current
    ClashCard(modifier = Modifier.padding(bottom = 12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = colors.text)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = colors.textMuted)
    }
}

private const val EXAMPLE_SEED = 20260904L
