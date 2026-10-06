package com.scrcpyguiplus.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.ui.components.AgentCard
import com.scrcpyguiplus.companion.ui.components.AgentSecondaryButton
import com.scrcpyguiplus.companion.ui.components.AgentTopBar
import com.scrcpyguiplus.companion.ui.components.NumberedStep
import com.scrcpyguiplus.companion.ui.theme.AgentBackground
import com.scrcpyguiplus.companion.ui.theme.AgentBrand
import com.scrcpyguiplus.companion.ui.theme.AgentSuccess
import com.scrcpyguiplus.companion.ui.theme.AgentSurfaceElevated
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary

/**
 * Screen 5 in the mockup: "Setup Device Control", a static how-to guide for enabling Android's
 * OS-level Developer Options / Wireless debugging plus a copyable pairing code. Android apps
 * cannot toggle these settings or read a live wireless-debugging pairing code themselves, so the
 * checkmarks and code shown here are informational/manual-entry only — not backed by a live ADB
 * integration.
 */
@Composable
fun SetupDeviceControlScreen(
    pairingCode: String,
    developerOptionsEnabled: Boolean,
    wirelessDebuggingEnabled: Boolean,
    onBack: () -> Unit,
    onIvePairedTheDevice: () -> Unit,
) {
    val clipboardManager = LocalClipboardManager.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AgentBackground)
            .padding(horizontal = 20.dp),
    ) {
        AgentTopBar(title = "Setup Device Control", onBack = onBack)

        Column(modifier = Modifier.fillMaxSize().padding(top = 8.dp)) {
            NumberedStep(
                number = 1,
                title = "Enable Developer Options",
                description = "Go to Settings > About phone\nTap Build number 7 times",
                done = developerOptionsEnabled,
                trailingContent = { StepCheck(done = developerOptionsEnabled) },
            )
            StepDivider()
            NumberedStep(
                number = 2,
                title = "Enable Wireless Debugging",
                description = "Go to Developer options\nTurn on Wireless debugging",
                done = wirelessDebuggingEnabled,
                trailingContent = { StepCheck(done = wirelessDebuggingEnabled) },
            )
            StepDivider()
            NumberedStep(
                number = 3,
                title = "Pair with Mobile Studio",
                description = "Tap \"Pair device with pairing code\"\nUse the code below",
            )

            AgentCard(modifier = Modifier.padding(top = 16.dp, bottom = 16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = pairingCode.ifBlank { "— — —" },
                        color = AgentTextPrimary,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    IconButton(
                        onClick = {
                            if (pairingCode.isNotBlank()) {
                                clipboardManager.setText(AnnotatedString(pairingCode))
                            }
                        },
                    ) {
                        Icon(
                            imageVector = Icons.Filled.ContentCopy,
                            contentDescription = "Copy pairing code",
                            tint = AgentTextSecondary,
                        )
                    }
                }
                Text(
                    text = "Pairing code (valid 5 minutes)",
                    modifier = Modifier.padding(top = 4.dp),
                    color = AgentTextSecondary,
                    fontSize = 12.sp,
                )
            }

            NumberedStep(
                number = 4,
                title = "Connect",
                description = "Mobile Studio will connect automatically\nafter pairing",
            )

            Spacer(modifier = Modifier.weight(1f))

            AgentSecondaryButton(
                text = "I've paired the device",
                onClick = onIvePairedTheDevice,
                modifier = Modifier.padding(bottom = 24.dp),
            )
        }
    }
}

@Composable
private fun StepCheck(done: Boolean) {
    if (done) {
        Icon(
            imageVector = Icons.Filled.CheckCircle,
            contentDescription = "Done",
            tint = AgentSuccess,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun StepDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 14.dp, top = 8.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(1.dp))
            .background(AgentSurfaceElevated)
            .padding(vertical = 0.5.dp),
    )
}
