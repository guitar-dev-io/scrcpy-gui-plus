package com.scrcpyguiplus.companion.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.ui.theme.AgentBorderSubtle
import com.scrcpyguiplus.companion.ui.theme.AgentBrand
import com.scrcpyguiplus.companion.ui.theme.AgentDanger
import com.scrcpyguiplus.companion.ui.theme.AgentDangerSurface
import com.scrcpyguiplus.companion.ui.theme.AgentSuccess
import com.scrcpyguiplus.companion.ui.theme.AgentSuccessSurface
import com.scrcpyguiplus.companion.ui.theme.AgentSurfaceCard
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary
import com.scrcpyguiplus.companion.ui.theme.AgentTextTertiary
import com.scrcpyguiplus.companion.ui.theme.AgentWarning
import com.scrcpyguiplus.companion.ui.theme.AgentWarningSurface

/** Top bar with an optional back button, a centered title, and an optional trailing action. */
@Composable
fun AgentTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    onSettings: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(40.dp)) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = AgentTextPrimary,
                    )
                }
            }
        }
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = AgentTextPrimary,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Box(modifier = Modifier.size(40.dp)) {
            if (onSettings != null) {
                IconButton(onClick = onSettings) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "Settings",
                        tint = AgentTextSecondary,
                    )
                }
            }
        }
    }
}

/** A rounded, bordered card matching the mockup's panel style. */
@Composable
fun AgentCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScopeAlias.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(AgentSurfaceCard)
            .border(1.dp, AgentBorderSubtle, RoundedCornerShape(16.dp))
            .padding(16.dp),
        content = content,
    )
}

// Alias so callers don't need to import ColumnScope explicitly at the call site.
typealias ColumnScopeAlias = androidx.compose.foundation.layout.ColumnScope

enum class StatusTone { Success, Warning, Danger, Neutral }

/** Small rounded pill used for connection-state labels ("Connected", "Not enabled", ...). */
@Composable
fun StatusPill(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val (background, dot, textColor) = when (tone) {
        StatusTone.Success -> Triple(AgentSuccessSurface, AgentSuccess, AgentSuccess)
        StatusTone.Warning -> Triple(AgentWarningSurface, AgentWarning, AgentWarning)
        StatusTone.Danger -> Triple(AgentDangerSurface, AgentDanger, AgentDanger)
        StatusTone.Neutral -> Triple(AgentSurfaceCard, AgentTextTertiary, AgentTextSecondary)
    }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(dot),
        )
        Text(text = text, color = textColor, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

/** Primary blue call-to-action button matching the mockup ("Add Studio", "Done", ...). */
@Composable
fun AgentPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = AgentBrand,
            contentColor = Color.White,
            disabledContainerColor = AgentBrand.copy(alpha = 0.35f),
            disabledContentColor = Color.White.copy(alpha = 0.6f),
        ),
    ) {
        if (leadingIcon != null) {
            leadingIcon()
        }
        Text(text = text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Secondary, low-emphasis button used for things like "Settings" or "I've paired the device". */
@Composable
fun AgentSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = AgentSurfaceCard,
            contentColor = AgentTextPrimary,
            disabledContainerColor = AgentSurfaceCard.copy(alpha = 0.6f),
            disabledContentColor = AgentTextTertiary,
        ),
    ) {
        Text(text = text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/** A single "label ... value" row inside an [AgentCard], e.g. device info fields. */
@Composable
fun InfoRow(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, color = AgentTextSecondary, fontSize = 13.sp)
        Text(text = value, color = AgentTextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/** A numbered step used on the "Setup Device Control" screen, with an optional trailing check. */
@Composable
fun NumberedStep(
    number: Int,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    done: Boolean = false,
    trailingContent: (@Composable () -> Unit)? = null,
) {
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(if (done) AgentSuccessSurface else AgentBrand.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = number.toString(),
                color = if (done) AgentSuccess else AgentBrand,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Text(text = title, color = AgentTextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(
                text = description,
                color = AgentTextSecondary,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        if (trailingContent != null) {
            Box(modifier = Modifier.padding(start = 8.dp)) { trailingContent() }
        }
    }
}

@Composable
fun ClickableRow(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScopeAlias.() -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

typealias RowScopeAlias = androidx.compose.foundation.layout.RowScope
