// Test session backend helpers.
//
// A "test session" orchestrates several QA actions (clear logcat, enable
// pointer location / show touches, capture a screenshot, gather device info,
// record the screen) and bundles the artifacts together. Most orchestration
// lives on the frontend which reuses the existing recording/screenshot/logcat
// commands; this module only adds the two pieces that did not exist yet:
// toggling "show touches" and gathering a structured device-info snapshot.
//
// All ADB usage goes through the validated `crate::adb` service.

use crate::adb::{self, AdbError};
use serde::Serialize;

const TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub android_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn err_simple(e: &AdbError) -> SimpleResult {
    SimpleResult {
        success: false,
        error: Some(e.message()),
        error_code: Some(e.code().to_string()),
    }
}

/// Toggle "Show touches" (pointer taps) on the device.
#[tauri::command]
pub async fn set_show_touches(
    serial: String,
    enabled: bool,
    custom_path: Option<String>,
) -> SimpleResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return err_simple(&e);
    }
    let value = if enabled { "1" } else { "0" };
    match adb::run_adb_text(
        Some(&serial),
        &["shell", "settings", "put", "system", "show_touches", value],
        custom_path,
        TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => SimpleResult {
            success: true,
            error: None,
            error_code: None,
        },
        Err(e) => err_simple(&e),
    }
}

/// Read a single getprop value, returning None when empty.
async fn getprop(serial: &str, prop: &str, custom_path: &Option<String>) -> Option<String> {
    adb::run_adb_text(
        Some(serial),
        &["shell", "getprop", prop],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

/// Parse a "key: value" style line, returning the value after the last colon.
fn value_after_colon(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.to_lowercase().starts_with(&key.to_lowercase()) {
            if let Some(idx) = line.find(':') {
                let val = line[idx + 1..].trim().to_string();
                if !val.is_empty() {
                    return Some(val);
                }
            }
        }
    }
    None
}

/// Gather a structured device-info snapshot.
#[tauri::command]
pub async fn get_device_info(serial: String, custom_path: Option<String>) -> DeviceInfo {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return DeviceInfo {
            success: false,
            model: None,
            manufacturer: None,
            android_version: None,
            sdk: None,
            resolution: None,
            density: None,
            battery: None,
            abi: None,
            serial: Some(serial),
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        };
    }

    let model = getprop(&serial, "ro.product.model", &custom_path).await;
    let manufacturer = getprop(&serial, "ro.product.manufacturer", &custom_path).await;
    let android_version = getprop(&serial, "ro.build.version.release", &custom_path).await;
    let sdk = getprop(&serial, "ro.build.version.sdk", &custom_path).await;
    let abi = getprop(&serial, "ro.product.cpu.abi", &custom_path).await;

    let resolution = adb::run_adb_text(
        Some(&serial),
        &["shell", "wm", "size"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .and_then(|t| value_after_colon(&t, "Physical size"));

    let density = adb::run_adb_text(
        Some(&serial),
        &["shell", "wm", "density"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .and_then(|t| value_after_colon(&t, "Physical density"));

    let battery = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "battery"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .and_then(|t| value_after_colon(&t, "level"));

    DeviceInfo {
        success: true,
        model,
        manufacturer,
        android_version,
        sdk,
        resolution,
        density,
        battery,
        abi,
        serial: Some(serial),
        error: None,
        error_code: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_after_colon_extracts_wm_size() {
        let text = "Physical size: 1080x2340\n";
        assert_eq!(value_after_colon(text, "Physical size"), Some("1080x2340".to_string()));
    }

    #[test]
    fn value_after_colon_extracts_density() {
        let text = "Physical density: 440";
        assert_eq!(value_after_colon(text, "Physical density"), Some("440".to_string()));
    }

    #[test]
    fn value_after_colon_extracts_battery_level() {
        let text = "Current Battery Service state:\n  level: 87\n  scale: 100\n";
        assert_eq!(value_after_colon(text, "level"), Some("87".to_string()));
    }

    #[test]
    fn value_after_colon_missing_returns_none() {
        assert_eq!(value_after_colon("nothing here", "level"), None);
    }
}
