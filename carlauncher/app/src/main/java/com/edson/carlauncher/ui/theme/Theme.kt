package com.edson.carlauncher.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DriveColors = darkColorScheme(
    primary = AccentBlue,
    onPrimary = BackgroundPrimary,
    secondary = SpeedGreen,
    background = BackgroundPrimary,
    onBackground = TextPrimary,
    surface = CardSurface,
    onSurface = TextPrimary,
    surfaceVariant = SidebarSurface,
    onSurfaceVariant = TextSecondary,
    outline = CardBorder,
    error = AlertRed
)

@Composable
fun DriveTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DriveColors, typography = DriveTypography, content = content)
}
