package com.scrcpyguiplus.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.ui.components.AgentPrimaryButton
import com.scrcpyguiplus.companion.ui.components.AgentSecondaryButton
import com.scrcpyguiplus.companion.ui.components.ClickableRow
import com.scrcpyguiplus.companion.ui.theme.AgentBackground
import com.scrcpyguiplus.companion.ui.theme.AgentBrand
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary

/**
 * Screen 2 in the mockup: "Mobile Studio Agent" home. Shown when there is no active or saved
 * pairing. The single primary action starts the QR scan flow (Screen 3).
 */
@Composable
fun HomeScreen(
    onAddStudio: () -> Unit,
    onFindOnNetwork: () -> Unit,
    onOpenDeviceInfo: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AgentBackground)
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().weight(1f),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(88.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(AgentBrand.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "M",
                    color = AgentBrand,
                    fontSize = 44.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            Text(
                text = "Mobile Studio\nAgent",
                modifier = Modifier.padding(top = 20.dp),
                color = AgentTextPrimary,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )

            Text(
                text = "Connect your Android device\nto Mobile Studio on your computer.",
                modifier = Modifier.padding(top = 10.dp, start = 8.dp, end = 8.dp),
                color = AgentTextSecondary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
        }

        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 32.dp)) {
            AgentPrimaryButton(
                text = "Add Studio",
                onClick = onAddStudio,
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Filled.QrCodeScanner,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier
                            .size(18.dp)
                            .padding(end = 4.dp),
                    )
                },
            )

            // The QR code is the happy path, but it fails outright on devices whose
            // scanner module is unavailable, so the network search is offered next to it
            // rather than buried as a fallback.
            AgentSecondaryButton(
                text = "Find on this network",
                onClick = onFindOnNetwork,
                modifier = Modifier.padding(top = 10.dp),
            )

            ClickableRow(
                onClick = onOpenDeviceInfo,
                modifier = Modifier.padding(top = 16.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Info,
                    contentDescription = null,
                    tint = AgentTextSecondary,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    text = "Device Info",
                    modifier = Modifier.padding(start = 8.dp),
                    color = AgentTextSecondary,
                    fontSize = 14.sp,
                )
            }

            ClickableRow(onClick = onOpenSettings) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = null,
                    tint = AgentTextSecondary,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    text = "Settings",
                    modifier = Modifier.padding(start = 8.dp),
                    color = AgentTextSecondary,
                    fontSize = 14.sp,
                )
            }
        }
    }
}
