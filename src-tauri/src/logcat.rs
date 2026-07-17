// Real-time logcat streaming backend.
//
// Spawns a long-running `adb logcat` process per device and streams its output
// to the frontend via the `logcat-line` event (buffered ~100ms like the scrcpy
// log stream). Filtering, crash/ANR detection, search and pause are handled on
// the frontend so the user can re-filter without restarting the stream.
//
// All ADB usage goes through validated arguments passed as an array (never a
// shell string). Only the device serial is user-controlled and it is validated
// before use.

use crate::adb;
use crate::commands::{create_command, get_binary_path};
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{Emitter, State, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::time::Duration;

/// State holding in-flight logcat processes keyed by device serial.
pub struct LogcatState {
    pub processes: Mutex<HashMap<String, Child>>,
}

impl Default for LogcatState {
    fn default() -> Self {
        LogcatState {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

/// Start streaming logcat for a device. If a stream is already running for the
/// serial it is stopped and replaced. Emits `logcat-line` events shaped as
/// `{ serial, chunk }` where `chunk` is a newline-joined batch of lines, and a
/// `logcat-status` event `{ serial, running }` on start/stop.
#[tauri::command]
pub async fn start_logcat(
    window: Window,
    state: State<'_, LogcatState>,
    serial: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return Ok(json!({ "success": false, "error": e.message(), "errorCode": e.code() }));
    }

    // Replace any existing stream for this device.
    stop_logcat_internal(&state, &serial).await;

    let adb_path = get_binary_path("adb", custom_path);

    // `-v threadtime` gives us a stable, parseable format:
    //   MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: message
    let mut child = create_command(&adb_path)
        .args(["-s", &serial, "logcat", "-v", "threadtime"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "ADB executable not found".to_string()
            } else {
                e.to_string()
            }
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture logcat stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture logcat stderr".to_string())?;

    state
        .processes
        .lock()
        .unwrap()
        .insert(serial.clone(), child);

    // Stream stdout in ~100ms batches to keep the UI responsive without
    // flooding it with one event per line.
    let window_out = window.clone();
    let serial_out = serial.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut buffer: Vec<String> = Vec::new();
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        loop {
            tokio::select! {
                line_res = lines.next_line() => {
                    match line_res {
                        Ok(Some(line)) => buffer.push(line),
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
                _ = interval.tick() => {
                    if !buffer.is_empty() {
                        let _ = window_out.emit(
                            "logcat-line",
                            json!({ "serial": serial_out, "chunk": buffer.join("\n") }),
                        );
                        buffer.clear();
                    }
                }
            }
        }
        if !buffer.is_empty() {
            let _ = window_out.emit(
                "logcat-line",
                json!({ "serial": serial_out, "chunk": buffer.join("\n") }),
            );
        }
        // stdout closed => the stream ended (device disconnected or stopped).
        let _ = window_out.emit(
            "logcat-status",
            json!({ "serial": serial_out, "running": false }),
        );
    });

    // Surface stderr (e.g. "device offline") as status lines too.
    let window_err = window.clone();
    let serial_err = serial.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = window_err.emit(
                "logcat-line",
                json!({ "serial": serial_err, "chunk": format!("[LOGCAT] {}", line) }),
            );
        }
    });

    let _ = window.emit(
        "logcat-status",
        json!({ "serial": serial, "running": true }),
    );

    Ok(json!({ "success": true }))
}

async fn stop_logcat_internal(state: &State<'_, LogcatState>, serial: &str) {
    let child = { state.processes.lock().unwrap().remove(serial) };
    if let Some(mut c) = child {
        let _ = c.kill().await;
    }
}

/// Stop the logcat stream for a device.
#[tauri::command]
pub async fn stop_logcat(
    window: Window,
    state: State<'_, LogcatState>,
    serial: String,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    stop_logcat_internal(&state, &serial).await;
    let _ = window.emit(
        "logcat-status",
        json!({ "serial": serial, "running": false }),
    );
    Ok(json!({ "success": true }))
}

/// Flush the device logcat buffer (`adb logcat -c`).
#[tauri::command]
pub async fn clear_logcat(
    serial: String,
    custom_path: Option<String>,
) -> serde_json::Value {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return json!({ "success": false, "error": e.message(), "errorCode": e.code() });
    }
    match adb::run_adb_text(Some(&serial), &["logcat", "-c"], custom_path, 15).await {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.message(), "errorCode": e.code() }),
    }
}
