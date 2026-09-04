package com.karos.mathclash.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Colours the board needs that Material does not name: the amber of a given
 * cell, the green of a line that has just closed, the wash behind the row and
 * column the player is working in.
 */
@Immutable
data class ClashColors(
    val screen: Color,
    val card: Color,
    val cardRaised: Color,
    val cellEmpty: Color,
    val cellFilled: Color,
    val cellGiven: Color,
    val cellGivenText: Color,
    val crosshair: Color,
    val outline: Color,
    val accent: Color,
    val accentSoft: Color,
    val violet: Color,
    val success: Color,
    val successSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
    val text: Color,
    val textMuted: Color,
    val textFaint: Color,
)

private val DarkClash = ClashColors(
    screen = Color(0xFF0A0D16),
    card = Color(0xFF141A2B),
    cardRaised = Color(0xFF1C2439),
    cellEmpty = Color(0xFF161D30),
    cellFilled = Color(0xFF25304E),
    cellGiven = Color(0xFF3A2E17),
    cellGivenText = Color(0xFFF5BE55),
    crosshair = Color(0xFF1B2440),
    outline = Color(0xFF2C3552),
    accent = Color(0xFF6E8BFF),
    accentSoft = Color(0xFF1E2A50),
    violet = Color(0xFFA177FF),
    success = Color(0xFF35D9A0),
    successSoft = Color(0xFF10322A),
    danger = Color(0xFFFF6B81),
    dangerSoft = Color(0xFF35161F),
    text = Color(0xFFE9EDFA),
    textMuted = Color(0xFF9AA5C4),
    textFaint = Color(0xFF63709A),
)

private val LightClash = ClashColors(
    screen = Color(0xFFF3F5FC),
    card = Color(0xFFFFFFFF),
    cardRaised = Color(0xFFFFFFFF),
    cellEmpty = Color(0xFFEDF1FB),
    cellFilled = Color(0xFFDCE4FA),
    cellGiven = Color(0xFFFDF0D5),
    cellGivenText = Color(0xFF9A6206),
    crosshair = Color(0xFFE6ECFB),
    outline = Color(0xFFC9D3EC),
    accent = Color(0xFF3C5BE0),
    accentSoft = Color(0xFFE0E7FF),
    violet = Color(0xFF7A44E0),
    success = Color(0xFF0E9F6E),
    successSoft = Color(0xFFDDF6EC),
    danger = Color(0xFFD92049),
    dangerSoft = Color(0xFFFDE4EA),
    text = Color(0xFF141A2C),
    textMuted = Color(0xFF576080),
    textFaint = Color(0xFF8590B0),
)

val LocalClashColors = staticCompositionLocalOf { DarkClash }

private fun darkScheme(c: ClashColors) = darkColorScheme(
    primary = c.accent,
    onPrimary = Color(0xFF07102A),
    primaryContainer = c.accentSoft,
    onPrimaryContainer = c.text,
    secondary = c.violet,
    onSecondary = Color(0xFF120A28),
    tertiary = c.success,
    onTertiary = Color(0xFF032018),
    background = c.screen,
    onBackground = c.text,
    surface = c.card,
    onSurface = c.text,
    surfaceVariant = c.cardRaised,
    onSurfaceVariant = c.textMuted,
    outline = c.outline,
    error = c.danger,
    onError = Color(0xFF2B0710),
)

private fun lightScheme(c: ClashColors) = lightColorScheme(
    primary = c.accent,
    onPrimary = Color.White,
    primaryContainer = c.accentSoft,
    onPrimaryContainer = c.text,
    secondary = c.violet,
    onSecondary = Color.White,
    tertiary = c.success,
    onTertiary = Color.White,
    background = c.screen,
    onBackground = c.text,
    surface = c.card,
    onSurface = c.text,
    surfaceVariant = c.cardRaised,
    onSurfaceVariant = c.textMuted,
    outline = c.outline,
    error = c.danger,
    onError = Color.White,
)

private val ClashTypography = Typography(
    displaySmall = TextStyle(fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold),
    headlineMedium = TextStyle(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
    headlineSmall = TextStyle(fontSize = 21.sp, lineHeight = 27.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun MathClashTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val clash = if (darkTheme) DarkClash else LightClash
    CompositionLocalProvider(LocalClashColors provides clash) {
        MaterialTheme(
            colorScheme = if (darkTheme) darkScheme(clash) else lightScheme(clash),
            typography = ClashTypography,
            content = content,
        )
    }
}
