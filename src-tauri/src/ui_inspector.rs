// UI Inspector backend.
//
// Provides the two data sources the UI Inspector panel needs to let QA testers
// inspect an Android screen:
//   * `dump_ui_hierarchy` — runs `uiautomator dump` on the device and returns
//     the raw view-hierarchy XML (parsed into a node tree on the frontend).
//   * `capture_screen_base64` — grabs the current screen as a PNG and returns
//     it as an in-memory data URL for the overlay (never written to disk, so
//     it does not pollute the user's screenshot folder).
//
// All ADB usage is routed through the validated `crate::adb` service.

use crate::adb::{self, AdbError};
use crate::screenshot::validate_png;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

/// uiautomator can be slow on large/complex hierarchies.
const DUMP_TIMEOUT_SECS: u64 = 30;
const CAPTURE_TIMEOUT_SECS: u64 = 30;

/// Default path `uiautomator dump` writes to when no explicit path is given.
const DEFAULT_DUMP_PATH: &str = "/sdcard/window_dump.xml";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiDumpResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl UiDumpResult {
    fn ok(xml: String) -> Self {
        UiDumpResult {
            success: true,
            xml: Some(xml),
            error: None,
            error_code: None,
        }
    }

    fn err(err: &AdbError) -> Self {
        UiDumpResult {
            success: false,
            xml: None,
            error: Some(err.message()),
            error_code: Some(err.code().to_string()),
        }
    }

    fn err_msg(code: &str, msg: String) -> Self {
        UiDumpResult {
            success: false,
            xml: None,
            error: Some(msg),
            error_code: Some(code.to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureResult {
    pub success: bool,
    /// `data:image/png;base64,...` payload for direct <img> display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl ScreenCaptureResult {
    fn err(err: &AdbError) -> Self {
        ScreenCaptureResult {
            success: false,
            data_url: None,
            error: Some(err.message()),
            error_code: Some(err.code().to_string()),
        }
    }

    fn err_msg(code: &str, msg: String) -> Self {
        ScreenCaptureResult {
            success: false,
            data_url: None,
            error: Some(msg),
            error_code: Some(code.to_string()),
        }
    }
}

/// Extract the file path that `uiautomator dump` reports it wrote to.
///
/// The tool prints a line such as:
///   `UI hierchary dumped to: /sdcard/window_dump.xml`
/// (the "hierchary" typo is Android's, not ours). Falls back to the default
/// path when the message cannot be parsed.
pub fn parse_dump_path(output: &str) -> String {
    for line in output.lines() {
        if let Some(idx) = line.to_lowercase().find("dumped to:") {
            let after = line[idx + "dumped to:".len()..].trim();
            if !after.is_empty() {
                return after.to_string();
            }
        }
    }
    DEFAULT_DUMP_PATH.to_string()
}

/// Detect the "device is busy / could not dump" failures uiautomator emits so
/// we can return a friendly, actionable message instead of raw XML noise.
fn dump_failed(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("could not get idle state")
        || lower.contains("error while dumping")
        || lower.contains("null root node")
        || lower.contains("could not dump")
}

/// Validate that a blob looks like a uiautomator XML dump.
fn looks_like_hierarchy(xml: &str) -> bool {
    let trimmed = xml.trim_start();
    trimmed.starts_with("<?xml") || trimmed.starts_with("<hierarchy")
}

/// Dump the current on-screen view hierarchy as raw XML.
#[tauri::command]
pub async fn dump_ui_hierarchy(serial: String, custom_path: Option<String>) -> UiDumpResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return UiDumpResult::err(&e);
    }

    // Step 1: trigger the dump. uiautomator writes the XML to a file on the
    // device and prints the destination path to stdout.
    let dump_out = match adb::run_adb_text(
        Some(&serial),
        &["shell", "uiautomator", "dump", DEFAULT_DUMP_PATH],
        custom_path.clone(),
        DUMP_TIMEOUT_SECS,
    )
    .await
    {
        Ok(o) => o,
        Err(e) => return UiDumpResult::err(&e),
    };

    if dump_failed(&dump_out) {
        return UiDumpResult::err_msg(
            "dump_failed",
            "uiautomator could not capture the screen (it may be animating, \
             secure, or showing a media surface). Try again after the screen \
             settles."
                .to_string(),
        );
    }

    let dump_path = parse_dump_path(&dump_out);

    // Step 2: read the XML back from the device.
    let xml = match adb::run_adb_text(
        Some(&serial),
        &["shell", "cat", &dump_path],
        custom_path.clone(),
        DUMP_TIMEOUT_SECS,
    )
    .await
    {
        Ok(o) => o,
        Err(e) => return UiDumpResult::err(&e),
    };

    if !looks_like_hierarchy(&xml) {
        return UiDumpResult::err_msg(
            "dump_failed",
            "The UI dump did not return a valid hierarchy. Try again.".to_string(),
        );
    }

    UiDumpResult::ok(xml)
}

/// Capture the current screen and return it as a base64 PNG data URL.
#[tauri::command]
pub async fn capture_screen_base64(
    serial: String,
    custom_path: Option<String>,
) -> ScreenCaptureResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return ScreenCaptureResult::err(&e);
    }

    let output = adb::run_adb_bytes(
        Some(&serial),
        &["exec-out", "screencap", "-p"],
        custom_path.clone(),
        CAPTURE_TIMEOUT_SECS,
    )
    .await;

    let bytes = match output {
        Ok(o) => o.stdout,
        Err(e) => return ScreenCaptureResult::err(&e),
    };

    if !validate_png(&bytes) {
        return ScreenCaptureResult::err_msg(
            "corrupt_png",
            "Captured data is empty or not a valid PNG".to_string(),
        );
    }

    let encoded = STANDARD.encode(&bytes);
    ScreenCaptureResult {
        success: true,
        data_url: Some(format!("data:image/png;base64,{}", encoded)),
        error: None,
        error_code: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dump_path_reads_reported_path() {
        assert_eq!(
            parse_dump_path("UI hierchary dumped to: /sdcard/window_dump.xml"),
            "/sdcard/window_dump.xml"
        );
        // Android's real (misspelled) message with surrounding noise.
        assert_eq!(
            parse_dump_path("some log\nUI hierchary dumped to: /data/local/tmp/x.xml\nbye"),
            "/data/local/tmp/x.xml"
        );
    }

    #[test]
    fn parse_dump_path_falls_back_to_default() {
        assert_eq!(parse_dump_path("no path here"), DEFAULT_DUMP_PATH);
        assert_eq!(parse_dump_path(""), DEFAULT_DUMP_PATH);
    }

    #[test]
    fn dump_failed_detects_known_errors() {
        assert!(dump_failed("ERROR: could not get idle state."));
        assert!(dump_failed("ERROR: null root node returned by UiTestAutomationBridge."));
        assert!(!dump_failed("UI hierchary dumped to: /sdcard/window_dump.xml"));
    }

    #[test]
    fn looks_like_hierarchy_accepts_xml() {
        assert!(looks_like_hierarchy(
            "<?xml version='1.0' encoding='UTF-8'?><hierarchy/>"
        ));
        assert!(looks_like_hierarchy("  <hierarchy rotation=\"0\"></hierarchy>"));
        assert!(!looks_like_hierarchy("ERROR: could not dump"));
        assert!(!looks_like_hierarchy(""));
    }
}
