// Screenshot capture backend.
//
// Captures the Android screen at native resolution via
// `adb -s <serial> exec-out screencap -p`, validates the PNG payload and
// writes it to a (configurable) directory. Only file metadata ever crosses
// back to the frontend; the binary payload stays in Rust.

use crate::adb::{self, AdbError};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// PNG magic number.
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Timeout for a screencap (large screens on slow USB can be a few seconds).
const SCREENSHOT_TIMEOUT_SECS: u64 = 30;

/// Timeout for a single live-preview frame. Shorter than a saved screenshot so
/// a slow/stalled frame does not back up the polling loop.
const PREVIEW_TIMEOUT_SECS: u64 = 12;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub success: bool,
    pub path: String,
    pub filename: String,
    pub device_serial: String,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl ScreenshotResult {
    fn failure(device_serial: &str, captured_at: &str, err: &AdbError) -> Self {
        ScreenshotResult {
            success: false,
            path: String::new(),
            filename: String::new(),
            device_serial: device_serial.to_string(),
            captured_at: captured_at.to_string(),
            error: Some(err.message()),
            error_code: Some(err.code().to_string()),
        }
    }

    fn failure_msg(device_serial: &str, captured_at: &str, code: &str, msg: String) -> Self {
        ScreenshotResult {
            success: false,
            path: String::new(),
            filename: String::new(),
            device_serial: device_serial.to_string(),
            captured_at: captured_at.to_string(),
            error: Some(msg),
            error_code: Some(code.to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
    pub device_serial: String,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub custom_path: Option<String>,
}

/// Replace characters that are invalid or unsafe in filenames across
/// Windows / macOS / Linux with underscores and collapse whitespace.
pub fn sanitize_filename_component(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c if c.is_whitespace() => '_',
            c => c,
        })
        .collect();

    // Collapse consecutive underscores and trim leading/trailing separators.
    let mut result = String::with_capacity(cleaned.len());
    let mut prev_underscore = false;
    for c in cleaned.chars() {
        if c == '_' {
            if !prev_underscore {
                result.push(c);
            }
            prev_underscore = true;
        } else {
            result.push(c);
            prev_underscore = false;
        }
    }
    let trimmed = result.trim_matches(|c| c == '_' || c == '.').to_string();
    if trimmed.is_empty() {
        "device".to_string()
    } else {
        trimmed
    }
}

/// Build the default screenshot filename:
/// `<DeviceName>_<Serial>_<YYYY-MM-DD_HH-mm-ss>.png`
pub fn build_screenshot_filename(device_name: &str, serial: &str, timestamp: &str) -> String {
    let name = sanitize_filename_component(device_name);
    let serial = sanitize_filename_component(serial);
    format!("{}_{}_{}.png", name, serial, timestamp)
}

/// Validate that the byte payload begins with a PNG signature and is non-trivial.
pub fn validate_png(bytes: &[u8]) -> bool {
    bytes.len() > PNG_SIGNATURE.len() && bytes[..PNG_SIGNATURE.len()] == PNG_SIGNATURE
}

/// Resolve the directory to save screenshots into, creating it if missing.
/// Falls back to `<Pictures>/ScrcpyGUI` when no directory is configured.
pub fn resolve_screenshot_dir(
    custom: Option<&str>,
    default_base: &Path,
) -> Result<PathBuf, String> {
    let dir = match custom {
        Some(c) if !c.trim().is_empty() => PathBuf::from(c.trim()),
        _ => default_base.join("ScrcpyGUI"),
    };

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Invalid output directory ({}): {}", dir.display(), e))?;
    } else if !dir.is_dir() {
        return Err(format!("Output path is not a directory: {}", dir.display()));
    }
    Ok(dir)
}

fn now_timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

/// Return the default screenshot directory path (created on demand).
#[tauri::command]
pub async fn get_default_screenshot_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let base = app_handle
        .path()
        .picture_dir()
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|e| e.to_string())?;
    let dir = resolve_screenshot_dir(None, &base)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Capture a screenshot from the given device and persist it as a PNG file.
