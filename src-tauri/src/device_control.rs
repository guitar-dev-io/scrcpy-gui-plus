// Device control backend.
//
// Exposes a *strict allowlist* of device actions. The frontend can only ask
// for one of the named actions below; it can never pass an arbitrary shell
// command. Each action maps to a fixed array of adb arguments that is passed
// to the centralized ADB service (never string-concatenated into a shell).

use crate::adb::{self, AdbError};
use crate::commands::{create_command, get_binary_path};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tokio::process::Child;

const ACTION_TIMEOUT_SECS: u64 = 15;

/// State holding in-flight screen recordings keyed by device serial.
pub struct RecordingState {
    pub recordings: Mutex<HashMap<String, RecordingHandle>>,
}

pub struct RecordingHandle {
    pub child: Child,
    pub remote_path: String,
    pub custom_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub success: bool,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Static allowlist: action name -> fixed adb shell argument vector.
/// Only simple, single-shot key/statusbar actions live here. Multi-step
/// actions (rotate) and stateful ones (recording) are handled separately.
fn action_args(action: &str) -> Option<Vec<&'static str>> {
    let args: Vec<&'static str> = match action {
        "back" => vec!["shell", "input", "keyevent", "KEYCODE_BACK"],
        "home" => vec!["shell", "input", "keyevent", "KEYCODE_HOME"],
        "recents" => vec!["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"],
        "volume_up" => vec!["shell", "input", "keyevent", "KEYCODE_VOLUME_UP"],
        "volume_down" => vec!["shell", "input", "keyevent", "KEYCODE_VOLUME_DOWN"],
        "mute" => vec!["shell", "input", "keyevent", "KEYCODE_VOLUME_MUTE"],
        "power" => vec!["shell", "input", "keyevent", "KEYCODE_POWER"],
        "lock" => vec!["shell", "input", "keyevent", "KEYCODE_SLEEP"],
        "screen_off" => vec!["shell", "input", "keyevent", "KEYCODE_SLEEP"],
        "screen_on" => vec!["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        "expand_notifications" => vec!["shell", "cmd", "statusbar", "expand-notifications"],
        "collapse_notifications" => vec!["shell", "cmd", "statusbar", "collapse"],
        _ => return None,
    };
    Some(args)
}

/// Whether an action name is part of the recognized allowlist (including the
/// specially-handled `rotate`).
pub fn is_allowed_action(action: &str) -> bool {
    action == "rotate" || action_args(action).is_some()
}

fn ok(action: &str, output: Option<String>) -> ActionResult {
    ActionResult {
        success: true,
        action: action.to_string(),
        output,
        error: None,
        error_code: None,
    }
}

fn err(action: &str, e: &AdbError) -> ActionResult {
    ActionResult {
        success: false,
        action: action.to_string(),
        output: None,
        error: Some(e.message()),
        error_code: Some(e.code().to_string()),
    }
}

fn err_msg(action: &str, code: &str, msg: String) -> ActionResult {
    ActionResult {
        success: false,
        action: action.to_string(),
        output: None,
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

/// Rotate the device by cycling `user_rotation` (0->1->2->3->0) with
/// accelerometer auto-rotate disabled so the change sticks.
async fn rotate_device(serial: &str, custom_path: Option<String>) -> ActionResult {
    // Disable auto-rotate first.
    if let Err(e) = adb::run_adb_text(
        Some(serial),
        &[
            "shell",
            "settings",
            "put",
            "system",
            "accelerometer_rotation",
            "0",
        ],
        custom_path.clone(),
        ACTION_TIMEOUT_SECS,
    )
    .await
    {
        return err("rotate", &e);
    }

    let current = adb::run_adb_text(
        Some(serial),
        &["shell", "settings", "get", "system", "user_rotation"],
        custom_path.clone(),
        ACTION_TIMEOUT_SECS,
    )
    .await;

    let current_val = match current {
        Ok(s) => s.trim().parse::<i32>().unwrap_or(0),
        Err(e) => return err("rotate", &e),
    };

    let next = ((current_val % 4) + 1) % 4;
    let next_str = next.to_string();

    match adb::run_adb_text(
        Some(serial),
        &[
            "shell",
            "settings",
            "put",
            "system",
            "user_rotation",
            &next_str,
        ],
        custom_path,
        ACTION_TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => ok("rotate", Some(format!("rotation={}", next))),
        Err(e) => err("rotate", &e),
    }
}

/// Execute a single validated device action.
#[tauri::command]
pub async fn device_action(
    serial: String,
    action: String,
    custom_path: Option<String>,
) -> ActionResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return err(&action, &e);
    }

    if !is_allowed_action(&action) {
        return err_msg(
            &action,
            "invalid_action",
            format!("Unsupported action: {}", action),
        );
    }

    if action == "rotate" {
        return rotate_device(&serial, custom_path).await;
    }

    let args = match action_args(&action) {
        Some(a) => a,
        None => {
            return err_msg(
                &action,
                "invalid_action",
                format!("Unsupported action: {}", action),
            )
        }
    };

    match adb::run_adb_text(Some(&serial), &args, custom_path, ACTION_TIMEOUT_SECS).await {
        Ok(out) => ok(&action, Some(out.trim().to_string())),
        Err(e) => err(&action, &e),
    }
}

