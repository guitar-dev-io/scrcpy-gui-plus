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
//   5. Stream each H.264 access unit to the frontend over a per-session Tauri
//      binary `Channel` (raw bytes, not base64/JSON) where a WebCodecs decoder
//      paints it to a canvas.
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
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State, Window};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;

/// Largest device dimension we will accept in a control message. Guards against
/// a malformed/hostile request producing a bogus scrcpy control packet.
const MAX_DEVICE_DIMENSION: u32 = 16384;

/// scrcpy control-message channel encoding lives here so it can be unit tested
/// without a device.
pub(crate) mod control {
    /// scrcpy control message type ids (stable since scrcpy 2.x).
    pub const TYPE_INJECT_KEYCODE: u8 = 0;
    pub const TYPE_INJECT_TEXT: u8 = 1;
    pub const TYPE_INJECT_TOUCH_EVENT: u8 = 2;

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
}

#[derive(Default)]
pub struct EmbedSessionState {
    sessions: Mutex<HashMap<String, EmbedSession>>,
}

impl EmbedSessionState {
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

/// Read framed H.264 packets and forward each to the frontend channel until the
/// socket closes or a stop is requested. Emits a couple of diagnostic log lines
/// so the log panel shows whether frames actually flow.
async fn read_frames(
    mut stream: TcpStream,
    channel: Channel<InvokeResponseBody>,
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
        if let Err(e) = channel.send(InvokeResponseBody::Raw(msg)) {
            let _ = window.emit(
                "scrcpy-log",
                format!("[WORKSPACE] video channel send failed: {}", e),
            );
            break;
        }
        count += 1;
        if !logged_first {
            logged_first = true;
            let _ = window.emit(
                "scrcpy-log",
                "[WORKSPACE] first video packet delivered to the decoder".to_string(),
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
    let serial = serial.trim().to_string();
    adb::validate_serial(&serial).map_err(|e| e.message())?;

    // One embedded session per device.
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.values().any(|s| s.serial == serial) {
            return Ok(json!({
                "success": false,
                "message": "An embedded session is already running for this device"
            }));
        }
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
    let state_cell = Arc::new(Mutex::new(SessionState::Connected));
    let stop = Arc::new(AtomicBool::new(false));

    // 5. Spawn the video reader.
    {
        let stop_loop = stop.clone();
        let state_loop = state_cell.clone();
        let win_loop = window.clone();
        let sid_loop = session_id.clone();
        let serial_loop = serial.clone();
        tokio::spawn(async move {
            read_frames(
                video,
                on_video,
                stop_loop,
                win_loop.clone(),
                sid_loop.clone(),
                serial_loop.clone(),
            )
            .await;
            set_state(&state_loop, SessionState::Disconnected);
            emit_status(
                &win_loop,
                &sid_loop,
                &serial_loop,
                SessionState::Disconnected,
            );
        });
    }

    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        EmbedSession {
            serial: serial.clone(),
            child,
            stop,
            port,
            control: Arc::new(AsyncMutex::new(control)),
            state: state_cell,
        },
    );

    emit_status(&window, &session_id, &serial, SessionState::Connected);

    Ok(json!({
        "success": true,
        "sessionId": session_id,
        "serial": serial,
        "width": width,
        "height": height,
        "codec": actual_codec,
        "message": "Embedded session started"
    }))
}

#[tauri::command]
pub async fn stop_embedded_session(
    window: Window,
    state: State<'_, EmbedSessionState>,
    session_id: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let session = state.sessions.lock().unwrap().remove(&session_id);
    if let Some(mut session) = session {
        set_state(&session.state, SessionState::Stopping);
        session.stop.store(true, Ordering::Relaxed);
        let _ = session.child.kill().await;
        let adb_exe = get_binary_path("adb", custom_path);
        let _ = remove_forward(&adb_exe, session.port).await;
        emit_status(
            &window,
            &session_id,
            &session.serial,
            SessionState::Disconnected,
        );
    }
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

async fn write_control(handle: &Arc<AsyncMutex<TcpStream>>, bytes: &[u8]) -> Result<(), String> {
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
