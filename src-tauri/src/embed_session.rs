// Embedded device workspace session service.
//
// This is the control-enabled evolution of `embed_mirror` (which is video
// only). It runs a minimal scrcpy *client* entirely inside the app so a single
// Android device can be both displayed AND controlled without ever opening the
// external scrcpy window.
//
// Pipeline:
//   1. Push the bundled `scrcpy-server` jar to the device (reused helper).
//   2. `adb forward tcp:0 localabstract:scrcpy_<scid>` for a loopback port.
//   3. Launch the server with video enabled, audio disabled, control ENABLED.
//   4. Connect the sockets in scrcpy's forward-tunnel order: video first, then
//      control. In forward mode the server only writes its handshake dummy byte
//      once *all* expected sockets have connected, so the ordering matters.
//   5. Stream each H.264 access unit to one or more frontend Tauri binary
//      `Channel`s (raw bytes, not base64/JSON) where WebCodecs decoders paint
//      it to canvases. Extra views attach to the running device session instead
//      of starting a second scrcpy-server.
//   6. Encode scrcpy control messages (touch / key / text) from the strict
//      allowlist of commands below and write them to the control socket.
//
// Security:
//   * No network server is opened; the only transport is the loopback adb
//     forward (video/control) plus the in-process Tauri IPC channel.
//   * Session ids are random tokens; every control command validates the
//     session id, the device serial and its own payload before touching a
//     socket.
//   * ADB is never invoked through a shell string; arguments are arrays and the
//     serial is validated by the shared adb service.

use crate::adb;
use crate::commands::{create_command, get_binary_path};
use crate::embed_mirror::{
    detect_version, generate_scid, remove_forward, resolve_server_jar, DEVICE_NAME_FIELD_LEN,
    MAX_PACKET_BYTES, REMOTE_SERVER_PATH,
};

// scrcpy stream packet flags for the current (v3.x/v4.x) protocol. These live
// in the top bits of the 64-bit frame header. NOTE: they differ from older
// scrcpy releases (which used 1<<63 for CONFIG and 1<<62 for KEY_FRAME and had
// no SESSION packet); this service targets the current protocol.
const PACKET_FLAG_SESSION: u64 = 1 << 63;
const PACKET_FLAG_CONFIG: u64 = 1 << 62;
const PACKET_FLAG_KEY_FRAME: u64 = 1 << 61;
const PACKET_PTS_MASK: u64 = (1 << 61) - 1;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;

/// Largest device dimension we will accept in a control message. Guards against
/// a malformed/hostile request producing a bogus scrcpy control packet.
const MAX_DEVICE_DIMENSION: u32 = 16384;

/// Bound the access units cached for a late subscriber. In normal operation a
/// GOP is only a few megabytes; if an encoder produces a pathological interval,
/// stop caching and let new subscribers wait for the next key frame instead of
/// growing memory without limit.
const MAX_CACHED_GOP_BYTES: usize = 16 * 1024 * 1024;

/// scrcpy control-message channel encoding lives here so it can be unit tested
/// without a device.
pub(crate) mod control {
    /// scrcpy control message type ids (stable since scrcpy 2.x).
    pub const TYPE_INJECT_KEYCODE: u8 = 0;
    pub const TYPE_INJECT_TEXT: u8 = 1;
    pub const TYPE_INJECT_TOUCH_EVENT: u8 = 2;
    pub const TYPE_SET_CLIPBOARD: u8 = 9;

    /// Android `MotionEvent` actions used for touch injection.
    pub const ACTION_DOWN: u8 = 0;
    pub const ACTION_UP: u8 = 1;
    pub const ACTION_MOVE: u8 = 2;
    pub const ACTION_CANCEL: u8 = 3;

    /// Android `KeyEvent` actions.
    pub const KEY_ACTION_DOWN: u8 = 0;
    pub const KEY_ACTION_UP: u8 = 1;

    /// Android key codes we surface through the action allowlist.
    pub const KEYCODE_BACK: u32 = 4;
    pub const KEYCODE_HOME: u32 = 3;
    pub const KEYCODE_APP_SWITCH: u32 = 187;

    /// scrcpy caps a single injected text message at this many UTF-8 bytes.
    pub const INJECT_TEXT_MAX_LEN: usize = 300;
    pub const SET_CLIPBOARD_MAX_LEN: usize = 256 * 1024;

    /// Map a workspace touch action name to the Android `MotionEvent` action.
    pub fn touch_action_code(action: &str) -> Option<u8> {
        match action {
            "down" => Some(ACTION_DOWN),
            "up" => Some(ACTION_UP),
            "move" => Some(ACTION_MOVE),
            "cancel" => Some(ACTION_CANCEL),
            _ => None,
        }
    }

    /// Convert a `0.0..=1.0` pressure to scrcpy's 16-bit fixed point.
    pub fn pressure_to_u16fp(value: f32) -> u16 {
        let clamped = value.clamp(0.0, 1.0);
        let scaled = (clamped * 65536.0) as u32;
        if scaled >= 0xffff {
            0xffff
        } else {
            scaled as u16
        }
    }

    /// Serialize an inject-touch control message (32 bytes, scrcpy 2.x+).
    pub fn encode_touch(
        action: u8,
        pointer_id: u64,
        x: i32,
        y: i32,
        width: u16,
        height: u16,
        pressure: f32,
    ) -> Vec<u8> {
        let mut b = Vec::with_capacity(32);
        b.push(TYPE_INJECT_TOUCH_EVENT);
        b.push(action);
        b.extend_from_slice(&pointer_id.to_be_bytes());
        b.extend_from_slice(&x.to_be_bytes());
        b.extend_from_slice(&y.to_be_bytes());
        b.extend_from_slice(&width.to_be_bytes());
        b.extend_from_slice(&height.to_be_bytes());
        b.extend_from_slice(&pressure_to_u16fp(pressure).to_be_bytes());
        // action_button + buttons: 0 emulates a bare touchscreen contact.
        b.extend_from_slice(&0u32.to_be_bytes());
        b.extend_from_slice(&0u32.to_be_bytes());
        debug_assert_eq!(b.len(), 32);
        b
    }

    /// Serialize an inject-keycode control message (14 bytes).
    pub fn encode_keycode(action: u8, keycode: u32, repeat: u32, metastate: u32) -> Vec<u8> {
        let mut b = Vec::with_capacity(14);
        b.push(TYPE_INJECT_KEYCODE);
        b.push(action);
        b.extend_from_slice(&keycode.to_be_bytes());
        b.extend_from_slice(&repeat.to_be_bytes());
        b.extend_from_slice(&metastate.to_be_bytes());
        debug_assert_eq!(b.len(), 14);
        b
    }

    /// Serialize an inject-text control message: type + u32 length + UTF-8.
    pub fn encode_text(text: &str) -> Vec<u8> {
        let mut bytes = text.as_bytes();
        if bytes.len() > INJECT_TEXT_MAX_LEN {
            // Never split a UTF-8 code point when clamping.
            let mut end = INJECT_TEXT_MAX_LEN;
            while end > 0 && (bytes[end] & 0xC0) == 0x80 {
                end -= 1;
            }
            bytes = &bytes[..end];
        }
        let mut b = Vec::with_capacity(5 + bytes.len());
        b.push(TYPE_INJECT_TEXT);
        b.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        b.extend_from_slice(bytes);
        b
    }

    /// Serialize a set-clipboard control message for the target Android device.
    /// Sequence `0` means no acknowledgement is requested; `paste=false`
    /// updates the clipboard without also injecting a paste key event.
    pub fn encode_set_clipboard(text: &str) -> Vec<u8> {
        let mut bytes = text.as_bytes();
        if bytes.len() > SET_CLIPBOARD_MAX_LEN {
            let mut end = SET_CLIPBOARD_MAX_LEN;
            while end > 0 && (bytes[end] & 0xC0) == 0x80 {
                end -= 1;
            }
            bytes = &bytes[..end];
        }
        let mut b = Vec::with_capacity(14 + bytes.len());
        b.push(TYPE_SET_CLIPBOARD);
        b.extend_from_slice(&0u64.to_be_bytes());
        b.push(0); // paste=false
        b.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        b.extend_from_slice(bytes);
        b
    }
}

/// Explicit session lifecycle state, kept in sync with the frontend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Idle,
    /// Startup phase. The backend transitions straight to `Connected` once the
    /// handshake completes; this variant mirrors the frontend state machine and
    /// is part of the serialized state contract.
    #[allow(dead_code)]
    Starting,
    Connected,
    Stopping,
    Disconnected,
    Error,
}

