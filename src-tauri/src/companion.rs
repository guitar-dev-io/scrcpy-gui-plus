//! Multi-transport Android companion support.
//!
//! USB uses Android Open Accessory (AOA). LAN pairing opens a short-lived TCP
//! listener authenticated by a one-time QR token. Both transports share the
//! same bounded, length-prefixed JSON application protocol and method allow-list.

use qrcode::{render::svg, EcLevel, QrCode};
use rand::Rng;
use rusb::{Device, DeviceHandle, Direction, Error as RusbError, GlobalContext, TransferType};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{ErrorKind as IoErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, Window};
use tokio::task;

type CompanionResult<T> = Result<T, CompanionError>;

const AOA_VENDOR_ID: u16 = 0x18d1;
const AOA_ACCESSORY_PRODUCT_IDS: &[u16] = &[0x2d00, 0x2d01, 0x2d04, 0x2d05];
const AOA_GET_PROTOCOL: u8 = 51;
const AOA_SEND_STRING: u8 = 52;
const AOA_START: u8 = 53;
const AOA_CONTROL_OUT: u8 = 0x40;
const AOA_CONTROL_IN: u8 = 0xc0;

// AOA discovery is an explicit user action, but still avoid probing arbitrary
// cameras and vendor-specific USB peripherals. These are established Android
// OEM/chipset USB vendor ids; Google AOA mode itself is handled separately.
const ANDROID_VENDOR_IDS: &[u16] = &[
    0x0502, // Acer
    0x05c6, // Qualcomm
    0x0b05, // ASUS
    0x0bb4, // HTC
    0x0e8d, // MediaTek
    0x0fce, // Sony
    0x1004, // LG
    0x12d1, // Huawei
    0x17ef, // Lenovo
    0x18d1, // Google
    0x1949, // Amazon
    0x19d2, // ZTE
    0x1bbb, // TCL/Alcatel
    0x22b8, // Motorola
    0x22d9, // OPPO/Realme
    0x2717, // Xiaomi
    0x2a70, // OnePlus
    0x2b4c, // Nothing
    0x2d95, // vivo
    0x2e04, // HMD/Nokia
    0x413c, // Dell
    0x04e8, // Samsung
];

const IO_POLL_TIMEOUT: Duration = Duration::from_millis(500);
const HELLO_ATTEMPT_TIMEOUT: Duration = Duration::from_millis(1_500);
const ACCESSORY_RESCAN_DELAY: Duration = Duration::from_millis(250);
const SCAN_TIMEOUT: Duration = Duration::from_secs(45);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
// Keep the authenticated LAN listener alive long enough for Android to retry a
// dropped control or screen socket without requiring another QR scan.
const LAN_PAIRING_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const LAN_HELLO_TIMEOUT: Duration = Duration::from_secs(4);
const LAN_ACCEPT_POLL_DELAY: Duration = Duration::from_millis(100);
const SCREEN_HELLO_TIMEOUT: Duration = Duration::from_secs(4);
const SCREEN_FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(20);
const SCREEN_FRAME_TIMEOUT: Duration = Duration::from_secs(5);
const SCREEN_SETUP_TIMEOUT: Duration = Duration::from_secs(90);
const SCREEN_RECONNECT_TIMEOUT: Duration = Duration::from_secs(120);
const SCREEN_ACCEPT_POLL_DELAY: Duration = Duration::from_millis(100);
const SCREEN_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
const SCREEN_MAX_HELLO_BYTES: usize = 16 * 1024;
const SCREEN_MAX_REJECTED_CLIENTS: usize = 8;
const REMOTE_HELLO_TIMEOUT: Duration = Duration::from_secs(4);
const REMOTE_SETUP_TIMEOUT: Duration = Duration::from_secs(90);
const REMOTE_RECONNECT_TIMEOUT: Duration = Duration::from_secs(120);
const REMOTE_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const REMOTE_ACCEPT_POLL_DELAY: Duration = Duration::from_millis(100);
const REMOTE_MAX_FRAME_BYTES: usize = 16 * 1024;
const REMOTE_MAX_VIDEO_FRAME_BYTES: usize = 32 * 1024 * 1024 + 14;
const REMOTE_MAX_CLIPBOARD_TEXT_BYTES: usize = 2 * 1024;
const REMOTE_MAX_REJECTED_CLIENTS: usize = 8;
const LAN_TOKEN_BYTES: usize = 32;
const LAN_MAX_REJECTED_CLIENTS: usize = 8;
// LAN auto-discovery. The Agent broadcasts a probe to this fixed UDP port and the
// desktop answers with the addresses it is reachable on plus the pairing port.
// A discovery reply never carries the pairing token: an Agent that arrives this
// way has to be approved by the desktop user instead (see `LanHelloAuth`).
const DISCOVERY_PORT: u16 = 47653;
const DISCOVERY_MAGIC: &str = "scrcpy-gui-plus-discovery";
const DISCOVERY_PROTOCOL: u64 = 1;
const DISCOVERY_MAX_DATAGRAM_BYTES: usize = 2 * 1024;
const DISCOVERY_POLL_TIMEOUT: Duration = Duration::from_millis(250);
// How long a token-less Agent may hold its socket open waiting for the desktop
// user to decide before it is dropped and has to ask again.
const LAN_APPROVAL_TIMEOUT: Duration = Duration::from_secs(90);
const LAN_APPROVAL_POLL_DELAY: Duration = Duration::from_millis(100);
const MIN_APPROVAL_NONCE_CHARS: usize = 16;
const MAX_APPROVAL_NONCE_CHARS: usize = 64;
const USB_READ_CHUNK_BYTES: usize = 16 * 1024;
const AOA_INTERFACE_CLASS: u8 = 0xff;
const AOA_INTERFACE_SUBCLASS: u8 = 0xff;
const AOA_INTERFACE_PROTOCOL: u8 = 0x00;
const ADB_INTERFACE_SUBCLASS: u8 = 0x42;
const ADB_INTERFACE_PROTOCOL: u8 = 0x01;
const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_CLIPBOARD_BYTES: usize = 256 * 1024;
const MAX_URL_BYTES: usize = 4_096;
const PROTOCOL_VERSION: u64 = 1;
const HOST_MANUFACTURER: &str = "Scrcpy GUI Plus";
const HOST_MODEL: &str = "Companion";
const HOST_VERSION: &str = "1";
const EXPECTED_PACKAGE: &str = "com.scrcpyguiplus.companion";

const ALLOWED_METHODS: &[&str] = &[
    "ping",
    "get_device_info",
    "clipboard_set",
    "clipboard_get",
    "open_url",
    "start_screen_share",
    "stop_screen_share",
    "start_remote_control",
    "stop_remote_control",
    // Phone-side input through the companion's AccessibilityService (no adb).
    "control_status",
    "control_gesture",
    "control_action",
    "control_text",
    "ui_dump",
    "list_apps",
    "launch_app",
    // Sent only by companion_send_file, which chunks the file itself.
    "file_begin",
    "file_chunk",
    "file_end",
];

const FILE_TRANSFER_METHODS: &[&str] = &["file_begin", "file_chunk", "file_end"];
const FILE_CHUNK_BYTES: usize = 384 * 1024;
const MAX_SEND_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_CONTROL_GESTURE_STROKES: usize = 2;

const MAX_CONTROL_GESTURE_POINTS: usize = 256;
const MAX_CONTROL_GESTURE_DURATION_MS: u64 = 10_000;
const MAX_CONTROL_TEXT_BYTES: usize = 4_096;
const CONTROL_ACTIONS: &[&str] = &[
    "back",
    "home",
    "recents",
    "notifications",
    "quick_settings",
    "power_dialog",
    "lock_screen",
    "enter",
    "backspace",
    "volume_up",
    "volume_down",
];

// A v1 client that omits capabilities predates remote control. Keep its
// implicit behavior unchanged; new methods require explicit advertisement.
const LEGACY_DEFAULT_METHODS: &[&str] = &[
    "ping",
    "get_device_info",
    "clipboard_set",
    "clipboard_get",
    "open_url",
    "start_screen_share",
    "stop_screen_share",
];

