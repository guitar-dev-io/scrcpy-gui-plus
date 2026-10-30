package com.scrcpyguiplus.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.ui.AgentDeviceInfo
import com.scrcpyguiplus.companion.ui.components.AgentCard
import com.scrcpyguiplus.companion.ui.components.AgentPrimaryButton
import com.scrcpyguiplus.companion.ui.components.AgentSecondaryButton
import com.scrcpyguiplus.companion.ui.components.AgentTopBar
import com.scrcpyguiplus.companion.ui.components.InfoRow
import com.scrcpyguiplus.companion.ui.components.StatusPill
import com.scrcpyguiplus.companion.ui.components.StatusTone
import com.scrcpyguiplus.companion.ui.theme.AgentBackground
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary

/**
 * Screen 4 in the mockup: "Mobile Studio Agent" status page shown once a session is connected.
 * Displays live device info (mirrors get_device_info fields already sent to the desktop) and
 * three connection rows: Agent (this app's session), Wireless Debugging, and ADB.
 */
@Composable
fun AgentStatusScreen(
    agentConnected: Boolean,
    studioLabel: String?,
    deviceInfo: AgentDeviceInfo?,
    wirelessDebuggingEnabled: Boolean,
    adbConnected: Boolean,
    deviceControlEnabled: Boolean,
    onAllowDeviceControl: () -> Unit,
    onOpenSettings: () -> Unit,
    onSetupWirelessDebugging: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AgentBackground)
            .padding(horizontal = 20.dp),
    ) {
        AgentTopBar(title = "Mobile Studio Agent", onSettings = onOpenSettings)

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                AgentCard(modifier = Modifier.padding(top = 8.dp, bottom = 16.dp)) {
                    StatusPill(
                        text = if (agentConnected) "Connected" else "Disconnected",
                        tone = if (agentConnected) StatusTone.Success else StatusTone.Danger,
                    )
                    Text(
                        text = if (agentConnected && studioLabel != null) {
                            "Connected to\n$studioLabel"
                        } else {
                            "Not connected to a studio"
                        },
                        modifier = Modifier.padding(top = 10.dp),
                        color = AgentTextSecondary,
                        fontSize = 13.sp,
                    )
                }
            }

            item {
                AgentCard(modifier = Modifier.padding(bottom = 16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Device Control",
                            color = AgentTextPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        StatusPill(
                            text = if (deviceControlEnabled) "Allowed" else "Not allowed",
                            tone = if (deviceControlEnabled) StatusTone.Success else StatusTone.Warning,
                        )
                    }
                    Text(
                        text = if (deviceControlEnabled) {
                            "Mobile Studio can tap, swipe and type on this phone while you share " +
                                "its screen. Turn it off in Accessibility settings at any time."
                        } else {
                            "To control this phone from your computer without a cable or adb, " +
                                "open Accessibility settings, choose \"Mobile Studio device control\" " +
                                "and switch it on."
                        },
                        modifier = Modifier.padding(top = 8.dp),
                        color = AgentTextSecondary,
                        fontSize = 13.sp,
                    )
                    if (!deviceControlEnabled) {
                        AgentPrimaryButton(
                            text = "Allow device control",
                            onClick = onAllowDeviceControl,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    } else {
                        AgentSecondaryButton(
                            text = "Accessibility settings",
                            onClick = onAllowDeviceControl,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                }
            }

            item {
                AgentCard(modifier = Modifier.padding(bottom = 16.dp)) {
                    Text(
                        text = "Device Information",
                        color = AgentTextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    val info = deviceInfo
                    if (info == null) {
                        Text(
                            text = "Device information will appear once connected.",
                            modifier = Modifier.padding(top = 8.dp),
                            color = AgentTextSecondary,
                            fontSize = 13.sp,
                        )
                    } else {
                        InfoRow(label = "Device Name", value = info.deviceName)
                        InfoRow(label = "Model", value = info.model)
                        InfoRow(label = "Android Version", value = info.androidVersion)
                        InfoRow(label = "IP Address", value = info.ipAddress)
                        InfoRow(
                            label = "Battery",
                            value = info.batteryPercent?.let { "$it%" } ?: "Unknown",
                        )
                        InfoRow(
                            label = "Wi-Fi",
                            value = if (info.wifiConnected) "Connected" else "Disconnected",
                        )
                    }
                }
            }

            item {
                AgentCard(modifier = Modifier.padding(bottom = 20.dp)) {
                    Text(
                        text = "Connection Status",
                        color = AgentTextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    ConnectionStatusRow(
                        label = "Agent",
                        connected = agentConnected,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    ConnectionStatusRow(
                        label = "Wireless Debugging",
                        connected = wirelessDebuggingEnabled,
                        connectedText = "Enabled",
                        disconnectedText = "Not enabled",
                    )
                    ConnectionStatusRow(
                        label = "ADB",
                        connected = adbConnected,
                        connectedText = "Connected",
                        disconnectedText = "Not connected",
                    )
                }
            }

            item {
                AgentPrimaryButton(
                    text = "Setup Wireless Debugging",
                    onClick = onSetupWirelessDebugging,
                    modifier = Modifier.padding(bottom = 24.dp),
                )
            }
        }
    }
}

@Composable
private fun ConnectionStatusRow(
    label: String,
    connected: Boolean,
    modifier: Modifier = Modifier,
    connectedText: String = "Connected",
    disconnectedText: String = "Not connected",
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, color = AgentTextSecondary, fontSize = 13.sp)
        StatusPill(
            text = if (connected) connectedText else disconnectedText,
            tone = if (connected) StatusTone.Success else StatusTone.Warning,
        )
    }
}