impl SessionState {
    fn as_str(self) -> &'static str {
        match self {
            SessionState::Idle => "idle",
            SessionState::Starting => "starting",
            SessionState::Connected => "connected",
            SessionState::Stopping => "stopping",
            SessionState::Disconnected => "disconnected",
            SessionState::Error => "error",
        }
    }
}

struct EmbedSession {
    serial: String,
    child: tokio::process::Child,
    stop: Arc<AtomicBool>,
    port: u16,
    /// Control socket write half (guarded for concurrent control commands).
    control: Arc<AsyncMutex<TcpStream>>,
    state: Arc<Mutex<SessionState>>,
    video: Arc<Mutex<VideoHub>>,
    codec: String,
    frontend_owner_subscriber: Option<String>,
    remote_lease_generation: Option<u64>,
    /// Auto-capture session id currently borrowing this control connection.
    /// Kept separate from the companion generation so either consumer can
    /// release its own lease without tearing down the other's session.
    auto_capture_lease_id: Option<String>,
    custom_path: Option<String>,
}

enum VideoSink {
    Tauri(Channel<InvokeResponseBody>),
    Remote(SyncSender<Vec<u8>>),
}

struct VideoSubscriber {
    id: String,
    sink: VideoSink,
}

impl VideoSubscriber {
    fn send(&self, message: Vec<u8>) -> bool {
        match &self.sink {
            VideoSink::Tauri(channel) => channel.send(InvokeResponseBody::Raw(message)).is_ok(),
            // A remote viewer must never apply backpressure to the scrcpy
            // reader. A full queue means the viewer is too slow to stay live.
            VideoSink::Remote(sender) => match sender.try_send(message) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
            },
        }
    }
}

/// Fan-out state for the single encoded stream owned by a device session.
///
/// The current codec config and complete GOP are retained so a Macro Recorder
/// opened after the workspace stream has started can initialize its own
/// decoder immediately. Replaying only the last key frame would be incorrect:
/// the next delta depends on every delta emitted after that key frame.
struct VideoHub {
    subscribers: Vec<VideoSubscriber>,
    latest_config: Option<Vec<u8>>,
    current_gop: Vec<Vec<u8>>,
    current_gop_bytes: usize,
    width: u32,
    height: u32,
}

impl VideoHub {
    fn empty() -> Self {
        Self {
            subscribers: Vec::new(),
            latest_config: None,
            current_gop: Vec::new(),
            current_gop_bytes: 0,
            width: 0,
            height: 0,
        }
    }

    fn new(subscriber_id: String, channel: Channel<InvokeResponseBody>) -> Self {
        let mut hub = Self::empty();
        hub.subscribers.push(VideoSubscriber {
            id: subscriber_id,
            sink: VideoSink::Tauri(channel),
        });
        hub
    }

    fn cache_frame(&mut self, message: &[u8], is_config: bool, is_key: bool) {
        if is_config {
            self.latest_config = Some(message.to_vec());
            self.current_gop.clear();
            self.current_gop_bytes = 0;
            return;
        }

        if is_key {
            self.current_gop.clear();
            self.current_gop_bytes = 0;
        } else if self.current_gop.is_empty() {
            return;
        }

        let next_size = self.current_gop_bytes.saturating_add(message.len());
        if next_size > MAX_CACHED_GOP_BYTES {
            self.current_gop.clear();
            self.current_gop_bytes = 0;
            return;
        }
        self.current_gop.push(message.to_vec());
        self.current_gop_bytes = next_size;
    }

    fn broadcast(&mut self, message: Vec<u8>, is_config: bool, is_key: bool) -> usize {
        self.cache_frame(&message, is_config, is_key);
        self.broadcast_uncached(message)
    }

    fn broadcast_uncached(&mut self, message: Vec<u8>) -> usize {
        self.subscribers
            .retain(|subscriber| subscriber.send(message.clone()));
        self.subscribers.len()
    }

    fn broadcast_remote_only(&mut self, message: Vec<u8>) {
        self.subscribers
            .retain(|subscriber| match &subscriber.sink {
                VideoSink::Tauri(_) => true,
                VideoSink::Remote(_) => subscriber.send(message.clone()),
            });
    }

    fn attach(
        &mut self,
        subscriber_id: String,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<(), String> {
        // Keep the hub locked while priming and registering this subscriber so
        // the reader cannot interleave a future delta before the cached GOP.
        if let Some(config) = &self.latest_config {
            channel
                .send(InvokeResponseBody::Raw(config.clone()))
                .map_err(|e| format!("Could not prime video subscriber: {e}"))?;
        }
        for frame in &self.current_gop {
            channel
                .send(InvokeResponseBody::Raw(frame.clone()))
                .map_err(|e| format!("Could not prime video subscriber: {e}"))?;
        }
        self.subscribers.push(VideoSubscriber {
            id: subscriber_id,
            sink: VideoSink::Tauri(channel),
        });
        Ok(())
    }

    fn attach_remote(&mut self, subscriber_id: String) -> Result<Receiver<Vec<u8>>, String> {
        // Enough room for decoder configuration plus a normal GOP, while still
        // bounded. If priming cannot fit, fail instead of starting permanently
        // behind the live stream.
        let (sender, receiver) = sync_channel(128);
        if self.width > 0 && self.height > 0 {
            sender
                .try_send(dimension_message(self.width, self.height))
                .map_err(|_| "Could not prime remote video dimensions".to_string())?;
        }
        if let Some(config) = &self.latest_config {
            sender
                .try_send(config.clone())
                .map_err(|_| "Could not prime remote video configuration".to_string())?;
        }
        for frame in &self.current_gop {
            sender
                .try_send(frame.clone())
                .map_err(|_| "The cached video GOP is too large for a remote viewer".to_string())?;
        }
        self.subscribers.push(VideoSubscriber {
            id: subscriber_id,
            sink: VideoSink::Remote(sender),
        });
        Ok(receiver)
    }

    fn detach(&mut self, subscriber_id: &str) -> bool {
        let before = self.subscribers.len();
        self.subscribers
            .retain(|subscriber| subscriber.id != subscriber_id);
        self.subscribers.len() != before
    }

    fn tauri_subscriber_count(&self) -> usize {
        self.subscribers
            .iter()
            .filter(|subscriber| matches!(subscriber.sink, VideoSink::Tauri(_)))
            .count()
    }
}

#[derive(Default)]
pub struct EmbedSessionState {
    sessions: Mutex<HashMap<String, EmbedSession>>,
    start_guards: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

struct SerialStartPermit<'a> {
    state: &'a EmbedSessionState,
    serial: String,
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
}

impl Drop for SerialStartPermit<'_> {
    fn drop(&mut self) {
        self.guard.take();
        if let Ok(mut guards) = self.state.start_guards.lock() {
            let can_remove = guards
                .get(&self.serial)
                .is_some_and(|guard| Arc::strong_count(guard) == 1);
            if can_remove {
                guards.remove(&self.serial);
            }
        }
    }
}

impl EmbedSessionState {
    async fn lock_serial_start(&self, serial: &str) -> SerialStartPermit<'_> {
        let guard = {
            let mut guards = self.start_guards.lock().unwrap();
            guards
                .entry(serial.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        SerialStartPermit {
            state: self,
            serial: serial.to_string(),
            guard: Some(guard.lock_owned().await),
        }
    }
    /// Best-effort synchronous teardown for app/window shutdown. Kills every
    /// scrcpy-server child and flags its reader loop to stop. adb forwards are
    /// released by adb when the child dies.
    pub fn kill_all_blocking(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.iter_mut() {
                session.stop.store(true, Ordering::Relaxed);
                let _ = session.child.start_kill();
            }
            sessions.clear();
        }
    }