const REMOTE_CONTROL_METHODS: &[&str] = &[
    "back",
    "home",
    "recents",
    "rotate",
    "screen_on",
    "screen_off",
    "touch",
    "key",
    "text",
    "clipboard_set",
];
const REMOTE_PERMISSIONS: &[&str] = &["view", "control", "keyboard", "clipboard"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionErrorKind {
    NotFound,
    Permission,
    Timeout,
    Cancelled,
    Usb,
    Network,
    Protocol,
    Remote,
    Validation,
    State,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompanionError {
    kind: CompanionErrorKind,
    message: String,
}

impl CompanionError {
    fn new(kind: CompanionErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn code(&self) -> &'static str {
        match self.kind {
            CompanionErrorKind::NotFound => "not_found",
            CompanionErrorKind::Permission => "permission_denied",
            CompanionErrorKind::Timeout => "timeout",
            CompanionErrorKind::Cancelled => "cancelled",
            CompanionErrorKind::Usb => "usb_error",
            CompanionErrorKind::Network => "network_error",
            CompanionErrorKind::Protocol => "protocol_error",
            CompanionErrorKind::Remote => "remote_error",
            CompanionErrorKind::Validation => "invalid_request",
            CompanionErrorKind::State => "state_error",
        }
    }

    fn loses_session(&self) -> bool {
        matches!(
            self.kind,
            CompanionErrorKind::NotFound
                | CompanionErrorKind::Permission
                | CompanionErrorKind::Timeout
                | CompanionErrorKind::Cancelled
                | CompanionErrorKind::Usb
                | CompanionErrorKind::Network
                | CompanionErrorKind::Protocol
                | CompanionErrorKind::State
        )
    }
}

impl std::fmt::Display for CompanionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

#[derive(Clone)]
struct CancellationToken {
    epoch: Arc<AtomicU64>,
    expected: u64,
}

impl CancellationToken {
    fn check(&self) -> CompanionResult<()> {
        if self.epoch.load(Ordering::SeqCst) == self.expected {
            Ok(())
        } else {
            Err(CompanionError::new(
                CompanionErrorKind::Cancelled,
                "Companion operation cancelled",
            ))
        }
    }
}

#[derive(Clone, Copy)]
struct OperationDeadline {
    end: Instant,
    label: &'static str,
}

impl OperationDeadline {
    fn after(duration: Duration, label: &'static str) -> Self {
        Self {
            end: Instant::now() + duration,
            label,
        }
    }

    fn capped(self, duration: Duration, label: &'static str) -> Self {
        let candidate = Instant::now() + duration;
        Self {
            end: if candidate < self.end {
                candidate
            } else {
                self.end
            },
            label,
        }
    }

    fn check(self, cancellation: &CancellationToken) -> CompanionResult<()> {
        cancellation.check()?;
        if Instant::now() >= self.end {
            Err(self.timeout_error())
        } else {
            Ok(())
        }
    }

    fn transfer_timeout(self, cancellation: &CancellationToken) -> CompanionResult<Duration> {
        self.check(cancellation)?;
        let remaining = self.end.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(self.timeout_error());
        }
        Ok(remaining.min(IO_POLL_TIMEOUT))
    }

    fn timeout_error(self) -> CompanionError {
        CompanionError::new(
            CompanionErrorKind::Timeout,
            format!("{} timed out", self.label),
        )
    }
}

/// Device information received from the Android companion hello frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDevice {
    pub id: String,
    pub name: String,
    pub package_name: String,
    pub app_version: String,
    pub protocol: u64,
    pub transport: String,
    pub capabilities: Vec<String>,
    /// Stable identity persisted by the Agent app itself (SharedPreferences UUID),
    /// independent of `id` (which is connection-scoped: `lan-<generation>-<ip>` /
    /// `aoa-<bus>-<addr>`). Absent for Agent builds older than this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_device_id: Option<String>,
    /// The LAN peer's IP address, captured from the accepted TCP socket. Used to
    /// auto-match this Agent against an ADB wifi device on the desktop side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_ip: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionScanResult {
    pub success: bool,
    pub devices: Vec<CompanionDevice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl CompanionScanResult {
    fn ok(device: CompanionDevice) -> Self {
        Self {
            success: true,
            devices: vec![device],
            error: None,
            error_code: None,
        }
    }

    fn err(error: CompanionError) -> Self {
        let error_code = error.code().to_string();
        Self {
            success: false,
            devices: Vec::new(),
            error: Some(error.message),
            error_code: Some(error_code),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionLanOffer {
    pub generation: u64,
    pub host: String,
    /// Every LAN address this desktop is reachable on, best first. `host` is just
    /// the first entry, kept as its own field for Agent builds that only read it.
    pub hosts: Vec<String>,
    pub port: u16,
    /// UDP port the Agent can broadcast to when the QR addresses are unreachable.
    /// `None` when the port was already taken, in which case QR pairing still works.
    pub discovery_port: Option<u16>,
    pub expires_at: u64,
    pub payload: String,
    pub svg: String,
}

/// An Agent that reached this desktop through LAN discovery and is waiting for the
/// user to approve it, emitted on the `companion-pairing-approval` channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionApprovalEvent {
    pub request_id: u64,
    pub pairing_generation: u64,
    pub device_name: String,
    pub peer_ip: String,
    /// Six digits both sides derive from the Agent's nonce, so the user can tell
    /// the phone in their hand apart from any other client on the network.
    pub code: String,
    /// True once the request has been answered, timed out, or been superseded, so
    /// the UI can take its prompt down without tracking timers of its own.
    pub resolved: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRequestResult {
    pub success: bool,
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub disconnected: bool,
}

impl CompanionRequestResult {
    fn ok(result: Value, disconnected: bool) -> Self {
        Self {
            success: true,
            result: Some(result),
            error: None,
            error_code: None,
            disconnected,
        }
    }

    fn err(error: CompanionError) -> Self {
        let disconnected = error.loses_session();
        let error_code = error.code().to_string();
        Self {
            success: false,
            result: None,
            error: Some(error.message),
            error_code: Some(error_code),
            disconnected,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionStatusEvent {
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    device: Option<CompanionDevice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pairing_generation: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionScreenStatusEvent {
    generation: u64,
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionRemoteStatusEvent {
    generation: u64,
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permissions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    video_ready: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    embedded_auto_started: Option<bool>,
}

/// Periodic telemetry polled from the connected Agent's `get_device_info`
/// response (battery/wifi/screen). Not a push frame from Android — see
/// `spawn_agent_heartbeat`, which reuses the existing request/response
/// protocol rather than adding a new unsolicited frame type.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionTelemetryEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    battery: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wifi_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screen_on: Option<bool>,
}

#[derive(Clone)]
struct RemoteSessionMetadata {
    generation: u64,
    session_id: String,
    target_serial: String,
    permissions: Vec<String>,
    legacy_navigation_only: bool,
    embedded_auto_started: bool,
    embedded_session_id: Option<String>,
}

fn clear_remote_metadata_if_generation(
    remote_session: &Arc<Mutex<Option<RemoteSessionMetadata>>>,
    generation: u64,
) -> bool {
    let Ok(mut current) = remote_session.lock() else {
        return false;
    };
    if current
        .as_ref()
        .is_some_and(|metadata| metadata.generation == generation)
    {
        *current = None;
        true
    } else {
        false
    }
}

struct RemoteListenerCleanup {
    remote_session: Arc<Mutex<Option<RemoteSessionMetadata>>>,
    remote_epoch: Arc<AtomicU64>,
    generation: u64,
    app: AppHandle,
    window: Window,
    runtime: tokio::runtime::Handle,
}

impl Drop for RemoteListenerCleanup {
    fn drop(&mut self) {
        if clear_remote_metadata_if_generation(&self.remote_session, self.generation) {
            invalidate_remote_epoch_if_generation(&self.remote_epoch, self.generation);
        }
        self.runtime
            .block_on(crate::embed_session::release_remote_session_lease(
                &self.app,
                &self.window,
                self.generation,
            ));
    }
}

fn invalidate_remote_epoch_if_generation(epoch: &AtomicU64, generation: u64) -> bool {
    epoch
        .compare_exchange(
            generation,
            generation.saturating_add(1),
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_ok()
}

fn emit_remote_status(
    window: &Window,
    generation: u64,
    stage: &str,
    message: impl Into<String>,
    metadata: Option<&RemoteSessionMetadata>,
) {
    emit_remote_status_with_video(window, generation, stage, message, metadata, None);
}

fn emit_remote_status_with_video(
    window: &Window,
    generation: u64,
    stage: &str,
    message: impl Into<String>,
    metadata: Option<&RemoteSessionMetadata>,
    video_ready: Option<bool>,
) {
    let _ = window.emit(
        "companion-remote-status",
        CompanionRemoteStatusEvent {
            generation,
            stage: stage.to_string(),
            message: message.into(),
            target_serial: metadata.map(|session| session.target_serial.clone()),
            session_id: metadata.map(|session| session.session_id.clone()),
            permissions: metadata.map(|session| session.permissions.clone()),
            video_ready,
            embedded_auto_started: metadata.map(|session| session.embedded_auto_started),
        },
    );
}

fn emit_screen_status(
    window: &Window,
    generation: u64,
    stage: &str,
    message: impl Into<String>,
    dimensions: Option<(u32, u32)>,
) {
    let (width, height) = dimensions
        .map(|(width, height)| (Some(width), Some(height)))
        .unwrap_or((None, None));
    let _ = window.emit(
        "companion-screen-status",
        CompanionScreenStatusEvent {
            generation,
            stage: stage.to_string(),
            message: message.into(),
            width,
            height,
        },
    );
}

fn emit_status(window: &Window, stage: &str, message: impl Into<String>) {
    emit_status_event(window, stage, message, None, None);
}

fn emit_pairing_status(
    window: &Window,
    stage: &str,
    message: impl Into<String>,
    device: Option<CompanionDevice>,
    pairing_generation: u64,
) {
    emit_status_event(window, stage, message, device, Some(pairing_generation));
}

fn emit_status_event(
    window: &Window,
    stage: &str,
    message: impl Into<String>,
    device: Option<CompanionDevice>,
    pairing_generation: Option<u64>,
) {
    let _ = window.emit(
        "companion-status",
        CompanionStatusEvent {
            stage: stage.to_string(),
            message: message.into(),
            device,
            pairing_generation,
        },
    );
}

fn emit_telemetry(window: &Window, agent_device_id: Option<String>, info: &Value) {
    let _ = window.emit(
        "companion-telemetry",
        CompanionTelemetryEvent {
            agent_device_id,
            battery: info.get("battery").and_then(Value::as_i64),
            wifi_connected: info.get("wifiConnected").and_then(Value::as_bool),
            screen_on: info.get("screenOn").and_then(Value::as_bool),
        },
    );
}

/// Poll the connected Agent's `get_device_info` on a fixed interval and emit
/// `companion-telemetry`. Reuses the existing desktop-initiated request/response
/// protocol (`perform_request`) rather than adding a new unsolicited push-frame
/// type, since the wire protocol today is strictly request/response. Stops
/// itself once the connection slot no longer holds this same connection (a new
/// pairing, a disconnect, or app shutdown all replace/clear it).
fn spawn_agent_heartbeat(
    window: Window,
    connection: Arc<Mutex<Option<CompanionConnection>>>,
    cancellation: CancellationToken,
    connection_id: String,
    agent_device_id: Option<String>,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
            if cancellation.check().is_err() {
                return;
            }

            let task_connection = connection.clone();
            let task_cancellation = cancellation.clone();
            let task_connection_id = connection_id.clone();
            let outcome = task::spawn_blocking(move || {
                let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Companion heartbeat");
                let mut guard = match lock_connection(&task_connection) {
                    Ok(guard) => guard,
                    Err(_) => return None,
                };
                let active = match guard.as_mut() {
                    Some(active) if active.device.id == task_connection_id => active,
                    _ => return None,
                };
                let result = perform_request(
                    active,
                    0,
                    "get_device_info",
                    json!({}),
                    deadline,
                    &task_cancellation,
                );
                if let Err(error) = &result {
                    if error.loses_session() {
                        *guard = None;
                    }
                }
                Some(result)
            })
            .await;

            match outcome {
                Ok(Some(Ok(value))) => emit_telemetry(&window, agent_device_id.clone(), &value),
                // A stale/non-fatal error is skipped; a session-losing error or a
                // connection slot that no longer matches ends the loop.
                Ok(Some(Err(error))) if !error.loses_session() => continue,
                _ => return,
            }
        }
    });
}

/// Runtime state for one active companion session and one pending LAN offer.
/// Requests are serialized by `connection`; cancellation epochs invalidate
/// stale USB/TCP work before the connection slot is synchronously cleared.
/// The single Agent currently awaiting approval. One slot is enough: the pairing
/// listener only ever holds one token-less socket at a time, and a newer request
/// replaces an older one the user never answered.
#[derive(Debug, Clone)]
struct PendingApproval {
    request_id: u64,
    pairing_generation: u64,
    device_name: String,
    peer_ip: String,
    code: String,
    /// `None` while the prompt is still open; `Some(true)` once approved.
    decision: Option<bool>,
}

pub struct CompanionState {
    connection: Arc<Mutex<Option<CompanionConnection>>>,
    cancellation_epoch: Arc<AtomicU64>,
    pairing_epoch: Arc<AtomicU64>,
    screen_epoch: Arc<AtomicU64>,
    remote_epoch: Arc<AtomicU64>,
    remote_session: Arc<Mutex<Option<RemoteSessionMetadata>>>,
    pending_approval: Arc<Mutex<Option<PendingApproval>>>,
    next_request_id: AtomicU64,
    next_approval_id: Arc<AtomicU64>,
}

impl Default for CompanionState {
    fn default() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
            cancellation_epoch: Arc::new(AtomicU64::new(1)),
            pairing_epoch: Arc::new(AtomicU64::new(1)),
            screen_epoch: Arc::new(AtomicU64::new(1)),
            remote_epoch: Arc::new(AtomicU64::new(1)),
            remote_session: Arc::new(Mutex::new(None)),
            pending_approval: Arc::new(Mutex::new(None)),
            next_request_id: AtomicU64::new(1),
            next_approval_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl CompanionState {
    fn cancellation_token(&self) -> CancellationToken {
        CancellationToken {
            epoch: self.cancellation_epoch.clone(),
            expected: self.cancellation_epoch.load(Ordering::SeqCst),
        }
    }

    pub fn shutdown(&self) -> u64 {
        self.cancellation_epoch.fetch_add(1, Ordering::SeqCst);
        self.screen_epoch.fetch_add(1, Ordering::SeqCst);
        self.remote_epoch.fetch_add(1, Ordering::SeqCst);
        let pairing_generation = self.pairing_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        match self.connection.lock() {
            Ok(mut guard) => *guard = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
        match self.remote_session.lock() {
            Ok(mut guard) => *guard = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
        match self.pending_approval.lock() {
            Ok(mut guard) => *guard = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
        pairing_generation
    }

    fn next_screen_generation(&self) -> u64 {
        self.screen_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn invalidate_screen(&self) {
        self.screen_epoch.fetch_add(1, Ordering::SeqCst);
    }

    fn next_remote_generation(&self) -> u64 {
        self.remote_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn invalidate_remote(&self) {
        self.remote_epoch.fetch_add(1, Ordering::SeqCst);
        match self.remote_session.lock() {
            Ok(mut guard) => *guard = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
    }
}

struct UsbTransport {
    handle: DeviceHandle<GlobalContext>,
    interface_number: u8,
    endpoint_in: u8,
    endpoint_out: u8,
    read_buffer: Vec<u8>,
    read_buffer_offset: usize,
}

impl Drop for UsbTransport {
    fn drop(&mut self) {
        let _ = self.handle.release_interface(self.interface_number);
    }
}

enum CompanionTransport {
    Usb(UsbTransport),
    Tcp(TcpStream),
}

struct CompanionConnection {
    transport: CompanionTransport,
    device: CompanionDevice,
}

impl CompanionConnection {
    fn open_usb(device: &Device<GlobalContext>) -> CompanionResult<Self> {
        let config = device
            .active_config_descriptor()
            .map_err(|error| usb_error("Could not read the USB configuration", error))?;

        // AOA+ADB devices expose two vendor bulk interfaces. Prefer the AOA
        // descriptor (ff/ff/00) and never select the ADB descriptor
        // (ff/42/01), even if a device lists ADB first.
        let endpoints = config
            .interfaces()
            .flat_map(|interface| interface.descriptors())
            .filter_map(|descriptor| {
                let is_adb = descriptor.class_code() == AOA_INTERFACE_CLASS
                    && descriptor.sub_class_code() == ADB_INTERFACE_SUBCLASS
                    && descriptor.protocol_code() == ADB_INTERFACE_PROTOCOL;
                if is_adb {
                    return None;
                }

                let mut endpoint_in = None;
                let mut endpoint_out = None;
                for endpoint in descriptor.endpoint_descriptors() {
                    if endpoint.transfer_type() != TransferType::Bulk {
                        continue;
                    }
                    match endpoint.direction() {
                        Direction::In => endpoint_in = Some(endpoint.address()),
                        Direction::Out => endpoint_out = Some(endpoint.address()),
                    }
                }

                match (endpoint_in, endpoint_out) {
                    (Some(input), Some(output)) => {
                        let is_aoa = descriptor.class_code() == AOA_INTERFACE_CLASS
                            && descriptor.sub_class_code() == AOA_INTERFACE_SUBCLASS
                            && descriptor.protocol_code() == AOA_INTERFACE_PROTOCOL;
                        Some((
                            u8::from(is_aoa),
                            descriptor.interface_number(),
                            input,
                            output,
                        ))
                    }
                    _ => None,
                }
            })
            .max_by_key(|candidate| candidate.0)
            .map(|candidate| (candidate.1, candidate.2, candidate.3))
            .ok_or_else(|| {
                CompanionError::new(
                    CompanionErrorKind::Protocol,
                    "AOA bulk endpoints were not found",
                )
            })?;

        let handle = device
            .open()
            .map_err(|error| usb_error("Could not open the AOA device", error))?;

        #[cfg(target_os = "linux")]
        let _ = handle.set_auto_detach_kernel_driver(true);

        handle
            .claim_interface(endpoints.0)
            .map_err(|error| usb_error("Could not claim the AOA interface", error))?;

        let id = format!("aoa-{}-{}", device.bus_number(), device.address());
        Ok(Self {
            transport: CompanionTransport::Usb(UsbTransport {
                handle,
                interface_number: endpoints.0,
                endpoint_in: endpoints.1,
                endpoint_out: endpoints.2,
                read_buffer: Vec::new(),
                read_buffer_offset: 0,
            }),
            device: empty_device(id, "usb-accessory"),
        })
    }

    fn open_tcp(
        stream: TcpStream,
        peer: SocketAddr,
        pairing_generation: u64,
    ) -> CompanionResult<Self> {
        stream
            .set_nodelay(true)
            .map_err(|error| network_error("Could not configure LAN companion socket", error))?;
        Ok(Self {
            transport: CompanionTransport::Tcp(stream),
            device: empty_device(format!("lan-{pairing_generation}-{}", peer.ip()), "lan-tcp"),
        })
    }

    fn read_exact(
        &mut self,
        buffer: &mut [u8],
        deadline: OperationDeadline,
        cancellation: &CancellationToken,
    ) -> CompanionResult<()> {
        match &mut self.transport {
            CompanionTransport::Usb(transport) => {
                read_usb_exact(transport, buffer, deadline, cancellation)
            }
            CompanionTransport::Tcp(stream) => {
                read_tcp_exact(stream, buffer, deadline, cancellation)
            }
        }
    }

    fn read_frame(
        &mut self,
        deadline: OperationDeadline,
        cancellation: &CancellationToken,
    ) -> CompanionResult<Vec<u8>> {
        let mut header = [0u8; 4];
        self.read_exact(&mut header, deadline, cancellation)?;
        let length = validate_frame_length(u32::from_be_bytes(header))?;

        let mut payload = vec![0u8; length];
        self.read_exact(&mut payload, deadline, cancellation)?;
        Ok(payload)
    }

    fn write_frame(
        &mut self,
        payload: &[u8],
        deadline: OperationDeadline,
        cancellation: &CancellationToken,
    ) -> CompanionResult<()> {
        validate_frame_length(payload.len() as u32)?;
        let header = (payload.len() as u32).to_be_bytes();
        match &mut self.transport {
            CompanionTransport::Usb(transport) => {
                write_bulk_all(
                    &mut transport.handle,
                    transport.endpoint_out,
                    &header,
                    deadline,
                    cancellation,
                )?;
                write_bulk_all(
                    &mut transport.handle,
                    transport.endpoint_out,
                    payload,
                    deadline,
                    cancellation,
                )
            }
            CompanionTransport::Tcp(stream) => {
                write_tcp_all(stream, &header, deadline, cancellation)?;
                write_tcp_all(stream, payload, deadline, cancellation)
            }
        }
    }
}

fn empty_device(id: String, transport: &str) -> CompanionDevice {
    CompanionDevice {
        id,
        name: "Android Companion".to_string(),
        package_name: String::new(),
        app_version: String::new(),
        protocol: PROTOCOL_VERSION,
        transport: transport.to_string(),
        capabilities: Vec::new(),
        agent_device_id: None,
        peer_ip: None,
    }
}

fn read_usb_exact(
    transport: &mut UsbTransport,
    buffer: &mut [u8],
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let mut write_offset = 0;
    while write_offset < buffer.len() {
        if transport.read_buffer_offset < transport.read_buffer.len() {
            let available = transport.read_buffer.len() - transport.read_buffer_offset;
            let count = available.min(buffer.len() - write_offset);
            buffer[write_offset..write_offset + count].copy_from_slice(
                &transport.read_buffer
                    [transport.read_buffer_offset..transport.read_buffer_offset + count],
            );
            transport.read_buffer_offset += count;
            write_offset += count;

            if transport.read_buffer_offset == transport.read_buffer.len() {
                transport.read_buffer.clear();
                transport.read_buffer_offset = 0;
            }
            continue;
        }

        // Android may coalesce the four-byte frame header and JSON payload.
        // Always receive a USB-packet-safe chunk and retain unread bytes.
        transport.read_buffer.resize(USB_READ_CHUNK_BYTES, 0);
        transport.read_buffer_offset = 0;
        let timeout = deadline.transfer_timeout(cancellation)?;
        match transport
            .handle
            .read_bulk(transport.endpoint_in, &mut transport.read_buffer, timeout)
        {
            Ok(0) => {
                transport.read_buffer.clear();
                return Err(CompanionError::new(
                    CompanionErrorKind::Usb,
                    "AOA read returned no progress",
                ));
            }
            Ok(count) => transport.read_buffer.truncate(count),
            Err(RusbError::Timeout) => {
                transport.read_buffer.clear();
                continue;
            }
            Err(error) => {
                transport.read_buffer.clear();
                return Err(usb_error("AOA read failed", error));
            }
        }
    }
    Ok(())
}

fn read_tcp_exact(
    stream: &mut TcpStream,
    buffer: &mut [u8],
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let mut offset = 0;
    while offset < buffer.len() {
        let timeout = deadline.transfer_timeout(cancellation)?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| network_error("Could not configure LAN read timeout", error))?;
        match stream.read(&mut buffer[offset..]) {
            Ok(0) => {
                return Err(CompanionError::new(
                    CompanionErrorKind::Network,
                    "LAN companion disconnected",
                ));
            }
            Ok(count) => offset += count,
            Err(error)
                if matches!(
                    error.kind(),
                    IoErrorKind::TimedOut | IoErrorKind::WouldBlock | IoErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(network_error("LAN companion read failed", error)),
        }
    }
    Ok(())
}

fn validate_frame_length(length: u32) -> CompanionResult<usize> {
    let length = length as usize;
    if length == 0 || length > MAX_PAYLOAD_BYTES {
        Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Invalid companion payload length {length}; expected 1..{MAX_PAYLOAD_BYTES}"),
        ))
    } else {
        Ok(length)
    }
}

fn write_bulk_all(
    handle: &mut DeviceHandle<GlobalContext>,
    endpoint: u8,
    bytes: &[u8],
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let timeout = deadline.transfer_timeout(cancellation)?;
        match handle.write_bulk(endpoint, &bytes[offset..], timeout) {
            Ok(0) => {
                return Err(CompanionError::new(
                    CompanionErrorKind::Usb,
                    "AOA write returned no progress",
                ))
            }
            Ok(count) => offset += count,
            Err(RusbError::Timeout) => continue,
            Err(error) => return Err(usb_error("AOA write failed", error)),
        }
    }
    Ok(())
}

fn write_tcp_all(
    stream: &mut TcpStream,
    bytes: &[u8],
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let timeout = deadline.transfer_timeout(cancellation)?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|error| network_error("Could not configure LAN write timeout", error))?;
        match stream.write(&bytes[offset..]) {
            Ok(0) => {
                return Err(CompanionError::new(
                    CompanionErrorKind::Network,
                    "LAN companion write returned no progress",
                ));
            }
            Ok(count) => offset += count,
            Err(error)
                if matches!(
                    error.kind(),
                    IoErrorKind::TimedOut | IoErrorKind::WouldBlock | IoErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(network_error("LAN companion write failed", error)),
        }
    }
    Ok(())
}

fn network_error(context: &str, error: std::io::Error) -> CompanionError {
    let kind = match error.kind() {
        IoErrorKind::PermissionDenied => CompanionErrorKind::Permission,
        IoErrorKind::TimedOut | IoErrorKind::WouldBlock => CompanionErrorKind::Timeout,
        _ => CompanionErrorKind::Network,
    };
    CompanionError::new(kind, format!("{context}: {error}"))
}

fn usb_error(context: &str, error: RusbError) -> CompanionError {
    let kind = match error {
        RusbError::Access | RusbError::Busy => CompanionErrorKind::Permission,
        RusbError::Timeout => CompanionErrorKind::Timeout,
        _ => CompanionErrorKind::Usb,
    };
    CompanionError::new(kind, format!("{context}: {error}"))
}

fn is_accessory_product(device: &Device<GlobalContext>) -> bool {
    let Ok(descriptor) = device.device_descriptor() else {
        return false;
    };
    descriptor.vendor_id() == AOA_VENDOR_ID
        && AOA_ACCESSORY_PRODUCT_IDS.contains(&descriptor.product_id())
}

fn is_android_candidate(device: &Device<GlobalContext>) -> bool {
    let Ok(descriptor) = device.device_descriptor() else {
        return false;
    };
    !is_accessory_product(device) && ANDROID_VENDOR_IDS.contains(&descriptor.vendor_id())
}

fn control_timeout(
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<Duration> {
    deadline.transfer_timeout(cancellation)
}

fn send_aoa_string(
    handle: &mut DeviceHandle<GlobalContext>,
    index: u16,
    value: &str,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let mut bytes = value.as_bytes().to_vec();
    bytes.push(0); // AOA SEND_STRING expects a NUL-terminated UTF-8 string.
    handle
        .write_control(
            AOA_CONTROL_OUT,
            AOA_SEND_STRING,
            0,
            index,
            &bytes,
            control_timeout(deadline, cancellation)?,
        )
        .map_err(|error| usb_error("AOA string handshake failed", error))?;
    Ok(())
}

fn switch_to_accessory(
    device: &Device<GlobalContext>,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<bool> {
    if !is_android_candidate(device) {
        return Ok(false);
    }
    deadline.check(cancellation)?;

    let mut handle = match device.open() {
        Ok(handle) => handle,
        Err(RusbError::Access | RusbError::Busy) => {
            return Err(CompanionError::new(
                CompanionErrorKind::Permission,
                "USB access was denied while opening an Android device",
            ))
        }
        Err(_) => return Ok(false),
    };

    let mut protocol = [0u8; 2];
    let read = match handle.read_control(
        AOA_CONTROL_IN,
        AOA_GET_PROTOCOL,
        0,
        0,
        &mut protocol,
        control_timeout(deadline, cancellation)?,
    ) {
        Ok(read) => read,
        Err(RusbError::Access | RusbError::Busy) => {
            return Err(CompanionError::new(
                CompanionErrorKind::Permission,
                "USB access was denied during the AOA handshake",
            ))
        }
        Err(RusbError::Timeout | RusbError::Pipe | RusbError::NotSupported) => return Ok(false),
        Err(_) => return Ok(false),
    };
    if read < 2 || u16::from_le_bytes(protocol) == 0 {
        return Ok(false);
    }

    send_aoa_string(&mut handle, 0, HOST_MANUFACTURER, deadline, cancellation)?;
    send_aoa_string(&mut handle, 1, HOST_MODEL, deadline, cancellation)?;
    send_aoa_string(
        &mut handle,
        2,
        "USB companion transport",
        deadline,
        cancellation,
    )?;
    send_aoa_string(&mut handle, 3, HOST_VERSION, deadline, cancellation)?;
    send_aoa_string(
        &mut handle,
        4,
        "https://github.com/kil0bit-kb/scrcpy-gui",
        deadline,
        cancellation,
    )?;
    send_aoa_string(
        &mut handle,
        5,
        "scrcpy-gui-plus-companion",
        deadline,
        cancellation,
    )?;

    handle
        .write_control(
            AOA_CONTROL_OUT,
            AOA_START,
            0,
            0,
            &[],
            control_timeout(deadline, cancellation)?,
        )
        .map_err(|error| usb_error("Could not start Android accessory mode", error))?;
    Ok(true)
}

fn parse_hello(
    device_id: &str,
    transport: &str,
    payload: &[u8],
) -> CompanionResult<CompanionDevice> {
    let value: Value = serde_json::from_slice(payload).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Companion hello was not valid JSON: {error}"),
        )
    })?;
    if value.get("type").and_then(Value::as_str) != Some("hello") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion did not send a hello frame",
        ));
    }
    let protocol = value
        .get("protocol")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Companion hello is missing protocol",
            )
        })?;
    if protocol != PROTOCOL_VERSION {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Unsupported companion protocol {protocol}; expected {PROTOCOL_VERSION}"),
        ));
    }

    let app = value
        .get("app")
        .and_then(Value::as_str)
        .unwrap_or("Android Companion")
        .trim();
    let package_name = value
        .get("package")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();

    if package_name != EXPECTED_PACKAGE {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            format!(
                "Unexpected companion package '{}'; expected {EXPECTED_PACKAGE}",
                if package_name.is_empty() {
                    "<missing>"
                } else {
                    package_name
                }
            ),
        ));
    }
    if app.len() > 128 || version.len() > 64 {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion hello metadata is too large",
        ));
    }

    let capabilities = value
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|items| {
            let mut capabilities = Vec::new();
            for capability in items.iter().filter_map(Value::as_str) {
                if ALLOWED_METHODS.contains(&capability)
                    && !capabilities.iter().any(|existing| existing == capability)
                {
                    capabilities.push(capability.to_string());
                }
            }
            capabilities
        })
        .unwrap_or_else(|| {
            LEGACY_DEFAULT_METHODS
                .iter()
                .map(|method| (*method).to_string())
                .collect()
        });
    if !capabilities.iter().any(|capability| capability == "ping") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion does not advertise the required ping capability",
        ));
    }

    let agent_device_id = value
        .get("deviceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .map(str::to_string);

    Ok(CompanionDevice {
        id: device_id.to_string(),
        name: app.to_string(),
        package_name: package_name.to_string(),
        app_version: version.to_string(),
        protocol,
        transport: transport.to_string(),
        capabilities,
        agent_device_id,
        peer_ip: None,
    })
}

