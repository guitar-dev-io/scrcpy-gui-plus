package com.scrcpyguiplus.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.TrustedStudio
import com.scrcpyguiplus.companion.ui.components.AgentCard
import com.scrcpyguiplus.companion.ui.components.AgentSecondaryButton
import com.scrcpyguiplus.companion.ui.components.AgentTopBar
import com.scrcpyguiplus.companion.ui.theme.AgentBackground
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary

/**
 * Not part of the 5-screen mockup, but required to keep existing functionality reachable:
 * trusted-studio management ("Forget"), diagnostic logs, and USB accessory recheck. Reuses the
 * same card/typography language as the mockup screens so it doesn't look bolted on.
 */
@Composable
fun SettingsScreen(
    trustedStudios: List<TrustedStudio>,
    logs: List<String>,
    onForgetStudio: (String) -> Unit,
    onCheckUsbAccessory: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AgentBackground)
            .padding(horizontal = 20.dp),
    ) {
        AgentTopBar(title = "Settings", onBack = onBack)

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item {
                AgentCard(modifier = Modifier.padding(top = 8.dp, bottom = 16.dp)) {
                    Text(
                        text = "Trusted Studios",
                        color = AgentTextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (trustedStudios.isEmpty()) {
                        Text(
                            text = "No studios paired yet",
                            modifier = Modifier.padding(top = 8.dp),
                            color = AgentTextSecondary,
                            fontSize = 13.sp,
                        )
                    } else {
                        trustedStudios.forEach { studio ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(text = studio.studioName, color = AgentTextPrimary, fontSize = 13.sp)
                                    Text(
                                        text = "${studio.host}:${studio.port}",
                                        color = AgentTextSecondary,
                                        fontSize = 12.sp,
                                    )
                                }
                                AgentSecondaryButton(
                                    text = "Forget",
                                    onClick = { onForgetStudio(studio.studioId) },
                                    modifier = Modifier.padding(start = 12.dp),
                                )
                            }
                        }
                    }
                }
            }

            item {
                AgentSecondaryButton(
                    text = "Check USB accessory",
                    onClick = onCheckUsbAccessory,
                    modifier = Modifier.padding(bottom = 16.dp),
                )
            }

            item {
                Text(
                    text = "Latest logs",
                    color = AgentTextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            item {
                AgentCard(modifier = Modifier.padding(top = 8.dp, bottom = 24.dp)) {
                    if (logs.isEmpty()) {
                        Text(text = "No events yet", color = AgentTextSecondary, fontSize = 12.sp)
                    } else {
                        logs.forEach { line ->
                            Text(
                                text = line,
                                color = AgentTextSecondary,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(vertical = 2.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