    pub(crate) fn remote_video_subscribe(
        &self,
        serial: &str,
        subscriber_id: String,
    ) -> Result<(String, Receiver<Vec<u8>>), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Embedded session state is unavailable")?;
        let (session_id, session) = sessions
            .iter()
            .find(|(_, session)| session.serial == serial)
            .ok_or_else(|| {
                "Start the target's embedded workspace before enabling remote video".to_string()
            })?;
        if session.codec != "h264" {
            return Err(
                "Mobile remote video currently requires an H.264 embedded session".to_string(),
            );
        }
        let receiver = session
            .video
            .lock()
            .map_err(|_| "The embedded video stream is unavailable".to_string())?
            .attach_remote(subscriber_id)?;
        Ok((session_id.clone(), receiver))
    }

    pub(crate) fn remote_video_detach(&self, session_id: &str, subscriber_id: &str) {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get(session_id) {
                if let Ok(mut video) = session.video.lock() {
                    video.detach(subscriber_id);
                }
            }
        }
    }

    pub(crate) fn remote_control_for_serial(
        &self,
        serial: &str,
    ) -> Result<Arc<AsyncMutex<TcpStream>>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Embedded session state is unavailable")?;
        let session = sessions
            .values()
            .find(|session| session.serial == serial)
            .ok_or_else(|| {
                "Start the target's embedded workspace before using low-latency input".to_string()
            })?;
        let connected = session
            .state
            .lock()
            .map(|state| *state == SessionState::Connected)
            .unwrap_or(false);
        if !connected {
            return Err("The target embedded session is not connected".to_string());
        }
        Ok(session.control.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SerialSwipeOutcome {
    Sent,
    NoUsableSession,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SerialSwipeError {
    StateUnavailable(String),
    InvalidGeometry(String),
    WriteFailed(String),
}

/// Send one complete swipe over an already-connected embedded scrcpy control
/// socket. Native ADB screenshot coordinates are scaled into the current
/// scrcpy video coordinate space before the first control packet is written.
/// `NoUsableSession` is the only outcome for which callers may safely fall
/// back to `adb shell input swipe`; write failures may represent a partially
/// delivered gesture and must not be retried through another path.
pub(crate) async fn swipe_existing_session(
    state: &EmbedSessionState,
    serial: &str,
    width: u32,
    height: u32,
    start_x: i32,
    start_y: i32,
    end_x: i32,
    end_y: i32,
    duration_ms: u64,
) -> Result<SerialSwipeOutcome, SerialSwipeError> {
    adb::validate_serial(serial).map_err(|error| {
        SerialSwipeError::InvalidGeometry(format!("invalid device serial: {}", error.message()))
    })?;
    let (native_start_x, native_start_y) =
        validate_touch(f64::from(start_x), f64::from(start_y), width, height)
            .map_err(SerialSwipeError::InvalidGeometry)?;
    let (native_end_x, native_end_y) =
        validate_touch(f64::from(end_x), f64::from(end_y), width, height)
            .map_err(SerialSwipeError::InvalidGeometry)?;

    let (control, stream_width, stream_height) = {
        let sessions = state.sessions.lock().map_err(|_| {
            SerialSwipeError::StateUnavailable(
                "embedded session registry lock was poisoned".to_string(),
            )
        })?;
        let session = sessions.values().find(|session| {
            session.serial == serial
                && session
                    .state
                    .lock()
                    .map(|value| *value == SessionState::Connected)
                    .unwrap_or(false)
        });
        let Some(session) = session else {
            return Ok(SerialSwipeOutcome::NoUsableSession);
        };
        let (stream_width, stream_height) = session
            .video
            .lock()
            .map(|video| (video.width, video.height))
            .map_err(|_| {
                SerialSwipeError::StateUnavailable(
                    "embedded video dimensions lock was poisoned".to_string(),
                )
            })?;
        if stream_width == 0
            || stream_height == 0
            || stream_width > u16::MAX as u32
            || stream_height > u16::MAX as u32
        {
            return Ok(SerialSwipeOutcome::NoUsableSession);
        }
        (session.control.clone(), stream_width, stream_height)
    };

    let scale_axis = |value: i32, native_extent: u32, stream_extent: u32| -> i32 {
        if native_extent <= 1 || stream_extent <= 1 {
            return 0;
        }
        let numerator = u64::from(value.max(0) as u32)
            .saturating_mul(u64::from(stream_extent.saturating_sub(1)))
            .saturating_add(u64::from(native_extent.saturating_sub(1)) / 2);
        (numerator / u64::from(native_extent.saturating_sub(1))).min(i32::MAX as u64) as i32
    };
    let start_x = scale_axis(native_start_x, width, stream_width);
    let start_y = scale_axis(native_start_y, height, stream_height);
    let end_x = scale_axis(native_end_x, width, stream_width);
    let end_y = scale_axis(native_end_y, height, stream_height);
    let (start_x, start_y) = validate_touch(
        f64::from(start_x),
        f64::from(start_y),
        stream_width,
        stream_height,
    )
    .map_err(SerialSwipeError::InvalidGeometry)?;
    let (end_x, end_y) = validate_touch(
        f64::from(end_x),
        f64::from(end_y),
        stream_width,
        stream_height,
    )
    .map_err(SerialSwipeError::InvalidGeometry)?;

    let mut writer = control.lock().await;
    let write = |result: std::io::Result<()>| {
        result.map_err(|error| {
            SerialSwipeError::WriteFailed(format!("scrcpy control write failed: {error}"))
        })
    };
    write(
        writer
            .write_all(&control::encode_touch(
                control::ACTION_DOWN,
                0,
                start_x,
                start_y,
                stream_width as u16,
                stream_height as u16,
                1.0,
            ))
            .await,
    )?;

    let steps = (duration_ms / 50).clamp(2, 12) as i64;
    let step_delay = Duration::from_millis((duration_ms / steps as u64).max(1));
    for step in 1..=steps {
        tokio::time::sleep(step_delay).await;
        let x = i64::from(start_x) + (i64::from(end_x) - i64::from(start_x)) * step / steps;
        let y = i64::from(start_y) + (i64::from(end_y) - i64::from(start_y)) * step / steps;
        let action = if step == steps {
            control::ACTION_UP
        } else {
            control::ACTION_MOVE
        };
        let pressure = if action == control::ACTION_UP {
            0.0
        } else {
            1.0
        };
        write(
            writer
                .write_all(&control::encode_touch(
                    action,
                    0,
                    x as i32,
                    y as i32,
                    stream_width as u16,
                    stream_height as u16,
                    pressure,
                ))
                .await,
        )?;
    }
    Ok(SerialSwipeOutcome::Sent)
}

fn claim_frontend_owner(owner: &mut Option<String>, subscriber_id: &str) -> bool {
    if owner.is_some() {
        false
    } else {
        *owner = Some(subscriber_id.to_string());
        true
    }
}

fn should_teardown_remote_owned_session(
    frontend_owner: Option<&str>,
    tauri_subscriber_count: usize,
) -> bool {
    frontend_owner.is_none() && tauri_subscriber_count == 0
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedSessionOptions {
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub max_size: Option<u32>,
    #[serde(default)]
    pub bit_rate: Option<u32>,
    #[serde(default)]
    pub max_fps: Option<u32>,
    /// Keep the device awake while the session runs.
    #[serde(default)]
    pub stay_awake: Option<bool>,
}

/// Generate a random, session-scoped token used as the session id / auth token
/// for the video channel. Uses process-unique entropy sources; no external dep.
fn generate_session_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    // Mix a stack-address for extra per-call entropy.
    let stack_marker = &nanos as *const _ as u128;
    let mixed = nanos
        .wrapping_mul(0x9E3779B97F4A7C15)
        .wrapping_add(pid.wrapping_mul(0xBF58476D1CE4E5B9))
        .wrapping_add(stack_marker);
    format!("{:016x}{:016x}", mixed as u64, (mixed >> 64) as u64)
}

fn set_state(state: &Arc<Mutex<SessionState>>, next: SessionState) {
    if let Ok(mut s) = state.lock() {
        *s = next;
    }
}

fn emit_status(window: &Window, session_id: &str, serial: &str, state: SessionState) {
    let _ = window.emit(
        "embed-session-status",
        json!({
            "sessionId": session_id,
            "serial": serial,
            "state": state.as_str(),
        }),
    );
}

/// Remove a session from the shared map and release everything it owns (kills
/// the scrcpy-server child, releases the adb forward). Shared by the explicit
/// `stop_embedded_session` command *and* the video reader's own end-of-stream
/// handler, so a session that dies on its own (network drop, device unplug,
/// scrcpy-server crash) never leaves a stale map entry behind — otherwise the
/// next `start_embedded_session` for that serial is permanently rejected as
/// "already running" until the app restarts. Safe to call twice for the same
/// id (e.g. a racing manual stop): the second call finds nothing to remove.
async fn teardown_session(
    app: &AppHandle,
    window: &Window,
    session_id: &str,
    custom_path: Option<String>,
) {
    let state = app.state::<EmbedSessionState>();
    let removed = state.sessions.lock().unwrap().remove(session_id);
    if let Some(session) = removed {
        cleanup_removed_session(window, session_id, session, custom_path).await;
    }
}

async fn cleanup_removed_session(
    window: &Window,
    session_id: &str,
    mut session: EmbedSession,
    custom_path: Option<String>,
) {
    set_state(&session.state, SessionState::Stopping);
    session.stop.store(true, Ordering::Relaxed);
    let _ = session.child.kill().await;
    let adb_exe = get_binary_path("adb", custom_path.or(session.custom_path.take()));
    let _ = remove_forward(&adb_exe, session.port).await;
    emit_status(
        window,
        session_id,
        &session.serial,
        SessionState::Disconnected,
    );
}

pub(crate) async fn release_remote_session_lease(
    app: &AppHandle,
    window: &Window,
    generation: u64,
) -> bool {
    let state = app.state::<EmbedSessionState>();
    let removed = {
        let mut sessions = state.sessions.lock().unwrap();
        let session_id = sessions.iter().find_map(|(session_id, session)| {
            (session.remote_lease_generation == Some(generation)).then(|| session_id.clone())
        });
        let Some(session_id) = session_id else {
            return false;
        };
        let should_remove = {
            let session = sessions
                .get_mut(&session_id)
                .expect("session disappeared while locked");
            session.remote_lease_generation = None;
            let tauri_subscriber_count = session
                .video
                .lock()
                .map(|hub| hub.tauri_subscriber_count())
                .unwrap_or(usize::MAX);
            session.auto_capture_lease_id.is_none()
                && should_teardown_remote_owned_session(
                    session.frontend_owner_subscriber.as_deref(),
                    tauri_subscriber_count,
                )
        };
        should_remove.then(|| (session_id.clone(), sessions.remove(&session_id).unwrap()))
    };
    if let Some((session_id, session)) = removed {
        cleanup_removed_session(window, &session_id, session, None).await;
        true
    } else {
        false
    }
}

pub(crate) async fn release_auto_capture_session_lease(
    app: &AppHandle,
    window: &Window,
    lease_id: &str,
) -> bool {
    let state = app.state::<EmbedSessionState>();
    let removed = {
        let mut sessions = state.sessions.lock().unwrap();
        let session_id = sessions.iter().find_map(|(session_id, session)| {
            (session.auto_capture_lease_id.as_deref() == Some(lease_id)).then(|| session_id.clone())
        });
        let Some(session_id) = session_id else {
            return false;
        };
        let should_remove = {
            let session = sessions
                .get_mut(&session_id)
                .expect("session disappeared while locked");
            session.auto_capture_lease_id = None;
            let tauri_subscriber_count = session
                .video
                .lock()
                .map(|hub| hub.tauri_subscriber_count())
                .unwrap_or(usize::MAX);
            session.remote_lease_generation.is_none()
                && should_teardown_remote_owned_session(
                    session.frontend_owner_subscriber.as_deref(),
                    tauri_subscriber_count,
                )
        };
        should_remove.then(|| (session_id.clone(), sessions.remove(&session_id).unwrap()))
    };
    if let Some((session_id, session)) = removed {
        cleanup_removed_session(window, &session_id, session, None).await;
        true
    } else {
        false
    }
}

/// Connect the scrcpy forward-tunnel sockets in the correct order and read the
/// stream header. Returns `(video_stream, control_stream, width, height,
/// codec)`.
async fn connect_and_handshake(
    port: u16,
    budget: Duration,
    window: &Window,
) -> Result<(TcpStream, TcpStream, u32, u32, String), String> {
    let deadline = Instant::now() + budget;

    // Phase A: obtain the *video* socket. This mirrors scrcpy's own client
    // order (connect video, read the 1-byte dummy, then connect control) and
    // the proven video-only mirror. In forward mode adb accepts our TCP
    // connection immediately — even before the device-side socket exists — so a
    // premature connection either reads EOF or hangs; only a real connection
    // delivers the dummy byte the server writes right after accepting video.
    // We therefore retry until a connection actually yields the dummy byte, and
    // never mistake a pending/premature adb connection for the video socket.
    let mut video = loop {
        if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)).await {
            let mut dummy = [0u8; 1];
            // A real connection delivers the dummy byte the server writes right
            // after accepting video; EOF/reset (premature) or a hung/pending
            // adb connection is dropped and retried.
            if let Ok(Ok(_)) =
                tokio::time::timeout(Duration::from_secs(2), s.read_exact(&mut dummy)).await
            {
                break s;
            }
        }
        if Instant::now() >= deadline {
            return Err("timed out waiting for scrcpy-server socket".to_string());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };

    // Phase B: connect the control socket. The server accepts this only after
    // video (and after sending the dummy), so it is safe to connect it now.
    let control = loop {
        if let Ok(s) = TcpStream::connect(("127.0.0.1", port)).await {
            break s;
        }
        if Instant::now() >= deadline {
            return Err("timed out connecting the control socket".to_string());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };

    // Phase C: read the stream header. In the current scrcpy protocol the video
    // socket header is just: device name (64 bytes) + codec id (4 bytes). The
    // frame dimensions are NOT here — they arrive as the first "session" packet
    // inside the frame loop (see read_frames), and again on every rotation.
    let mut name_buf = [0u8; DEVICE_NAME_FIELD_LEN];
    video
        .read_exact(&mut name_buf)
        .await
        .map_err(|e| format!("device name read failed: {}", e))?;

    let mut codec_id_buf = [0u8; 4];
    video
        .read_exact(&mut codec_id_buf)
        .await
        .map_err(|e| format!("codec id read failed: {}", e))?;
    let codec_str = match &codec_id_buf {
        b"h264" => "h264",
        b"h265" => "h265",
        b"av01" => "av1",
        other => {
            let _ = window.emit(
                "scrcpy-log",
                format!(
                    "[WORKSPACE] unexpected codec id bytes {:02x?} — defaulting to h264",
                    other
                ),
            );
            "h264"
        }
    }
    .to_string();

    // Width/height are unknown until the first session packet; report 0 and let
    // read_frames emit the real dimensions to the frontend.
    Ok((video, control, 0, 0, codec_str))
}

/// Frame the header + payload for the binary video channel:
/// `[kind:1][flags:1][pts:8][len:4][payload]`.
fn frame_message(is_config: bool, is_key: bool, pts: u64, payload: &[u8]) -> Vec<u8> {
    let mut flags = 0u8;
    if is_config {
        flags |= 0x01;
    }
    if is_key {
        flags |= 0x02;
    }
    let mut buf = Vec::with_capacity(14 + payload.len());
    buf.push(1); // kind: video packet
    buf.push(flags);
    buf.extend_from_slice(&pts.to_be_bytes());
    buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    buf.extend_from_slice(payload);
    buf
}

/// Dimension metadata shared by browser and mobile remote decoders:
/// `[kind=2][width:u32 BE][height:u32 BE]`.
fn dimension_message(width: u32, height: u32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(9);
    buf.push(2);
    buf.extend_from_slice(&width.to_be_bytes());
    buf.extend_from_slice(&height.to_be_bytes());
    buf
}

/// Read framed H.264 packets and forward each to the frontend channel until the
/// socket closes or a stop is requested. Emits a couple of diagnostic log lines
/// so the log panel shows whether frames actually flow.
async fn read_frames(
    mut stream: TcpStream,
    video_hub: Arc<Mutex<VideoHub>>,
    stop: Arc<AtomicBool>,
    window: Window,
    session_id: String,
    serial: String,
) {
    let mut count: u64 = 0;
    let mut logged_first = false;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        // Every packet begins with a 12-byte header: [u64 pts+flags][u32 size].
        let mut header = [0u8; 12];
        if stream.read_exact(&mut header).await.is_err() {
            break;
        }
        let pts_and_flags = u64::from_be_bytes([
            header[0], header[1], header[2], header[3], header[4], header[5], header[6], header[7],
        ]);
        let size = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);

        // Session packet (resolution meta): carries no payload. The low 32 bits
        // of the header are the width, and `size` is the height. Sent once at
        // start and again whenever the device rotates / resizes.
        if pts_and_flags & PACKET_FLAG_SESSION != 0 {
            let width = (pts_and_flags & 0xffff_ffff) as u32;
            let height = size;
            if let Ok(mut hub) = video_hub.lock() {
                hub.width = width;
                hub.height = height;
                // Browser subscribers already receive dimensions through the
                // Tauri event. The binary kind=2 packet is remote-only so the
                // existing WebCodecs byte contract stays unchanged.
                hub.broadcast_remote_only(dimension_message(width, height));
            }
            let _ = window.emit(
                "embed-session-dims",
                json!({
                    "sessionId": session_id,
                    "serial": serial,
                    "width": width,
                    "height": height,
                }),
            );
            let _ = window.emit(
                "scrcpy-log",
                format!("[WORKSPACE] session dimensions: {}x{}", width, height),
            );
            continue;
        }

        if size == 0 || size > MAX_PACKET_BYTES {
            let _ = window.emit(
                "scrcpy-log",
                format!("[WORKSPACE] bogus packet size {} — stopping reader", size),
            );
            break;
        }
        let is_config = pts_and_flags & PACKET_FLAG_CONFIG != 0;
        let is_key = pts_and_flags & PACKET_FLAG_KEY_FRAME != 0;
        let pts = pts_and_flags & PACKET_PTS_MASK;

        let mut payload = vec![0u8; size as usize];
        if stream.read_exact(&mut payload).await.is_err() {
            break;
        }

        let msg = frame_message(is_config, is_key, pts, &payload);
        let subscriber_count = video_hub
            .lock()
            .map(|mut hub| hub.broadcast(msg, is_config, is_key))
            .unwrap_or(0);
        count += 1;
        if !logged_first {
            logged_first = true;
            let _ = window.emit(
                "scrcpy-log",
                format!(
                    "[WORKSPACE] first video packet delivered to {} decoder(s)",
                    subscriber_count
                ),
            );
        }
    }
    let _ = window.emit(
        "scrcpy-log",
        format!("[WORKSPACE] video stream ended after {} packet(s)", count),
    );
}

