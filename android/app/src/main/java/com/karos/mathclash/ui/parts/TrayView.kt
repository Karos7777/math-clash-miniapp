package com.karos.mathclash.ui.parts

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.karos.mathclash.game.TraySlot
import com.karos.mathclash.ui.theme.LocalClashColors

/** The numbers waiting to be played, laid out in rows that fit the screen. */
@Composable
fun TrayView(
    tray: List<TraySlot>,
    selectedValue: Int?,
    onValueTap: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (tray.isEmpty()) return
    val perRow = when {
        tray.size <= 4 -> tray.size
        tray.size <= 10 -> 5
        else -> 8
    }
    val gap = 8.dp

    BoxWithConstraints(modifier) {
        val available = maxWidth - gap * (perRow - 1)
        val tile = minOf(available / perRow, 54.dp)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(gap),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            tray.chunked(perRow).forEach { chunk ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    chunk.forEach { slot ->
                        TrayTile(
                            slot = slot,
                            selected = selectedValue == slot.value,
                            edge = tile,
                            onClick = { onValueTap(slot.value) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TrayTile(
    slot: TraySlot,
    selected: Boolean,
    edge: Dp,
    onClick: () -> Unit,
) {
    val colors = LocalClashColors.current
    val spent = slot.remaining <= 0
    val shape = RoundedCornerShape(edge * 0.26f)

    val fill by animateColorAsState(
        targetValue = when {
            spent -> Color.Transparent
            selected -> colors.accent
            else -> colors.cellFilled
        },
        animationSpec = tween(160),
        label = "trayFill",
    )
    val ink = when {
        spent -> colors.textFaint.copy(alpha = 0.45f)
        selected -> Color.White
        else -> colors.text
    }

    Box(
        modifier = Modifier
            .size(edge)
            .clip(shape)
            .background(fill)
            .border(1.dp, if (spent) colors.outline.copy(alpha = 0.5f) else Color.Transparent, shape)
            .clickable(enabled = !spent, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = slot.value.toString(),
                fontSize = (edge.value * 0.40f).sp,
                fontWeight = FontWeight.SemiBold,
                color = ink,
            )
            if (slot.remaining > 1) {
                Text(
                    text = "×${slot.remaining}",
                    fontSize = (edge.value * 0.20f).sp,
                    color = ink.copy(alpha = 0.7f),
                    modifier = Modifier.align(Alignment.BottomEnd),
                )
            }
        }
    }
}

/** A slim strip of live numbers for the header: time, hints, mistakes, lines closed. */
@Composable
fun StatStrip(items: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    val colors = LocalClashColors.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.card),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        items.forEach { (value, label) ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = value,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.text,
                )
                Text(
                    text = label,
                    fontSize = 11.sp,
                    color = colors.textMuted,
                )
            }
        }
    }
}
