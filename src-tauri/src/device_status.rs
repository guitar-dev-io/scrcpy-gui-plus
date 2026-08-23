// Device status backend.
//
// Gathers a rich, structured status snapshot for a single device (battery,
// Android version, resolution, IP address, storage and memory). Used by the
// Device Status panel and the multi-device Device Workspace cards. All ADB
// usage is routed through the validated `crate::adb` service.

use crate::adb;
use serde::Serialize;

const TIMEOUT_SECS: u64 = 15;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AndroidScreenState {
    On,
    Off,
    Dozing,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub android_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_patch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootloader: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_temperature_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charging: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen_state: Option<AndroidScreenState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_total_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_used_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_available_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_total_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem_available_kb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_rotate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDisplayGeometry {
    pub success: bool,
    pub serial: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl DeviceStatus {
    fn empty(serial: String) -> Self {
        DeviceStatus {
            success: false,
            serial: Some(serial),
            model: None,
            manufacturer: None,
            android_version: None,
            sdk: None,
            abi: None,
            security_patch: None,
            bootloader: None,
            uptime_seconds: None,
            resolution: None,
            rotation: None,
            density: None,
            battery_level: None,
            battery_temperature_c: None,
            charging: None,
            screen_state: None,
            ip_address: None,
            storage_total_kb: None,
            storage_used_kb: None,
            storage_available_kb: None,
            mem_total_kb: None,
            mem_available_kb: None,
            auto_rotate: None,
            screen_timeout_ms: None,
            error: None,
            error_code: None,
        }
    }
}

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

/// Value after the last colon on a line that starts with `key`.
fn value_after_colon(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.to_lowercase().starts_with(&key.to_lowercase()) {
            if let Some(idx) = trimmed.find(':') {
                let val = trimmed[idx + 1..].trim().to_string();
                if !val.is_empty() {
                    return Some(val);
                }
            }
        }
    }
    None
}

/// Parse `dumpsys battery` for level, temperature (tenths of a degree Celsius),
/// and charging state.
fn parse_battery(text: &str) -> (Option<i32>, Option<f64>, Option<bool>) {
    let level = value_after_colon(text, "level").and_then(|v| v.parse::<i32>().ok());
    let temperature = value_after_colon(text, "temperature")
        .and_then(|v| v.parse::<i32>().ok())
        .map(|value| value as f64 / 10.0);
    // `status: 2` == charging; also treat any powered source as charging.
    let mut charging = None;
    if let Some(status) = value_after_colon(text, "status").and_then(|v| v.parse::<i32>().ok()) {
        charging = Some(status == 2);
    }
    for src in ["AC powered", "USB powered", "Wireless powered"] {
        if let Some(v) = value_after_colon(text, src) {
            if v.eq_ignore_ascii_case("true") {
                charging = Some(true);
            }
        }
    }
    (level, temperature, charging)
}

/// Parse the stable and legacy screen-state markers emitted by `dumpsys power`.
/// Prefer the display controller state because wakefulness may remain `Awake`
/// briefly while the panel is already turning off.
fn parse_screen_state(text: &str) -> Option<AndroidScreenState> {
    let lowercase = text.to_ascii_lowercase();

    if lowercase.contains("display power: state=doze")
        || lowercase.contains("display power: state=doze_suspend")
    {
        return Some(AndroidScreenState::Dozing);
    }
    if lowercase.contains("display power: state=on") {
        return Some(AndroidScreenState::On);
    }
    if lowercase.contains("display power: state=off") {
        return Some(AndroidScreenState::Off);
    }

    for line in lowercase.lines().map(str::trim) {
        if line.contains("mwakefulness=dozing") {
            return Some(AndroidScreenState::Dozing);
        }
        if line.contains("mwakefulness=awake")
            || line.contains("mwakefulness=dreaming")
            || line.contains("mscreenon=true")
            || line.contains("minteractive=true")
        {
            return Some(AndroidScreenState::On);
        }
        if line.contains("mwakefulness=asleep")
            || line.contains("mscreenon=false")
            || line.contains("minteractive=false")
        {
            return Some(AndroidScreenState::Off);
        }
    }

    None
}

/// Extract an IPv4 address from `ip addr show` output ("inet 192.168.x.x/24").
fn parse_ip(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("inet ") {
            let addr = rest.split('/').next().unwrap_or("").trim();
            if !addr.is_empty() && addr != "127.0.0.1" {
                return Some(addr.to_string());
            }
        }
    }
    None
}

/// Parse `df /data` output into (total, used, available) in KiB.
fn parse_df(text: &str) -> (Option<u64>, Option<u64>, Option<u64>) {
    for line in text.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        // Filesystem 1K-blocks Used Available Use% Mounted-on
        if fields.len() >= 6 {
            let total = fields[fields.len() - 5].parse::<u64>().ok();
            let used = fields[fields.len() - 4].parse::<u64>().ok();
            let avail = fields[fields.len() - 3].parse::<u64>().ok();
            if total.is_some() || used.is_some() {
                return (total, used, avail);
            }
        }
    }
    (None, None, None)
}