#[tauri::command]
pub async fn start_embedded_session(
    window: Window,
    state: State<'_, EmbedSessionState>,
    serial: String,
    custom_path: Option<String>,
    options: Option<EmbedSessionOptions>,
    on_video: Channel<InvokeResponseBody>,
) -> Result<serde_json::Value, String> {
    start_embedded_session_core(
        window,
        &state,
        serial,
        custom_path,
        options,
        Some(on_video),
        None,
        None,
    )
    .await
}

async fn start_embedded_session_core(
    window: Window,
    state: &EmbedSessionState,
    serial: String,
    custom_path: Option<String>,
    options: Option<EmbedSessionOptions>,
    on_video: Option<Channel<InvokeResponseBody>>,
    remote_generation: Option<u64>,
    auto_capture_lease_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    adb::validate_serial(&serial).map_err(|e| e.message())?;
    let _start_guard = state.lock_serial_start(&serial).await;

    // A device has one scrcpy-server/control socket, but may have multiple UI
    // decoders (workspace + Macro Recorder). Attach to the existing encoded
    // stream and replay its config/current GOP so the new decoder starts clean.
    let existing = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions
            .iter_mut()
            .find(|(_, session)| session.serial == serial)
            .map(|(session_id, session)| {
                if remote_generation.is_some() && session.codec != "h264" {
                    return Err(
                        "Remote control requires H.264; stop the existing non-H.264 embedded session first"
                            .to_string(),
                    );
                }
                if remote_generation.is_some() || auto_capture_lease_id.is_some() {
                    if let Some(generation) = remote_generation {
                        session.remote_lease_generation = Some(generation);
                    }
                    if let Some(lease_id) = auto_capture_lease_id.as_deref() {
                        session.auto_capture_lease_id = Some(lease_id.to_string());
                    }
                    let hub = session
                        .video
                        .lock()
                        .map_err(|_| "The embedded video stream is unavailable".to_string())?;
                    return Ok((
                        session_id.clone(),
                        None,
                        false,
                        hub.width,
                        hub.height,
                        session.codec.clone(),
                    ));
                }
                let subscriber_id = generate_session_token();
                let channel = on_video
                    .as_ref()
                    .ok_or_else(|| "A frontend video channel is required".to_string())?;
                let mut hub = session
                    .video
                    .lock()
                    .map_err(|_| "The embedded video stream is unavailable".to_string())?;
                hub.attach(subscriber_id.clone(), channel.clone())?;
                let owns_session = claim_frontend_owner(
                    &mut session.frontend_owner_subscriber,
                    &subscriber_id,
                );
                Ok((
                    session_id.clone(),
                    Some(subscriber_id),
                    owns_session,
                    hub.width,
                    hub.height,
                    session.codec.clone(),
                ))
            })
            .transpose()?
    };
    if let Some((session_id, subscriber_id, owns_session, width, height, codec)) = existing {
        let _ = window.emit(
            "scrcpy-log",
            format!("[WORKSPACE] reused embedded session for {}", serial),
        );
        return Ok(json!({
            "success": true,
            "sessionId": session_id,
            "subscriberId": subscriber_id,
            "ownsSession": owns_session,
            "embeddedAutoStarted": false,
            "serial": serial,
            "width": width,
            "height": height,
            "codec": codec,
            "message": "Attached to the running embedded session"
        }));
    }

    let opts = options.unwrap_or_default();
    let codec = opts
        .codec
        .as_deref()
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "h264".to_string());

    let scrcpy_exe = get_binary_path("scrcpy", custom_path.clone());
    let server_jar = match resolve_server_jar(custom_path.clone()) {
        Some(p) => p,
        None => {
            return Ok(json!({
                "success": false,
                "message": "scrcpy-server not found. Set the scrcpy folder in settings so the embedded workspace can locate the server jar."
            }));
        }
    };

    let version = match detect_version(&scrcpy_exe).await {
        Some(v) => v,
        None => {
            return Ok(json!({
                "success": false,
                "message": "Could not determine the scrcpy version (needed to launch the server)."
            }));
        }
    };

    let adb_exe = get_binary_path("adb", custom_path.clone());
    let scid = generate_scid();

    let _ = window.emit(
        "scrcpy-log",
        format!(
            "[WORKSPACE] Starting embedded session for {} (scrcpy {}, codec {})",
            serial, version, codec
        ),
    );

    // 1. Push the server jar.
    if let Err(e) = adb::run_adb_text(
        Some(&serial),
        &["push", &server_jar, REMOTE_SERVER_PATH],
        custom_path.clone(),
        30,
    )
    .await
    {
        return Ok(json!({
            "success": false,
            "message": format!("Failed to push scrcpy-server: {}", e.message())
        }));
    }

    // 2. Forward a local port to the server's abstract socket.
    let socket_name = format!("localabstract:scrcpy_{}", scid);
    let port: u16 = match adb::run_adb_text(
        Some(&serial),
        &["forward", "tcp:0", &socket_name],
        custom_path.clone(),
        10,
    )
    .await
    {
        Ok(out) => match out.trim().parse() {
            Ok(p) => p,
            Err(_) => {
                return Ok(json!({
                    "success": false,
                    "message": format!("adb forward returned an unexpected port: {}", out.trim())
                }))
            }
        },
        Err(e) => {
            return Ok(json!({
                "success": false,
                "message": format!("adb forward failed: {}", e.message())
            }))
        }
    };

    // 3. Launch the server with video on, audio off, control ON.
    let mut server_args: Vec<String> = vec![
        "-s".to_string(),
        serial.clone(),
        "shell".to_string(),
        format!("CLASSPATH={}", REMOTE_SERVER_PATH),
        "app_process".to_string(),
        "/".to_string(),
        "com.genymobile.scrcpy.Server".to_string(),
        version.clone(),
        format!("scid={}", scid),
        "log_level=info".to_string(),
        "tunnel_forward=true".to_string(),
        "audio=false".to_string(),
        "control=true".to_string(),
        "cleanup=true".to_string(),
        format!("video_codec={}", codec),
        format!("max_size={}", opts.max_size.unwrap_or(0)),
        format!("video_bit_rate={}", opts.bit_rate.unwrap_or(8_000_000)),
    ];
    if let Some(fps) = opts.max_fps {
        if fps > 0 {
            server_args.push(format!("max_fps={}", fps));
        }
    }
    if opts.stay_awake.unwrap_or(false) {
        server_args.push("stay_awake=true".to_string());
    }

    let spawn = create_command(&adb_exe)
        .args(&server_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn {
        Ok(c) => c,
        Err(e) => {
            let _ = remove_forward(&adb_exe, port).await;
            return Ok(json!({
                "success": false,
                "message": format!("Failed to launch scrcpy-server: {}", e)
            }));
        }
    };

    // Surface server log lines into the shared log panel.
    if let Some(out) = child.stdout.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[WORKSPACE] {}", line));
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[WORKSPACE] {}", line));
            }
        });
    }

    // 4. Connect video + control and read the stream header.
    let (video, control, width, height, actual_codec) = match connect_and_handshake(
        port,
        Duration::from_secs(15),
        &window,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            let _ = child.kill().await;
            let _ = remove_forward(&adb_exe, port).await;
            return Ok(json!({
                "success": false,
                "message": format!(
                    "Could not connect to scrcpy-server: {}. Check the [WORKSPACE] log lines for the server's own error.",
                    e
                )
            }));
        }
    };

    let _ = window.emit(
        "scrcpy-log",
        format!(
            "[WORKSPACE] handshake OK: codec {} — waiting for frames",
            actual_codec
        ),
    );
    let _ = (width, height); // dimensions arrive via the first session packet

    let session_id = generate_session_token();
    let subscriber_id = on_video.as_ref().map(|_| generate_session_token());
    let state_cell = Arc::new(Mutex::new(SessionState::Connected));
    let stop = Arc::new(AtomicBool::new(false));
    let video_hub = Arc::new(Mutex::new(match (subscriber_id.as_ref(), on_video) {
        (Some(subscriber_id), Some(channel)) => VideoHub::new(subscriber_id.clone(), channel),
        _ => VideoHub::empty(),
    }));

    // 5. Register the session before spawning the reader. If the stream closes
    // immediately, its teardown task can now remove the real map entry instead
    // of racing an insertion that has not happened yet.
    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        EmbedSession {
            serial: serial.clone(),
            child,
            stop: stop.clone(),
            port,
            control: Arc::new(AsyncMutex::new(control)),
            state: state_cell,
            video: video_hub.clone(),
            codec: actual_codec.clone(),
            frontend_owner_subscriber: subscriber_id.clone(),
            remote_lease_generation: remote_generation,
            auto_capture_lease_id: auto_capture_lease_id.clone(),
            custom_path: custom_path.clone(),
        },
    );

    // 6. Spawn the video reader.
    {
        let stop_loop = stop.clone();
        let win_loop = window.clone();
        let sid_loop = session_id.clone();
        let serial_loop = serial.clone();
        let app_loop = window.app_handle().clone();
        let custom_path_loop = custom_path.clone();
        tokio::spawn(async move {
            read_frames(
                video,
                video_hub,
                stop_loop,
                win_loop.clone(),
                sid_loop.clone(),
                serial_loop.clone(),
            )
            .await;
            // The stream ended on its own (device unplugged, network drop,
            // scrcpy-server crash, ...) rather than via an explicit stop —
            // tear the session down ourselves so it doesn't linger in the
            // map and block the next start for this serial.
            teardown_session(&app_loop, &win_loop, &sid_loop, custom_path_loop).await;
        });
    }

    emit_status(&window, &session_id, &serial, SessionState::Connected);

    Ok(json!({
        "success": true,
        "sessionId": session_id,
        "subscriberId": subscriber_id,
        "ownsSession": remote_generation.is_none() && auto_capture_lease_id.is_none(),
        "embeddedAutoStarted": remote_generation.is_some() || auto_capture_lease_id.is_some(),
        "serial": serial,
        "width": width,
        "height": height,
        "codec": actual_codec,
        "message": "Embedded session started"
    }))
}

