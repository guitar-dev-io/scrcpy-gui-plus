package com.scrcpyguiplus.companion.ui

import androidx.compose.runtime.mutableStateOf
import com.scrcpyguiplus.companion.DiscoveredStudio
import com.scrcpyguiplus.companion.TrustedStudio

/** High-level connection phase driving which screen the Compose UI shows. */
enum class AgentConnectionPhase {
    /** No active session; showing the "Add Studio" home screen. */
    Idle,

    /** The in-app QR scanner is open. */
    Scanning,

    /** A LAN/USB session socket is being opened. */
    Connecting,

    /** The session just connected; showing the transient "Connected Successfully" screen. */
    JustConnected,

    /** A session is connected and steady-state; showing the agent status screen. */
    Connected,
}

/** One row of the "Device Information" card on the agent status screen. */
data class AgentDeviceInfo(
    val deviceName: String,
    val model: String,
    val androidVersion: String,
    val ipAddress: String,
    val batteryPercent: Int?,
    val wifiConnected: Boolean,
)

/**
 * Observable UI state for the Compose screens. [MainActivity] is the sole writer: it already
 * owns every underlying session/protocol object, and this class only mirrors the subset of that
 * state the UI needs to render. Keeping it a plain mutable-state holder (no ViewModel/lifecycle
 * scoping) matches the Activity's existing single-owner model and avoids duplicating session
 * ownership across two objects.
 */
class AgentUiState {
    var connectionPhase = mutableStateOf(AgentConnectionPhase.Idle)
    var statusMessage = mutableStateOf("Starting…")
    var isConnected = mutableStateOf(false)
    var transport = mutableStateOf<String?>(null)
    var studioLabel = mutableStateOf<String?>(null)

    var deviceInfo = mutableStateOf<AgentDeviceInfo?>(null)

    var agentConnected = mutableStateOf(false)
    var wirelessDebuggingEnabled = mutableStateOf(false)
    var adbConnected = mutableStateOf(false)

    var pairingCode = mutableStateOf("")

    /** Studios found by the last LAN broadcast, offered as tappable rows. */
    var discoveredStudios = mutableStateOf<List<DiscoveredStudio>>(emptyList())
    var isDiscovering = mutableStateOf(false)

    /**
     * Six digits to compare against the desktop's approval prompt. Non-null only while a
     * discovered studio is holding this device's socket open waiting to be approved.
     */
    var approvalCode = mutableStateOf<String?>(null)

    var trustedStudios = mutableStateOf<List<TrustedStudio>>(emptyList())

    var logs = mutableStateOf<List<String>>(emptyList())

    var remoteControlAvailable = mutableStateOf(false)
    var remoteControlStatus = mutableStateOf("Waiting for the desktop to approve a target")
}