/// Parse `/proc/meminfo` for MemTotal + MemAvailable (KiB).
fn parse_meminfo(text: &str) -> (Option<u64>, Option<u64>) {
    let mut total = None;
    let mut available = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("MemTotal:") {
            total = rest
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u64>().ok());
        } else if let Some(rest) = trimmed.strip_prefix("MemAvailable:") {
            available = rest
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u64>().ok());
        }
        if total.is_some() && available.is_some() {
            break;
        }
    }
    (total, available)
}

fn parse_uptime_seconds(text: &str) -> Option<u64> {
    text.split_whitespace()
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.floor() as u64)
}

fn parse_display_rotation(text: &str) -> Option<u8> {
    for line in text.lines().map(str::trim) {
        for marker in ["SurfaceOrientation:", "mCurrentOrientation="] {
            if let Some(value) = line.split_once(marker).map(|(_, value)| value.trim()) {
                if let Ok(rotation) = value.parse::<u8>() {
                    if rotation <= 3 {
                        return Some(rotation);
                    }
                }
            }
        }
        if let Some((_, value)) = line.split_once("mCurrentRotation=") {
            return match value.trim().split_whitespace().next().unwrap_or("") {
                "ROTATION_0" | "0" => Some(0),
                "ROTATION_90" | "1" => Some(1),
                "ROTATION_180" | "2" => Some(2),
                "ROTATION_270" | "3" => Some(3),
                _ => None,
            };
        }
    }
    None
}

#[tauri::command]
pub async fn get_device_display_geometry(
    serial: String,
    custom_path: Option<String>,
) -> DeviceDisplayGeometry {
    let serial = serial.trim().to_string();
    if let Err(error) = adb::validate_serial(&serial) {
        return DeviceDisplayGeometry {
            success: false,
            serial,
            resolution: None,
            rotation: None,
            error: Some(error.message()),
            error_code: Some(error.code().to_string()),
        };
    }

    let resolution = adb::run_adb_text(
        Some(&serial),
        &["shell", "wm", "size"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .and_then(|output| value_after_colon(&output, "Physical size"));
    let rotation = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "input"],
        custom_path,
        TIMEOUT_SECS,
    )
    .await
    .ok()
    .and_then(|output| parse_display_rotation(&output));
    let success = resolution.is_some();
    DeviceDisplayGeometry {
        success,
        serial,
        resolution,
        rotation,
        error: (!success).then(|| "Device display geometry is unavailable".to_string()),
        error_code: (!success).then(|| "geometry_unavailable".to_string()),
    }
}

