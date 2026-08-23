use crate::screenshot::ScreenshotResult;
use serde::Deserialize;

#[cfg(target_os = "macos")]
use crate::screenshot;
#[cfg(target_os = "macos")]
use std::fs::{self, OpenOptions};
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::Stdio;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "macos")]
use tokio::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacScreenshotRequest {
    /// One of `display`, `window`, or `region`.
    pub target: String,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub display_number: Option<u32>,
    #[serde(default)]
    pub include_cursor: Option<bool>,
}

#[tauri::command]
pub async fn capture_macos_screenshot(
    app_handle: tauri::AppHandle,
    request: MacScreenshotRequest,
) -> ScreenshotResult {
    let captured_at = chrono::Local::now().to_rfc3339();

    #[cfg(target_os = "macos")]
    {
        capture_on_macos(app_handle, request, &captured_at).await
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_handle, request);
        ScreenshotResult::failure_msg(
            "macos:unsupported",
            &captured_at,
            "unsupported_platform",
            "macOS screen capture is only available in the macOS desktop app".to_string(),
        )
    }
}

#[cfg(target_os = "macos")]
async fn capture_on_macos(
    app_handle: tauri::AppHandle,
    request: MacScreenshotRequest,
    captured_at: &str,
) -> ScreenshotResult {
    let target = request.target.trim().to_ascii_lowercase();
    let display_number = request
        .display_number
        .filter(|value| *value > 0)
        .unwrap_or(1);

    let (source_kind, source_id, source_name, device_serial, interactive) = match target.as_str() {
        "display" => {
            let name = if display_number == 1 {
                "macOS Main Display".to_string()
            } else {
                format!("macOS Display {display_number}")
            };
            (
                "macos-display".to_string(),
                format!("display:{display_number}"),
                name,
                format!("macos:display:{display_number}"),
                false,
            )
        }
        "window" => (
            "macos-window".to_string(),
            "window:interactive".to_string(),
            "macOS Window".to_string(),
            "macos:window:interactive".to_string(),
            true,
        ),
        "region" => (
            "macos-region".to_string(),
            "region:interactive".to_string(),
            "macOS Region".to_string(),
            "macos:region:interactive".to_string(),
            true,
        ),
        _ => {
            return ScreenshotResult::failure_msg(
                "macos:unknown",
                captured_at,
                "invalid_target",
                "macOS capture target must be display, window, or region".to_string(),
            )
        }
    };

    let directory = match screenshot::resolve_output_dir(&app_handle, request.output_dir.as_deref())
    {
        Ok(directory) => directory,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(&device_serial, captured_at, &code, message)
        }
    };
    let temp_path = match create_temp_capture_path() {
        Ok(path) => path,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(&device_serial, captured_at, &code, message)
        }
    };

    let mut args = vec!["-x".to_string(), "-T0".to_string()];
    if request.include_cursor.unwrap_or(false) {
        args.push("-C".to_string());
    }
    match target.as_str() {
        "display" => {
            if display_number == 1 {
                args.push("-m".to_string());
            } else {
                args.push(format!("-D{display_number}"));
            }
        }
        "window" => {
            args.push("-i".to_string());
            args.push("-w".to_string());
        }
        "region" => {
            args.push("-i".to_string());
            args.push("-s".to_string());
        }
        _ => unreachable!("target was validated above"),
    }
    args.push("-t".to_string());
    args.push("png".to_string());
    args.push(temp_path.to_string_lossy().into_owned());

    let output = Command::new("/usr/sbin/screencapture")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await;
    let output = match output {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return ScreenshotResult::failure_msg(
                &device_serial,
                captured_at,
                "capture_failed",
                format!("Could not start macOS screen capture: {error}"),
            );
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let (code, message) = if interactive && stderr.is_empty() {
            (
                "capture_cancelled",
                "macOS screen capture was cancelled".to_string(),
            )
        } else if interactive {
            (
                "capture_failed",
                format!("macOS interactive capture failed: {stderr}"),
            )
        } else {
            (
                "permission_denied",
                format!(
                    "macOS could not capture the display. Allow Screen Recording permission in System Settings > Privacy & Security > Screen Recording.{}",
                    if stderr.is_empty() {
                        String::new()
                    } else {
                        format!(" Details: {stderr}")
                    }
                ),
            )
        };
        let _ = fs::remove_file(&temp_path);
        return ScreenshotResult::failure_msg(&device_serial, captured_at, code, message);
    }

    let bytes = match fs::read(&temp_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return ScreenshotResult::failure_msg(
                &device_serial,
                captured_at,
                "capture_failed",
                format!("macOS capture completed without a readable PNG: {error}"),
            );
        }
    };
    let _ = fs::remove_file(&temp_path);

    screenshot::persist_png_screenshot(
        &directory,
        &bytes,
        &device_serial,
        &source_name,
        &source_kind,
        &source_id,
        &source_name,
        captured_at,
    )
}

#[cfg(target_os = "macos")]
fn create_temp_capture_path() -> Result<PathBuf, (String, String)> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let directory = std::env::temp_dir();

    for attempt in 0..64u32 {
        let path = directory.join(format!(
            "scrcpy-gui-macos-capture-{}-{timestamp}-{attempt}.png",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                drop(file);
                if let Err(error) = fs::remove_file(&path) {
                    return Err((
                        "temp_file_failed".to_string(),
                        format!("Could not prepare macOS capture file: {error}"),
                    ));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err((
                    "temp_file_failed".to_string(),
                    format!("Could not prepare macOS capture file: {error}"),
                ));
            }
        }
    }

    Err((
        "temp_file_failed".to_string(),
        "Could not reserve a temporary macOS capture file".to_string(),
    ))
}