fn open_and_identify(
    device: &Device<GlobalContext>,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<CompanionConnection> {
    let mut connection = CompanionConnection::open_usb(device)?;
    let hello = connection.read_frame(deadline, cancellation)?;
    let info = parse_hello(&connection.device.id, "usb-accessory", &hello)?;
    connection.device = info;
    Ok(connection)
}

struct AccessorySearch {
    connection: Option<CompanionConnection>,
    saw_accessory: bool,
    last_error: Option<CompanionError>,
}

fn find_open_accessory(
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<AccessorySearch> {
    deadline.check(cancellation)?;
    let devices = rusb::devices().map_err(|error| usb_error("USB enumeration failed", error))?;
    let mut search = AccessorySearch {
        connection: None,
        saw_accessory: false,
        last_error: None,
    };

    for device in devices.iter() {
        deadline.check(cancellation)?;
        if !is_accessory_product(&device) {
            continue;
        }
        search.saw_accessory = true;
        let hello_deadline = deadline.capped(HELLO_ATTEMPT_TIMEOUT, "Companion hello");
        match open_and_identify(&device, hello_deadline, cancellation) {
            Ok(connection) => {
                search.connection = Some(connection);
                return Ok(search);
            }
            Err(error) => search.last_error = Some(error),
        }
    }
    Ok(search)
}

fn sleep_with_cancel(
    duration: Duration,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let sleep_end = Instant::now() + duration;
    loop {
        deadline.check(cancellation)?;
        let now = Instant::now();
        if now >= sleep_end {
            return Ok(());
        }
        std::thread::sleep((sleep_end - now).min(Duration::from_millis(50)));
    }
}

fn scan_wait_error(error: CompanionError, last_error: Option<&CompanionError>) -> CompanionError {
    if error.kind != CompanionErrorKind::Timeout {
        return error;
    }

    match last_error {
        Some(last_error) => CompanionError::new(
            CompanionErrorKind::Timeout,
            format!(
                "{}; last USB attempt failed: {}",
                error.message, last_error.message
            ),
        ),
        None => error,
    }
}

fn scan_for_companion(
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
    progress: &dyn Fn(&'static str, String),
) -> CompanionResult<CompanionConnection> {
    progress(
        "scanning",
        "Checking existing USB accessory sessions...".to_string(),
    );
    let initial = find_open_accessory(deadline, cancellation)?;
    if let Some(connection) = initial.connection {
        return Ok(connection);
    }

    progress(
        "switching",
        "Looking for Android devices that support USB accessory mode...".to_string(),
    );
    let devices = rusb::devices().map_err(|error| usb_error("USB enumeration failed", error))?;
    let mut requested_switches = 0usize;
    let mut last_error = initial.last_error;
    for device in devices.iter() {
        deadline.check(cancellation)?;
        match switch_to_accessory(&device, deadline, cancellation) {
            Ok(true) => requested_switches += 1,
            Ok(false) => {}
            Err(error) => last_error = Some(error),
        }
    }

    if requested_switches == 0 && !initial.saw_accessory {
        if let Some(error) = last_error.filter(|error| {
            matches!(
                error.kind,
                CompanionErrorKind::Permission | CompanionErrorKind::Usb
            )
        }) {
            return Err(error);
        }
        return Err(CompanionError::new(
            CompanionErrorKind::NotFound,
            "No compatible Android USB device was found. Install and open the companion app, keep the phone unlocked, connect a data cable, then start USB Companion again.",
        ));
    }

    progress(
        "waiting_permission",
        if requested_switches > 0 {
            "Accessory mode requested. Keep the phone unlocked and the companion app open, then tap Allow on Android."
                .to_string()
        } else {
            "Accessory detected. Keep the phone unlocked and the companion app open, then tap Allow on Android."
                .to_string()
        },
    );

    loop {
        if let Err(error) = deadline.check(cancellation) {
            return Err(scan_wait_error(error, last_error.as_ref()));
        }
        if let Err(error) = sleep_with_cancel(ACCESSORY_RESCAN_DELAY, deadline, cancellation) {
            return Err(scan_wait_error(error, last_error.as_ref()));
        }
        let search = match find_open_accessory(deadline, cancellation) {
            Ok(search) => search,
            Err(error) => return Err(scan_wait_error(error, last_error.as_ref())),
        };
        if let Some(connection) = search.connection {
            return Ok(connection);
        }
        if let Some(error) = search.last_error {
            last_error = Some(error);
        }
    }
}

fn constant_time_token_eq(actual: &str, expected: &str) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    actual
        .as_bytes()
        .iter()
        .zip(expected.as_bytes())
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

/// How an accepted LAN socket proved it is allowed to drive this desktop.
#[derive(Debug)]
enum LanHelloAuth {
    /// The Agent presented the one-time token carried by the pairing QR.
    Token,
    /// The Agent found this desktop through LAN discovery, so it has no token and
    /// the desktop user has to approve it. Carries the digits both sides display.
    NeedsApproval { code: String },
}

fn parse_lan_hello(
    device_id: &str,
    payload: &[u8],
    expected_token: &str,
    peer_ip: &str,
) -> CompanionResult<(CompanionDevice, LanHelloAuth)> {
    let value: Value = serde_json::from_slice(payload).map_err(|_| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "LAN companion hello was not valid JSON",
        )
    })?;
    let token = value.get("token").and_then(Value::as_str).unwrap_or("");
    let auth = if constant_time_token_eq(token, expected_token) {
        LanHelloAuth::Token
    } else if token.is_empty() {
        // Discovery path: no token was ever handed out, so the nonce is all this
        // Agent can offer and approval has to come from the desktop user.
        let nonce = value
            .get("nonce")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let nonce_is_valid = (MIN_APPROVAL_NONCE_CHARS..=MAX_APPROVAL_NONCE_CHARS)
            .contains(&nonce.len())
            && nonce.bytes().all(|byte| byte.is_ascii_hexdigit());
        if !nonce_is_valid {
            return Err(CompanionError::new(
                CompanionErrorKind::Permission,
                "LAN companion hello carried neither a pairing token nor a valid approval nonce",
            ));
        }
        LanHelloAuth::NeedsApproval {
            code: approval_code(nonce),
        }
    } else {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "LAN companion pairing token was rejected",
        ));
    };
    let mut device = parse_hello(device_id, "lan-tcp", payload)?;
    device.peer_ip = Some(peer_ip.to_string());
    Ok((device, auth))
}

fn is_allowed_lan_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        IpAddr::V6(address) => {
            address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local()
        }
    }
}

/// Interface names that never carry the network a phone can dial: VPN and tunnel
/// devices, Apple's AWDL/link-local helpers, and hypervisor or container bridges.
/// Putting one of these in the pairing QR hands the Agent an address it can never
/// reach, which is the most common reason a scanned QR silently goes nowhere.
const NON_LAN_INTERFACE_PREFIXES: &[&str] = &[
    "utun", "tun", "tap", "ppp", "ipsec", "gif", "stf", "awdl", "llw", "bridge", "vmnet",
    "vboxnet", "docker", "veth", "zt", "wg",
];

/// Windows names adapters with friendly strings rather than short interface names,
/// so tunnels there have to be matched on substrings instead of prefixes.
const NON_LAN_ADAPTER_MARKERS: &[&str] = &[
    "vpn",
    "virtual",
    "tailscale",
    "zerotier",
    "wireguard",
    "hyper-v",
    "loopback",
    "pseudo",
];

fn is_lan_interface_name(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    !NON_LAN_INTERFACE_PREFIXES
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
        && !NON_LAN_ADAPTER_MARKERS
            .iter()
            .any(|marker| lowered.contains(marker))
}

/// The local address the default route would pick. It is the best single guess when
/// it really is a LAN address, but a full-tunnel VPN makes it a tunnel address the
/// phone cannot reach, so it only ever ranks the list rather than defining it.
fn default_route_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) => Some(address),
        IpAddr::V6(_) => None,
    }
}

/// Every IPv4 address a phone on the same network could dial, best first.
///
/// Ranking a list instead of committing to one address is what makes pairing
/// survive a multi-homed desktop: the QR carries all of them and the Agent tries
/// each in turn, so a VPN owning the default route or a second active network no
/// longer produces an unreachable pairing code.
pub(crate) fn lan_host_candidates() -> Vec<Ipv4Addr> {
    let mut preferred: Vec<Ipv4Addr> = Vec::new();
    let mut fallback: Vec<Ipv4Addr> = Vec::new();

    if let Some(address) = default_route_ipv4().filter(Ipv4Addr::is_private) {
        preferred.push(address);
    }

    for interface in if_addrs::get_if_addrs().unwrap_or_default() {
        let IpAddr::V4(address) = interface.ip() else {
            continue;
        };
        if address.is_loopback() || !is_lan_interface_name(&interface.name) {
            continue;
        }
        if address.is_private() {
            preferred.push(address);
        } else if is_allowed_lan_address(IpAddr::V4(address)) {
            // Link-local and carrier-grade-NAT addresses do reach a directly
            // attached phone, but only once every routable LAN address has failed.
            fallback.push(address);
        }
    }

    let mut ordered: Vec<Ipv4Addr> = Vec::with_capacity(preferred.len() + fallback.len());
    for address in preferred.into_iter().chain(fallback) {
        if !ordered.contains(&address) {
            ordered.push(address);
        }
    }
    ordered
}

/// Reorder host candidates so the ones sharing a /24 with the asking phone come
/// first. A desktop on both Wi-Fi and Ethernet must not answer a discovery probe
/// with the address on the network that phone cannot see.
fn order_hosts_for_peer(hosts: &[Ipv4Addr], peer: IpAddr) -> Vec<Ipv4Addr> {
    let peer_prefix = match peer {
        IpAddr::V4(address) => {
            let octets = address.octets();
            Some([octets[0], octets[1], octets[2]])
        }
        IpAddr::V6(_) => None,
    };
    let mut ordered: Vec<Ipv4Addr> = Vec::with_capacity(hosts.len());
    let shares_subnet = |host: &Ipv4Addr| match peer_prefix {
        Some(prefix) => host.octets()[..3] == prefix,
        None => false,
    };
    ordered.extend(hosts.iter().copied().filter(shares_subnet));
    ordered.extend(hosts.iter().copied().filter(|host| !shares_subnet(host)));
    ordered
}

/// The address to advertise to an Agent that is already connected, preferring the
/// one on that Agent's own subnet. The screen-share and remote-control listeners
/// hand their address to the phone the same way the pairing QR does, so they hit
/// the same multi-homed failure and need the same ranking.
fn preferred_lan_host(peer_ip: Option<&str>) -> CompanionResult<Ipv4Addr> {
    let hosts = lan_host_candidates();
    let ordered = match peer_ip.and_then(|value| value.parse::<IpAddr>().ok()) {
        Some(peer) => order_hosts_for_peer(&hosts, peer),
        None => hosts,
    };
    ordered.first().copied().ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Network,
            "No private IPv4 LAN address is available. Connect this computer to the same Wi-Fi \
             network as the phone, and turn off any VPN that captures all traffic.",
        )
    })
}

/// Six digits derived from the Agent's nonce. Not a secret — it exists so the user
/// approving a discovered Agent can confirm it is the phone showing the same digits.
fn approval_code(nonce: &str) -> String {
    let digest = Sha256::digest(nonce.as_bytes());
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

fn generate_pairing_token() -> String {
    let mut bytes = [0u8; LAN_TOKEN_BYTES];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Minimal percent-encoding for one query value (RFC 3986 unreserved set kept
/// literal, everything else escaped as UTF-8 bytes). Avoids pulling in a
/// dedicated URL crate for the one optional, user-supplied field (studio name)
/// that needs it.
fn percent_encode_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn is_valid_stream_token(token: &str) -> bool {
    token.len() == LAN_TOKEN_BYTES * 2 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_valid_remote_session_id(session_id: &str) -> bool {
    session_id
        .strip_prefix("remote-")
        .is_some_and(is_valid_stream_token)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RemoteChannel {
    Control,
    Video,
}

struct RemoteChannelLease(Arc<std::sync::atomic::AtomicBool>);

impl Drop for RemoteChannelLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn parse_remote_hello(
    payload: &[u8],
    expected_token: &str,
    expected_generation: u64,
    expected_session_id: &str,
) -> CompanionResult<RemoteChannel> {
    let value: Value = serde_json::from_slice(payload).map_err(|_| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller hello was not valid JSON",
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller hello must be a JSON object",
        )
    })?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "type" | "protocol" | "package" | "token" | "generation" | "sessionId" | "channel"
        )
    }) {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller hello contains unsupported fields",
        ));
    }
    if value.get("type").and_then(Value::as_str) != Some("remote_hello")
        || value.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION)
        || value.get("package").and_then(Value::as_str) != Some(EXPECTED_PACKAGE)
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller hello metadata is invalid",
        ));
    }
    let token = value.get("token").and_then(Value::as_str).unwrap_or("");
    let session_id = value.get("sessionId").and_then(Value::as_str).unwrap_or("");
    if !constant_time_token_eq(token, expected_token)
        || value.get("generation").and_then(Value::as_u64) != Some(expected_generation)
        || !constant_time_token_eq(session_id, expected_session_id)
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Remote controller credentials were rejected",
        ));
    }
    let channel = match value.get("channel") {
        None => "control",
        Some(value) => value.as_str().ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Remote controller channel is invalid",
            )
        })?,
    };
    match channel {
        "control" => Ok(RemoteChannel::Control),
        "video" => Ok(RemoteChannel::Video),
        _ => Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller channel is invalid",
        )),
    }
}

#[derive(Debug, PartialEq)]
enum RemoteCommand {
    Action(String),
    Touch {
        action: String,
        pointer_id: u64,
        x: f64,
        y: f64,
        device_width: u32,
        device_height: u32,
        pressure: f32,
    },
    Key {
        keycode: u32,
        metastate: u32,
        action: String,
    },
    Text(String),
    ClipboardSet(String),
}

fn exact_remote_params(params: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    params.keys().all(|key| allowed.contains(&key.as_str()))
}

fn required_u32(params: &serde_json::Map<String, Value>, key: &str) -> CompanionResult<u32> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            CompanionError::new(CompanionErrorKind::Validation, format!("{key} is invalid"))
        })
}

fn parse_remote_request(payload: &[u8]) -> CompanionResult<(u64, RemoteCommand)> {
    let value: Value = serde_json::from_slice(payload).map_err(|_| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller request was not valid JSON",
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller request must be a JSON object",
        )
    })?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "type" | "id" | "method" | "params"))
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller request contains unsupported fields",
        ));
    }
    if value.get("type").and_then(Value::as_str) != Some("remote_request") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Remote controller sent a non-request frame",
        ));
    }
    let id = value
        .get("id")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Remote controller request id is invalid",
            )
        })?;
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    if !REMOTE_CONTROL_METHODS.contains(&method) {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Remote controller method is not allowed",
        ));
    }
    let params = value
        .get("params")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Remote controller params must be a JSON object",
            )
        })?;
    let invalid_params = || {
        CompanionError::new(
            CompanionErrorKind::Validation,
            format!("Remote controller {method} params are invalid"),
        )
    };
    let command = match method {
        "back" | "home" | "recents" | "rotate" | "screen_on" | "screen_off" => {
            if !params.is_empty() {
                return Err(CompanionError::new(
                    CompanionErrorKind::Permission,
                    "Remote controller action does not accept params",
                ));
            }
            RemoteCommand::Action(method.to_string())
        }
        "touch" => {
            if !exact_remote_params(
                params,
                &[
                    "action",
                    "pointerId",
                    "x",
                    "y",
                    "deviceWidth",
                    "deviceHeight",
                    "pressure",
                ],
            ) {
                return Err(invalid_params());
            }
            let action = params.get("action").and_then(Value::as_str).unwrap_or("");
            if crate::embed_session::control::touch_action_code(action).is_none() {
                return Err(invalid_params());
            }
            let pointer_id = params
                .get("pointerId")
                .and_then(Value::as_u64)
                .ok_or_else(invalid_params)?;
            let x = params
                .get("x")
                .and_then(Value::as_f64)
                .ok_or_else(invalid_params)?;
            let y = params
                .get("y")
                .and_then(Value::as_f64)
                .ok_or_else(invalid_params)?;
            let device_width = required_u32(params, "deviceWidth")?;
            let device_height = required_u32(params, "deviceHeight")?;
            crate::embed_session::validate_touch(x, y, device_width, device_height)
                .map_err(|_| invalid_params())?;
            let pressure = match params.get("pressure") {
                Some(value) => value.as_f64().ok_or_else(invalid_params)?,
                None => 1.0,
            };
            if !pressure.is_finite() || !(0.0..=1.0).contains(&pressure) {
                return Err(invalid_params());
            }
            RemoteCommand::Touch {
                action: action.to_string(),
                pointer_id,
                x,
                y,
                device_width,
                device_height,
                pressure: pressure as f32,
            }
        }
        "key" => {
            if !exact_remote_params(params, &["keycode", "metastate", "action"]) {
                return Err(invalid_params());
            }
            let keycode = required_u32(params, "keycode")?;
            if keycode > 4096 {
                return Err(invalid_params());
            }
            let metastate = params
                .get("metastate")
                .map(|_| required_u32(params, "metastate"))
                .transpose()?
                .unwrap_or(0);
            let action = params
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("click");
            if !matches!(action, "down" | "up" | "click") {
                return Err(invalid_params());
            }
            RemoteCommand::Key {
                keycode,
                metastate,
                action: action.to_string(),
            }
        }
        "text" | "clipboard_set" => {
            if !exact_remote_params(params, &["text"]) {
                return Err(invalid_params());
            }
            let text = params
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(invalid_params)?;
            let max = if method == "text" {
                crate::embed_session::control::INJECT_TEXT_MAX_LEN
            } else {
                REMOTE_MAX_CLIPBOARD_TEXT_BYTES
            };
            if text.len() > max {
                return Err(invalid_params());
            }
            if method == "text" {
                RemoteCommand::Text(text.to_string())
            } else {
                RemoteCommand::ClipboardSet(text.to_string())
            }
        }
        _ => unreachable!("method allowlist checked above"),
    };
    Ok((id, command))
}

fn write_remote_frame(
    stream: &mut TcpStream,
    value: &Value,
    cancellation: &CancellationToken,
) -> CompanionResult<()> {
    let payload = serde_json::to_vec(value).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::State,
            format!("Could not encode remote controller response: {error}"),
        )
    })?;
    if payload.is_empty() || payload.len() > REMOTE_MAX_FRAME_BYTES {
        return Err(CompanionError::new(
            CompanionErrorKind::State,
            "Remote controller response is too large",
        ));
    }
    let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Remote controller response");
    write_tcp_all(
        stream,
        &(payload.len() as u32).to_be_bytes(),
        deadline,
        cancellation,
    )?;
    write_tcp_all(stream, &payload, deadline, cancellation)
}

fn read_screen_frame(
    stream: &mut TcpStream,
    max_bytes: usize,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<Vec<u8>> {
    let mut header = [0u8; 4];
    read_tcp_exact(stream, &mut header, deadline, cancellation)?;
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > max_bytes {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Invalid screen payload length {length}; expected 1..{max_bytes}"),
        ));
    }
    let mut payload = vec![0u8; length];
    read_tcp_exact(stream, &mut payload, deadline, cancellation)?;
    Ok(payload)
}

fn parse_screen_hello(
    payload: &[u8],
    expected_token: &str,
    expected_generation: u64,
) -> CompanionResult<(u32, u32)> {
    let value: Value = serde_json::from_slice(payload).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Screen hello was not valid JSON: {error}"),
        )
    })?;
    if value.get("type").and_then(Value::as_str) != Some("screen_hello") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Screen stream did not send a screen_hello frame",
        ));
    }
    if value.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Unsupported screen stream protocol",
        ));
    }
    if value.get("package").and_then(Value::as_str) != Some(EXPECTED_PACKAGE) {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Unexpected screen stream package",
        ));
    }
    let token = value.get("token").and_then(Value::as_str).unwrap_or("");
    if !constant_time_token_eq(token, expected_token) {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Screen stream token was rejected",
        ));
    }
    if value.get("generation").and_then(Value::as_u64) != Some(expected_generation) {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Screen stream generation was rejected",
        ));
    }
    if value.get("format").and_then(Value::as_str) != Some("jpeg") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Unsupported screen stream format",
        ));
    }
    let width = value
        .get("width")
        .and_then(Value::as_u64)
        .filter(|value| (1..=16_384).contains(value))
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Screen hello width is invalid",
            )
        })? as u32;
    let height = value
        .get("height")
        .and_then(Value::as_u64)
        .filter(|value| (1..=16_384).contains(value))
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Screen hello height is invalid",
            )
        })? as u32;
    Ok((width, height))
}

fn parse_screen_error(
    payload: &[u8],
    expected_token: &str,
    expected_generation: u64,
) -> CompanionResult<String> {
    let value: Value = serde_json::from_slice(payload).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Screen error was not valid JSON: {error}"),
        )
    })?;
    if value.get("type").and_then(Value::as_str) != Some("screen_error") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Screen stream did not send a screen_error frame",
        ));
    }
    if value.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Unsupported screen error protocol",
        ));
    }
    if value.get("package").and_then(Value::as_str) != Some(EXPECTED_PACKAGE) {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Unexpected screen error package",
        ));
    }
    let token = value.get("token").and_then(Value::as_str).unwrap_or("");
    if !constant_time_token_eq(token, expected_token) {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Screen error token was rejected",
        ));
    }
    if value.get("generation").and_then(Value::as_u64) != Some(expected_generation) {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Screen error generation was rejected",
        ));
    }
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
        .map(str::trim)
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Protocol,
                "Screen error did not include a message",
            )
        })?;
    if message.len() > 512 {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Screen error message is too large",
        ));
    }
    Ok(message.to_string())
}

fn render_pairing_qr(payload: &str) -> CompanionResult<String> {
    let code =
        QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::M).map_err(|error| {
            CompanionError::new(
                CompanionErrorKind::State,
                format!("Could not generate LAN pairing QR: {error}"),
            )
        })?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#e4e4e7"))
        .light_color(svg::Color("#09090b"))
        .quiet_zone(true)
        .build())
}

fn pairing_is_current(
    pairing_epoch: &AtomicU64,
    pairing_generation: u64,
    cancellation: &CancellationToken,
) -> bool {
    pairing_epoch.load(Ordering::SeqCst) == pairing_generation && cancellation.check().is_ok()
}