/// Gather a full status snapshot for a device.
#[tauri::command]
pub async fn get_device_status(serial: String, custom_path: Option<String>) -> DeviceStatus {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        let mut s = DeviceStatus::empty(serial);
        s.error = Some(e.message());
        s.error_code = Some(e.code().to_string());
        return s;
    }

    let mut status = DeviceStatus::empty(serial.clone());

    status.model = getprop(&serial, "ro.product.model", &custom_path).await;
    status.manufacturer = getprop(&serial, "ro.product.manufacturer", &custom_path).await;
    status.android_version = getprop(&serial, "ro.build.version.release", &custom_path).await;
    status.sdk = getprop(&serial, "ro.build.version.sdk", &custom_path).await;
    status.abi = getprop(&serial, "ro.product.cpu.abi", &custom_path).await;
    status.security_patch = getprop(&serial, "ro.build.version.security_patch", &custom_path).await;
    status.bootloader = getprop(&serial, "ro.bootloader", &custom_path)
        .await
        .filter(|value| !value.eq_ignore_ascii_case("unknown"));

    if let Ok(value) = adb::run_adb_text(
        Some(&serial),
        &["shell", "cat", "/proc/uptime"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.uptime_seconds = parse_uptime_seconds(&value);
    }

    if let Ok(value) = adb::run_adb_text(
        Some(&serial),
        &[
            "shell",
            "settings",
            "get",
            "system",
            "accelerometer_rotation",
        ],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.auto_rotate = match value.trim() {
            "1" => Some(true),
            "0" => Some(false),
            _ => None,
        };
    }

    if let Ok(value) = adb::run_adb_text(
        Some(&serial),
        &["shell", "settings", "get", "system", "screen_off_timeout"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.screen_timeout_ms = value.trim().parse::<u64>().ok();
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "wm", "size"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.resolution = value_after_colon(&t, "Physical size");
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "input"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.rotation = parse_display_rotation(&t);
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "wm", "density"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.density = value_after_colon(&t, "Physical density");
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "battery"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        let (level, temperature, charging) = parse_battery(&t);
        status.battery_level = level;
        status.battery_temperature_c = temperature;
        status.charging = charging;
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "power"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.screen_state = parse_screen_state(&t);
    }

    // IP: prefer wlan0; fall back to a generic `ip route` src.
    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "ip", "-f", "inet", "addr", "show", "wlan0"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        status.ip_address = parse_ip(&t);
    }
    if status.ip_address.is_none() {
        if let Ok(t) = adb::run_adb_text(
            Some(&serial),
            &["shell", "ip", "route"],
            custom_path.clone(),
            TIMEOUT_SECS,
        )
        .await
        {
            // "... src 192.168.x.x"
            for line in t.lines() {
                if let Some(pos) = line.find(" src ") {
                    let addr = line[pos + 5..]
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !addr.is_empty() {
                        status.ip_address = Some(addr.to_string());
                        break;
                    }
                }
            }
        }
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "df", "/data"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        let (total, used, avail) = parse_df(&t);
        status.storage_total_kb = total;
        status.storage_used_kb = used;
        status.storage_available_kb = avail;
    }

    if let Ok(t) = adb::run_adb_text(
        Some(&serial),
        &["shell", "cat", "/proc/meminfo"],
        custom_path.clone(),
        TIMEOUT_SECS,
    )
    .await
    {
        let (total, available) = parse_meminfo(&t);
        status.mem_total_kb = total;
        status.mem_available_kb = available;
    }

    status.success = true;
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_battery_level_and_charging() {
        let text = "  level: 87\n  temperature: 321\n  status: 2\n  AC powered: false\n";
        let (level, temperature, charging) = parse_battery(text);
        assert_eq!(level, Some(87));
        assert_eq!(temperature, Some(32.1));
        assert_eq!(charging, Some(true));
    }

    #[test]
    fn parse_battery_not_charging() {
        let text = "  level: 50\n  status: 3\n  AC powered: false\n  USB powered: false\n";
        let (level, temperature, charging) = parse_battery(text);
        assert_eq!(level, Some(50));
        assert_eq!(temperature, None);
        assert_eq!(charging, Some(false));
    }

    #[test]
    fn parse_screen_state_prefers_display_controller_state() {
        let text = "Power Manager State:\n  mWakefulness=Awake\nDisplay Power: state=OFF\n";
        assert_eq!(parse_screen_state(text), Some(AndroidScreenState::Off));
    }

    #[test]
    fn parse_screen_state_supports_wakefulness_and_legacy_markers() {
        assert_eq!(
            parse_screen_state("Power Manager State:\n  mWakefulness=Dozing\n"),
            Some(AndroidScreenState::Dozing)
        );
        assert_eq!(
            parse_screen_state("mScreenOn=true\nmInteractive=true\n"),
            Some(AndroidScreenState::On)
        );
        assert_eq!(parse_screen_state("unrecognized output"), None);
    }

    #[test]
    fn health_additions_serialize_with_frontend_field_names() {
        let mut status = DeviceStatus::empty("pixel-1".to_string());
        status.battery_temperature_c = Some(32.1);
        status.screen_state = Some(AndroidScreenState::Dozing);
        status.rotation = Some(1);

        let json = serde_json::to_value(status).expect("status should serialize");
        assert_eq!(json["batteryTemperatureC"], serde_json::json!(32.1));
        assert_eq!(json["screenState"], serde_json::json!("dozing"));
        assert_eq!(json["rotation"], serde_json::json!(1));
    }

    #[test]
    fn parse_rotation_supports_common_android_dumpsys_formats() {
        assert_eq!(parse_display_rotation("SurfaceOrientation: 1\n"), Some(1));
        assert_eq!(
            parse_display_rotation("mCurrentRotation=ROTATION_270\n"),
            Some(3)
        );
        assert_eq!(parse_display_rotation("mCurrentOrientation=2\n"), Some(2));
        assert_eq!(parse_display_rotation("SurfaceOrientation: 9\n"), None);
    }

    #[test]
    fn parse_ip_extracts_inet() {
        let text =
            "12: wlan0: <UP>\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0\n";
        assert_eq!(parse_ip(text), Some("192.168.1.42".to_string()));
    }

    #[test]
    fn parse_ip_ignores_loopback() {
        let text = "inet 127.0.0.1/8 scope host lo\n";
        assert_eq!(parse_ip(text), None);
    }

    #[test]
    fn parse_df_extracts_columns() {
        let text = "Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/block/dm-5 100000000 40000000  60000000  40% /data\n";
        let (total, used, avail) = parse_df(text);
        assert_eq!(total, Some(100000000));
        assert_eq!(used, Some(40000000));
        assert_eq!(avail, Some(60000000));
    }

    #[test]
    fn parse_meminfo_extracts_total_and_available() {
        let text = "MemTotal:        3908456 kB\nMemFree:          123456 kB\nMemAvailable:    1500000 kB\n";
        let (total, available) = parse_meminfo(text);
        assert_eq!(total, Some(3908456));
        assert_eq!(available, Some(1500000));
    }

    #[test]
    fn parse_uptime_uses_elapsed_seconds() {
        assert_eq!(parse_uptime_seconds("93784.42 18233.10\n"), Some(93784));
        assert_eq!(parse_uptime_seconds("invalid"), None);
    }
}
