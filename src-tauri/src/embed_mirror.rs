// True in-app embedded mirror (Phase 1: video-only).
//
// Unlike the "docking" approach (which launches scrcpy as its own OS window and
// positions it over a placeholder), this module implements a minimal scrcpy
// *client* ourselves so the video can be decoded and painted INSIDE the app
// (via WebCodecs on the frontend), exactly like QtScrcpy.
//
// Pipeline:
//   1. Push the bundled `scrcpy-server` jar to the device.
//   2. `adb forward tcp:0 localabstract:scrcpy_<scid>` to get a local port.
//   3. Launch the server via `app_process` (video only, control off, forward
//      tunnel).
//   4. Connect to the forwarded port and speak the scrcpy stream protocol:
//        [1 dummy byte] [64B device name] [codec meta: id/w/h] then repeated
//        [12B frame header: pts+flags (u64) + size (u32)] [H.264 packet].
//   5. Forward each H.264 packet to the webview as a base64 `embed-video-packet`
//      event; the frontend feeds them to a WebCodecs VideoDecoder and draws to
//      a <canvas>.
//
// Control (touch/keyboard) is intentionally NOT wired yet — that is Phase 2 and
// requires connecting the control socket and encoding control messages.

use crate::adb;
use crate::commands::{create_command, get_binary_path, parse_scrcpy_version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, State, Window};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::TcpStream;

/// Remote path the server jar is pushed to (matches scrcpy's own convention).
pub(crate) const REMOTE_SERVER_PATH: &str = "/data/local/tmp/scrcpy-server-manual.jar";

/// Length of the device-name field the server sends on the first socket.
pub(crate) const DEVICE_NAME_FIELD_LEN: usize = 64;

/// Reject an absurd packet size (corrupt header / desync). 32 MB is far larger
/// than any single H.264 access unit at sane bitrates.
pub(crate) const MAX_PACKET_BYTES: u32 = 32 * 1024 * 1024;

/// Flag bits packed into the top of the 64-bit PTS field of each frame header.
pub(crate) const PACKET_FLAG_CONFIG: u64 = 1 << 63;
pub(crate) const PACKET_FLAG_KEY_FRAME: u64 = 1 << 62;
pub(crate) const PACKET_PTS_MASK: u64 = (1 << 62) - 1;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedOptions {
    /// Video codec: "h264" (default), "h265", or "av1".
    #[serde(default)]
    pub codec: Option<String>,
    /// Max dimension in px (0 = device native). Lower = less bandwidth/latency.
    #[serde(default)]
    pub max_size: Option<u32>,
    /// Target bit rate in bits/sec (default 8 Mbit).
    #[serde(default)]
    pub bit_rate: Option<u32>,
    /// Cap the capture frame rate.
    #[serde(default)]
    pub max_fps: Option<u32>,
}

struct EmbedSession {
    child: tokio::process::Child,
    stop: Arc<AtomicBool>,
    /// Local TCP port the adb forward was bound to (removed on stop).
    port: u16,
}

#[derive(Default)]
pub struct EmbedMirrorState {
    sessions: Mutex<HashMap<String, EmbedSession>>,
}