#[tauri::command]
pub async fn capture_screenshot(
    app_handle: tauri::AppHandle,
    request: ScreenshotRequest,
) -> ScreenshotResult {
    let captured_at = now_iso();
    let serial = request.device_serial.trim();

    if let Err(e) = adb::validate_serial(serial) {
        return ScreenshotResult::failure(serial, &captured_at, &e);
    }

    // Resolve the output directory first so we fail fast on invalid paths.
    let base = match app_handle
        .path()
        .picture_dir()
        .or_else(|_| app_handle.path().home_dir())
    {
        Ok(b) => b,
        Err(e) => {
            return ScreenshotResult::failure_msg(
                serial,
                &captured_at,
                "invalid_output_dir",
                e.to_string(),
            )
        }
    };

    let dir = match resolve_screenshot_dir(request.output_dir.as_deref(), &base) {
        Ok(d) => d,
        Err(e) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, "invalid_output_dir", e)
        }
    };

    // Capture raw PNG bytes at native resolution.
    let output = adb::run_adb_bytes(
        Some(serial),
        &["exec-out", "screencap", "-p"],
        request.custom_path.clone(),
        SCREENSHOT_TIMEOUT_SECS,
    )
    .await;

    let bytes = match output {
        Ok(o) => o.stdout,
        Err(e) => return ScreenshotResult::failure(serial, &captured_at, &e),
    };

    if !validate_png(&bytes) {
        return ScreenshotResult::failure_msg(
            serial,
            &captured_at,
            "corrupt_png",
            "Captured data is empty or not a valid PNG".to_string(),
        );
    }

    let device_name = request
        .device_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(serial);

    let timestamp = now_timestamp();
    let filename = build_screenshot_filename(device_name, serial, &timestamp);
    let full_path = dir.join(&filename);

    if let Err(e) = std::fs::write(&full_path, &bytes) {
        let code = if e.kind() == std::io::ErrorKind::PermissionDenied {
            "permission_denied"
        } else {
            "write_failed"
        };
        return ScreenshotResult::failure_msg(serial, &captured_at, code, e.to_string());
    }

    ScreenshotResult {
        success: true,
        path: full_path.to_string_lossy().to_string(),
        filename,
        device_serial: serial.to_string(),
        captured_at,
        error: None,
        error_code: None,
    }
}

/// Capture a single frame for the in-app live preview.
///
/// Reuses the same `adb exec-out screencap -p` path as the screenshot feature
/// but returns the PNG as a base64 string instead of writing it to disk, so it
/// can be polled a few times per second without littering the filesystem. The
/// frontend turns this into a `data:image/png;base64,...` URL.
#[tauri::command]
pub async fn capture_preview_frame(
    device_serial: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let serial = device_serial.trim();

    adb::validate_serial(serial).map_err(|e| e.message())?;

    let output = adb::run_adb_bytes(
        Some(serial),
        &["exec-out", "screencap", "-p"],
        custom_path,
        PREVIEW_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| e.message())?;

    let bytes = output.stdout;
    if !validate_png(&bytes) {
        return Err("Captured frame was empty or not a valid PNG".to_string());
    }

    Ok(STANDARD.encode(&bytes))
}

/// Delete a screenshot file (used when removing a history entry with the
/// "also delete file" option). Missing files are treated as success.
#[tauri::command]
pub async fn delete_screenshot_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_invalid_chars() {
        assert_eq!(sanitize_filename_component("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_filename_component("Pixel 7 Pro"), "Pixel_7_Pro");
        assert_eq!(
            sanitize_filename_component("weird<>:\"|?*name"),
            "weird_name"
        );
    }

    #[test]
    fn sanitize_collapses_and_trims() {
        assert_eq!(
            sanitize_filename_component("  spaced   out  "),
            "spaced_out"
        );
        assert_eq!(sanitize_filename_component("///"), "device");
        assert_eq!(sanitize_filename_component(""), "device");
        assert_eq!(sanitize_filename_component("...dots..."), "dots");
    }

    #[test]
    fn build_filename_matches_format() {
        let f = build_screenshot_filename("Pixel 7", "ABC123", "2026-07-16_10-30-00");
        assert_eq!(f, "Pixel_7_ABC123_2026-07-16_10-30-00.png");
    }

    #[test]
    fn build_filename_sanitizes_network_serial() {
        let f = build_screenshot_filename("Tablet", "192.168.1.5:5555", "2026-07-16_10-30-00");
        // Colon becomes underscore; dots preserved.
        assert_eq!(f, "Tablet_192.168.1.5_5555_2026-07-16_10-30-00.png");
    }

    #[test]
    fn validate_png_signature() {
        let mut good = PNG_SIGNATURE.to_vec();
        good.extend_from_slice(&[0u8; 32]);
        assert!(validate_png(&good));

        assert!(!validate_png(&[]));
        assert!(!validate_png(b"not a png at all"));
        assert!(!validate_png(&PNG_SIGNATURE)); // signature only, no data
    }

    #[test]
    fn resolve_dir_defaults_to_scrcpygui() {
        let tmp = std::env::temp_dir().join(format!("scrcpygui_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let dir = resolve_screenshot_dir(None, &tmp).unwrap();
        assert!(dir.ends_with("ScrcpyGUI"));
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_dir_uses_custom_when_provided() {
        let tmp = std::env::temp_dir().join(format!("scrcpygui_custom_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let custom = tmp.to_string_lossy().to_string();
        let dir = resolve_screenshot_dir(Some(&custom), Path::new("/nonexistent")).unwrap();
        assert_eq!(dir, tmp);
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
