package com.scrcpyguiplus.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Dark palette matching the "Mobile Studio Agent" mockup: deep navy backgrounds,
 * a bright blue brand accent, and soft slate text/borders. The app is dark-only
 * by design (the mockup has no light variant), so [MobileStudioTheme] always
 * applies this scheme regardless of the system setting.
 */
val AgentBackground = Color(0xFF0B0F1A)
val AgentSurface = Color(0xFF121826)
val AgentSurfaceElevated = Color(0xFF1A2233)
val AgentSurfaceCard = Color(0xFF171F2E)
val AgentBorderSubtle = Color(0xFF262F42)
val AgentBrand = Color(0xFF2E6BFF)
val AgentBrandOn = Color(0xFFFFFFFF)
val AgentTextPrimary = Color(0xFFF3F5F9)
val AgentTextSecondary = Color(0xFF9AA5B8)
val AgentTextTertiary = Color(0xFF6B7688)
val AgentSuccess = Color(0xFF2ECC71)
val AgentSuccessSurface = Color(0xFF15301F)
val AgentWarning = Color(0xFFF5A623)
val AgentWarningSurface = Color(0xFF332510)
val AgentDanger = Color(0xFFEF4444)
val AgentDangerSurface = Color(0xFF321616)
val AgentNeutralSurface = Color(0xFF232C3E)

private val AgentDarkColorScheme = darkColorScheme(
    primary = AgentBrand,
    onPrimary = AgentBrandOn,
    secondary = AgentBrand,
    onSecondary = AgentBrandOn,
    background = AgentBackground,
    onBackground = AgentTextPrimary,
    surface = AgentSurface,
    onSurface = AgentTextPrimary,
    surfaceVariant = AgentSurfaceElevated,
    onSurfaceVariant = AgentTextSecondary,
    outline = AgentBorderSubtle,
    error = AgentDanger,
    onError = AgentBrandOn,
)

/** The mockup only defines a dark theme, so it is applied unconditionally here. */
@Composable
fun MobileStudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AgentDarkColorScheme,
        typography = MobileStudioTypography,
        content = content,
    )
}