/// Derive the `scrcpy-server` jar path (sibling of the scrcpy executable).
/// Returns None only when no `scrcpy-server` file can be located in any of the
/// well-known layouts (bundled, custom folder, next to the binary, the
/// `share/scrcpy` dir used by Homebrew/most Linux packages, or the
/// `SCRCPY_SERVER_PATH` override).
pub(crate) fn resolve_server_jar(custom_path: Option<String>) -> Option<String> {
    // 0. scrcpy's own explicit override.
    if let Ok(p) = std::env::var("SCRCPY_SERVER_PATH") {
        let p = p.trim().to_string();
        if !p.is_empty() && Path::new(&p).is_file() {
            return Some(p);
        }
    }

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1. Explicit custom folder (and its share/scrcpy subdir).
    if let Some(folder) = custom_path.as_ref() {
        let folder = folder.trim();
        if !folder.is_empty() {
            candidates.push(Path::new(folder).join("scrcpy-server"));
            candidates.push(Path::new(folder).join("scrcpy-server.jar"));
            candidates.push(Path::new(folder).join("share/scrcpy/scrcpy-server"));
        }
    }

    // 2. Locations derived from the resolved scrcpy executable. Follow symlinks
    //    (Homebrew's bin/scrcpy points into Cellar) so both the bin sibling and
    //    the `../share/scrcpy/scrcpy-server` layout are covered.
    let exe = get_binary_path("scrcpy", custom_path.clone());
    let exe_path = if exe == "scrcpy" {
        which_in_path("scrcpy")
    } else {
        Some(std::path::PathBuf::from(&exe))
    };
    if let Some(p) = exe_path {
        let real = std::fs::canonicalize(&p).unwrap_or(p);
        if let Some(bin_dir) = real.parent() {
            candidates.push(bin_dir.join("scrcpy-server"));
            candidates.push(bin_dir.join("scrcpy-server.jar"));
            if let Some(prefix) = bin_dir.parent() {
                candidates.push(prefix.join("share/scrcpy/scrcpy-server"));
            }
        }
    }

    // 3. App-local `scrcpy-bin` folders (portable / downloaded-in-app installs).
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            candidates.push(dir.join("scrcpy-bin").join("scrcpy-server"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("scrcpy-bin").join("scrcpy-server"));
    }

    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

/// Find an executable by name on the `PATH` (a tiny, dependency-free `which`).
fn which_in_path(name: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// A weak, dependency-free session id. Only needs to be locally unique enough
/// to avoid abstract-socket collisions between concurrent sessions.
pub(crate) fn generate_scid() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Keep it within scrcpy's 31-bit positive range.
    let scid = (nanos as u32) & 0x7fff_ffff;
    format!("{:08x}", scid)
}

pub(crate) async fn detect_version(scrcpy_exe: &str) -> Option<String> {
    let output = create_command(scrcpy_exe)
        .arg("--version")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    parse_scrcpy_version(&text)
}

/// Read exactly `buf.len()` bytes or fail.
async fn read_full(stream: &mut TcpStream, buf: &mut [u8]) -> std::io::Result<()> {
    stream.read_exact(buf).await.map(|_| ())
}

#[tauri::command]
pub async fn start_embedded_mirror(
    window: Window,
    state: State<'_, EmbedMirrorState>,
    serial: String,
    custom_path: Option<String>,
    options: Option<EmbedOptions>,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    adb::validate_serial(&serial).map_err(|e| e.message())?;

    // Reject a duplicate session for the same device.
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&serial) {
            return Ok(json!({
                "success": false,
                "message": "An embedded mirror is already running for this device"
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
                "message": "scrcpy-server not found. Set the scrcpy folder in settings so the embedded mirror can locate the server jar."
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
            "[EMBED] Starting embedded mirror for {} (scrcpy {}, codec {})",
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
    let forward_out = adb::run_adb_text(
        Some(&serial),
        &["forward", "tcp:0", &socket_name],
        custom_path.clone(),
        10,
    )
    .await;
    let port: u16 = match forward_out {
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

    // 3. Launch the server (video only, control off, forward tunnel).
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
        "control=false".to_string(),
        "cleanup=true".to_string(),
        format!("video_codec={}", codec),
    ];
    server_args.push(format!("max_size={}", opts.max_size.unwrap_or(0)));
    server_args.push(format!(
        "video_bit_rate={}",
        opts.bit_rate.unwrap_or(8_000_000)
    ));
    if let Some(fps) = opts.max_fps {
        if fps > 0 {
            server_args.push(format!("max_fps={}", fps));
        }
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

    // Forward the server's own log lines into the shared log panel.
    if let Some(out) = child.stdout.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[EMBED] {}", line));
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[EMBED] {}", line));
            }
        });
    }

    // 4. Connect + read the 1-byte dummy handshake, retrying until the device
    // socket is actually up. In forward mode `adb forward` accepts our TCP
    // connection immediately (before the server's LocalServerSocket exists), so
    // a fresh connection can read EOF; the real readiness signal is the dummy
    // byte the server writes once it accepts the socket.
    let mut stream = match connect_and_handshake(port, Duration::from_secs(10)).await {
        Ok(s) => s,
        Err(e) => {
            let _ = child.kill().await;
            let _ = remove_forward(&adb_exe, port).await;
            return Ok(json!({
                "success": false,
                "message": format!(
                    "Could not connect to scrcpy-server: {}. Check the [EMBED] lines in the log panel for the server's own error.",
                    e
                )
            }));
        }
    };

    // 5. Read the stream info that follows the dummy byte: device name + codec.
    if let Err(e) = read_stream_info(&mut stream, &window, &serial).await {
        let _ = child.kill().await;
        let _ = remove_forward(&adb_exe, port).await;
        return Ok(json!({
            "success": false,
            "message": format!("Handshake with scrcpy-server failed: {}", e)
        }));
    }

    // 6. Spawn the frame-reading loop.
    let stop = Arc::new(AtomicBool::new(false));
    let stop_loop = stop.clone();
    let win_loop = window.clone();
    let serial_loop = serial.clone();
    tokio::spawn(async move {
        read_frames(stream, win_loop, serial_loop, stop_loop).await;
    });

    state
        .sessions
        .lock()
        .unwrap()
        .insert(serial.clone(), EmbedSession { child, stop, port });
    let _ = window.emit("embed-status", json!({ "serial": serial, "running": true }));

    Ok(json!({ "success": true, "message": "Embedded mirror started" }))
}

/// Connect to the forwarded port and read the 1-byte dummy handshake, retrying
/// on immediate EOF until the device-side socket is ready (or the budget is
/// exhausted). Returns the live stream positioned right after the dummy byte.
async fn connect_and_handshake(port: u16, budget: Duration) -> Result<TcpStream, String> {
    let deadline = std::time::Instant::now() + budget;
    #[allow(unused_assignments)]
    let mut last = String::from("timed out waiting for scrcpy-server socket");
    loop {
        match TcpStream::connect(("127.0.0.1", port)).await {
            Ok(mut stream) => {
                let mut dummy = [0u8; 1];
                match stream.read_exact(&mut dummy).await {
                    // A live connection to the server: proceed.
                    Ok(_) => return Ok(stream),
                    // Dead adb pipe (device socket not up yet): drop and retry.
                    Err(e) => last = format!("dummy byte read failed ({})", e),
                }
            }
            Err(e) => last = format!("connect failed ({})", e),
        }
        if std::time::Instant::now() >= deadline {
            return Err(last);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Read the stream info that follows the dummy byte (device name + codec
/// metadata) and emit the codec/dimension info to the frontend.
async fn read_stream_info(
    stream: &mut TcpStream,
    window: &Window,
    serial: &str,
) -> Result<(), String> {
    // 64-byte device name (UTF-8, null padded).
    let mut name_buf = [0u8; DEVICE_NAME_FIELD_LEN];
    read_full(stream, &mut name_buf)
        .await
        .map_err(|e| e.to_string())?;
    let end = name_buf
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(DEVICE_NAME_FIELD_LEN);
    let device_name = String::from_utf8_lossy(&name_buf[..end]).to_string();

    // Codec metadata: codec id (u32), width (u32), height (u32).
    let mut meta = [0u8; 12];
    read_full(stream, &mut meta)
        .await
        .map_err(|e| e.to_string())?;
    let codec_id = u32::from_be_bytes([meta[0], meta[1], meta[2], meta[3]]);
    let width = u32::from_be_bytes([meta[4], meta[5], meta[6], meta[7]]);
    let height = u32::from_be_bytes([meta[8], meta[9], meta[10], meta[11]]);

    let codec_str = match &codec_id.to_be_bytes() {
        b"h264" => "h264",
        b"h265" => "h265",
        b"av01" => "av1",
        _ => "h264",
    };

    let _ = window.emit(
        "embed-codec-info",
        json!({
            "serial": serial,
            "deviceName": device_name,
            "codec": codec_str,
            "codecId": codec_id,
            "width": width,
            "height": height,
        }),
    );
    Ok(())
}

/// Read framed H.264 packets until the socket closes or a stop is requested,
/// forwarding each to the webview.
async fn read_frames(mut stream: TcpStream, window: Window, serial: String, stop: Arc<AtomicBool>) {
    let mut seq: u64 = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        // 12-byte frame header: [u64 pts+flags][u32 packet size].
        let mut header = [0u8; 12];
        if read_full(&mut stream, &mut header).await.is_err() {
            break;
        }
        let pts_and_flags = u64::from_be_bytes([
            header[0], header[1], header[2], header[3], header[4], header[5], header[6], header[7],
        ]);
        let size = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
        if size == 0 || size > MAX_PACKET_BYTES {
            break;
        }

        let is_config = pts_and_flags & PACKET_FLAG_CONFIG != 0;
        let is_key = pts_and_flags & PACKET_FLAG_KEY_FRAME != 0;
        let pts = pts_and_flags & PACKET_PTS_MASK;

        let mut payload = vec![0u8; size as usize];
        if read_full(&mut stream, &mut payload).await.is_err() {
            break;
        }

        seq += 1;
        let _ = window.emit(
            "embed-video-packet",
            json!({
                "serial": serial,
                "seq": seq,
                "config": is_config,
                "keyFrame": is_key,
                "pts": pts,
                "data": BASE64.encode(&payload),
            }),
        );
    }

    let _ = window.emit(
        "embed-status",
        json!({ "serial": serial, "running": false }),
    );
}

pub(crate) async fn remove_forward(adb_exe: &str, port: u16) -> std::io::Result<()> {
    let _ = create_command(adb_exe)
        .args(["forward", "--remove", &format!("tcp:{}", port)])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
    Ok(())
}

#[tauri::command]
pub async fn stop_embedded_mirror(
    window: Window,
    state: State<'_, EmbedMirrorState>,
    serial: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    let session = state.sessions.lock().unwrap().remove(&serial);

    if let Some(mut session) = session {
        session.stop.store(true, Ordering::Relaxed);
        let _ = session.child.kill().await;
        let adb_exe = get_binary_path("adb", custom_path);
        let _ = remove_forward(&adb_exe, session.port).await;
        let _ = window.emit(
            "embed-status",
            json!({ "serial": serial, "running": false }),
        );
    }

    Ok(json!({ "success": true, "message": "Embedded mirror stopped" }))
}