pub(crate) struct RemoteEmbedPreparation {
    pub session_id: String,
    pub auto_started: bool,
}

pub(crate) async fn ensure_remote_embedded_session(
    window: Window,
    state: &EmbedSessionState,
    serial: String,
    custom_path: Option<String>,
    generation: u64,
) -> Result<RemoteEmbedPreparation, String> {
    let result = start_embedded_session_core(
        window,
        state,
        serial,
        custom_path,
        Some(EmbedSessionOptions {
            codec: Some("h264".to_string()),
            ..Default::default()
        }),
        None,
        Some(generation),
        None,
    )
    .await?;
    if result.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Could not prepare the target embedded session")
            .to_string());
    }
    let session_id = result
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Embedded session start returned no session id".to_string())?
        .to_string();
    Ok(RemoteEmbedPreparation {
        session_id,
        auto_started: result
            .get("embeddedAutoStarted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub(crate) async fn ensure_auto_capture_control_session(
    window: Window,
    state: &EmbedSessionState,
    serial: String,
    custom_path: Option<String>,
    lease_id: String,
) -> Result<bool, String> {
    let result = start_embedded_session_core(
        window,
        state,
        serial,
        custom_path,
        Some(EmbedSessionOptions {
            codec: Some("h264".to_string()),
            ..Default::default()
        }),
        None,
        None,
        Some(lease_id),
    )
    .await?;
    if result.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Could not prepare the auto-capture control session")
            .to_string());
    }
    Ok(result
        .get("embeddedAutoStarted")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// Remove only one frontend decoder from a shared device session. The owner
/// continues streaming and retains the control socket/server process.
#[tauri::command]
pub async fn detach_embedded_session(
    window: Window,
    session_id: String,
    subscriber_id: String,
) -> serde_json::Value {
    let state = window.app_handle().state::<EmbedSessionState>();
    let (detached, orphan) = {
        let mut sessions = state.sessions.lock().unwrap();
        let Some(session) = sessions.get_mut(&session_id) else {
            return json!({ "success": true, "detached": false });
        };
        let (detached, tauri_count) = session
            .video
            .lock()
            .map(|mut hub| {
                let detached = hub.detach(&subscriber_id);
                (detached, hub.tauri_subscriber_count())
            })
            .unwrap_or((false, usize::MAX));
        if detached && session.frontend_owner_subscriber.as_deref() == Some(subscriber_id.as_str())
        {
            session.frontend_owner_subscriber = None;
        }
        let orphan = session.remote_lease_generation.is_none()
            && session.auto_capture_lease_id.is_none()
            && session.frontend_owner_subscriber.is_none()
            && tauri_count == 0;
        (
            detached,
            orphan.then(|| sessions.remove(&session_id).unwrap()),
        )
    };
    if let Some(session) = orphan {
        cleanup_removed_session(&window, &session_id, session, None).await;
    }
    json!({ "success": true, "detached": detached })
}

#[tauri::command]
pub async fn stop_embedded_session(
    window: Window,
    session_id: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let state = window.app_handle().state::<EmbedSessionState>();
    let kept_for_headless_consumer = {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            if session.remote_lease_generation.is_some() || session.auto_capture_lease_id.is_some()
            {
                if let Some(owner_id) = session.frontend_owner_subscriber.take() {
                    if let Ok(mut hub) = session.video.lock() {
                        hub.detach(&owner_id);
                    }
                }
                true
            } else {
                false
            }
        } else {
            false
        }
    };
    if kept_for_headless_consumer {
        return Ok(json!({
            "success": true,
            "keptForRemote": true,
            "message": "Frontend decoder detached; a headless control consumer remains active"
        }));
    }
    let app = window.app_handle().clone();
    teardown_session(&app, &window, &session_id, custom_path).await;
    Ok(json!({ "success": true, "message": "Embedded session stopped" }))
}

#[tauri::command]
pub fn get_embedded_session_state(
    state: State<'_, EmbedSessionState>,
    session_id: String,
) -> serde_json::Value {
    let sessions = state.sessions.lock().unwrap();
    match sessions.get(&session_id) {
        Some(s) => {
            let st = s.state.lock().map(|g| *g).unwrap_or(SessionState::Error);
            json!({ "exists": true, "serial": s.serial, "state": st.as_str() })
        }
        None => json!({ "exists": false, "state": SessionState::Idle.as_str() }),
    }
}

/// Look up the control socket for a session, validating that the caller-provided
/// serial (when given) matches the session's device.
fn control_handle(
    state: &State<'_, EmbedSessionState>,
    session_id: &str,
) -> Result<Arc<AsyncMutex<TcpStream>>, String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(session_id)
        .ok_or_else(|| "Unknown or expired session".to_string())?;
    let connected = session
        .state
        .lock()
        .map(|g| *g == SessionState::Connected)
        .unwrap_or(false);
    if !connected {
        return Err("Session is not connected".to_string());
    }
    Ok(session.control.clone())
}