fn emit_approval(window: &Window, request: &PendingApproval, resolved: bool) {
    let _ = window.emit(
        "companion-pairing-approval",
        CompanionApprovalEvent {
            request_id: request.request_id,
            pairing_generation: request.pairing_generation,
            device_name: request.device_name.clone(),
            peer_ip: request.peer_ip.clone(),
            code: request.code.clone(),
            resolved,
        },
    );
}

/// How an approval request ended. The distinction matters for the anti-abuse counter:
/// a user deliberately turning a device away must not also end their pairing session,
/// while a request nobody answered is an Agent holding a socket for nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApprovalOutcome {
    Approved,
    Rejected,
    Expired,
}

/// Hold a discovered Agent's socket open until the desktop user answers.
///
/// The socket stays silent for the whole wait, so no extra protocol frame is
/// involved: the Agent is already blocked reading, and simply sees the first real
/// request once approved or a closed socket if not.
#[allow(clippy::too_many_arguments)]
fn await_pairing_approval(
    device: &CompanionDevice,
    code: &str,
    peer_ip: &str,
    pending_approval: &Arc<Mutex<Option<PendingApproval>>>,
    next_approval_id: &AtomicU64,
    pairing_generation: u64,
    pairing_epoch: &AtomicU64,
    cancellation: &CancellationToken,
    window: &Window,
) -> ApprovalOutcome {
    let request_id = next_approval_id.fetch_add(1, Ordering::SeqCst);
    let request = PendingApproval {
        request_id,
        pairing_generation,
        device_name: device.name.clone(),
        peer_ip: peer_ip.to_string(),
        code: code.to_string(),
        decision: None,
    };
    match pending_approval.lock() {
        Ok(mut guard) => *guard = Some(request.clone()),
        Err(_) => return ApprovalOutcome::Expired,
    }
    emit_approval(window, &request, false);

    let deadline = Instant::now() + LAN_APPROVAL_TIMEOUT;
    let outcome = loop {
        if !pairing_is_current(pairing_epoch, pairing_generation, cancellation) {
            break ApprovalOutcome::Expired;
        }
        if Instant::now() >= deadline {
            break ApprovalOutcome::Expired;
        }
        let observed = match pending_approval.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => break ApprovalOutcome::Expired,
        };
        match observed {
            // A newer request took the slot, so this older socket loses the race.
            Some(current) if current.request_id != request_id => break ApprovalOutcome::Expired,
            Some(current) => match current.decision {
                Some(true) => break ApprovalOutcome::Approved,
                Some(false) => break ApprovalOutcome::Rejected,
                None => {}
            },
            None => break ApprovalOutcome::Expired,
        }
        thread::sleep(LAN_APPROVAL_POLL_DELAY);
    };

    if let Ok(mut guard) = pending_approval.lock() {
        if guard.as_ref().map(|current| current.request_id) == Some(request_id) {
            *guard = None;
        }
    }
    emit_approval(window, &request, true);
    outcome
}

/// Answer LAN discovery probes for as long as this pairing generation is current.
///
/// Replies carry addresses and the pairing port only. The token is deliberately
/// withheld so that overhearing a probe reply grants nothing on its own.
#[allow(clippy::too_many_arguments)]
fn run_discovery_responder(
    socket: UdpSocket,
    tcp_port: u16,
    hosts: Vec<Ipv4Addr>,
    studio_id: Option<String>,
    studio_name: Option<String>,
    pairing_generation: u64,
    pairing_epoch: Arc<AtomicU64>,
    cancellation: CancellationToken,
) {
    let deadline = Instant::now() + LAN_PAIRING_TIMEOUT;
    let mut buffer = [0u8; DISCOVERY_MAX_DATAGRAM_BYTES];

    while pairing_is_current(&pairing_epoch, pairing_generation, &cancellation) {
        if Instant::now() >= deadline {
            return;
        }
        let (length, peer) = match socket.recv_from(&mut buffer) {
            Ok(received) => received,
            Err(error)
                if matches!(
                    error.kind(),
                    IoErrorKind::WouldBlock | IoErrorKind::TimedOut | IoErrorKind::Interrupted
                ) =>
            {
                continue
            }
            Err(_) => return,
        };
        if !is_allowed_lan_address(peer.ip()) {
            continue;
        }
        let Ok(probe) = serde_json::from_slice::<Value>(&buffer[..length]) else {
            continue;
        };
        if probe.get("magic").and_then(Value::as_str) != Some(DISCOVERY_MAGIC)
            || probe.get("type").and_then(Value::as_str) != Some("discover")
        {
            continue;
        }
        let ordered: Vec<String> = order_hosts_for_peer(&hosts, peer.ip())
            .iter()
            .map(Ipv4Addr::to_string)
            .collect();
        let reply = json!({
            "magic": DISCOVERY_MAGIC,
            "type": "studio",
            "v": DISCOVERY_PROTOCOL,
            "port": tcp_port,
            "hosts": ordered,
            "studioId": studio_id,
            "studioName": studio_name,
            "requiresApproval": true,
        });
        let _ = socket.send_to(reply.to_string().as_bytes(), peer);
    }
}

#[allow(clippy::too_many_arguments)]
fn run_lan_pairing_listener(
    listener: TcpListener,
    token: String,
    pairing_generation: u64,
    pairing_epoch: Arc<AtomicU64>,
    connection: Arc<Mutex<Option<CompanionConnection>>>,
    pending_approval: Arc<Mutex<Option<PendingApproval>>>,
    next_approval_id: Arc<AtomicU64>,
    cancellation: CancellationToken,
    window: Window,
    auto_approve_trusted: bool,
) {
    let deadline = OperationDeadline::after(LAN_PAIRING_TIMEOUT, "LAN pairing");
    let mut rejected_clients = 0usize;
    // Agents the user already approved during this pairing generation. Keeping them
    // here lets a Wi-Fi blip reconnect straight away instead of re-prompting, while
    // an app restart (a new generation) still asks again.
    let mut approved_agents: HashSet<String> = HashSet::new();

    loop {
        if !pairing_is_current(&pairing_epoch, pairing_generation, &cancellation) {
            return;
        }
        if Instant::now() >= deadline.end {
            if pairing_is_current(&pairing_epoch, pairing_generation, &cancellation) {
                emit_pairing_status(
                    &window,
                    "error",
                    "LAN pairing expired. Generate a new QR code to try again.",
                    None,
                    pairing_generation,
                );
            }
            return;
        }

        match listener.accept() {
            Ok((stream, peer)) => {
                if !is_allowed_lan_address(peer.ip()) {
                    rejected_clients += 1;
                } else {
                    let attempt: CompanionResult<(
                        CompanionConnection,
                        CompanionDevice,
                        LanHelloAuth,
                    )> = (|| {
                        let mut candidate =
                            CompanionConnection::open_tcp(stream, peer, pairing_generation)?;
                        let hello = candidate.read_frame(
                            deadline.capped(LAN_HELLO_TIMEOUT, "LAN companion hello"),
                            &cancellation,
                        )?;
                        let (device, auth) = parse_lan_hello(
                            &candidate.device.id,
                            &hello,
                            &token,
                            &peer.ip().to_string(),
                        )?;
                        candidate.device = device.clone();
                        Ok((candidate, device, auth))
                    })();

                    // One phone at a time: a different Agent must not silently take over the
                    // session another phone is using. Only the same Agent may replace its own
                    // (possibly stale) socket, which is how Wi-Fi reconnects work.
                    let attempt = match attempt {
                        Ok((mut candidate, device, auth)) => {
                            if let Some(holder) = busy_holder(&connection, &device) {
                                notify_studio_busy(
                                    &mut candidate,
                                    &holder,
                                    deadline.capped(LAN_HELLO_TIMEOUT, "LAN busy notice"),
                                    &cancellation,
                                );
                                let _ = window.emit(
                                    "scrcpy-log",
                                    format!(
                                        "[COMPANION] Turned away {} because {} is already connected",
                                        device.name, holder
                                    ),
                                );
                                continue;
                            }
                            Ok((candidate, device, auth))
                        }
                        Err(error) => Err(error),
                    };

                    // A discovered Agent has no token, so hold its socket until the
                    // user answers the prompt. Dropping it here is a plain rejection:
                    // the Agent sees a closed socket and reports it.
                    // A rejection is the user exercising the gate, not an attack, so it
                    // must not push this listener toward its abuse cut-off and end a
                    // pairing session the user is still in the middle of.
                    let mut user_rejected = false;
                    let attempt = match attempt {
                        Ok((candidate, device, LanHelloAuth::NeedsApproval { code })) => {
                            let agent_key = device
                                .agent_device_id
                                .clone()
                                .unwrap_or_else(|| peer.ip().to_string());
                            // With auto-connect on, a phone the user approved in an earlier
                            // session skips the prompt (keyed by the Agent's own stable id).
                            let remembered = auto_approve_trusted
                                && device
                                    .agent_device_id
                                    .as_deref()
                                    .is_some_and(|id| is_trusted_agent(&window, id));
                            let outcome = if approved_agents.contains(&agent_key) || remembered {
                                ApprovalOutcome::Approved
                            } else {
                                await_pairing_approval(
                                    &device,
                                    &code,
                                    &peer.ip().to_string(),
                                    &pending_approval,
                                    &next_approval_id,
                                    pairing_generation,
                                    &pairing_epoch,
                                    &cancellation,
                                    &window,
                                )
                            };
                            if !pairing_is_current(
                                &pairing_epoch,
                                pairing_generation,
                                &cancellation,
                            ) {
                                return;
                            }
                            match outcome {
                                ApprovalOutcome::Approved => {
                                    approved_agents.insert(agent_key);
                                    if let Some(id) = device.agent_device_id.as_deref() {
                                        remember_trusted_agent(&window, id, &device.name);
                                    }
                                    Ok((candidate, device))
                                }
                                ApprovalOutcome::Rejected => {
                                    user_rejected = true;
                                    Err(CompanionError::new(
                                        CompanionErrorKind::Permission,
                                        "Pairing request was rejected",
                                    ))
                                }
                                ApprovalOutcome::Expired => Err(CompanionError::new(
                                    CompanionErrorKind::Timeout,
                                    "Pairing request was not answered",
                                )),
                            }
                        }
                        Ok((candidate, device, LanHelloAuth::Token)) => Ok((candidate, device)),
                        Err(error) => Err(error),
                    };

                    match attempt {
                        Ok((candidate, device)) => match lock_connection(&connection) {
                            Ok(mut guard) => {
                                if !pairing_is_current(
                                    &pairing_epoch,
                                    pairing_generation,
                                    &cancellation,
                                ) {
                                    return;
                                }
                                if guard.is_some() {
                                    emit_pairing_status(
                                        &window,
                                        "reconnecting",
                                        "Android companion is reconnecting over LAN",
                                        None,
                                        pairing_generation,
                                    );
                                }
                                // Replacing an authenticated stale socket is intentional: a
                                // dropped Wi-Fi connection can leave the old TcpStream in the
                                // slot until the next desktop request observes the failure.
                                *guard = Some(candidate);
                                rejected_clients = 0;
                                spawn_agent_heartbeat(
                                    window.clone(),
                                    connection.clone(),
                                    cancellation.clone(),
                                    device.id.clone(),
                                    device.agent_device_id.clone(),
                                );
                                emit_pairing_status(
                                    &window,
                                    "connected",
                                    "Android companion connected over LAN",
                                    Some(device),
                                    pairing_generation,
                                );
                                // Keep the listener alive. Android reuses the persisted QR offer
                                // and the same token for subsequent control-socket retries.
                            }
                            Err(error) => {
                                if pairing_is_current(
                                    &pairing_epoch,
                                    pairing_generation,
                                    &cancellation,
                                ) {
                                    emit_pairing_status(
                                        &window,
                                        "error",
                                        error.message,
                                        None,
                                        pairing_generation,
                                    );
                                }
                                return;
                            }
                        },
                        Err(_) if user_rejected => {}
                        Err(_) => rejected_clients += 1,
                    }
                }

                if rejected_clients >= LAN_MAX_REJECTED_CLIENTS {
                    if pairing_is_current(&pairing_epoch, pairing_generation, &cancellation) {
                        emit_pairing_status(
                            &window,
                            "error",
                            "LAN pairing stopped after too many rejected connection attempts",
                            None,
                            pairing_generation,
                        );
                    }
                    return;
                }
            }
            Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                thread::sleep(LAN_ACCEPT_POLL_DELAY);
            }
            Err(error) => {
                if pairing_is_current(&pairing_epoch, pairing_generation, &cancellation) {
                    emit_pairing_status(
                        &window,
                        "error",
                        network_error("LAN pairing listener failed", error).message,
                        None,
                        pairing_generation,
                    );
                }
                return;
            }
        }
    }
}

fn remote_permission_for(command: &RemoteCommand) -> &'static str {
    match command {
        RemoteCommand::Action(_) | RemoteCommand::Touch { .. } => "control",
        RemoteCommand::Key { .. } | RemoteCommand::Text(_) => "keyboard",
        RemoteCommand::ClipboardSet(_) => "clipboard",
    }
}

fn execute_remote_command(
    command: RemoteCommand,
    metadata: &RemoteSessionMetadata,
    custom_path: Option<String>,
    runtime: &tokio::runtime::Handle,
    window: &Window,
) -> Result<Value, String> {
    if metadata.legacy_navigation_only && !matches!(&command, RemoteCommand::Action(_)) {
        return Err("This legacy remote session allows navigation actions only".to_string());
    }
    let required = remote_permission_for(&command);
    if !metadata.permissions.iter().any(|scope| scope == required) {
        return Err(format!(
            "Desktop approval did not grant the {required} permission"
        ));
    }

    let embed_state = window
        .app_handle()
        .state::<crate::embed_session::EmbedSessionState>();
    match command {
        RemoteCommand::Action(action) => {
            let embedded_action = match action.as_str() {
                "back" => Some(crate::embed_session::control::KEYCODE_BACK),
                "home" => Some(crate::embed_session::control::KEYCODE_HOME),
                "recents" => Some(crate::embed_session::control::KEYCODE_APP_SWITCH),
                _ => None,
            };
            if let Some(keycode) = embedded_action {
                if let Ok(handle) = embed_state.remote_control_for_serial(&metadata.target_serial) {
                    let down = crate::embed_session::control::encode_keycode(
                        crate::embed_session::control::KEY_ACTION_DOWN,
                        keycode,
                        0,
                        0,
                    );
                    let up = crate::embed_session::control::encode_keycode(
                        crate::embed_session::control::KEY_ACTION_UP,
                        keycode,
                        0,
                        0,
                    );
                    runtime.block_on(crate::embed_session::write_control(&handle, &down))?;
                    runtime.block_on(crate::embed_session::write_control(&handle, &up))?;
                    return Ok(json!({ "success": true, "transport": "scrcpy" }));
                }
            }
            let action = runtime.block_on(crate::device_control::device_action(
                metadata.target_serial.clone(),
                action,
                custom_path,
            ));
            if action.success {
                serde_json::to_value(action).map_err(|error| error.to_string())
            } else {
                Err(action
                    .error
                    .unwrap_or_else(|| "Device action failed".to_string()))
            }
        }
        RemoteCommand::Touch {
            action,
            pointer_id,
            x,
            y,
            device_width,
            device_height,
            pressure,
        } => {
            let handle = embed_state.remote_control_for_serial(&metadata.target_serial)?;
            let (x, y) = crate::embed_session::validate_touch(x, y, device_width, device_height)?;
            let action = crate::embed_session::control::touch_action_code(&action)
                .ok_or_else(|| "Unsupported touch action".to_string())?;
            let message = crate::embed_session::control::encode_touch(
                action,
                pointer_id,
                x,
                y,
                device_width as u16,
                device_height as u16,
                pressure,
            );
            runtime.block_on(crate::embed_session::write_control(&handle, &message))?;
            Ok(json!({ "success": true }))
        }
        RemoteCommand::Key {
            keycode,
            metastate,
            action,
        } => {
            let handle = embed_state.remote_control_for_serial(&metadata.target_serial)?;
            let messages = match action.as_str() {
                "down" => vec![crate::embed_session::control::encode_keycode(
                    0, keycode, 0, metastate,
                )],
                "up" => vec![crate::embed_session::control::encode_keycode(
                    1, keycode, 0, metastate,
                )],
                "click" => vec![
                    crate::embed_session::control::encode_keycode(0, keycode, 0, metastate),
                    crate::embed_session::control::encode_keycode(1, keycode, 0, metastate),
                ],
                _ => return Err("Unsupported key action".to_string()),
            };
            for message in messages {
                runtime.block_on(crate::embed_session::write_control(&handle, &message))?;
            }
            Ok(json!({ "success": true }))
        }
        RemoteCommand::Text(text) => {
            let handle = embed_state.remote_control_for_serial(&metadata.target_serial)?;
            let message = crate::embed_session::control::encode_text(&text);
            runtime.block_on(crate::embed_session::write_control(&handle, &message))?;
            Ok(json!({ "success": true }))
        }
        RemoteCommand::ClipboardSet(text) => {
            let handle = embed_state.remote_control_for_serial(&metadata.target_serial)?;
            let message = crate::embed_session::control::encode_set_clipboard(&text);
            runtime.block_on(crate::embed_session::write_control(&handle, &message))?;
            Ok(json!({ "success": true }))
        }
    }
}

fn run_remote_connection(
    mut stream: TcpStream,
    peer: SocketAddr,
    token: String,
    metadata: RemoteSessionMetadata,
    cancellation: CancellationToken,
    custom_path: Option<String>,
    runtime: tokio::runtime::Handle,
    window: Window,
    active_control: Arc<std::sync::atomic::AtomicBool>,
    active_video: Arc<std::sync::atomic::AtomicBool>,
    ever_control: Arc<std::sync::atomic::AtomicBool>,
    ever_video: Arc<std::sync::atomic::AtomicBool>,
    control_reconnect_deadline: Arc<Mutex<Option<Instant>>>,
    video_reconnect_deadline: Arc<Mutex<Option<Instant>>>,
    setup_deadline: Instant,
    authenticated_channel: Arc<Mutex<Option<RemoteChannel>>>,
    authenticated_clients: Arc<AtomicUsize>,
) -> CompanionResult<()> {
    let hello = read_screen_frame(
        &mut stream,
        REMOTE_MAX_FRAME_BYTES,
        OperationDeadline::after(REMOTE_HELLO_TIMEOUT, "Remote controller hello"),
        &cancellation,
    )?;
    let channel = parse_remote_hello(&hello, &token, metadata.generation, &metadata.session_id)?;
    if channel == RemoteChannel::Video && !metadata.permissions.iter().any(|scope| scope == "view")
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Permission,
            "Desktop approval did not grant the view permission",
        ));
    }
    let (channel_flag, ever_authenticated, reconnect_deadline) = match channel {
        RemoteChannel::Control => (active_control, ever_control, control_reconnect_deadline),
        RemoteChannel::Video => (active_video, ever_video, video_reconnect_deadline),
    };
    let was_ever_authenticated = ever_authenticated.load(Ordering::SeqCst);
    if !was_ever_authenticated && Instant::now() >= setup_deadline {
        return Err(CompanionError::new(
            CompanionErrorKind::Timeout,
            "Remote controller channel setup window expired",
        ));
    }
    if was_ever_authenticated
        && reconnect_deadline
            .lock()
            .ok()
            .and_then(|deadline| *deadline)
            .is_some_and(|deadline| Instant::now() >= deadline)
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Timeout,
            "Remote controller channel reconnect window expired",
        ));
    }
    channel_flag
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| {
            CompanionError::new(
                CompanionErrorKind::Permission,
                "That remote controller channel is already connected",
            )
        })?;
    let _channel_lease = RemoteChannelLease(channel_flag);
    ever_authenticated.store(true, Ordering::SeqCst);
    if let Ok(mut deadline) = reconnect_deadline.lock() {
        *deadline = None;
    }
    if let Ok(mut authenticated) = authenticated_channel.lock() {
        *authenticated = Some(channel);
    }
    authenticated_clients.fetch_add(1, Ordering::Relaxed);
    match channel {
        RemoteChannel::Control => {
            emit_remote_status(
                &window,
                metadata.generation,
                "connected",
                format!("Remote controller connected from {}", peer.ip()),
                Some(&metadata),
            );
            loop {
                let request = read_screen_frame(
                    &mut stream,
                    REMOTE_MAX_FRAME_BYTES,
                    OperationDeadline::after(REMOTE_IDLE_TIMEOUT, "Remote controller request"),
                    &cancellation,
                )?;
                let (id, command) = parse_remote_request(&request)?;
                let result = execute_remote_command(
                    command,
                    &metadata,
                    custom_path.clone(),
                    &runtime,
                    &window,
                );
                let response = match result {
                    Ok(result) => {
                        json!({ "type": "remote_response", "id": id, "ok": true, "result": result, "error": Value::Null })
                    }
                    Err(error) => {
                        json!({ "type": "remote_response", "id": id, "ok": false, "result": Value::Null, "error": error })
                    }
                };
                write_remote_frame(&mut stream, &response, &cancellation)?;
            }
        }
        RemoteChannel::Video => {
            let embed_state = window
                .app_handle()
                .state::<crate::embed_session::EmbedSessionState>();
            let subscriber_id = format!("remote-video-{}", generate_pairing_token());
            let (session_id, receiver) = match embed_state
                .remote_video_subscribe(&metadata.target_serial, subscriber_id.clone())
            {
                Ok(subscription) => subscription,
                Err(error) => {
                    return Err(CompanionError::new(CompanionErrorKind::Remote, error));
                }
            };
            emit_remote_status_with_video(
                &window,
                metadata.generation,
                "connected",
                "Remote H.264 video channel is ready",
                Some(&metadata),
                Some(true),
            );
            let result = (|| -> CompanionResult<()> {
                loop {
                    cancellation.check()?;
                    match receiver.recv_timeout(REMOTE_ACCEPT_POLL_DELAY) {
                        Ok(message) => {
                            if message.is_empty() || message.len() > REMOTE_MAX_VIDEO_FRAME_BYTES {
                                return Err(CompanionError::new(
                                    CompanionErrorKind::Protocol,
                                    "Remote video frame is invalid",
                                ));
                            }
                            let deadline =
                                OperationDeadline::after(REQUEST_TIMEOUT, "Remote video frame");
                            write_tcp_all(
                                &mut stream,
                                &(message.len() as u32).to_be_bytes(),
                                deadline,
                                &cancellation,
                            )?;
                            write_tcp_all(&mut stream, &message, deadline, &cancellation)?;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            return Err(CompanionError::new(
                                CompanionErrorKind::Remote,
                                "Embedded video stream ended",
                            ));
                        }
                    }
                }
            })();
            embed_state.remote_video_detach(&session_id, &subscriber_id);
            result
        }
    }
}

