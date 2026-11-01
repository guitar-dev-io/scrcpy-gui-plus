package com.scrcpyguiplus.companion.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.scrcpyguiplus.companion.DiscoveredStudio
import com.scrcpyguiplus.companion.ui.screens.AgentStatusScreen
import com.scrcpyguiplus.companion.ui.screens.HomeScreen
import com.scrcpyguiplus.companion.ui.screens.ScanQrScreen
import com.scrcpyguiplus.companion.ui.screens.SettingsScreen
import com.scrcpyguiplus.companion.ui.screens.SetupDeviceControlScreen
import com.scrcpyguiplus.companion.ui.theme.MobileStudioTheme

/** Route ids for the 5-screen mockup flow plus the additional Settings screen. */
private object Routes {
    const val HOME = "home"
    const val SCAN_QR = "scan_qr"
    const val AGENT_STATUS = "agent_status"
    const val SETUP_DEVICE_CONTROL = "setup_device_control"
    const val SETTINGS = "settings"
}

/** Callbacks [MobileStudioApp] needs from [MainActivity] to drive the real session logic. */
class AgentActions(
    val onScanQr: () -> Unit,
    val onConnectWithManualCode: (String) -> Unit,
    val onDiscoverStudios: () -> Unit,
    val onConnectToStudio: (DiscoveredStudio) -> Unit,
    val onCheckUsbAccessory: () -> Unit,
    val onForgetStudio: (String) -> Unit,
    val onDisconnect: () -> Unit,
    val onOpenDeviceControlSettings: () -> Unit,
    val onDisconnectStudio: () -> Unit,
)

/**
 * Compose root for the Companion app. Purely a presentation layer over [AgentUiState]: all
 * session/protocol/USB/screen-capture logic continues to live in MainActivity exactly as before,
 * this only renders that state and forwards user actions back via [actions].
 */
@Composable
fun MobileStudioApp(state: AgentUiState, actions: AgentActions) {
    val navController = rememberNavController()
    var manualCode by remember { mutableStateOf("") }

    val phase by state.connectionPhase
    LaunchedEffect(phase) {
        when (phase) {
            AgentConnectionPhase.Idle -> navigateSingleTop(navController, Routes.HOME)
            AgentConnectionPhase.Scanning,
            AgentConnectionPhase.Connecting,
            AgentConnectionPhase.JustConnected,
            -> navigateSingleTop(navController, Routes.SCAN_QR)
            AgentConnectionPhase.Connected -> navigateSingleTop(navController, Routes.AGENT_STATUS)
        }
    }

    MobileStudioTheme {
        NavHost(navController = navController, startDestination = Routes.HOME) {
            composable(Routes.HOME) {
                HomeScreen(
                    onAddStudio = actions.onScanQr,
                    onFindOnNetwork = {
                        actions.onDiscoverStudios()
                        navigateSingleTop(navController, Routes.SCAN_QR)
                    },
                    onOpenDeviceInfo = { navController.navigate(Routes.AGENT_STATUS) },
                    onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                )
            }
            composable(Routes.SCAN_QR) {
                val isConnecting = phase == AgentConnectionPhase.Connecting
                val justConnected = phase == AgentConnectionPhase.JustConnected
                ScanQrScreen(
                    statusMessage = state.statusMessage.value,
                    isConnecting = isConnecting,
                    justConnected = justConnected,
                    manualCode = manualCode,
                    approvalCode = state.approvalCode.value,
                    discoveredStudios = state.discoveredStudios.value,
                    isDiscovering = state.isDiscovering.value,
                    onManualCodeChange = { manualCode = it },
                    onScanQr = actions.onScanQr,
                    onDiscoverStudios = actions.onDiscoverStudios,
                    onConnectToStudio = actions.onConnectToStudio,
                    onConnectWithCode = { actions.onConnectWithManualCode(manualCode) },
                    onBack = {
                        actions.onDisconnect()
                        navController.popBackStack()
                    },
                    onDone = { state.connectionPhase.value = AgentConnectionPhase.Connected },
                )
            }
            composable(Routes.AGENT_STATUS) {
                AgentStatusScreen(
                    agentConnected = state.isConnected.value,
                    studioLabel = state.studioLabel.value,
                    deviceInfo = state.deviceInfo.value,
                    wirelessDebuggingEnabled = state.wirelessDebuggingEnabled.value,
                    adbConnected = state.adbConnected.value,
                    deviceControlEnabled = state.deviceControlEnabled.value,
                    onAllowDeviceControl = actions.onOpenDeviceControlSettings,
                    onDisconnectStudio = actions.onDisconnectStudio,
                    onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                    onSetupWirelessDebugging = { navController.navigate(Routes.SETUP_DEVICE_CONTROL) },
                )
            }
            composable(Routes.SETUP_DEVICE_CONTROL) {
                SetupDeviceControlScreen(
                    pairingCode = state.pairingCode.value,
                    developerOptionsEnabled = state.wirelessDebuggingEnabled.value,
                    wirelessDebuggingEnabled = state.wirelessDebuggingEnabled.value,
                    onBack = { navController.popBackStack() },
                    onIvePairedTheDevice = { navController.popBackStack() },
                )
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    trustedStudios = state.trustedStudios.value,
                    logs = state.logs.value,
                    onForgetStudio = actions.onForgetStudio,
                    onCheckUsbAccessory = actions.onCheckUsbAccessory,
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}

private fun navigateSingleTop(navController: NavHostController, route: String) {
    if (navController.currentDestination?.route == route) return
    navController.navigate(route) {
        popUpTo(navController.graph.startDestinationId) { inclusive = route == Routes.HOME }
        launchSingleTop = true
    }
}