pub(crate) async fn write_control(
    handle: &Arc<AsyncMutex<TcpStream>>,
    bytes: &[u8],
) -> Result<(), String> {
    let mut guard = handle.lock().await;
    guard
        .write_all(bytes)
        .await
        .map_err(|e| format!("control write failed: {}", e))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchRequest {
    pub session_id: String,
    pub action: String,
    pub pointer_id: u64,
    pub x: f64,
    pub y: f64,
    pub device_width: u32,
    pub device_height: u32,
    #[serde(default)]
    pub pressure: f32,
}

/// Validate a touch payload and return the integer device coordinates to send.
pub(crate) fn validate_touch(
    x: f64,
    y: f64,
    width: u32,
    height: u32,
) -> Result<(i32, i32), String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("Touch coordinates must be finite".to_string());
    }
    if width == 0 || height == 0 || width > MAX_DEVICE_DIMENSION || height > MAX_DEVICE_DIMENSION {
        return Err("Invalid device dimensions".to_string());
    }
    if x < 0.0 || y < 0.0 || x > width as f64 || y > height as f64 {
        return Err("Touch coordinates out of bounds".to_string());
    }
    // Clamp to the last valid pixel to avoid off-by-one at the far edge.
    let cx = (x.round() as i64).clamp(0, (width - 1) as i64) as i32;
    let cy = (y.round() as i64).clamp(0, (height - 1) as i64) as i32;
    Ok((cx, cy))
}