fn remote_channel_window_open(
    active: bool,
    ever_authenticated: bool,
    reconnect_deadline: Option<Instant>,
    setup_deadline: Instant,
    now: Instant,
) -> bool {
    active
        || if ever_authenticated {
            reconnect_deadline.is_some_and(|deadline| now < deadline)
        } else {
            now < setup_deadline
        }
}

fn run_remote_control_listener(
    listener: TcpListener,
    token: String,
    metadata: RemoteSessionMetadata,
    remote_epoch: Arc<AtomicU64>,
    custom_path: Option<String>,
    runtime: tokio::runtime::Handle,
    window: Window,
    remote_session: Arc<Mutex<Option<RemoteSessionMetadata>>>,
) {
    let cleanup_epoch = remote_epoch.clone();
    let _cleanup = RemoteListenerCleanup {
        remote_session,
        remote_epoch: cleanup_epoch,
        generation: metadata.generation,
        app: window.app_handle().clone(),
        window: window.clone(),
        runtime: runtime.clone(),
    };
    let cancellation = CancellationToken {
        epoch: remote_epoch,
        expected: metadata.generation,
    };
    let setup_deadline = Instant::now() + REMOTE_SETUP_TIMEOUT;
    const MAX_IN_FLIGHT_REMOTE_CLIENTS: usize = 4;
    let authenticated_clients = Arc::new(AtomicUsize::new(0));
    let rejected_clients = Arc::new(AtomicUsize::new(0));
    let in_flight_clients = Arc::new(AtomicUsize::new(0));
    let active_control = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let active_video = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ever_control = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ever_video = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let control_reconnect_deadline = Arc::new(Mutex::new(None::<Instant>));
    let video_reconnect_deadline = Arc::new(Mutex::new(None::<Instant>));

    loop {
        if cancellation.check().is_err() {
            return;
        }
        if rejected_clients.load(Ordering::Relaxed) >= REMOTE_MAX_REJECTED_CLIENTS {
            emit_remote_status_with_video(
                &window,
                metadata.generation,
                "error",
                "Remote control stopped after too many rejected connection attempts",
                Some(&metadata),
                Some(false),
            );
            return;
        }
        let now = Instant::now();
        let control_available = remote_channel_window_open(
            active_control.load(Ordering::SeqCst),
            ever_control.load(Ordering::SeqCst),
            control_reconnect_deadline
                .lock()
                .ok()
                .and_then(|deadline| *deadline),
            setup_deadline,
            now,
        );
        let expects_video = metadata
            .permissions
            .iter()
            .any(|permission| permission == "view");
        let video_available = expects_video
            && remote_channel_window_open(
                active_video.load(Ordering::SeqCst),
                ever_video.load(Ordering::SeqCst),
                video_reconnect_deadline
                    .lock()
                    .ok()
                    .and_then(|deadline| *deadline),
                setup_deadline,
                now,
            );
        if !control_available && !video_available {
            let had_authenticated = authenticated_clients.load(Ordering::Relaxed) > 0;
            emit_remote_status_with_video(
                &window,
                metadata.generation,
                "error",
                if had_authenticated {
                    "Remote controller reconnect window expired"
                } else {
                    "Remote controller did not connect in time"
                },
                Some(&metadata),
                Some(false),
            );
            return;
        }

        match listener.accept() {
            Ok((stream, peer)) => {
                if !is_allowed_lan_address(peer.ip()) {
                    rejected_clients.fetch_add(1, Ordering::Relaxed);
                } else if in_flight_clients
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                        (count < MAX_IN_FLIGHT_REMOTE_CLIENTS).then_some(count + 1)
                    })
                    .is_err()
                {
                    rejected_clients.fetch_add(1, Ordering::Relaxed);
                } else {
                    let _ = stream.set_nodelay(true);
                    let connection_token = token.clone();
                    let connection_metadata = metadata.clone();
                    let connection_cancellation = cancellation.clone();
                    let connection_path = custom_path.clone();
                    let connection_runtime = runtime.clone();
                    let connection_window = window.clone();
                    let connection_authenticated = Arc::new(Mutex::new(None::<RemoteChannel>));
                    let rejected_count = rejected_clients.clone();
                    let authenticated_count = authenticated_clients.clone();
                    let in_flight_count = in_flight_clients.clone();
                    let connection_active_control = active_control.clone();
                    let connection_active_video = active_video.clone();
                    let connection_ever_control = ever_control.clone();
                    let connection_ever_video = ever_video.clone();
                    let connection_control_deadline = control_reconnect_deadline.clone();
                    let connection_video_deadline = video_reconnect_deadline.clone();
                    let worker_authenticated = connection_authenticated.clone();
                    let status_active_control = active_control.clone();
                    let status_active_video = active_video.clone();
                    let status_control_deadline = control_reconnect_deadline.clone();
                    let status_video_deadline = video_reconnect_deadline.clone();
                    thread::spawn(move || {
                        let result = run_remote_connection(
                            stream,
                            peer,
                            connection_token,
                            connection_metadata.clone(),
                            connection_cancellation.clone(),
                            connection_path,
                            connection_runtime,
                            connection_window.clone(),
                            connection_active_control,
                            connection_active_video,
                            connection_ever_control,
                            connection_ever_video,
                            connection_control_deadline,
                            connection_video_deadline,
                            setup_deadline,
                            worker_authenticated.clone(),
                            authenticated_count,
                        );
                        in_flight_count.fetch_sub(1, Ordering::SeqCst);
                        let authenticated_channel = worker_authenticated
                            .lock()
                            .ok()
                            .and_then(|channel| *channel);
                        if let Some(channel) = authenticated_channel {
                            if connection_cancellation.check().is_ok() {
                                let deadline = Instant::now() + REMOTE_RECONNECT_TIMEOUT;
                                let slot = match channel {
                                    RemoteChannel::Control => &status_control_deadline,
                                    RemoteChannel::Video => &status_video_deadline,
                                };
                                if let Ok(mut reconnect) = slot.lock() {
                                    *reconnect = Some(deadline);
                                }
                            }
                        }
                        if matches!(&result, Err(error) if matches!(error.kind, CompanionErrorKind::Permission | CompanionErrorKind::Protocol))
                        {
                            rejected_count.fetch_add(1, Ordering::Relaxed);
                        }
                        if let Some(channel) = authenticated_channel {
                            if connection_cancellation.check().is_ok() {
                                let other_active = match channel {
                                    RemoteChannel::Control => {
                                        status_active_video.load(Ordering::SeqCst)
                                    }
                                    RemoteChannel::Video => {
                                        status_active_control.load(Ordering::SeqCst)
                                    }
                                };
                                let stage = if other_active {
                                    "connected"
                                } else {
                                    "reconnecting"
                                };
                                let message = match (channel, other_active) {
                                    (RemoteChannel::Video, true) => "Remote video disconnected; control remains active",
                                    (RemoteChannel::Control, true) => "Remote control disconnected; video remains active",
                                    _ => "Remote controller channel disconnected; waiting for reconnect",
                                };
                                emit_remote_status_with_video(
                                    &connection_window,
                                    connection_metadata.generation,
                                    stage,
                                    message,
                                    Some(&connection_metadata),
                                    (channel == RemoteChannel::Video).then_some(false),
                                );
                            }
                        }
                    });
                }
            }
            Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                thread::sleep(REMOTE_ACCEPT_POLL_DELAY);
            }
            Err(error) => {
                emit_remote_status_with_video(
                    &window,
                    metadata.generation,
                    "error",
                    network_error("Remote controller listener failed", error).message,
                    Some(&metadata),
                    Some(false),
                );
                return;
            }
        }
    }
}

fn run_screen_stream_listener(
    listener: TcpListener,
    token: String,
    generation: u64,
    screen_epoch: Arc<AtomicU64>,
    channel: Channel<InvokeResponseBody>,
    window: Window,
) {
    let cancellation = CancellationToken {
        epoch: screen_epoch,
        expected: generation,
    };
    let setup_deadline = Instant::now() + SCREEN_SETUP_TIMEOUT;
    let mut reconnect_deadline = None;
    let mut rejected_clients = 0usize;

    loop {
        if cancellation.check().is_err() {
            return;
        }
        let wait_deadline = reconnect_deadline.unwrap_or(setup_deadline);
        if Instant::now() >= wait_deadline {
            let message = if reconnect_deadline.is_some() {
                "Screen stream could not reconnect before the retry window expired"
            } else {
                "Timed out waiting for Android screen-capture permission and connection"
            };
            emit_screen_status(&window, generation, "error", message, None);
            return;
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !is_allowed_lan_address(peer.ip()) {
                    rejected_clients += 1;
                } else {
                    let _ = stream.set_nodelay(true);
                    let mut authenticated = false;
                    let mut terminal_error = false;
                    let result = (|| {
                        let hello = read_screen_frame(
                            &mut stream,
                            SCREEN_MAX_HELLO_BYTES,
                            OperationDeadline::after(SCREEN_HELLO_TIMEOUT, "Screen stream hello"),
                            &cancellation,
                        )?;
                        let payload_type =
                            serde_json::from_slice::<Value>(&hello)
                                .ok()
                                .and_then(|value| {
                                    value
                                        .get("type")
                                        .and_then(Value::as_str)
                                        .map(str::to_string)
                                });
                        if payload_type.as_deref() == Some("screen_error") {
                            terminal_error = true;
                            let message = parse_screen_error(&hello, &token, generation)?;
                            authenticated = true;
                            return Err(CompanionError::new(CompanionErrorKind::Remote, message));
                        }

                        let dimensions = parse_screen_hello(&hello, &token, generation)?;
                        authenticated = true;
                        reconnect_deadline = None;
                        rejected_clients = 0;
                        emit_screen_status(
                            &window,
                            generation,
                            "connecting",
                            format!("Screen stream connected from {}", peer.ip()),
                            Some(dimensions),
                        );

                        let mut sent_first_frame = false;
                        loop {
                            let (frame_timeout, timeout_label) = if sent_first_frame {
                                (SCREEN_FRAME_TIMEOUT, "Screen stream frame")
                            } else {
                                (SCREEN_FIRST_FRAME_TIMEOUT, "Screen stream first frame")
                            };
                            let frame = read_screen_frame(
                                &mut stream,
                                SCREEN_MAX_FRAME_BYTES,
                                OperationDeadline::after(frame_timeout, timeout_label),
                                &cancellation,
                            )?;
                            if frame.len() < 4
                                || frame[0] != 0xff
                                || frame[1] != 0xd8
                                || frame[frame.len() - 2] != 0xff
                                || frame[frame.len() - 1] != 0xd9
                            {
                                return Err(CompanionError::new(
                                    CompanionErrorKind::Protocol,
                                    "Screen stream frame is not a valid JPEG payload",
                                ));
                            }
                            if let Err(error) = channel.send(InvokeResponseBody::Raw(frame)) {
                                terminal_error = true;
                                return Err(CompanionError::new(
                                    CompanionErrorKind::State,
                                    format!("Desktop screen channel closed: {error}"),
                                ));
                            }
                            if !sent_first_frame {
                                sent_first_frame = true;
                                emit_screen_status(
                                    &window,
                                    generation,
                                    "streaming",
                                    "Receiving Android screen frames",
                                    Some(dimensions),
                                );
                            }
                        }
                    })();

                    match result {
                        Ok(()) => return,
                        Err(error) if error.kind == CompanionErrorKind::Cancelled => return,
                        Err(error) if terminal_error => {
                            emit_screen_status(&window, generation, "error", error.message, None);
                            return;
                        }
                        Err(error) if authenticated => {
                            reconnect_deadline = Some(Instant::now() + SCREEN_RECONNECT_TIMEOUT);
                            emit_screen_status(
                                &window,
                                generation,
                                "reconnecting",
                                format!(
                                    "Screen socket lost; waiting for Android to reconnect: {}",
                                    error.message
                                ),
                                None,
                            );
                        }
                        Err(_) => {
                            // A bad token or hello must not permanently consume
                            // the listener. Keep accepting bounded retries until
                            // the setup/reconnect deadline or rejection budget is reached.
                            rejected_clients += 1;
                        }
                    }
                }

                if rejected_clients >= SCREEN_MAX_REJECTED_CLIENTS {
                    emit_screen_status(
                        &window,
                        generation,
                        "error",
                        "Screen stream stopped after too many rejected connection attempts",
                        None,
                    );
                    return;
                }
            }
            Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                thread::sleep(SCREEN_ACCEPT_POLL_DELAY);
            }
            Err(error) => {
                if cancellation.check().is_ok() {
                    emit_screen_status(
                        &window,
                        generation,
                        "error",
                        network_error("Screen stream listener failed", error).message,
                        None,
                    );
                }
                return;
            }
        }
    }
}

fn validate_screen_stream_params(params: &Value) -> CompanionResult<()> {
    let host = params.get("host").and_then(Value::as_str).ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share requires params.host",
        )
    })?;
    let address = host.parse::<Ipv4Addr>().map_err(|_| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share host must be an IPv4 address",
        )
    })?;
    if !is_allowed_lan_address(IpAddr::V4(address)) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share host must be on a private network",
        ));
    }

    let port = params.get("port").and_then(Value::as_u64).ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share requires params.port",
        )
    })?;
    if !(1..=u16::MAX as u64).contains(&port) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share port is invalid",
        ));
    }

    let token = params.get("token").and_then(Value::as_str).unwrap_or("");
    if !is_valid_stream_token(token) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share token is invalid",
        ));
    }

    let generation = params
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if generation == 0 {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_screen_share generation is invalid",
        ));
    }
    Ok(())
}

fn validate_remote_control_params(params: &Value) -> CompanionResult<()> {
    let object = params.as_object().ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control params must be an object",
        )
    })?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "host" | "port" | "token" | "generation" | "sessionId" | "target" | "permissions"
        )
    }) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control contains unsupported fields",
        ));
    }
    let host = params.get("host").and_then(Value::as_str).ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control requires params.host",
        )
    })?;
    let address = host.parse::<Ipv4Addr>().map_err(|_| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control host must be an IPv4 address",
        )
    })?;
    if !is_allowed_lan_address(IpAddr::V4(address)) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control host must be on a private network",
        ));
    }

    let port = params.get("port").and_then(Value::as_u64).ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control requires params.port",
        )
    })?;
    if !(1..=u16::MAX as u64).contains(&port) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control port is invalid",
        ));
    }

    let token = params.get("token").and_then(Value::as_str).unwrap_or("");
    if !is_valid_stream_token(token) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control token is invalid",
        ));
    }

    let generation = params
        .get("generation")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if generation == 0 {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control generation is invalid",
        ));
    }

    let session_id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !is_valid_remote_session_id(session_id) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control sessionId is invalid",
        ));
    }

    let target = params
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Validation,
                "start_remote_control requires params.target",
            )
        })?;
    let serial = target.get("serial").and_then(Value::as_str).unwrap_or("");
    crate::adb::validate_serial(serial)
        .map_err(|error| CompanionError::new(CompanionErrorKind::Validation, error.message()))?;
    let label = target.get("label").and_then(Value::as_str).unwrap_or("");
    if label.is_empty() || label.len() > 256 {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "start_remote_control target label is invalid",
        ));
    }
    if let Some(permission_values) = params.get("permissions") {
        let permission_values = permission_values.as_array().ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::Validation,
                "start_remote_control permissions must be an array",
            )
        })?;
        let requested_permissions = permission_values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    CompanionError::new(
                        CompanionErrorKind::Validation,
                        "start_remote_control permission is invalid",
                    )
                })
            })
            .collect::<CompanionResult<Vec<_>>>()?;
        validate_remote_permissions(Some(requested_permissions))
            .map_err(|message| CompanionError::new(CompanionErrorKind::Validation, message))?;
    }
    Ok(())
}

fn validate_remote_permissions(permissions: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let requested = permissions.unwrap_or_else(|| vec!["control".to_string()]);
    if requested.is_empty() {
        return Err("Select at least one remote permission".to_string());
    }
    let mut normalized = Vec::with_capacity(requested.len());
    for permission in requested {
        if !REMOTE_PERMISSIONS.contains(&permission.as_str()) {
            return Err(format!("Unsupported remote permission: {permission}"));
        }
        if normalized.contains(&permission) {
            return Err(format!("Duplicate remote permission: {permission}"));
        }
        normalized.push(permission);
    }
    Ok(normalized)
}

