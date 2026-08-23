//! Event-driven Android device discovery.
//!
//! `adb track-devices` stays alive and notifies the frontend whenever ADB's
//! device list changes. The frontend then reuses the existing structured
//! `get_devices` command, keeping one parser and one registry merge path.

use crate::commands::{create_command, get_binary_path};
use serde_json::json;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

struct RunningTracker {
    id: u64,
    child: Child,
}

pub struct DeviceTrackerState {
    next_id: AtomicU64,
    process: Mutex<Option<RunningTracker>>,
}

impl Default for DeviceTrackerState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            process: Mutex::new(None),
        }
    }
}

impl DeviceTrackerState {
    pub fn kill_all_blocking(&self) {
        if let Ok(mut process) = self.process.lock() {
            if let Some(mut running) = process.take() {
                let _ = running.child.start_kill();
            }
        }
    }

    fn stop_if_current(&self, tracker_id: u64) -> bool {
        let Ok(mut process) = self.process.lock() else {
            return false;
        };
        if process.as_ref().map(|running| running.id) != Some(tracker_id) {
            return false;
        }
        if let Some(mut running) = process.take() {
            let _ = running.child.start_kill();
        }
        true
    }
}

#[tauri::command]
pub async fn start_device_tracker(
    window: Window,
    state: tauri::State<'_, DeviceTrackerState>,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    state.kill_all_blocking();

    let tracker_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let adb_path = get_binary_path("adb", custom_path);
    let mut child = match create_command(&adb_path)
        .arg("track-devices")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return Ok(json!({
                "success": false,
                "error": if error.kind() == std::io::ErrorKind::NotFound {
                    "ADB executable not found".to_string()
                } else {
                    error.to_string()
                }
            }));
        }
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture adb track-devices output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture adb track-devices diagnostics".to_string())?;

    *state
        .process
        .lock()
        .map_err(|_| "Device tracker state is unavailable".to_string())? = Some(RunningTracker {
        id: tracker_id,
        child,
    });

    let output_window = window.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(_)) = lines.next_line().await {
            let _ = output_window.emit(
                "adb-device-tracker",
                json!({ "trackerId": tracker_id, "state": "changed" }),
            );
        }
        let _ = output_window.emit(
            "adb-device-tracker",
            json!({ "trackerId": tracker_id, "state": "stopped" }),
        );
    });

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(message)) = lines.next_line().await {
            if !message.trim().is_empty() {
                let _ = window.emit(
                    "adb-device-tracker",
                    json!({
                        "trackerId": tracker_id,
                        "state": "diagnostic",
                        "message": message
                    }),
                );
            }
        }
    });

    Ok(json!({ "success": true, "trackerId": tracker_id }))
}
#[tauri::command]
pub async fn stop_device_tracker(
    state: tauri::State<'_, DeviceTrackerState>,
    tracker_id: u64,
) -> Result<serde_json::Value, String> {
    Ok(json!({
        "success": true,
        "stopped": state.stop_if_current(tracker_id)
    }))
}