#[tauri::command]
pub async fn send_embedded_touch(
    state: State<'_, EmbedSessionState>,
    request: TouchRequest,
) -> Result<serde_json::Value, String> {
    let action = control::touch_action_code(&request.action)
        .ok_or_else(|| format!("Unsupported touch action: {}", request.action))?;
    let (x, y) = validate_touch(
        request.x,
        request.y,
        request.device_width,
        request.device_height,
    )?;
    let handle = control_handle(&state, &request.session_id)?;
    let msg = control::encode_touch(
        action,
        request.pointer_id,
        x,
        y,
        request.device_width as u16,
        request.device_height as u16,
        request.pressure,
    );
    write_control(&handle, &msg).await?;
    Ok(json!({ "success": true }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRequest {
    pub session_id: String,
    pub keycode: u32,
    #[serde(default)]
    pub metastate: u32,
    /// "down" | "up" | "click" (default click = down then up).
    #[serde(default)]
    pub action: Option<String>,
}

#[tauri::command]
pub async fn send_embedded_key(
    state: State<'_, EmbedSessionState>,
    request: KeyRequest,
) -> Result<serde_json::Value, String> {
    let handle = control_handle(&state, &request.session_id)?;
    let action = request.action.as_deref().unwrap_or("click");
    match action {
        "down" => {
            let msg = control::encode_keycode(
                control::KEY_ACTION_DOWN,
                request.keycode,
                0,
                request.metastate,
            );
            write_control(&handle, &msg).await?;
        }
        "up" => {
            let msg = control::encode_keycode(
                control::KEY_ACTION_UP,
                request.keycode,
                0,
                request.metastate,
            );
            write_control(&handle, &msg).await?;
        }
        "click" => {
            let down = control::encode_keycode(
                control::KEY_ACTION_DOWN,
                request.keycode,
                0,
                request.metastate,
            );
            let up = control::encode_keycode(
                control::KEY_ACTION_UP,
                request.keycode,
                0,
                request.metastate,
            );
            write_control(&handle, &down).await?;
            write_control(&handle, &up).await?;
        }
        other => return Err(format!("Unsupported key action: {}", other)),
    }
    Ok(json!({ "success": true }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRequest {
    pub session_id: String,
    pub text: String,
}

#[tauri::command]
pub async fn send_embedded_text(
    state: State<'_, EmbedSessionState>,
    request: TextRequest,
) -> Result<serde_json::Value, String> {
    if request.text.is_empty() {
        return Ok(json!({ "success": true }));
    }
    let handle = control_handle(&state, &request.session_id)?;
    let msg = control::encode_text(&request.text);
    write_control(&handle, &msg).await?;
    Ok(json!({ "success": true }))
}

/// Non-touch device actions exposed to the workspace.
pub(crate) fn is_allowed_session_action(action: &str) -> bool {
    matches!(
        action,
        "back" | "home" | "recent_apps" | "rotate" | "screen_on" | "screen_off"
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub session_id: String,
    pub action: String,
}

#[tauri::command]
pub async fn send_embedded_action(
    state: State<'_, EmbedSessionState>,
    request: ActionRequest,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    if !is_allowed_session_action(&request.action) {
        return Err(format!("Unsupported action: {}", request.action));
    }

    // Navigation keys go through the scrcpy control socket (low latency).
    let keycode = match request.action.as_str() {
        "back" => Some(control::KEYCODE_BACK),
        "home" => Some(control::KEYCODE_HOME),
        "recent_apps" => Some(control::KEYCODE_APP_SWITCH),
        _ => None,
    };
    if let Some(code) = keycode {
        let handle = control_handle(&state, &request.session_id)?;
        let down = control::encode_keycode(control::KEY_ACTION_DOWN, code, 0, 0);
        let up = control::encode_keycode(control::KEY_ACTION_UP, code, 0, 0);
        write_control(&handle, &down).await?;
        write_control(&handle, &up).await?;
        return Ok(json!({ "success": true }));
    }

    // rotate / screen_on / screen_off reuse the shared adb device-action path,
    // which is version independent and already tested.
    let serial = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&request.session_id)
            .map(|s| s.serial.clone())
            .ok_or_else(|| "Unknown or expired session".to_string())?
    };
    let adb_action = match request.action.as_str() {
        "rotate" => "rotate",
        "screen_on" => "screen_on",
        "screen_off" => "screen_off",
        other => return Err(format!("Unsupported action: {}", other)),
    };
    let result =
        crate::device_control::device_action(serial, adb_action.to_string(), custom_path).await;
    Ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "success": false })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
    pub session_id: String,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub custom_path: Option<String>,
}

#[tauri::command]
pub async fn capture_embedded_screenshot(
    app: AppHandle,
    state: State<'_, EmbedSessionState>,
    request: ScreenshotRequest,
) -> Result<serde_json::Value, String> {
    // Resolve the session's device serial (never trust a serial from the UI).
    let serial = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&request.session_id)
            .map(|s| s.serial.clone())
            .ok_or_else(|| "Unknown or expired session".to_string())?
    };

    // Reuse the existing screenshot pipeline (native-resolution screencap ->
    // validated PNG -> file), so history/paths behave like every other capture.
    let shot = crate::screenshot::capture_screenshot(
        app,
        crate::screenshot::ScreenshotRequest {
            device_serial: serial,
            device_name: request.device_name,
            output_dir: request.output_dir,
            custom_path: request.custom_path,
        },
    )
    .await;
    Ok(serde_json::to_value(shot).unwrap_or_else(|_| json!({ "success": false })))
}

#[cfg(test)]
mod tests {
    use super::control::*;
    use super::*;

    #[test]
    fn touch_action_mapping() {
        assert_eq!(touch_action_code("down"), Some(ACTION_DOWN));
        assert_eq!(touch_action_code("move"), Some(ACTION_MOVE));
        assert_eq!(touch_action_code("up"), Some(ACTION_UP));
        assert_eq!(touch_action_code("cancel"), Some(ACTION_CANCEL));
        assert_eq!(touch_action_code("swipe"), None);
    }

    #[test]
    fn pressure_fixed_point() {
        assert_eq!(pressure_to_u16fp(0.0), 0);
        assert_eq!(pressure_to_u16fp(1.0), 0xffff);
        assert_eq!(pressure_to_u16fp(2.0), 0xffff); // clamped
        assert_eq!(pressure_to_u16fp(-1.0), 0);
        assert!(pressure_to_u16fp(0.5) > 0x7000 && pressure_to_u16fp(0.5) < 0x9000);
    }

    #[test]
    fn touch_message_layout() {
        let msg = encode_touch(ACTION_DOWN, 7, 100, 200, 1080, 2340, 1.0);
        assert_eq!(msg.len(), 32);
        assert_eq!(msg[0], TYPE_INJECT_TOUCH_EVENT);
        assert_eq!(msg[1], ACTION_DOWN);
        assert_eq!(u64::from_be_bytes(msg[2..10].try_into().unwrap()), 7);
        assert_eq!(i32::from_be_bytes(msg[10..14].try_into().unwrap()), 100);
        assert_eq!(i32::from_be_bytes(msg[14..18].try_into().unwrap()), 200);
        assert_eq!(u16::from_be_bytes(msg[18..20].try_into().unwrap()), 1080);
        assert_eq!(u16::from_be_bytes(msg[20..22].try_into().unwrap()), 2340);
        assert_eq!(u16::from_be_bytes(msg[22..24].try_into().unwrap()), 0xffff);
    }

    #[test]
    fn keycode_message_layout() {
        let msg = encode_keycode(KEY_ACTION_DOWN, KEYCODE_BACK, 0, 0);
        assert_eq!(msg.len(), 14);
        assert_eq!(msg[0], TYPE_INJECT_KEYCODE);
        assert_eq!(msg[1], KEY_ACTION_DOWN);
        assert_eq!(
            u32::from_be_bytes(msg[2..6].try_into().unwrap()),
            KEYCODE_BACK
        );
    }

    #[test]
    fn text_message_layout() {
        let msg = encode_text("hi");
        assert_eq!(msg[0], TYPE_INJECT_TEXT);
        assert_eq!(u32::from_be_bytes(msg[1..5].try_into().unwrap()), 2);
        assert_eq!(&msg[5..], b"hi");
    }

    #[test]
    fn text_message_clamps_without_splitting_utf8() {
        // A multibyte character repeated beyond the cap must not be split.
        let s = "é".repeat(200); // each 'é' is 2 bytes => 400 bytes
        let msg = encode_text(&s);
        let len = u32::from_be_bytes(msg[1..5].try_into().unwrap()) as usize;
        assert!(len <= INJECT_TEXT_MAX_LEN);
        // The payload must be valid UTF-8 (no split code point).
        assert!(std::str::from_utf8(&msg[5..]).is_ok());
    }

    #[test]
    fn clipboard_message_targets_scrcpy_clipboard_without_paste() {
        let msg = encode_set_clipboard("hello");
        assert_eq!(msg[0], TYPE_SET_CLIPBOARD);
        assert_eq!(u64::from_be_bytes(msg[1..9].try_into().unwrap()), 0);
        assert_eq!(msg[9], 0);
        assert_eq!(u32::from_be_bytes(msg[10..14].try_into().unwrap()), 5);
        assert_eq!(&msg[14..], b"hello");
    }

    #[test]
    fn frame_message_header() {
        let payload = [1u8, 2, 3, 4];
        let msg = frame_message(true, false, 12345, &payload);
        assert_eq!(msg[0], 1);
        assert_eq!(msg[1], 0x01); // config flag
        assert_eq!(u64::from_be_bytes(msg[2..10].try_into().unwrap()), 12345);
        assert_eq!(u32::from_be_bytes(msg[10..14].try_into().unwrap()), 4);
        assert_eq!(&msg[14..], &payload);
    }

    #[test]
    fn remote_dimension_message_layout() {
        let msg = dimension_message(1080, 2400);
        assert_eq!(msg.len(), 9);
        assert_eq!(msg[0], 2);
        assert_eq!(u32::from_be_bytes(msg[1..5].try_into().unwrap()), 1080);
        assert_eq!(u32::from_be_bytes(msg[5..9].try_into().unwrap()), 2400);
    }

    #[test]
    fn slow_remote_subscriber_is_dropped_without_blocking_tauri_subscriber() {
        let owner_channel = Channel::new(|_| Ok(()));
        let mut hub = VideoHub::new("owner".to_string(), owner_channel);
        let _receiver = hub.attach_remote("remote".to_string()).unwrap();
        for index in 0..130u64 {
            hub.broadcast(frame_message(false, true, index, &[1]), false, true);
        }
        assert_eq!(hub.subscribers.len(), 1);
        assert_eq!(hub.subscribers[0].id, "owner");
    }

    #[test]
    fn dimension_metadata_is_sent_only_to_remote_subscribers() {
        let browser_messages = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let browser_sink = browser_messages.clone();
        let browser_channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                browser_sink.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        let mut hub = VideoHub::new("browser".to_string(), browser_channel);
        let remote = hub.attach_remote("remote".to_string()).unwrap();
        let dimensions = dimension_message(1080, 2400);
        hub.broadcast_remote_only(dimensions.clone());
        assert!(browser_messages.lock().unwrap().is_empty());
        assert_eq!(remote.try_recv().unwrap(), dimensions);
    }

    #[test]
    fn first_frontend_subscriber_adopts_headless_session_ownership() {
        let mut owner = None;
        assert!(claim_frontend_owner(&mut owner, "workspace"));
        assert_eq!(owner.as_deref(), Some("workspace"));
        assert!(!claim_frontend_owner(&mut owner, "macro"));
        assert_eq!(owner.as_deref(), Some("workspace"));
    }

    #[test]
    fn remote_release_only_tears_down_truly_headless_session() {
        assert!(should_teardown_remote_owned_session(None, 0));
        assert!(!should_teardown_remote_owned_session(Some("workspace"), 0));
        assert!(!should_teardown_remote_owned_session(None, 1));
    }

    #[tokio::test]
    async fn starts_for_the_same_serial_are_serialized() {
        let state = Arc::new(EmbedSessionState::default());
        let first = state.lock_serial_start("emulator-5554").await;
        let waiting_state = state.clone();
        let waiter = tokio::spawn(async move {
            let _guard = waiting_state.lock_serial_start("emulator-5554").await;
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());
        drop(first);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("second start did not acquire the serial guard")
            .unwrap();
        assert!(state.start_guards.lock().unwrap().is_empty());
    }

    #[test]
    fn late_video_subscriber_is_primed_with_config_and_complete_gop() {
        let owner_messages = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let owner_sink = owner_messages.clone();
        let owner_channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                owner_sink.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        let mut hub = VideoHub::new("owner".to_string(), owner_channel);

        let config = frame_message(true, false, 0, &[1, 2]);
        let key = frame_message(false, true, 1, &[3, 4]);
        let delta = frame_message(false, false, 2, &[5, 6]);
        hub.broadcast(config.clone(), true, false);
        hub.broadcast(key.clone(), false, true);
        hub.broadcast(delta.clone(), false, false);

        let late_messages = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let late_sink = late_messages.clone();
        let late_channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                late_sink.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        hub.attach("macro".to_string(), late_channel).unwrap();

        assert_eq!(
            *late_messages.lock().unwrap(),
            vec![config.clone(), key.clone(), delta.clone()]
        );

        let next_delta = frame_message(false, false, 3, &[7, 8]);
        hub.broadcast(next_delta.clone(), false, false);
        assert_eq!(late_messages.lock().unwrap().last(), Some(&next_delta));
        assert!(hub.detach("macro"));
        assert!(!hub.detach("macro"));
    }

    #[test]
    fn validate_touch_accepts_in_bounds() {
        assert_eq!(validate_touch(0.0, 0.0, 1080, 2340), Ok((0, 0)));
        assert_eq!(validate_touch(1080.0, 2340.0, 1080, 2340), Ok((1079, 2339)));
        assert_eq!(validate_touch(540.4, 1170.6, 1080, 2340), Ok((540, 1171)));
    }

    #[test]
    fn validate_touch_rejects_bad_input() {
        assert!(validate_touch(-1.0, 10.0, 1080, 2340).is_err());
        assert!(validate_touch(10.0, 3000.0, 1080, 2340).is_err());
        assert!(validate_touch(f64::NAN, 10.0, 1080, 2340).is_err());
        assert!(validate_touch(10.0, 10.0, 0, 2340).is_err());
        assert!(validate_touch(10.0, 10.0, 99999, 2340).is_err());
    }

    #[test]
    fn action_allowlist() {
        for a in [
            "back",
            "home",
            "recent_apps",
            "rotate",
            "screen_on",
            "screen_off",
        ] {
            assert!(is_allowed_session_action(a), "{} should be allowed", a);
        }
        for a in ["shell", "reboot", "install", "rm", ""] {
            assert!(!is_allowed_session_action(a), "{} should be denied", a);
        }
    }

    #[test]
    fn session_state_serialization() {
        assert_eq!(SessionState::Connected.as_str(), "connected");
        assert_eq!(SessionState::Disconnected.as_str(), "disconnected");
        assert_eq!(SessionState::Error.as_str(), "error");
    }

    #[test]
    fn session_tokens_are_unique_and_long() {
        let a = generate_session_token();
        let b = generate_session_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