fn validate_method(method: &str, params: &Value) -> CompanionResult<()> {
    if !ALLOWED_METHODS.contains(&method) {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            format!("Unsupported companion method: {method}"),
        ));
    }
    if !params.is_object() {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            "Companion params must be a JSON object",
        ));
    }

    match method {
        "clipboard_set" => {
            let text = params.get("text").and_then(Value::as_str).ok_or_else(|| {
                CompanionError::new(
                    CompanionErrorKind::Validation,
                    "clipboard_set requires params.text",
                )
            })?;
            if text.len() > MAX_CLIPBOARD_BYTES {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "clipboard_set text is too large",
                ));
            }
        }
        "open_url" => {
            let url = params.get("url").and_then(Value::as_str).ok_or_else(|| {
                CompanionError::new(
                    CompanionErrorKind::Validation,
                    "open_url requires params.url",
                )
            })?;
            let lower = url.trim().to_ascii_lowercase();
            if !(lower.starts_with("https://") || lower.starts_with("http://")) {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "open_url only accepts http or https URLs",
                ));
            }
            if url.len() > MAX_URL_BYTES {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "open_url URL is too long",
                ));
            }
        }
        "start_screen_share" => validate_screen_stream_params(params)?,
        "stop_screen_share" => {}
        "start_remote_control" => validate_remote_control_params(params)?,
        "stop_remote_control" => {}
        "control_status" | "list_apps" => {}
        "ui_dump" => {
            for key in ["targetWidth", "targetHeight"] {
                if let Some(value) = params.get(key) {
                    if !value
                        .as_u64()
                        .is_some_and(|size| (1..=8192).contains(&size))
                    {
                        return Err(CompanionError::new(
                            CompanionErrorKind::Validation,
                            format!("ui_dump {key} must be 1 to 8192"),
                        ));
                    }
                }
            }
        }
        "launch_app" => {
            let package = params
                .get("package")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if package.is_empty()
                || package.len() > 255
                || !package
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
            {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "launch_app requires a valid params.package",
                ));
            }
        }
        method if FILE_TRANSFER_METHODS.contains(&method) => {
            return Err(CompanionError::new(
                CompanionErrorKind::Validation,
                "Use companion_send_file to send files",
            ));
        }
        "control_gesture" => validate_control_gesture(params)?,
        "control_action" => {
            let action = params
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !CONTROL_ACTIONS.contains(&action) {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "control_action requires a supported params.action",
                ));
            }
        }
        "control_text" => {
            let text = params
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if text.is_empty() || text.len() > MAX_CONTROL_TEXT_BYTES {
                return Err(CompanionError::new(
                    CompanionErrorKind::Validation,
                    "control_text requires params.text of 1 to 4096 bytes",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

/// `points` are `[x, y]` pairs normalized to the phone's display (0..=1), so the
/// desktop never needs the phone's pixel size or orientation.
fn validate_control_gesture(params: &Value) -> CompanionResult<()> {
    let invalid = |message: &str| CompanionError::new(CompanionErrorKind::Validation, message);
    // One finger as `points`, or up to two (a pinch) as `strokes`.
    let strokes: Vec<&Vec<Value>> = match params.get("strokes") {
        Some(strokes) => {
            let strokes = strokes
                .as_array()
                .ok_or_else(|| invalid("control_gesture strokes must be an array"))?;
            if strokes.is_empty() || strokes.len() > MAX_CONTROL_GESTURE_STROKES {
                return Err(invalid("control_gesture needs 1 or 2 strokes"));
            }
            strokes
                .iter()
                .map(|stroke| {
                    stroke
                        .as_array()
                        .ok_or_else(|| invalid("control_gesture stroke must be an array"))
                })
                .collect::<CompanionResult<_>>()?
        }
        None => vec![params
            .get("points")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("control_gesture requires params.points"))?],
    };
    for points in strokes {
        if points.is_empty() || points.len() > MAX_CONTROL_GESTURE_POINTS {
            return Err(invalid("control_gesture needs 1 to 256 points"));
        }
        for point in points {
            let pair = point.as_array().filter(|pair| pair.len() == 2);
            let in_range = pair.is_some_and(|pair| {
                pair.iter()
                    .all(|value| value.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v)))
            });
            if !in_range {
                return Err(invalid(
                    "control_gesture points must be [x, y] between 0 and 1",
                ));
            }
        }
    }
    let duration = params
        .get("durationMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if duration == 0 || duration > MAX_CONTROL_GESTURE_DURATION_MS {
        return Err(invalid("control_gesture durationMs must be 1 to 10000"));
    }
    Ok(())
}

fn decode_response(payload: &[u8], request_id: u64) -> CompanionResult<Value> {
    let value: Value = serde_json::from_slice(payload).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Companion response was not valid JSON: {error}"),
        )
    })?;
    if value.get("type").and_then(Value::as_str) != Some("response") {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion returned a non-response frame",
        ));
    }
    let response_id = value.get("id").and_then(Value::as_u64).ok_or_else(|| {
        CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion response is missing a valid id",
        )
    })?;
    if response_id != request_id {
        return Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            format!("Companion response id mismatch: expected {request_id}, got {response_id}"),
        ));
    }

    match value.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
        Some(false) => Err(CompanionError::new(
            CompanionErrorKind::Remote,
            value
                .get("error")
                .and_then(Value::as_str)
                .filter(|message| !message.trim().is_empty())
                .unwrap_or("Companion request failed"),
        )),
        None => Err(CompanionError::new(
            CompanionErrorKind::Protocol,
            "Companion response is missing the ok flag",
        )),
    }
}

fn perform_request(
    connection: &mut CompanionConnection,
    request_id: u64,
    method: &str,
    params: Value,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) -> CompanionResult<Value> {
    if !connection
        .device
        .capabilities
        .iter()
        .any(|capability| capability == method)
    {
        return Err(CompanionError::new(
            CompanionErrorKind::Validation,
            format!("The connected companion does not support {method}"),
        ));
    }

    let request = json!({
        "type": "request",
        "id": request_id,
        "method": method,
        "params": params,
    });
    let payload = serde_json::to_vec(&request).map_err(|error| {
        CompanionError::new(
            CompanionErrorKind::Validation,
            format!("Could not encode companion request: {error}"),
        )
    })?;
    connection.write_frame(&payload, deadline, cancellation)?;
    let response = connection.read_frame(deadline, cancellation)?;
    decode_response(&response, request_id)
}

fn agent_key(device: &CompanionDevice) -> Option<&str> {
    device
        .agent_device_id
        .as_deref()
        .or(device.peer_ip.as_deref())
}

/// Name of the phone holding the session when it is a different phone than `incoming`.
fn busy_holder(
    connection: &Arc<Mutex<Option<CompanionConnection>>>,
    incoming: &CompanionDevice,
) -> Option<String> {
    let guard = connection.lock().ok()?;
    let current = guard.as_ref()?;
    if agent_key(&current.device) == agent_key(incoming) {
        return None;
    }
    Some(current.device.name.clone())
}

/// Tells a turned-away phone why, so it stops retrying and shows the reason. Best
/// effort: an Agent that predates `studio_busy` just sees the socket close.
fn notify_studio_busy(
    candidate: &mut CompanionConnection,
    holder: &str,
    deadline: OperationDeadline,
    cancellation: &CancellationToken,
) {
    let notice = json!({
        "type": "request",
        "id": 0,
        "method": "studio_busy",
        "params": {
            "inUseBy": holder,
            "message": format!("This computer is already connected to {holder}. Disconnect it there first."),
        },
    });
    if let Ok(payload) = serde_json::to_vec(&notice) {
        if candidate
            .write_frame(&payload, deadline, cancellation)
            .is_ok()
        {
            let _ = candidate.read_frame(deadline, cancellation);
        }
    }
}

fn lock_connection(
    connection: &Arc<Mutex<Option<CompanionConnection>>>,
) -> CompanionResult<std::sync::MutexGuard<'_, Option<CompanionConnection>>> {
    connection.lock().map_err(|_| {
        CompanionError::new(CompanionErrorKind::State, "Companion state is unavailable")
    })
}

/// Start an authenticated LAN pairing session and return a QR offer. The
/// listener keeps the token valid for the session window and accepts repeated
/// authenticated control connections, so Android can retry after a broken
/// pipe or temporary Wi-Fi loss without scanning a new QR code.
/// Sends a file from this computer into the phone's Downloads, in chunks small enough
/// for one request frame each. Emits `companion-file-progress` after every chunk.
#[tauri::command]
pub async fn companion_send_file(
    window: Window,
    state: tauri::State<'_, CompanionState>,
    path: String,
) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let file_path = std::path::PathBuf::from(&path);
    let metadata = std::fs::metadata(&file_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Choose a file, not a folder".to_string());
    }
    if metadata.len() > MAX_SEND_FILE_BYTES {
        return Err("Files up to 1 GB can be sent".to_string());
    }
    let name = file_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let total = metadata.len();
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    // Reserve request ids for every frame of this transfer up front.
    let frames = total.div_ceil(FILE_CHUNK_BYTES as u64) + 2;
    let first_request_id = state.next_request_id.fetch_add(frames, Ordering::Relaxed);
    let request_counter = AtomicU64::new(first_request_id);

    task::spawn_blocking(move || {
        let request = |method: &str, params: Value| -> Result<Value, String> {
            let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "File transfer");
            let mut guard = lock_connection(&connection).map_err(|error| error.message)?;
            let active = guard
                .as_mut()
                .ok_or_else(|| "No companion is connected".to_string())?;
            let id = request_counter.fetch_add(1, Ordering::Relaxed);
            perform_request(active, id, method, params, deadline, &cancellation)
                .map_err(|error| error.message)
        };

        let begin = request("file_begin", json!({ "name": name, "size": total }))?;
        let transfer_id = begin
            .get("transferId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The phone did not start the transfer".to_string())?
            .to_string();
        let mut file = std::fs::File::open(&file_path).map_err(|error| error.to_string())?;
        let mut buffer = vec![0u8; FILE_CHUNK_BYTES];
        let mut offset: u64 = 0;
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            request(
                "file_chunk",
                json!({
                    "transferId": transfer_id,
                    "offset": offset,
                    "data": BASE64.encode(&buffer[..read]),
                }),
            )?;
            offset += read as u64;
            let _ = window.emit(
                "companion-file-progress",
                json!({ "name": name, "sent": offset, "total": total }),
            );
        }
        request("file_end", json!({ "transferId": transfer_id }))
    })
    .await
    .map_err(|error| error.to_string())?
}

const TRUSTED_AGENTS_FILE: &str = "companion_trusted_agents.json";
const MAX_TRUSTED_AGENTS: usize = 20;

/// A phone the desktop user approved once; with auto-connect on it reconnects
/// without another prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedAgent {
    pub agent_device_id: String,
    pub name: String,
    pub approved_at: u64,
}

fn trusted_agents_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(TRUSTED_AGENTS_FILE))
}

fn load_trusted_agents(app: &AppHandle) -> Vec<TrustedAgent> {
    trusted_agents_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_trusted_agents(app: &AppHandle, agents: &[TrustedAgent]) {
    let Some(path) = trusted_agents_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(agents) {
        let _ = std::fs::write(path, bytes);
    }
}

fn upsert_trusted_agent(agents: &mut Vec<TrustedAgent>, agent: TrustedAgent) {
    agents.retain(|existing| existing.agent_device_id != agent.agent_device_id);
    agents.insert(0, agent);
    agents.truncate(MAX_TRUSTED_AGENTS);
}

fn is_trusted_agent(window: &Window, agent_device_id: &str) -> bool {
    load_trusted_agents(window.app_handle())
        .iter()
        .any(|agent| agent.agent_device_id == agent_device_id)
}

fn remember_trusted_agent(window: &Window, agent_device_id: &str, name: &str) {
    let app = window.app_handle();
    let mut agents = load_trusted_agents(app);
    let approved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    upsert_trusted_agent(
        &mut agents,
        TrustedAgent {
            agent_device_id: agent_device_id.to_string(),
            name: name.to_string(),
            approved_at,
        },
    );
    save_trusted_agents(app, &agents);
}

/// Phones that may reconnect without a prompt while auto-connect is on.
#[tauri::command]
pub fn companion_trusted_agents(app: AppHandle) -> Vec<TrustedAgent> {
    load_trusted_agents(&app)
}

/// Forgets every remembered phone; each must be approved again next time.
#[tauri::command]
pub fn companion_forget_trusted_agents(app: AppHandle) {
    save_trusted_agents(&app, &[]);
}

/// The name people know this computer by ("Anuwat's MacBook Pro"), used as the
/// studio name phones show while pairing.
fn local_computer_name() -> Option<String> {
    let from_command = |program: &str, args: &[&str]| {
        std::process::Command::new(program)
            .args(args)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    };
    let name = if cfg!(target_os = "macos") {
        from_command("scutil", &["--get", "ComputerName"])
    } else if cfg!(target_os = "windows") {
        std::env::var("COMPUTERNAME").ok()
    } else {
        from_command("hostname", &[])
    };
    name.map(|value| value.chars().take(64).collect::<String>())
        .filter(|value| !value.trim().is_empty())
}

#[tauri::command]
pub async fn companion_lan_start(
    window: Window,
    state: tauri::State<'_, CompanionState>,
    studio_id: Option<String>,
    studio_name: Option<String>,
    auto_approve_trusted: Option<bool>,
) -> Result<CompanionLanOffer, String> {
    // Without a name the phone has nothing to show but "null"/an IP, so fall
    // back to this computer's own name.
    let studio_name = studio_name
        .filter(|name| !name.trim().is_empty())
        .or_else(local_computer_name);
    match state.connection.try_lock() {
        Ok(guard) if guard.is_some() => {
            return Err("Disconnect the current companion before starting LAN pairing".to_string())
        }
        Ok(_) => {}
        Err(TryLockError::WouldBlock) => {
            state.cancellation_epoch.fetch_add(1, Ordering::SeqCst);
            state.invalidate_screen();
            state.invalidate_remote();
            return Err(
                "Another companion operation is stopping; try LAN pairing again".to_string(),
            );
        }
        Err(TryLockError::Poisoned(_)) => return Err("Companion state is unavailable".to_string()),
    }

    state.cancellation_epoch.fetch_add(1, Ordering::SeqCst);
    state.invalidate_screen();
    state.invalidate_remote();
    let cancellation = state.cancellation_token();
    let pairing_generation = state.pairing_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let guard = state
            .connection
            .lock()
            .map_err(|_| "Companion state is unavailable".to_string())?;
        if guard.is_some() {
            return Err("Disconnect the current companion before starting LAN pairing".to_string());
        }
    }

    let hosts = lan_host_candidates();
    let host = *hosts.first().ok_or_else(|| {
        "No private IPv4 LAN address is available. Connect this computer to the same Wi-Fi \
         network as the phone, and turn off any VPN that captures all traffic."
            .to_string()
    })?;
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| network_error("Could not open the LAN pairing listener", error).message)?;
    listener.set_nonblocking(true).map_err(|error| {
        network_error("Could not configure the LAN pairing listener", error).message
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| network_error("Could not read the LAN pairing port", error).message)?
        .port();

    let token = generate_pairing_token();
    let mut payload = format!("scrcpy-gui-plus://pair?v=1&host={host}&port={port}&token={token}");
    // Additive, since the QR only ever carried one address: Agents that understand
    // `hosts` walk the whole list, older builds ignore it and still use `host`.
    if hosts.len() > 1 {
        payload.push_str("&hosts=");
        payload.push_str(&percent_encode_query(
            &hosts
                .iter()
                .map(Ipv4Addr::to_string)
                .collect::<Vec<_>>()
                .join(","),
        ));
    }
    // Trusted Studios identity (doc §5/§12): optional, additive query params.
    // Older Agent builds that don't recognize them simply ignore extra params.
    if let Some(studio_id) = studio_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.push_str("&studioId=");
        payload.push_str(&percent_encode_query(studio_id));
    }
    if let Some(studio_name) = studio_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.push_str("&studioName=");
        payload.push_str(&percent_encode_query(studio_name));
    }
    let svg = render_pairing_qr(&payload).map_err(|error| error.message)?;
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .saturating_add(LAN_PAIRING_TIMEOUT)
        .as_millis() as u64;

    emit_pairing_status(
        &window,
        "pairing",
        "Scan this QR code in the Android companion. Both devices must be on the same private network.",
        None,
        pairing_generation,
    );

    // Discovery is a best-effort convenience. If the fixed port is already taken (a
    // second instance, or an unrelated app) QR pairing still works on its own.
    let discovery_socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT))
        .ok()
        .filter(|socket| {
            socket.set_broadcast(true).is_ok()
                && socket
                    .set_read_timeout(Some(DISCOVERY_POLL_TIMEOUT))
                    .is_ok()
        });
    let discovery_port = discovery_socket.as_ref().map(|_| DISCOVERY_PORT);

    let pairing_epoch = state.pairing_epoch.clone();
    let connection = state.connection.clone();
    let pending_approval = state.pending_approval.clone();
    let next_approval_id = state.next_approval_id.clone();

    if let Some(socket) = discovery_socket {
        let discovery_hosts = hosts.clone();
        let discovery_epoch = pairing_epoch.clone();
        let discovery_cancellation = cancellation.clone();
        let discovery_studio_id = studio_id.clone();
        let discovery_studio_name = studio_name.clone();
        task::spawn_blocking(move || {
            run_discovery_responder(
                socket,
                port,
                discovery_hosts,
                discovery_studio_id,
                discovery_studio_name,
                pairing_generation,
                discovery_epoch,
                discovery_cancellation,
            );
        });
    }

    task::spawn_blocking(move || {
        run_lan_pairing_listener(
            listener,
            token,
            pairing_generation,
            pairing_epoch,
            connection,
            pending_approval,
            next_approval_id,
            cancellation,
            window,
            auto_approve_trusted.unwrap_or(false),
        );
    });

    Ok(CompanionLanOffer {
        generation: pairing_generation,
        host: host.to_string(),
        hosts: hosts.iter().map(Ipv4Addr::to_string).collect(),
        port,
        discovery_port,
        expires_at,
        payload,
        svg,
    })
}

/// Answer the prompt raised by a discovered Agent that connected without a token.
#[tauri::command]
pub async fn companion_pairing_approve(
    state: tauri::State<'_, CompanionState>,
    request_id: u64,
    approve: bool,
) -> Result<(), String> {
    let mut guard = state
        .pending_approval
        .lock()
        .map_err(|_| "Companion state is unavailable".to_string())?;
    match guard.as_mut() {
        Some(pending) if pending.request_id == request_id => {
            pending.decision = Some(approve);
            Ok(())
        }
        // The Agent gave up, the pairing was cancelled, or a newer request replaced
        // this one. Saying so lets the UI drop a prompt it should no longer show.
        _ => Err("This pairing request is no longer waiting for an answer".to_string()),
    }
}

/// (max edge px, fps, JPEG quality) for a stream preset, inside the bounds the
/// Android app accepts (320..=1920 px, 1..=30 fps, 35..=85 quality).
fn screen_quality_params(preset: Option<&str>) -> (u32, u32, u32) {
    match preset {
        Some("low") => (960, 10, 45),
        Some("smooth") => (1280, 24, 55),
        Some("sharp") => (1920, 15, 75),
        _ => (1280, 12, 60),
    }
}

/// Start a separate authenticated LAN socket for JPEG screen frames, then ask the
/// connected Android companion to request MediaProjection permission. The control
/// socket remains strictly request/response; frame bytes use the Tauri channel.
#[tauri::command]
pub async fn companion_screen_start(
    window: Window,
    state: tauri::State<'_, CompanionState>,
    on_frame: Channel<InvokeResponseBody>,
    quality: Option<String>,
) -> Result<CompanionRequestResult, String> {
    let (max_size, max_fps, jpeg_quality) = screen_quality_params(quality.as_deref());
    let peer_ip;
    {
        let guard = state
            .connection
            .lock()
            .map_err(|_| "Companion state is unavailable".to_string())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "No companion is connected; start QR / LAN pairing first".to_string())?;
        if active.device.transport != "lan-tcp" {
            return Err(
                "Screen streaming currently requires a QR / LAN companion connection".to_string(),
            );
        }
        peer_ip = active.device.peer_ip.clone();
    }

    let generation = state.next_screen_generation();
    let host = preferred_lan_host(peer_ip.as_deref()).map_err(|error| error.message)?;
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|error| {
        network_error("Could not open the screen stream listener", error).message
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        network_error("Could not configure the screen stream listener", error).message
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| network_error("Could not read the screen stream port", error).message)?
        .port();
    let token = generate_pairing_token();

    emit_screen_status(
        &window,
        generation,
        "connecting",
        "Opening the Android screen socket",
        None,
    );

    let screen_epoch = state.screen_epoch.clone();
    let listener_window = window.clone();
    let listener_token = token.clone();
    task::spawn_blocking(move || {
        run_screen_stream_listener(
            listener,
            listener_token,
            generation,
            screen_epoch,
            on_frame,
            listener_window,
        );
    });

    let params = json!({
        "host": host.to_string(),
        "port": port,
        "token": token,
        "generation": generation,
        "maxWidth": max_size,
        "maxHeight": max_size,
        "maxFps": max_fps,
        "jpegQuality": jpeg_quality,
    });
    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let task_result = task::spawn_blocking(move || {
        let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Screen stream request");
        let mut guard = lock_connection(&connection)?;
        deadline.check(&cancellation)?;
        let active = guard.as_mut().ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::NotFound,
                "No companion is connected; start QR / LAN pairing first",
            )
        })?;
        match perform_request(
            active,
            request_id,
            "start_screen_share",
            params,
            deadline,
            &cancellation,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                if error.loses_session() {
                    *guard = None;
                }
                Err(error)
            }
        }
    })
    .await;

    let result = match task_result {
        Ok(Ok(value)) => CompanionRequestResult::ok(value, false),
        Ok(Err(error)) => CompanionRequestResult::err(error),
        Err(error) => CompanionRequestResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Screen stream request task failed: {error}"),
        )),
    };

    if result.success {
        emit_screen_status(
            &window,
            generation,
            "waiting_permission",
            "Approve screen capture on Android. The live preview will appear below in Connection Tools.",
            None,
        );
    } else {
        state.invalidate_screen();
        if result.disconnected {
            state.invalidate_remote();
            emit_status(
                &window,
                "disconnected",
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "Companion disconnected".to_string()),
            );
        }
        emit_screen_status(
            &window,
            generation,
            "error",
            result
                .error
                .clone()
                .unwrap_or_else(|| "Could not start the screen stream".to_string()),
            None,
        );
    }
    Ok(result)
}

