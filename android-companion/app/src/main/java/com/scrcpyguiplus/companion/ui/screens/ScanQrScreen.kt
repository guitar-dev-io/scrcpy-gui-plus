package com.scrcpyguiplus.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scrcpyguiplus.companion.DiscoveredStudio
import com.scrcpyguiplus.companion.ui.components.AgentCard
import com.scrcpyguiplus.companion.ui.components.AgentPrimaryButton
import com.scrcpyguiplus.companion.ui.components.AgentSecondaryButton
import com.scrcpyguiplus.companion.ui.components.AgentTopBar
import com.scrcpyguiplus.companion.ui.theme.AgentBackground
import com.scrcpyguiplus.companion.ui.theme.AgentBrand
import com.scrcpyguiplus.companion.ui.theme.AgentSurfaceCard
import com.scrcpyguiplus.companion.ui.theme.AgentTextPrimary
import com.scrcpyguiplus.companion.ui.theme.AgentTextSecondary

/**
 * Screen 3 in the mockup: "Scan QR Code". The actual camera viewport is Google Code Scanner's
 * own full-screen system UI (launched by [onScanQr]); this screen provides the framed preview
 * placeholder, guidance text, and the manual pairing-code fallback shown while that scanner is
 * not on top, plus the transient "Connected Successfully" state once a session comes up.
 */
@Composable
fun ScanQrScreen(
    statusMessage: String,
    isConnecting: Boolean,
    justConnected: Boolean,
    manualCode: String,
    approvalCode: String?,
    discoveredStudios: List<DiscoveredStudio>,
    isDiscovering: Boolean,
    onManualCodeChange: (String) -> Unit,
    onScanQr: () -> Unit,
    onDiscoverStudios: () -> Unit,
    onConnectToStudio: (DiscoveredStudio) -> Unit,
    onConnectWithCode: () -> Unit,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(AgentBackground)
            .padding(horizontal = 20.dp),
    ) {
        AgentTopBar(title = if (justConnected) "" else "Scan QR Code", onBack = if (justConnected) null else onBack)

        if (justConnected) {
            ConnectedSuccessContent(onDone = onDone)
        } else {
            Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Text(
                    text = "Scan the QR code from\nMobile Studio on your computer",
                    modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
                    color = AgentTextSecondary,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .size(260.dp)
                        .align(Alignment.CenterHorizontally)
                        .clip(RoundedCornerShape(20.dp))
                        .background(AgentSurfaceCard),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        approvalCode != null -> AwaitingApprovalContent(approvalCode)
                        isConnecting || isDiscovering -> CircularProgressIndicator(color = AgentBrand)
                        else -> Icon(
                            imageVector = Icons.Filled.QrCodeScanner,
                            contentDescription = null,
                            tint = AgentBrand,
                            modifier = Modifier.size(64.dp),
                        )
                    }
                }

                Text(
                    text = statusMessage,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                    color = AgentTextSecondary,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                )

                AgentPrimaryButton(
                    text = "Open camera scanner",
                    onClick = onScanQr,
                    enabled = !isConnecting,
                    modifier = Modifier.padding(top = 24.dp),
                )

                AgentSecondaryButton(
                    text = if (isDiscovering) "Searching the network…" else "Find on this network",
                    onClick = onDiscoverStudios,
                    enabled = !isConnecting && !isDiscovering,
                    modifier = Modifier.padding(top = 10.dp),
                )

                if (discoveredStudios.isNotEmpty()) {
                    Text(
                        text = "Studios found on this network",
                        modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
                        color = AgentTextSecondary,
                        fontSize = 12.sp,
                    )
                    discoveredStudios.forEach { studio ->
                        DiscoveredStudioRow(
                            studio = studio,
                            enabled = !isConnecting,
                            onClick = { onConnectToStudio(studio) },
                        )
                    }
                }

                Text(
                    text = "Or paste the manual pairing code",
                    modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
                    color = AgentTextSecondary,
                    fontSize = 12.sp,
                )
                OutlinedTextField(
                    value = manualCode,
                    onValueChange = onManualCodeChange,
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("scrcpy-gui-plus://pair?...", color = AgentTextSecondary) },
                    singleLine = false,
                )
                AgentSecondaryButton(
                    text = "Connect with pairing code",
                    onClick = onConnectWithCode,
                    enabled = manualCode.isNotBlank() && !isConnecting,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
    }
}

/**
 * Shown while the desktop holds this device's socket open waiting to be approved. The
 * digits let the user confirm the prompt on the computer belongs to this phone.
 */
@Composable
private fun AwaitingApprovalContent(code: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(horizontal = 16.dp),
    ) {
        CircularProgressIndicator(color = AgentBrand)
        Text(
            text = "Approve on your computer",
            modifier = Modifier.padding(top = 16.dp),
            color = AgentTextPrimary,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = code,
            modifier = Modifier.padding(top = 8.dp),
            color = AgentBrand,
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Check that Mobile Studio shows these digits, then approve.",
            modifier = Modifier.padding(top = 8.dp),
            color = AgentTextSecondary,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DiscoveredStudioRow(
    studio: DiscoveredStudio,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    AgentCard(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(
                imageVector = Icons.Filled.Computer,
                contentDescription = null,
                tint = AgentBrand,
                modifier = Modifier.size(22.dp),
            )
            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(
                    text = studio.label(),
                    color = AgentTextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = "${studio.replyHost}:${studio.port}",
                    color = AgentTextSecondary,
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun ConnectedSuccessContent(onDone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(bottom = 96.dp),
            verticalArrangement = Arrangement.Bottom,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AgentCard(modifier = Modifier.padding(bottom = 16.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Icon(
                        imageVector = Icons.Filled.CheckCircle,
                        contentDescription = null,
                        tint = com.scrcpyguiplus.companion.ui.theme.AgentSuccess,
                        modifier = Modifier.size(48.dp),
                    )
                    Text(
                        text = "Connected Successfully",
                        modifier = Modifier.padding(top = 12.dp),
                        color = AgentTextPrimary,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "Your device has been registered with Mobile Studio.",
                        modifier = Modifier.padding(top = 6.dp),
                        color = AgentTextSecondary,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            AgentPrimaryButton(text = "Done", onClick = onDone)
        }
    }
}