fn sanitize_remote_component(serial: &str) -> String {
    serial
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Start recording the device screen using `screenrecord` on the device.
#[tauri::command]
pub async fn start_recording(
    state: State<'_, RecordingState>,
    serial: String,
    custom_path: Option<String>,
) -> Result<ActionResult, String> {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return Ok(err("start_recording", &e));
    }

    {
        let recordings = state.recordings.lock().unwrap();
        if recordings.contains_key(&serial) {
            return Ok(err_msg(
                "start_recording",
                "already_recording",
                "A recording is already in progress for this device".to_string(),
            ));
        }
    }

    let remote_path = format!(
        "/sdcard/scrcpygui-rec-{}-{}.mp4",
        sanitize_remote_component(&serial),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    let adb_path = get_binary_path("adb", custom_path.clone());
    let child = create_command(&adb_path)
        .args(["-s", &serial, "shell", "screenrecord", &remote_path])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            let code = if e.kind() == std::io::ErrorKind::NotFound {
                "adb_not_found"
            } else {
                "spawn_failed"
            };
            return Ok(err_msg("start_recording", code, e.to_string()));
        }
    };

    state.recordings.lock().unwrap().insert(
        serial.clone(),
        RecordingHandle {
            child,
            remote_path: remote_path.clone(),
            custom_path,
        },
    );

    Ok(ok("start_recording", Some(remote_path)))
}

/// Stop an in-flight recording and pull the file to `output_dir`.
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, RecordingState>,
    serial: String,
    output_dir: String,
) -> Result<ActionResult, String> {
    let serial = serial.trim().to_string();

    let handle = { state.recordings.lock().unwrap().remove(&serial) };

    let mut handle = match handle {
        Some(h) => h,
        None => {
            return Ok(err_msg(
                "stop_recording",
                "not_recording",
                "No recording is in progress for this device".to_string(),
            ))
        }
    };

    // Terminate the local adb client; the on-device screenrecord receives the
    // interrupt and finalizes the MP4.
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(pid) = handle.child.id() {
            let _ = std::process::Command::new("kill")
                .arg(pid.to_string())
                .output();
        } else {
            let _ = handle.child.kill().await;
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = handle.child.kill().await;
    }

    // Give the device time to flush the MP4 to disk.
    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
    let _ = handle.child.wait().await;

    let filename = handle
        .remote_path
        .rsplit('/')
        .next()
        .unwrap_or("recording.mp4")
        .to_string();
    let local_path = std::path::Path::new(&output_dir).join(&filename);
    let local_str = local_path.to_string_lossy().to_string();

    // Pull the recording off the device.
    match adb::run_adb_text(
        Some(&serial),
        &["pull", &handle.remote_path, &local_str],
        handle.custom_path.clone(),
        120,
    )
    .await
    {
        Ok(_) => {
            // Best-effort cleanup of the on-device file.
            let _ = adb::run_adb_text(
                Some(&serial),
                &["shell", "rm", "-f", &handle.remote_path],
                handle.custom_path.clone(),
                ACTION_TIMEOUT_SECS,
            )
            .await;
            Ok(ok("stop_recording", Some(local_str)))
        }
        Err(e) => Ok(err("stop_recording", &e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_known_actions() {
        for a in [
            "back",
            "home",
            "recents",
            "volume_up",
            "volume_down",
            "mute",
            "power",
            "lock",
            "screen_off",
            "screen_on",
            "expand_notifications",
            "collapse_notifications",
            "rotate",
        ] {
            assert!(is_allowed_action(a), "expected {} to be allowed", a);
        }
    }

    #[test]
    fn allowlist_rejects_unknown_actions() {
        assert!(!is_allowed_action(""));
        assert!(!is_allowed_action("reboot"));
        assert!(!is_allowed_action("shell rm -rf /"));
        assert!(!is_allowed_action("input keyevent 26; reboot"));
        assert!(!is_allowed_action("BACK"));
    }

    #[test]
    fn action_args_never_contain_shell_metachars() {
        for a in [
            "back",
            "home",
            "recents",
            "volume_up",
            "power",
            "expand_notifications",
        ] {
            let args = action_args(a).unwrap();
            for arg in args {
                assert!(!arg.contains(';'));
                assert!(!arg.contains('|'));
                assert!(!arg.contains('&'));
                assert!(!arg.contains(' '));
            }
        }
    }

    #[test]
    fn sanitize_remote_component_strips_specials() {
        assert_eq!(
            sanitize_remote_component("192.168.1.5:5555"),
            "192-168-1-5-5555"
        );
        assert_eq!(sanitize_remote_component("ABC123"), "ABC123");
    }
}