/// Stop the screen capture without closing the underlying Companion control session.
#[tauri::command]
pub async fn companion_screen_stop(
    window: Window,
    state: tauri::State<'_, CompanionState>,
) -> Result<CompanionRequestResult, String> {
    let generation = state.next_screen_generation();
    emit_screen_status(
        &window,
        generation,
        "stopped",
        "Stopping Android screen stream",
        None,
    );

    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let task_result = task::spawn_blocking(move || {
        let mut guard = lock_connection(&connection)?;
        let Some(active) = guard.as_mut() else {
            return Ok(json!({ "stopped": true }));
        };
        if !active
            .device
            .capabilities
            .iter()
            .any(|capability| capability == "stop_screen_share")
        {
            return Ok(json!({ "stopped": true }));
        }
        let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Stop screen stream");
        deadline.check(&cancellation)?;
        match perform_request(
            active,
            request_id,
            "stop_screen_share",
            json!({}),
            deadline,
            &cancellation,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                if error.loses_session() {
                    *guard = None;
                }
                Err(error)
            }
        }
    })
    .await;

    let result = match task_result {
        Ok(Ok(value)) => CompanionRequestResult::ok(value, false),
        Ok(Err(error)) => CompanionRequestResult::err(error),
        Err(error) => CompanionRequestResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Screen stop task failed: {error}"),
        )),
    };
    if result.success {
        emit_screen_status(
            &window,
            generation,
            "stopped",
            "Android screen stream stopped",
            None,
        );
    } else {
        if result.disconnected {
            state.invalidate_remote();
            emit_status(
                &window,
                "disconnected",
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "Companion disconnected".to_string()),
            );
        }
        emit_screen_status(
            &window,
            generation,
            "error",
            result
                .error
                .clone()
                .unwrap_or_else(|| "Could not stop the screen stream".to_string()),
            None,
        );
    }
    Ok(result)
}

/// Discover or reconnect to an Android companion over USB AOA. A cached
/// session is pinged before it is reported as connected.
#[tauri::command]
pub async fn companion_scan(
    window: Window,
    state: tauri::State<'_, CompanionState>,
) -> Result<CompanionScanResult, String> {
    state.invalidate_screen();
    state.invalidate_remote();
    state.pairing_epoch.fetch_add(1, Ordering::SeqCst);
    emit_status(&window, "scanning", "Scanning USB devices...");
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let progress_window = window.clone();

    let task_result = task::spawn_blocking(move || {
        let deadline = OperationDeadline::after(SCAN_TIMEOUT, "Companion scan");
        let mut guard = lock_connection(&connection)?;
        deadline.check(&cancellation)?;

        if let Some(active) = guard.as_mut() {
            emit_status(
                &progress_window,
                "checking_connection",
                "Checking the existing companion connection...",
            );
            match perform_request(
                active,
                request_id,
                "ping",
                json!({}),
                deadline.capped(Duration::from_secs(3), "Companion liveness check"),
                &cancellation,
            ) {
                Ok(result) if result.get("message").and_then(Value::as_str) == Some("pong") => {
                    return Ok(active.device.clone())
                }
                _ => *guard = None,
            }
        }

        let progress = |stage: &'static str, message: String| {
            emit_status(&progress_window, stage, message);
        };
        let new_connection = scan_for_companion(deadline, &cancellation, &progress)?;
        let device = new_connection.device.clone();
        *guard = Some(new_connection);
        Ok(device)
    })
    .await;

    let result = match task_result {
        Ok(Ok(device)) => CompanionScanResult::ok(device),
        Ok(Err(error)) => {
            if let Ok(mut guard) = state.connection.lock() {
                *guard = None;
            }
            CompanionScanResult::err(error)
        }
        Err(error) => CompanionScanResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Companion scan task failed: {error}"),
        )),
    };

    if result.success {
        if let Some(device) = result.devices.first() {
            spawn_agent_heartbeat(
                window.clone(),
                state.connection.clone(),
                state.cancellation_token(),
                device.id.clone(),
                device.agent_device_id.clone(),
            );
        }
        emit_status(&window, "connected", "Android companion connected");
    } else {
        let stage = if result.error_code.as_deref() == Some("cancelled") {
            "disconnected"
        } else {
            "error"
        };
        emit_status(
            &window,
            stage,
            result
                .error
                .clone()
                .unwrap_or_else(|| "Companion scan failed".to_string()),
        );
    }
    Ok(result)
}

/// Open an authenticated, session-bound socket for a mobile remote controller.
/// Calling this command is the desktop approval gate: the target serial is
/// captured here and is never accepted from remote request frames.
#[tauri::command]
pub async fn companion_remote_start(
    window: Window,
    state: tauri::State<'_, CompanionState>,
    target_serial: String,
    custom_path: Option<String>,
    permissions: Option<Vec<String>>,
) -> Result<CompanionRequestResult, String> {
    let target_serial = target_serial.trim().to_string();
    crate::adb::validate_serial(&target_serial).map_err(|error| error.message())?;
    let peer_ip;
    {
        let guard = state
            .connection
            .lock()
            .map_err(|_| "Companion state is unavailable".to_string())?;
        let active = guard
            .as_ref()
            .ok_or_else(|| "No companion is connected; start QR / LAN pairing first".to_string())?;
        if active.device.transport != "lan-tcp" {
            return Err(
                "Remote control currently requires a QR / LAN companion connection".to_string(),
            );
        }
        if !active
            .device
            .capabilities
            .iter()
            .any(|capability| capability == "start_remote_control")
        {
            return Err(
                "The connected companion does not support remote control; update the Android app"
                    .to_string(),
            );
        }
        peer_ip = active.device.peer_ip.clone();
    }

    let permissions_are_explicit = permissions.is_some();
    let permissions = validate_remote_permissions(permissions)?;
    let generation = state.next_remote_generation();
    {
        let mut guard = state
            .remote_session
            .lock()
            .map_err(|_| "Companion remote state is unavailable".to_string())?;
        *guard = None;
    }
    let session_id = format!("remote-{}", generate_pairing_token());
    let host = preferred_lan_host(peer_ip.as_deref()).map_err(|error| error.message)?;
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|error| {
        network_error("Could not open the remote controller listener", error).message
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        network_error("Could not configure the remote controller listener", error).message
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| network_error("Could not read the remote controller port", error).message)?
        .port();
    let token = generate_pairing_token();
    let preparation = if permissions_are_explicit {
        let preparing_metadata = RemoteSessionMetadata {
            generation,
            session_id: session_id.clone(),
            target_serial: target_serial.clone(),
            permissions: permissions.clone(),
            legacy_navigation_only: false,
            embedded_auto_started: false,
            embedded_session_id: None,
        };
        emit_remote_status(
            &window,
            generation,
            "preparing_target",
            "Preparing an H.264 target session",
            Some(&preparing_metadata),
        );
        Some(
            crate::embed_session::ensure_remote_embedded_session(
                window.clone(),
                &window
                    .app_handle()
                    .state::<crate::embed_session::EmbedSessionState>(),
                target_serial.clone(),
                custom_path.clone(),
                generation,
            )
            .await
            .map_err(|error| {
                emit_remote_status_with_video(
                    &window,
                    generation,
                    "error",
                    error.clone(),
                    Some(&preparing_metadata),
                    Some(false),
                );
                error
            })?,
        )
    } else {
        None
    };
    if state.remote_epoch.load(Ordering::SeqCst) != generation {
        crate::embed_session::release_remote_session_lease(
            window.app_handle(),
            &window,
            generation,
        )
        .await;
        return Err("Remote target preparation was cancelled".to_string());
    }
    let metadata = RemoteSessionMetadata {
        generation,
        session_id: session_id.clone(),
        target_serial: target_serial.clone(),
        permissions: permissions.clone(),
        legacy_navigation_only: !permissions_are_explicit,
        embedded_auto_started: preparation
            .as_ref()
            .is_some_and(|preparation| preparation.auto_started),
        embedded_session_id: preparation.map(|preparation| preparation.session_id),
    };
    let metadata_stored = if let Ok(mut guard) = state.remote_session.lock() {
        *guard = Some(metadata.clone());
        true
    } else {
        false
    };
    if !metadata_stored {
        crate::embed_session::release_remote_session_lease(
            window.app_handle(),
            &window,
            generation,
        )
        .await;
        return Err("Companion remote state is unavailable".to_string());
    }

    emit_remote_status(
        &window,
        generation,
        "connecting",
        "Opening the mobile remote controller socket",
        Some(&metadata),
    );

    let listener_metadata = metadata.clone();
    let remote_epoch = state.remote_epoch.clone();
    let listener_window = window.clone();
    let listener_token = token.clone();
    let listener_custom_path = custom_path.clone();
    let listener_remote_session = state.remote_session.clone();
    let runtime = tokio::runtime::Handle::current();
    task::spawn_blocking(move || {
        run_remote_control_listener(
            listener,
            listener_token,
            listener_metadata,
            remote_epoch,
            listener_custom_path,
            runtime,
            listener_window,
            listener_remote_session,
        );
    });

    let mut params = json!({
        "host": host.to_string(),
        "port": port,
        "token": token,
        "generation": generation,
        "sessionId": session_id,
        "target": {
            "serial": target_serial.clone(),
            "label": target_serial,
        },
        "permissions": permissions,
    });
    if !permissions_are_explicit {
        params
            .as_object_mut()
            .expect("remote params object")
            .remove("permissions");
    }
    if let Err(error) = validate_remote_control_params(&params) {
        state.remote_epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = state.remote_session.lock() {
            *guard = None;
        }
        crate::embed_session::release_remote_session_lease(
            window.app_handle(),
            &window,
            generation,
        )
        .await;
        return Ok(CompanionRequestResult::err(error));
    }

    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let task_result = task::spawn_blocking(move || {
        let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Start remote control");
        let mut guard = lock_connection(&connection)?;
        deadline.check(&cancellation)?;
        let active = guard.as_mut().ok_or_else(|| {
            CompanionError::new(CompanionErrorKind::NotFound, "No companion is connected")
        })?;
        match perform_request(
            active,
            request_id,
            "start_remote_control",
            params,
            deadline,
            &cancellation,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                if error.loses_session() {
                    *guard = None;
                }
                Err(error)
            }
        }
    })
    .await;

    let result = match task_result {
        Ok(Ok(android_result)) => CompanionRequestResult::ok(
            json!({
                "generation": generation,
                "sessionId": metadata.session_id,
                "targetSerial": metadata.target_serial,
                "permissions": metadata.permissions,
                "embeddedAutoStarted": metadata.embedded_auto_started,
                "embeddedSessionId": metadata.embedded_session_id,
                "android": android_result,
            }),
            false,
        ),
        Ok(Err(error)) => CompanionRequestResult::err(error),
        Err(error) => CompanionRequestResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Remote start task failed: {error}"),
        )),
    };
    if !result.success {
        state.remote_epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = state.remote_session.lock() {
            if guard
                .as_ref()
                .is_some_and(|session| session.generation == generation)
            {
                *guard = None;
            }
        }
        crate::embed_session::release_remote_session_lease(
            window.app_handle(),
            &window,
            generation,
        )
        .await;
        emit_remote_status_with_video(
            &window,
            generation,
            "error",
            result
                .error
                .clone()
                .unwrap_or_else(|| "Could not start remote control".to_string()),
            Some(&metadata),
            Some(false),
        );
    }
    Ok(result)
}

/// Invalidate the remote socket first, then best-effort notify Android so stale
/// clients cannot continue issuing actions while the stop request is in flight.
#[tauri::command]
pub async fn companion_remote_stop(
    window: Window,
    state: tauri::State<'_, CompanionState>,
) -> Result<CompanionRequestResult, String> {
    let generation = state.next_remote_generation();
    let metadata = state
        .remote_session
        .lock()
        .map_err(|_| "Companion remote state is unavailable".to_string())?
        .take();
    let embedded_stopped = if let Some(metadata) = metadata.as_ref() {
        crate::embed_session::release_remote_session_lease(
            window.app_handle(),
            &window,
            metadata.generation,
        )
        .await
    } else {
        false
    };
    emit_remote_status_with_video(
        &window,
        generation,
        "stopped",
        "Stopping mobile remote control",
        metadata.as_ref(),
        Some(false),
    );

    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let stop_params = metadata
        .as_ref()
        .map(|session| {
            json!({
                "generation": session.generation,
                "sessionId": session.session_id,
            })
        })
        .unwrap_or_else(|| json!({}));
    let task_result = task::spawn_blocking(move || {
        let mut guard = lock_connection(&connection)?;
        let Some(active) = guard.as_mut() else {
            return Ok(json!({ "stopped": true }));
        };
        if !active
            .device
            .capabilities
            .iter()
            .any(|capability| capability == "stop_remote_control")
        {
            return Ok(json!({ "stopped": true }));
        }
        let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Stop remote control");
        deadline.check(&cancellation)?;
        match perform_request(
            active,
            request_id,
            "stop_remote_control",
            stop_params,
            deadline,
            &cancellation,
        ) {
            Ok(result) => Ok(result),
            Err(error) => {
                if error.loses_session() {
                    *guard = None;
                }
                Err(error)
            }
        }
    })
    .await;

    let result = match task_result {
        Ok(Ok(value)) => CompanionRequestResult::ok(value, false),
        Ok(Err(error)) => CompanionRequestResult::err(error),
        Err(error) => CompanionRequestResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Remote stop task failed: {error}"),
        )),
    };
    if result.success {
        emit_remote_status_with_video(
            &window,
            generation,
            "stopped",
            "Mobile remote control stopped",
            metadata.as_ref(),
            Some(false),
        );
    }
    let mut result = result;
    if let Some(value) = result.result.as_mut().and_then(Value::as_object_mut) {
        value.insert("embeddedStopped".to_string(), Value::Bool(embedded_stopped));
    }
    Ok(result)
}

/// Send one allow-listed app-level request to the connected companion.
#[tauri::command]
pub async fn companion_request(
    window: Window,
    state: tauri::State<'_, CompanionState>,
    method: String,
    params: Option<Value>,
) -> Result<CompanionRequestResult, String> {
    let method = method.trim().to_string();
    let params = params.unwrap_or_else(|| json!({}));
    if let Err(error) = validate_method(&method, &params) {
        return Ok(CompanionRequestResult::err(error));
    }

    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    let connection = state.connection.clone();
    let cancellation = state.cancellation_token();
    let method_for_task = method.clone();
    let task_result = task::spawn_blocking(move || {
        let deadline = OperationDeadline::after(REQUEST_TIMEOUT, "Companion request");
        let mut guard = lock_connection(&connection)?;
        deadline.check(&cancellation)?;
        let active = guard.as_mut().ok_or_else(|| {
            CompanionError::new(
                CompanionErrorKind::NotFound,
                "No companion is connected; start USB or LAN pairing first",
            )
        })?;

        let outcome = perform_request(
            active,
            request_id,
            &method_for_task,
            params,
            deadline,
            &cancellation,
        );
        match outcome {
            Ok(result) => {
                // open_url backgrounds the foreground-owned Android Activity.
                // Its response is flushed first, then both sides deliberately
                // close and require a rescan for the next operation.
                let disconnected = method_for_task == "open_url";
                if disconnected {
                    *guard = None;
                }
                Ok((result, disconnected))
            }
            Err(error) => {
                if error.loses_session() {
                    *guard = None;
                }
                Err(error)
            }
        }
    })
    .await;

    let result = match task_result {
        Ok(Ok((value, disconnected))) => CompanionRequestResult::ok(value, disconnected),
        Ok(Err(error)) => CompanionRequestResult::err(error),
        Err(error) => CompanionRequestResult::err(CompanionError::new(
            CompanionErrorKind::State,
            format!("Companion request task failed: {error}"),
        )),
    };

    if result.disconnected {
        state.invalidate_screen();
        state.invalidate_remote();
        let message = if method == "open_url" && result.success {
            "URL opened on Android; reopen the companion app and scan again"
        } else {
            result.error.as_deref().unwrap_or("Companion disconnected")
        };
        emit_status(&window, "disconnected", message);
    } else if result.success {
        emit_status(&window, "connected", "Android companion connected");
    }
    Ok(result)
}

