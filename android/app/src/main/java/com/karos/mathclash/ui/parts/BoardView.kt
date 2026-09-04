package com.karos.mathclash.ui.parts

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.karos.mathclash.R
import com.karos.mathclash.engine.BoardSpec
import com.karos.mathclash.engine.LineState
import com.karos.mathclash.engine.LineStatus
import com.karos.mathclash.engine.Op
import com.karos.mathclash.engine.Puzzle
import com.karos.mathclash.game.BoardSnapshot
import com.karos.mathclash.ui.theme.LocalClashColors

private const val OP_FACTOR = 0.60f
private const val EQUALS_FACTOR = 0.46f
private const val TARGET_FACTOR = 1.10f
private val MAX_CELL = 76.dp

/**
 * The grid itself: cells, the operators between them, and the target each row
 * and column has to reach.
 *
 * Everything is sized off one number — the cell edge — worked out from the width
 * the board is given, so a 2x2 and a 4x4 both fill the screen sensibly.
 */
@Composable
fun BoardView(
    puzzle: Puzzle,
    board: BoardSnapshot,
    selectedCell: Int?,
    onCellTap: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val n = puzzle.size
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        // The cell edge is whatever fits both ways, so the board never needs to scroll.
        val widthUnits = n + (n - 1) * OP_FACTOR + EQUALS_FACTOR + TARGET_FACTOR
        val heightUnits = n + (n - 1) * OP_FACTOR + EQUALS_FACTOR + 1f
        val cell = minOf(maxWidth / widthUnits, maxHeight / heightUnits, MAX_CELL)
        val opSpan = cell * OP_FACTOR
        val equalsSpan = cell * EQUALS_FACTOR
        val targetSpan = cell * TARGET_FACTOR
        val selectedRow = selectedCell?.let { it / n }
        val selectedCol = selectedCell?.let { it % n }

        Column {
            for (row in 0 until n) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    for (col in 0 until n) {
                        val index = row * n + col
                        CellTile(
                            value = board.cells[index],
                            locked = index in board.locked,
                            hinted = index in board.revealed,
                            selected = selectedCell == index,
                            crossed = selectedRow == row || selectedCol == col,
                            edge = cell,
                            row = row,
                            col = col,
                            onClick = { onCellTap(index) },
                        )
                        if (col < n - 1) {
                            OperatorGlyph(puzzle.spec.rowOps[row][col], cell, Modifier.width(opSpan).height(cell))
                        }
                    }
                    EqualsGlyph(cell, Modifier.width(equalsSpan).height(cell))
                    TargetTile(
                        state = board.rows[row],
                        edge = cell,
                        description = stringResource(R.string.cd_row_target, row + 1, board.rows[row].target),
                        modifier = Modifier.width(targetSpan).height(cell),
                    )
                }
                if (row < n - 1) {
                    Row {
                        for (col in 0 until n) {
                            OperatorGlyph(
                                puzzle.spec.colOps[col][row],
                                cell,
                                Modifier.width(cell).height(opSpan),
                            )
                            if (col < n - 1) Spacer(Modifier.width(opSpan))
                        }
                        Spacer(Modifier.width(equalsSpan + targetSpan))
                    }
                }
            }

            Row {
                for (col in 0 until n) {
                    EqualsGlyph(cell, Modifier.width(cell).height(equalsSpan))
                    if (col < n - 1) Spacer(Modifier.width(opSpan))
                }
                Spacer(Modifier.width(equalsSpan + targetSpan))
            }

            Row {
                for (col in 0 until n) {
                    TargetTile(
                        state = board.cols[col],
                        edge = cell,
                        description = stringResource(R.string.cd_col_target, col + 1, board.cols[col].target),
                        modifier = Modifier.width(cell).height(cell),
                    )
                    if (col < n - 1) Spacer(Modifier.width(opSpan))
                }
                Spacer(Modifier.width(equalsSpan + targetSpan))
            }
        }
    }
}

