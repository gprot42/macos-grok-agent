package com.tinyggrok.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

enum class AppTheme {
    LIGHT, DARK, TOKYO_NIGHT
}

@Composable
fun TinyGrokTheme(
    appTheme: AppTheme = AppTheme.DARK,
    content: @Composable () -> Unit
) {
    val colorScheme = when (appTheme) {
        AppTheme.LIGHT -> lightColorScheme(
            primary = LightPrimary,
            onPrimary = LightOnPrimary,
            background = LightBackground,
            surface = LightSurface,
            onSurface = LightOnSurface
        )
        AppTheme.DARK -> darkColorScheme(
            primary = DarkPrimary,
            onPrimary = DarkOnPrimary,
            background = DarkBackground,
            surface = DarkSurface,
            onSurface = DarkOnSurface
        )
        AppTheme.TOKYO_NIGHT -> darkColorScheme(
            primary = TokyoNightPrimary,
            onPrimary = TokyoNightOnPrimary,
            background = TokyoNightBackground,
            surface = TokyoNightSurface,
            onSurface = TokyoNightOnSurface,
            secondary = TokyoNightSecondary,
            onSecondary = TokyoNightOnSecondary,
            tertiary = TokyoNightAccent,
            onTertiary = TokyoNightText
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography(),
        content = content
    )
}
