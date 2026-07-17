// Device status backend.
//
// Gathers a rich, structured status snapshot for a single device (battery,
// Android version, resolution, IP address, storage and memory). Used by the
// Device Status panel and the multi-device Device Workspace cards. All ADB
// usage is routed through the validated `crate::adb` service.

use crate::adb;
use serde::Serialize;

const TIMEOUT_SECS: u64 = 15;

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
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charging: Option<bool>,
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
            resolution: None,
            density: None,
            battery_level: None,
            charging: None,
            ip_address: None,
            storage_total_kb: None,
            storage_used_kb: None,
            storage_available_kb: None,
            mem_total_kb: None,
            mem_available_kb: None,
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

/// Parse `dumpsys battery` for level + charging state.
fn parse_battery(text: &str) -> (Option<i32>, Option<bool>) {
    let level = value_after_colon(text, "level").and_then(|v| v.parse::<i32>().ok());
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
    (level, charging)
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
        let (level, charging) = parse_battery(&t);
        status.battery_level = level;
        status.charging = charging;
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
        let text = "  level: 87\n  status: 2\n  AC powered: false\n";
        let (level, charging) = parse_battery(text);
        assert_eq!(level, Some(87));
        assert_eq!(charging, Some(true));
    }

    #[test]
    fn parse_battery_not_charging() {
        let text = "  level: 50\n  status: 3\n  AC powered: false\n  USB powered: false\n";
        let (level, charging) = parse_battery(text);
        assert_eq!(level, Some(50));
        assert_eq!(charging, Some(false));
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
}
