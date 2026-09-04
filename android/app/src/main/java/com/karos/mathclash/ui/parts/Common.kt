package com.karos.mathclash.ui.parts

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.karos.mathclash.ui.theme.LocalClashColors
import kotlin.math.roundToInt

@Composable
fun ScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val colors = LocalClashColors.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(colors.card)
                    .border(1.dp, colors.outline, CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Text("←", color = colors.text, fontSize = 19.sp)
            }
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = colors.text)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textMuted)
            }
        }
        trailing()
    }
}

@Composable
fun ClashCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(16.dp),
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val colors = LocalClashColors.current
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier = modifier
            .clip(shape)
            .background(colors.card)
            .border(1.dp, colors.outline, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun StatTile(value: String, label: String, accent: Color, modifier: Modifier = Modifier) {
    val colors = LocalClashColors.current
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, style = MaterialTheme.typography.headlineSmall, color = accent)
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun StarRow(stars: Int, modifier: Modifier = Modifier, size: Int = 26) {
    val colors = LocalClashColors.current
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(3) { index ->
            Text(
                text = "★",
                fontSize = size.sp,
                color = if (index < stars) colors.cellGivenText else colors.outline,
            )
        }
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = LocalClashColors.current
    Button(
        onClick = onClick,
        modifier = modifier.height(52.dp),
        enabled = enabled,
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = colors.accent,
            contentColor = Color.White,
            disabledContainerColor = colors.outline,
            disabledContentColor = colors.textFaint,
        ),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color? = null,
) {
    val colors = LocalClashColors.current
    val content = tint ?: colors.text
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        enabled = enabled,
        shape = RoundedCornerShape(15.dp),
        border = BorderStroke(1.dp, if (enabled) colors.outline else colors.outline.copy(alpha = 0.5f)),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = content,
            disabledContentColor = colors.textFaint,
        ),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/**
 * The focus index dial. 100 is a full sweep; anything above that keeps going
 * round in the brighter second colour.
 */
@Composable
fun FocusDial(
    value: Int,
    modifier: Modifier = Modifier,
    diameter: Dp = 116.dp,
    caption: String? = null,
) {
    val colors = LocalClashColors.current
    val progress by animateFloatAsState(
        targetValue = (value / 100f).coerceIn(0f, 2f),
        animationSpec = tween(700),
        label = "focus",
    )
    Box(modifier = modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(diameter)) {
            val stroke = 11.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(
                color = colors.crosshair,
                startAngle = 135f,
                sweepAngle = 270f,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            if (progress > 0f) {
                drawArc(
                    brush = Brush.linearGradient(listOf(colors.accent, colors.violet)),
                    startAngle = 135f,
                    sweepAngle = 270f * progress.coerceAtMost(1f),
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
            if (progress > 1f) {
                drawArc(
                    color = colors.success,
                    startAngle = 135f,
                    sweepAngle = 270f * (progress - 1f),
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = value.toString(),
                style = MaterialTheme.typography.displaySmall,
                color = colors.text,
                fontWeight = FontWeight.Bold,
            )
            if (caption != null) {
                Text(caption, style = MaterialTheme.typography.labelSmall, color = colors.textMuted)
            }
        }
    }
}

/** A tiny trend line of recent ratings, drawn only when there is enough history. */
@Composable
fun Sparkline(values: List<Int>, modifier: Modifier = Modifier) {
    val colors = LocalClashColors.current
    if (values.size < 2) return
    val top = (values.max().coerceAtLeast(1)).toFloat()
    val bottom = values.min().toFloat()
    val span = (top - bottom).coerceAtLeast(1f)
    Canvas(modifier) {
        val stepX = size.width / (values.size - 1)
        var previous = Offset(0f, size.height * (1f - (values[0] - bottom) / span))
        values.forEachIndexed { index, value ->
            if (index == 0) return@forEachIndexed
            val point = Offset(
                x = stepX * index,
                y = size.height * (1f - (value - bottom) / span),
            )
            drawLine(
                color = colors.accent,
                start = previous,
                end = point,
                strokeWidth = 2.5.dp.toPx(),
                cap = StrokeCap.Round,
            )
            previous = point
        }
    }
}

fun Double.asIndex(): Int = roundToInt()