@Composable
private fun CellTile(
    value: Int,
    locked: Boolean,
    hinted: Boolean,
    selected: Boolean,
    crossed: Boolean,
    edge: Dp,
    row: Int,
    col: Int,
    onClick: () -> Unit,
) {
    val colors = LocalClashColors.current
    val empty = value == BoardSpec.EMPTY
    val shape = RoundedCornerShape(edge * 0.22f)

    val fill by animateColorAsState(
        targetValue = when {
            locked -> colors.cellGiven
            !empty -> colors.cellFilled
            crossed -> colors.crosshair
            else -> colors.cellEmpty
        },
        animationSpec = tween(180),
        label = "cellFill",
    )
    val edgeColor by animateColorAsState(
        targetValue = when {
            selected -> colors.accent
            crossed && empty -> colors.accent.copy(alpha = 0.35f)
            else -> Color.Transparent
        },
        animationSpec = tween(180),
        label = "cellBorder",
    )

    val bounce = remember { Animatable(1f) }
    LaunchedEffect(value) {
        if (value != BoardSpec.EMPTY) {
            bounce.snapTo(0.84f)
            bounce.animateTo(
                targetValue = 1f,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessMedium,
                ),
            )
        }
    }

    val position = stringResource(R.string.cd_cell, row + 1, col + 1)
    val label = if (empty) {
        stringResource(R.string.cd_cell_empty)
    } else if (locked) {
        stringResource(R.string.cd_cell_locked, value)
    } else {
        value.toString()
    }

    Box(
        modifier = Modifier
            .size(edge)
            .padding(edge * 0.045f)
            .graphicsLayer {
                scaleX = bounce.value
                scaleY = bounce.value
            }
            .clip(shape)
            .background(fill)
            .drawBehind {
                if (empty) {
                    val radius = (edge * 0.22f).toPx()
                    drawRoundRect(
                        color = colors.outline,
                        cornerRadius = CornerRadius(radius, radius),
                        style = Stroke(
                            width = 1.4.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(7f, 7f), 0f),
                        ),
                    )
                }
            }
            .border(2.dp, edgeColor, shape)
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = "$position, $label"
            },
        contentAlignment = Alignment.Center,
    ) {
        if (!empty) {
            Text(
                text = value.toString(),
                fontSize = (edge.value * 0.40f).sp,
                fontWeight = FontWeight.SemiBold,
                color = if (locked) colors.cellGivenText else colors.text,
            )
        }
        if (hinted) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(edge * 0.07f)
                    .size(edge * 0.11f)
                    .clip(RoundedCornerShape(50))
                    .background(colors.accent),
            )
        }
    }
}

@Composable
private fun OperatorGlyph(op: Op, cell: Dp, modifier: Modifier) {
    val colors = LocalClashColors.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Text(
            text = op.symbol,
            fontSize = (cell.value * 0.30f).sp,
            fontWeight = FontWeight.Medium,
            color = colors.textMuted,
        )
    }
}

@Composable
private fun EqualsGlyph(cell: Dp, modifier: Modifier) {
    val colors = LocalClashColors.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Text(
            text = "=",
            fontSize = (cell.value * 0.26f).sp,
            color = colors.textFaint,
        )
    }
}

@Composable
private fun TargetTile(state: LineState, edge: Dp, description: String, modifier: Modifier) {
    val colors = LocalClashColors.current
    val shape = RoundedCornerShape(edge * 0.20f)
    val fill by animateColorAsState(
        targetValue = when (state.status) {
            LineStatus.SOLVED -> colors.successSoft
            LineStatus.WRONG -> colors.dangerSoft
            LineStatus.INCOMPLETE -> Color.Transparent
        },
        animationSpec = tween(220),
        label = "targetFill",
    )
    val ink = when (state.status) {
        LineStatus.SOLVED -> colors.success
        LineStatus.WRONG -> colors.danger
        LineStatus.INCOMPLETE -> colors.textMuted
    }

    Box(
        modifier = modifier
            .padding(edge * 0.045f)
            .clip(shape)
            .background(fill)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = state.target.toString(),
                fontSize = (edge.value * 0.33f).sp,
                fontWeight = FontWeight.Bold,
                color = ink,
                textAlign = TextAlign.Center,
            )
            if (state.status == LineStatus.WRONG) {
                Text(
                    text = state.value?.toString() ?: "—",
                    fontSize = (edge.value * 0.20f).sp,
                    color = colors.danger,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}