/// Cancel any in-flight operation and close the current session. Epochs are
/// invalidated first; then the connection slot is cleared after blocking I/O
/// observes cancellation (polling at most every 500 ms).
#[tauri::command]
pub fn companion_disconnect(
    window: Window,
    state: tauri::State<'_, CompanionState>,
) -> Result<(), String> {
    let remote = state
        .remote_session
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let pairing_generation = state.shutdown();
    emit_pairing_status(
        &window,
        "disconnected",
        "Companion disconnected",
        None,
        pairing_generation,
    );
    if let Some(remote) = remote.as_ref() {
        emit_remote_status(
            &window,
            remote.generation,
            "stopped",
            "Mobile remote control stopped because the companion disconnected",
            Some(remote),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_token() -> (Arc<AtomicU64>, CancellationToken) {
        let epoch = Arc::new(AtomicU64::new(7));
        let token = CancellationToken {
            epoch: epoch.clone(),
            expected: 7,
        };
        (epoch, token)
    }

    #[test]
    fn validates_frame_lengths() {
        assert_eq!(validate_frame_length(1).unwrap(), 1);
        assert_eq!(
            validate_frame_length(MAX_PAYLOAD_BYTES as u32).unwrap(),
            MAX_PAYLOAD_BYTES
        );
        assert_eq!(
            validate_frame_length(0).unwrap_err().kind,
            CompanionErrorKind::Protocol
        );
        assert!(validate_frame_length((MAX_PAYLOAD_BYTES + 1) as u32).is_err());
    }

    #[test]
    fn cancellation_token_detects_epoch_change() {
        let (epoch, token) = test_token();
        assert!(token.check().is_ok());
        epoch.fetch_add(1, Ordering::SeqCst);
        let error = token.check().unwrap_err();
        assert_eq!(error.kind, CompanionErrorKind::Cancelled);
    }

    #[test]
    fn deadline_caps_each_transfer_and_expires() {
        let (_, token) = test_token();
        let deadline = OperationDeadline::after(Duration::from_secs(2), "test");
        assert!(deadline.transfer_timeout(&token).unwrap() <= IO_POLL_TIMEOUT);

        let expired = OperationDeadline {
            end: Instant::now() - Duration::from_millis(1),
            label: "expired test",
        };
        assert_eq!(
            expired.transfer_timeout(&token).unwrap_err().kind,
            CompanionErrorKind::Timeout
        );
    }

    #[test]
    fn validates_only_supported_methods_and_bounds() {
        assert!(validate_method("ping", &json!({})).is_ok());
        assert!(validate_method("shell", &json!({})).is_err());
        assert!(validate_method("clipboard_set", &json!({})).is_err());
        assert!(validate_method("open_url", &json!({ "url": "file:///tmp/a" })).is_err());
        assert!(validate_method(
            "clipboard_set",
            &json!({ "text": "x".repeat(MAX_CLIPBOARD_BYTES + 1) })
        )
        .is_err());
        assert!(validate_method(
            "open_url",
            &json!({ "url": format!("https://example.com/{}", "x".repeat(MAX_URL_BYTES)) })
        )
        .is_err());
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let session_id = format!("remote-{token}");
        assert!(validate_method(
            "start_remote_control",
            &json!({
                "host": "192.168.1.10",
                "port": 33445,
                "token": token,
                "generation": 2,
                "sessionId": session_id,
                "target": { "serial": "emulator-5554", "label": "emulator-5554" },
                "permissions": ["control"],
            })
        )
        .is_ok());
    }

    #[test]
    fn authenticates_remote_hello_with_all_session_credentials() {
        let token = "12".repeat(LAN_TOKEN_BYTES);
        let session_id = format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES));
        let hello = serde_json::to_vec(&json!({
            "type": "remote_hello",
            "protocol": PROTOCOL_VERSION,
            "package": EXPECTED_PACKAGE,
            "token": token,
            "generation": 7,
            "sessionId": session_id,
        }))
        .unwrap();
        assert!(parse_remote_hello(
            &hello,
            &"12".repeat(LAN_TOKEN_BYTES),
            7,
            &format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES)),
        )
        .is_ok());

        let video_hello = serde_json::to_vec(&json!({
            "type": "remote_hello", "protocol": PROTOCOL_VERSION,
            "package": EXPECTED_PACKAGE, "token": "12".repeat(LAN_TOKEN_BYTES),
            "generation": 7, "sessionId": format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES)),
            "channel": "video",
        }))
        .unwrap();
        assert_eq!(
            parse_remote_hello(
                &video_hello,
                &"12".repeat(LAN_TOKEN_BYTES),
                7,
                &format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES))
            )
            .unwrap(),
            RemoteChannel::Video
        );

        let error = parse_remote_hello(
            &hello,
            &"12".repeat(LAN_TOKEN_BYTES),
            8,
            &format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES)),
        )
        .unwrap_err();
        assert_eq!(error.kind, CompanionErrorKind::Permission);

        let invalid_channel = serde_json::to_vec(&json!({
            "type": "remote_hello", "protocol": PROTOCOL_VERSION,
            "package": EXPECTED_PACKAGE, "token": "12".repeat(LAN_TOKEN_BYTES),
            "generation": 7, "sessionId": format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES)),
            "channel": null,
        }))
        .unwrap();
        assert_eq!(
            parse_remote_hello(
                &invalid_channel,
                &"12".repeat(LAN_TOKEN_BYTES),
                7,
                &format!("remote-{}", "34".repeat(LAN_TOKEN_BYTES))
            )
            .unwrap_err()
            .kind,
            CompanionErrorKind::Protocol
        );
    }

    #[test]
    fn remote_requests_are_strictly_allow_listed_and_cannot_select_a_target() {
        let valid = serde_json::to_vec(&json!({
            "type": "remote_request",
            "id": 11,
            "method": "home",
            "params": {},
        }))
        .unwrap();
        assert_eq!(
            parse_remote_request(&valid).unwrap(),
            (11, RemoteCommand::Action("home".to_string()))
        );

        let touch = serde_json::to_vec(&json!({
            "type": "remote_request", "id": 14, "method": "touch",
            "params": { "action": "down", "pointerId": 1, "x": 10.0, "y": 20.0,
                "deviceWidth": 1080, "deviceHeight": 2400, "pressure": 1.0 }
        }))
        .unwrap();
        assert!(matches!(
            parse_remote_request(&touch).unwrap().1,
            RemoteCommand::Touch { .. }
        ));

        let injected_target = serde_json::to_vec(&json!({
            "type": "remote_request",
            "id": 12,
            "method": "home",
            "params": { "serial": "attacker-selected" },
        }))
        .unwrap();
        assert_eq!(
            parse_remote_request(&injected_target).unwrap_err().kind,
            CompanionErrorKind::Permission
        );

        let shell = serde_json::to_vec(&json!({
            "type": "remote_request",
            "id": 13,
            "method": "shell",
            "params": {},
        }))
        .unwrap();
        assert_eq!(
            parse_remote_request(&shell).unwrap_err().kind,
            CompanionErrorKind::Permission
        );
    }

    #[test]
    fn remote_permissions_are_strict_and_default_to_phase_one_control() {
        assert_eq!(validate_remote_permissions(None).unwrap(), vec!["control"]);
        assert!(validate_remote_permissions(Some(vec!["view".into(), "view".into()])).is_err());
        assert!(validate_remote_permissions(Some(vec!["shell".into()])).is_err());
    }

    #[test]
    fn legacy_remote_offer_may_omit_permissions() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let session_id = format!("remote-{}", "cd".repeat(LAN_TOKEN_BYTES));
        assert!(validate_remote_control_params(&json!({
            "host": "192.168.1.2", "port": 12345, "token": token,
            "generation": 1, "sessionId": session_id,
            "target": { "serial": "emulator-5554", "label": "emulator-5554" }
        }))
        .is_ok());
    }

    #[test]
    fn remote_video_bound_matches_scrcpy_packet_envelope() {
        assert_eq!(REMOTE_MAX_VIDEO_FRAME_BYTES, 32 * 1024 * 1024 + 14);
    }

    #[test]
    fn remote_channel_windows_are_bounded_and_active_channel_stays_open() {
        let now = Instant::now();
        let setup = now + Duration::from_secs(10);
        assert!(remote_channel_window_open(false, false, None, setup, now));
        assert!(!remote_channel_window_open(false, false, None, now, now));
        assert!(remote_channel_window_open(
            false,
            true,
            Some(now + Duration::from_secs(1)),
            setup,
            now
        ));
        assert!(!remote_channel_window_open(
            false,
            true,
            Some(now),
            setup,
            now
        ));
        assert!(remote_channel_window_open(true, true, Some(now), now, now));
    }

    #[test]
    fn remote_channel_lease_releases_active_slot() {
        let active = Arc::new(std::sync::atomic::AtomicBool::new(true));
        {
            let _lease = RemoteChannelLease(active.clone());
            assert!(active.load(Ordering::SeqCst));
        }
        assert!(!active.load(Ordering::SeqCst));
    }

    #[test]
    fn listener_cleanup_only_clears_matching_generation() {
        let session = |generation| RemoteSessionMetadata {
            generation,
            session_id: format!("remote-{}", "ab".repeat(LAN_TOKEN_BYTES)),
            target_serial: "emulator-5554".to_string(),
            permissions: vec!["control".to_string()],
            legacy_navigation_only: false,
            embedded_auto_started: false,
            embedded_session_id: None,
        };
        let state = Arc::new(Mutex::new(Some(session(2))));
        assert!(!clear_remote_metadata_if_generation(&state, 1));
        assert_eq!(state.lock().unwrap().as_ref().unwrap().generation, 2);
        assert!(clear_remote_metadata_if_generation(&state, 2));
        assert!(state.lock().unwrap().is_none());
    }

    #[test]
    fn listener_cleanup_invalidates_matching_epoch_but_not_newer_session() {
        let session = |generation| RemoteSessionMetadata {
            generation,
            session_id: format!("remote-{}", "ef".repeat(LAN_TOKEN_BYTES)),
            target_serial: "emulator-5554".to_string(),
            permissions: vec!["control".to_string()],
            legacy_navigation_only: false,
            embedded_auto_started: false,
            embedded_session_id: None,
        };
        let epoch = Arc::new(AtomicU64::new(3));
        let state = Arc::new(Mutex::new(Some(session(3))));
        assert!(clear_remote_metadata_if_generation(&state, 3));
        assert!(invalidate_remote_epoch_if_generation(&epoch, 3));
        assert_eq!(epoch.load(Ordering::SeqCst), 4);
        assert!(state.lock().unwrap().is_none());

        *state.lock().unwrap() = Some(session(5));
        epoch.store(5, Ordering::SeqCst);
        assert!(!clear_remote_metadata_if_generation(&state, 4));
        assert!(!invalidate_remote_epoch_if_generation(&epoch, 4));
        assert_eq!(epoch.load(Ordering::SeqCst), 5);
        assert_eq!(state.lock().unwrap().as_ref().unwrap().generation, 5);
    }

    #[test]
    fn parses_expected_hello_and_filters_capabilities() {
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping", "clipboard_get", "unknown", "ping"]
        });
        let device = parse_hello(
            "aoa-test",
            "usb-accessory",
            &serde_json::to_vec(&hello).unwrap(),
        )
        .unwrap();
        assert_eq!(device.id, "aoa-test");
        assert_eq!(device.capabilities, vec!["ping", "clipboard_get"]);
    }

    #[test]
    fn capability_less_v1_hello_keeps_legacy_defaults() {
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Legacy Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0"
        });
        let device =
            parse_hello("lan-test", "lan-tcp", &serde_json::to_vec(&hello).unwrap()).unwrap();
        assert!(device
            .capabilities
            .iter()
            .any(|capability| capability == "ping"));
        assert!(!device
            .capabilities
            .iter()
            .any(|capability| capability == "start_remote_control"));
    }

    #[test]
    fn parses_optional_agent_device_id_from_hello() {
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping"],
            "deviceId": "agent-uuid-123",
        });
        let device =
            parse_hello("lan-test", "lan-tcp", &serde_json::to_vec(&hello).unwrap()).unwrap();
        assert_eq!(device.agent_device_id.as_deref(), Some("agent-uuid-123"));
    }

    #[test]
    fn hello_without_device_id_leaves_agent_device_id_absent() {
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping"],
        });
        let device =
            parse_hello("lan-test", "lan-tcp", &serde_json::to_vec(&hello).unwrap()).unwrap();
        assert!(device.agent_device_id.is_none());
    }

    #[test]
    fn lan_hello_captures_the_peer_ip() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping"],
            "token": token,
        });
        let (device, auth) = parse_lan_hello(
            "lan-test",
            &serde_json::to_vec(&hello).unwrap(),
            &token,
            "192.168.1.50",
        )
        .unwrap();
        assert_eq!(device.peer_ip.as_deref(), Some("192.168.1.50"));
        assert!(matches!(auth, LanHelloAuth::Token));
    }

    fn approval_hello(nonce: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping"],
            "nonce": nonce,
        }))
        .unwrap()
    }

    #[test]
    fn a_token_less_hello_asks_for_approval_instead_of_being_rejected() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let nonce = "0123456789abcdef";
        let (device, auth) =
            parse_lan_hello("lan-test", &approval_hello(nonce), &token, "192.168.1.50").unwrap();

        assert_eq!(device.peer_ip.as_deref(), Some("192.168.1.50"));
        match auth {
            LanHelloAuth::NeedsApproval { code } => {
                // Both sides derive the digits from the nonce alone, so the code the
                // desktop shows has to match what the phone computes for itself.
                assert_eq!(code, approval_code(nonce));
                assert_eq!(code.len(), 6);
                assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
            }
            LanHelloAuth::Token => panic!("a hello with no token must require approval"),
        }
    }

    #[test]
    fn a_wrong_token_is_still_rejected_outright() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Companion",
            "package": EXPECTED_PACKAGE,
            "version": "1.0.0",
            "capabilities": ["ping"],
            "token": "cd".repeat(LAN_TOKEN_BYTES),
            "nonce": "0123456789abcdef",
        });
        let error = parse_lan_hello(
            "lan-test",
            &serde_json::to_vec(&hello).unwrap(),
            &token,
            "192.168.1.50",
        )
        .expect_err("a presented-but-wrong token must not fall back to approval");
        assert_eq!(error.kind, CompanionErrorKind::Permission);
    }

    #[test]
    fn a_token_less_hello_without_a_usable_nonce_is_rejected() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        for nonce in ["", "short", "zzzzzzzzzzzzzzzz", &"a".repeat(65)] {
            let error = parse_lan_hello("lan-test", &approval_hello(nonce), &token, "192.168.1.50")
                .expect_err("nonce should be rejected");
            assert_eq!(error.kind, CompanionErrorKind::Permission);
        }
    }

    #[test]
    fn tunnel_and_virtual_interfaces_never_become_pairing_hosts() {
        for name in [
            "utun40",
            "tun0",
            "ppp0",
            "awdl0",
            "bridge100",
            "vmnet8",
            "docker0",
            "wg0",
            "Tailscale Tunnel",
            "Hyper-V Virtual Adapter",
            "Corporate VPN",
        ] {
            assert!(!is_lan_interface_name(name), "{name} must be skipped");
        }
        for name in ["en0", "en1", "eth0", "wlan0", "Wi-Fi", "Ethernet"] {
            assert!(is_lan_interface_name(name), "{name} must be usable");
        }
    }

    #[test]
    fn candidate_hosts_are_lan_addresses_without_duplicates() {
        let hosts = lan_host_candidates();
        let mut seen = HashSet::new();
        for host in &hosts {
            assert!(
                is_allowed_lan_address(IpAddr::V4(*host)),
                "{host} is not a private-network address"
            );
            assert!(!host.is_loopback(), "{host} is a loopback address");
            assert!(seen.insert(*host), "{host} appears twice");
        }
    }

    #[test]
    fn discovery_prefers_the_address_on_the_asking_phones_subnet() {
        let hosts = [
            Ipv4Addr::new(10, 0, 0, 5),
            Ipv4Addr::new(192, 168, 1, 43),
            Ipv4Addr::new(172, 16, 9, 9),
        ];
        let ordered = order_hosts_for_peer(&hosts, IpAddr::V4(Ipv4Addr::new(192, 168, 1, 41)));

        assert_eq!(ordered[0], Ipv4Addr::new(192, 168, 1, 43));
        // The rest are kept as fallbacks rather than dropped: a /24 guess can be
        // wrong on a network with a wider prefix.
        assert_eq!(ordered.len(), hosts.len());
    }

    #[test]
    fn discovery_answers_a_valid_probe_and_ignores_foreign_traffic() {
        let responder = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        responder
            .set_read_timeout(Some(DISCOVERY_POLL_TIMEOUT))
            .unwrap();
        let responder_address = responder.local_addr().unwrap();
        let epoch = Arc::new(AtomicU64::new(7));
        let cancellation = CancellationToken {
            epoch: epoch.clone(),
            expected: 7,
        };
        let responder_epoch = epoch.clone();
        let worker = thread::spawn(move || {
            run_discovery_responder(
                responder,
                44_100,
                vec![Ipv4Addr::new(192, 168, 1, 43)],
                Some("studio-1".to_string()),
                Some("Desk".to_string()),
                7,
                responder_epoch,
                cancellation,
            );
        });

        let probe = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        probe
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();

        // Traffic that is not a discovery probe must not draw a reply at all.
        probe.send_to(b"not json", responder_address).unwrap();
        probe
            .send_to(
                json!({ "magic": "someone-else", "type": "discover" })
                    .to_string()
                    .as_bytes(),
                responder_address,
            )
            .unwrap();
        probe
            .send_to(
                json!({ "magic": DISCOVERY_MAGIC, "type": "discover" })
                    .to_string()
                    .as_bytes(),
                responder_address,
            )
            .unwrap();

        let mut buffer = [0u8; DISCOVERY_MAX_DATAGRAM_BYTES];
        let (length, _) = probe.recv_from(&mut buffer).expect("a reply is expected");
        let reply: Value = serde_json::from_slice(&buffer[..length]).unwrap();

        assert_eq!(reply["magic"], DISCOVERY_MAGIC);
        assert_eq!(reply["type"], "studio");
        assert_eq!(reply["port"], 44_100);
        assert_eq!(reply["hosts"], json!(["192.168.1.43"]));
        assert_eq!(reply["requiresApproval"], true);
        // Overhearing a reply must not be enough to pair.
        assert!(reply.get("token").is_none());

        epoch.fetch_add(1, Ordering::SeqCst);
        worker.join().unwrap();
    }

    #[test]
    fn percent_encode_query_keeps_unreserved_chars_and_escapes_the_rest() {
        assert_eq!(percent_encode_query("MacBook Pro"), "MacBook%20Pro");
        assert_eq!(percent_encode_query("studio-1_2.3~4"), "studio-1_2.3~4");
        assert_eq!(
            percent_encode_query("โน้ตบุ๊ก"),
            "%E0%B9%82%E0%B8%99%E0%B9%89%E0%B8%95%E0%B8%9A%E0%B8%B8%E0%B9%8A%E0%B8%81"
        );
    }

    #[test]
    fn parses_authenticated_screen_error() {
        let token = "ab".repeat(LAN_TOKEN_BYTES);
        let payload = serde_json::to_vec(&json!({
            "type": "screen_error",
            "protocol": PROTOCOL_VERSION,
            "package": EXPECTED_PACKAGE,
            "token": token,
            "generation": 42,
            "message": "Screen capture permission was denied"
        }))
        .unwrap();

        assert_eq!(
            parse_screen_error(&payload, &"ab".repeat(LAN_TOKEN_BYTES), 42).unwrap(),
            "Screen capture permission was denied"
        );
    }

    #[test]
    fn rejects_screen_error_with_wrong_generation() {
        let token = "cd".repeat(LAN_TOKEN_BYTES);
        let payload = serde_json::to_vec(&json!({
            "type": "screen_error",
            "protocol": PROTOCOL_VERSION,
            "package": EXPECTED_PACKAGE,
            "token": token,
            "generation": 9,
            "message": "capture failed"
        }))
        .unwrap();

        assert_eq!(
            parse_screen_error(&payload, &"cd".repeat(LAN_TOKEN_BYTES), 10)
                .unwrap_err()
                .kind,
            CompanionErrorKind::Permission
        );
    }

    #[test]
    fn rejects_unexpected_companion_package() {
        let hello = json!({
            "type": "hello",
            "protocol": 1,
            "app": "Other",
            "package": "example.other",
            "version": "1",
            "capabilities": ["ping"]
        });
        assert_eq!(
            parse_hello(
                "aoa-test",
                "usb-accessory",
                &serde_json::to_vec(&hello).unwrap(),
            )
            .unwrap_err()
            .kind,
            CompanionErrorKind::Protocol
        );
    }

    #[test]
    fn decodes_success_and_remote_error() {
        let success = json!({
            "type": "response",
            "id": 4,
            "ok": true,
            "result": { "message": "pong" },
            "error": null
        });
        let result = decode_response(&serde_json::to_vec(&success).unwrap(), 4).unwrap();
        assert_eq!(result["message"], "pong");

        let failure = json!({
            "type": "response",
            "id": 4,
            "ok": false,
            "result": null,
            "error": "clipboard unavailable"
        });
        let error = decode_response(&serde_json::to_vec(&failure).unwrap(), 4).unwrap_err();
        assert_eq!(error.kind, CompanionErrorKind::Remote);
        assert!(!error.loses_session());
    }

    #[test]
    fn protocol_errors_lose_the_session() {
        let response = json!({
            "type": "response",
            "id": 5,
            "ok": true,
            "result": null,
            "error": null
        });
        let error = decode_response(&serde_json::to_vec(&response).unwrap(), 4).unwrap_err();
        assert_eq!(error.kind, CompanionErrorKind::Protocol);
        assert!(error.loses_session());
    }

    #[test]
    fn validates_control_methods() {
        assert!(validate_method(
            "control_gesture",
            &json!({ "points": [[0.5, 0.5]], "durationMs": 60 })
        )
        .is_ok());
        assert!(validate_method(
            "control_gesture",
            &json!({ "points": [[0.0, 1.0], [1.0, 0.0]], "durationMs": 300 })
        )
        .is_ok());
        for bad in [
            json!({ "points": [], "durationMs": 60 }),
            json!({ "points": [[1.2, 0.5]], "durationMs": 60 }),
            json!({ "points": [[0.5]], "durationMs": 60 }),
            json!({ "points": [[0.5, 0.5]], "durationMs": 0 }),
            json!({ "points": [[0.5, 0.5]], "durationMs": 20_000 }),
        ] {
            assert!(validate_method("control_gesture", &bad).is_err(), "{bad}");
        }
        assert!(validate_method("control_action", &json!({ "action": "home" })).is_ok());
        assert!(validate_method("control_action", &json!({ "action": "reboot" })).is_err());
        assert!(validate_method("control_text", &json!({ "text": "hello" })).is_ok());
        assert!(validate_method("control_text", &json!({ "text": "" })).is_err());
        assert!(validate_method("control_status", &json!({})).is_ok());
    }

    #[test]
    fn agent_key_prefers_stable_agent_id() {
        let mut device = CompanionDevice {
            id: "lan-1-192.168.1.20".to_string(),
            name: "Pixel".to_string(),
            package_name: EXPECTED_PACKAGE.to_string(),
            app_version: "1".to_string(),
            protocol: 1,
            transport: "lan-tcp".to_string(),
            capabilities: vec![],
            agent_device_id: Some("agent-a".to_string()),
            peer_ip: Some("192.168.1.20".to_string()),
        };
        assert_eq!(agent_key(&device), Some("agent-a"));
        device.agent_device_id = None;
        assert_eq!(agent_key(&device), Some("192.168.1.20"));
    }

    #[test]
    fn trusted_agents_dedupe_newest_first_and_cap() {
        let agent = |id: &str, at: u64| TrustedAgent {
            agent_device_id: id.to_string(),
            name: id.to_uppercase(),
            approved_at: at,
        };
        let mut agents = vec![agent("a", 1), agent("b", 2)];
        upsert_trusted_agent(&mut agents, agent("a", 3));
        assert_eq!(
            agents
                .iter()
                .map(|a| a.agent_device_id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(agents[0].approved_at, 3);
        for i in 0..30 {
            upsert_trusted_agent(&mut agents, agent(&format!("x{i}"), 10 + i));
        }
        assert_eq!(agents.len(), MAX_TRUSTED_AGENTS);
        assert_eq!(agents[0].agent_device_id, "x29");
    }

    #[test]
    fn screen_quality_presets_stay_within_agent_bounds() {
        for preset in [
            None,
            Some("low"),
            Some("balanced"),
            Some("smooth"),
            Some("sharp"),
            Some("x"),
        ] {
            let (size, fps, quality) = screen_quality_params(preset);
            assert!((320..=1920).contains(&size), "{preset:?}");
            assert!((1..=30).contains(&fps), "{preset:?}");
            assert!((35..=85).contains(&quality), "{preset:?}");
        }
        assert_eq!(screen_quality_params(None), (1280, 12, 60));
    }

    #[test]
    fn validates_pinch_strokes_apps_and_blocks_raw_file_methods() {
        assert!(validate_method(
            "control_gesture",
            &json!({ "strokes": [[[0.4, 0.5], [0.2, 0.5]], [[0.6, 0.5], [0.8, 0.5]]], "durationMs": 250 })
        )
        .is_ok());
        assert!(validate_method(
            "control_gesture",
            &json!({ "strokes": [[[0.1, 0.1]], [[0.2, 0.2]], [[0.3, 0.3]]], "durationMs": 250 })
        )
        .is_err());
        assert!(validate_method("control_action", &json!({ "action": "backspace" })).is_ok());
        assert!(validate_method("list_apps", &json!({})).is_ok());
        assert!(validate_method("launch_app", &json!({ "package": "com.android.chrome" })).is_ok());
        assert!(validate_method("launch_app", &json!({ "package": "x; rm" })).is_err());
        assert!(validate_method("file_begin", &json!({ "name": "a", "size": 1 })).is_err());
    }
}
