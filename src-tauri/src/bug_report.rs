// Bug report package backend.
//
// Collects device artifacts (screenshot, logcat, device/app info, existing
// recording) into a single ZIP for QA/support. Runs entirely in Rust so the
// UI never blocks, emits per-step progress events, supports cooperative
// cancellation, tolerates partial failures and cleans up temp files.

use crate::adb::{self};
use crate::screenshot::validate_png;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, State, Window};

const LOGCAT_TIMEOUT_SECS: u64 = 60;
const INFO_TIMEOUT_SECS: u64 = 30;

/// Cancellation flag for the (single) in-flight bug report generation.
pub struct BugReportState {
    pub cancelled: AtomicBool,
    pub running: Mutex<bool>,
}

impl Default for BugReportState {
    fn default() -> Self {
        BugReportState {
            cancelled: AtomicBool::new(false),
            running: Mutex::new(false),
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BugReportRequest {
    pub device_serial: String,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub steps: String,
    #[serde(default)]
    pub expected: String,
    #[serde(default)]
    pub actual: String,
    #[serde(default)]
    pub package_name: Option<String>,
    pub output_dir: String,
    #[serde(default)]
    pub include_current_screenshot: bool,
    #[serde(default)]
    pub current_screenshot_path: Option<String>,
    #[serde(default)]
    pub include_new_screenshot: bool,
    #[serde(default)]
    pub include_logcat: bool,
    #[serde(default)]
    pub include_device_info: bool,
    #[serde(default)]
    pub include_app_info: bool,
    #[serde(default)]
    pub include_recording: bool,
    #[serde(default)]
    pub recording_path: Option<String>,
    #[serde(default)]
    pub custom_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReportResult {
    pub success: bool,
    pub zip_path: String,
    pub filename: String,
    pub included_files: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub cancelled: bool,
}

/// Sanitize a filename component (mirrors the screenshot sanitizer rules).
pub fn sanitize_component(input: &str) -> String {
    crate::screenshot::sanitize_filename_component(input)
}

/// Build the ZIP filename: `BugReport_<DeviceName>_<YYYY-MM-DD_HH-mm-ss>.zip`
pub fn build_bug_report_filename(device_name: &str, timestamp: &str) -> String {
    format!(
        "BugReport_{}_{}.zip",
        sanitize_component(device_name),
        timestamp
    )
}

/// Parse a value out of `adb shell getprop` output for a given key.
pub fn extract_getprop(output: &str, key: &str) -> Option<String> {
    let needle = format!("[{}]:", key);
    for line in output.lines() {
        if line.starts_with(&needle) {
            if let Some(start) = line.rfind("[") {
                let val = &line[start + 1..];
                let val = val.trim_end_matches(']');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

/// Extract `versionName=` from `dumpsys package` output.
pub fn extract_version_name(output: &str) -> Option<String> {
    for line in output.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("versionName=") {
            let v = rest.split_whitespace().next().unwrap_or("").to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// Filter logcat for a package while preserving crash stack traces.
pub fn filter_logcat_for_package(logcat: &str, package: &str) -> String {
    let mut out = Vec::new();
    let mut in_crash = false;
    for line in logcat.lines() {
        let is_crash_marker = line.contains("FATAL EXCEPTION")
            || line.contains("AndroidRuntime")
            || line.contains("beginning of crash");
        if is_crash_marker {
            in_crash = true;
        }
        // Crash blocks are indented "at ..." continuation lines.
        let is_stack_continuation =
            in_crash && (line.trim_start().starts_with("at ") || line.contains("Caused by"));

        if line.contains(package) || is_crash_marker || is_stack_continuation {
            out.push(line);
        } else if !line.trim_start().starts_with("at ") {
            // A non-stack line that doesn't match ends the current crash block.
            in_crash = false;
        }
    }
    out.join("\n")
}

/// Build the report.md contents.
#[allow(clippy::too_many_arguments)]
pub fn build_report_markdown(
    req: &BugReportRequest,
    device_name: &str,
    android_version: &str,
    app_version: Option<&str>,
    included_files: &[String],
    warnings: &[String],
    created_at: &str,
) -> String {
    let mut md = String::new();
    let title = if req.title.trim().is_empty() {
        "Untitled Bug Report"
    } else {
        req.title.trim()
    };
    md.push_str(&format!("# {}\n\n", title));
    md.push_str(&format!("- **Created:** {}\n", created_at));
    md.push_str(&format!("- **Device name:** {}\n", device_name));
    md.push_str(&format!("- **Device serial:** {}\n", req.device_serial));
    md.push_str(&format!("- **Android version:** {}\n", android_version));
    if let Some(pkg) = req.package_name.as_deref().filter(|p| !p.trim().is_empty()) {
        md.push_str(&format!("- **Package:** {}\n", pkg));
        if let Some(v) = app_version {
            md.push_str(&format!("- **App version:** {}\n", v));
        }
    }
    md.push('\n');

    md.push_str("## Description\n\n");
    md.push_str(&format!("{}\n\n", empty_placeholder(&req.description)));
    md.push_str("## Steps to Reproduce\n\n");
    md.push_str(&format!("{}\n\n", empty_placeholder(&req.steps)));
    md.push_str("## Expected Result\n\n");
    md.push_str(&format!("{}\n\n", empty_placeholder(&req.expected)));
    md.push_str("## Actual Result\n\n");
    md.push_str(&format!("{}\n\n", empty_placeholder(&req.actual)));

    md.push_str("## Included Files\n\n");
    if included_files.is_empty() {
        md.push_str("_None_\n\n");
    } else {
        for f in included_files {
            md.push_str(&format!("- `{}`\n", f));
        }
        md.push('\n');
    }

    md.push_str("## Collection Warnings\n\n");
    if warnings.is_empty() {
        md.push_str("_None_\n");
    } else {
        for w in warnings {
            md.push_str(&format!("- {}\n", w));
        }
    }

    md
}

fn empty_placeholder(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        "_Not provided_".to_string()
    } else {
        t.to_string()
    }
}

/// A single entry to place in the ZIP.
pub enum ZipSource {
    Path(PathBuf),
    Bytes(Vec<u8>),
}

pub struct ZipEntry {
    pub name: String,
    pub source: ZipSource,
}

/// Create a ZIP archive from the given entries.
pub fn create_zip_archive(zip_path: &Path, entries: &[ZipEntry]) -> Result<(), String> {
    let file = std::fs::File::create(zip_path).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in entries {
        writer
            .start_file(entry.name.clone(), options)
            .map_err(|e| e.to_string())?;
        match &entry.source {
            ZipSource::Bytes(b) => {
                writer.write_all(b).map_err(|e| e.to_string())?;
            }
            ZipSource::Path(p) => {
                let data = std::fs::read(p).map_err(|e| format!("{}: {}", p.display(), e))?;
                writer.write_all(&data).map_err(|e| e.to_string())?;
            }
        }
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn emit_progress(window: &Window, step: &str, status: &str, message: &str) {
    let _ = window.emit(
        "bug-report-progress",
        serde_json::json!({
            "step": step,
            "status": status,
            "message": message,
        }),
    );
}

/// Cancel the in-flight bug report generation.
#[tauri::command]
pub fn cancel_bug_report(state: State<'_, BugReportState>) {
    state.cancelled.store(true, Ordering::SeqCst);
}

fn is_cancelled(state: &BugReportState) -> bool {
    state.cancelled.load(Ordering::SeqCst)
}

/// Generate a bug report ZIP. Emits `bug-report-progress` events per step.
#[tauri::command]
pub async fn create_bug_report(
    window: Window,
    state: State<'_, BugReportState>,
    request: BugReportRequest,
) -> Result<BugReportResult, String> {
    // Guard against concurrent runs.
    {
        let mut running = state.running.lock().unwrap();
        if *running {
            return Ok(BugReportResult {
                success: false,
                zip_path: String::new(),
                filename: String::new(),
                included_files: vec![],
                warnings: vec![],
                error: Some("A bug report is already being generated".to_string()),
                cancelled: false,
            });
        }
        *running = true;
    }
    state.cancelled.store(false, Ordering::SeqCst);

    let result = generate(&window, &state, &request).await;

    *state.running.lock().unwrap() = false;
    result
}

async fn generate(
    window: &Window,
    state: &BugReportState,
    req: &BugReportRequest,
) -> Result<BugReportResult, String> {
    let serial = req.device_serial.trim().to_string();
    if adb::validate_serial(&serial).is_err() {
        return Ok(BugReportResult {
            success: false,
            zip_path: String::new(),
            filename: String::new(),
            included_files: vec![],
            warnings: vec![],
            error: Some("Invalid device serial".to_string()),
            cancelled: false,
        });
    }

    if let Some(pkg) = req.package_name.as_deref().filter(|p| !p.trim().is_empty()) {
        if adb::validate_package_name(pkg.trim()).is_err() {
            return Ok(BugReportResult {
                success: false,
                zip_path: String::new(),
                filename: String::new(),
                included_files: vec![],
                warnings: vec![],
                error: Some("Invalid package name".to_string()),
                cancelled: false,
            });
        }
    }

    let device_name = req
        .device_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&serial)
        .to_string();

    let created_at = chrono::Local::now().to_rfc3339();
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();

    // Temp working dir for cleanup safety.
    let temp_dir = std::env::temp_dir().join(format!(
        "scrcpygui-bugreport-{}-{}",
        std::process::id(),
        timestamp
    ));
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return Ok(BugReportResult {
            success: false,
            zip_path: String::new(),
            filename: String::new(),
            included_files: vec![],
            warnings: vec![],
            error: Some(format!("Could not create temp directory: {}", e)),
            cancelled: false,
        });
    }

    let mut warnings: Vec<String> = Vec::new();
    let mut included_files: Vec<String> = Vec::new();
    let mut entries: Vec<ZipEntry> = Vec::new();
    let mut android_version = "unknown".to_string();
    let mut app_version: Option<String> = None;

    macro_rules! bail_cancel {
        () => {
            if is_cancelled(state) {
                let _ = std::fs::remove_dir_all(&temp_dir);
                emit_progress(window, "cancelled", "done", "Cancelled");
                return Ok(BugReportResult {
                    success: false,
                    zip_path: String::new(),
                    filename: String::new(),
                    included_files: vec![],
                    warnings,
                    error: Some("Cancelled by user".to_string()),
                    cancelled: true,
                });
            }
        };
    }

    // Device info (also used to enrich report.md even if not zipped).
    bail_cancel!();
    if req.include_device_info || req.include_logcat {
        emit_progress(
            window,
            "device-info",
            "running",
            "Collecting device information",
        );
        match collect_device_info(&serial, req.custom_path.clone()).await {
            Ok((json_text, ver)) => {
                android_version = ver;
                if req.include_device_info {
                    entries.push(ZipEntry {
                        name: "device-info.json".to_string(),
                        source: ZipSource::Bytes(json_text.into_bytes()),
                    });
                    included_files.push("device-info.json".to_string());
                }
                emit_progress(
                    window,
                    "device-info",
                    "done",
                    "Device information collected",
                );
            }
            Err(e) => {
                warnings.push(format!("Device info collection failed: {}", e));
                emit_progress(window, "device-info", "failed", &e);
            }
        }
    }

    // App info.
    bail_cancel!();
    if req.include_app_info {
        if let Some(pkg) = req.package_name.as_deref().filter(|p| !p.trim().is_empty()) {
            emit_progress(
                window,
                "app-info",
                "running",
                "Collecting application information",
            );
            match collect_app_info(&serial, pkg.trim(), req.custom_path.clone()).await {
                Ok((json_text, ver)) => {
                    app_version = ver;
                    entries.push(ZipEntry {
                        name: "app-info.json".to_string(),
                        source: ZipSource::Bytes(json_text.into_bytes()),
                    });
                    included_files.push("app-info.json".to_string());
                    emit_progress(
                        window,
                        "app-info",
                        "done",
                        "Application information collected",
                    );
                }
                Err(e) => {
                    warnings.push(format!("App info collection failed: {}", e));
                    emit_progress(window, "app-info", "failed", &e);
                }
            }
        } else {
            warnings.push("App info requested but no package name provided".to_string());
            emit_progress(window, "app-info", "skipped", "No package name provided");
        }
    }

    // Logcat.
    bail_cancel!();
    if req.include_logcat {
        emit_progress(window, "logcat", "running", "Collecting logcat");
        match collect_logcat(
            &serial,
            req.package_name.as_deref(),
            req.custom_path.clone(),
        )
        .await
        {
            Ok(text) => {
                entries.push(ZipEntry {
                    name: "logcat.txt".to_string(),
                    source: ZipSource::Bytes(text.into_bytes()),
                });
                included_files.push("logcat.txt".to_string());
                emit_progress(window, "logcat", "done", "Logcat collected");
            }
            Err(e) => {
                warnings.push(format!("Logcat collection failed: {}", e));
                emit_progress(window, "logcat", "failed", &e);
            }
        }
    }

    // New screenshot captured during generation.
    bail_cancel!();
    if req.include_new_screenshot {
        emit_progress(window, "screenshot", "running", "Capturing screenshot");
        match adb::run_adb_bytes(
            Some(&serial),
            &["exec-out", "screencap", "-p"],
            req.custom_path.clone(),
            INFO_TIMEOUT_SECS,
        )
        .await
        {
            Ok(out) if validate_png(&out.stdout) => {
                entries.push(ZipEntry {
                    name: "screenshot.png".to_string(),
                    source: ZipSource::Bytes(out.stdout),
                });
                included_files.push("screenshot.png".to_string());
                emit_progress(window, "screenshot", "done", "Screenshot captured");
            }
            Ok(_) => {
                warnings.push("Screenshot capture returned invalid PNG data".to_string());
                emit_progress(window, "screenshot", "failed", "Invalid PNG data");
            }
            Err(e) => {
                warnings.push(format!("Screenshot capture failed: {}", e.message()));
                emit_progress(window, "screenshot", "failed", &e.message());
            }
        }
    } else if req.include_current_screenshot {
        // Use an already-captured screenshot file.
        if let Some(path) = req
            .current_screenshot_path
            .as_deref()
            .filter(|p| !p.is_empty())
        {
            if Path::new(path).exists() {
                entries.push(ZipEntry {
                    name: "screenshot.png".to_string(),
                    source: ZipSource::Path(PathBuf::from(path)),
                });
                included_files.push("screenshot.png".to_string());
                emit_progress(window, "screenshot", "done", "Current screenshot included");
            } else {
                warnings.push("Current screenshot file no longer exists".to_string());
                emit_progress(window, "screenshot", "failed", "Screenshot file missing");
            }
        } else {
            warnings.push("Current screenshot requested but no path provided".to_string());
            emit_progress(window, "screenshot", "skipped", "No screenshot path");
        }
    }

    // Existing recording (never deleted - user provided).
    bail_cancel!();
    if req.include_recording {
        if let Some(path) = req.recording_path.as_deref().filter(|p| !p.is_empty()) {
            if Path::new(path).exists() {
                let ext = Path::new(path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("mp4");
                let name = format!("recording.{}", ext);
                entries.push(ZipEntry {
                    name: name.clone(),
                    source: ZipSource::Path(PathBuf::from(path)),
                });
                included_files.push(name);
                emit_progress(window, "recording", "done", "Recording included");
            } else {
                warnings.push("Recording file does not exist".to_string());
                emit_progress(window, "recording", "failed", "Recording file missing");
            }
        } else {
            warnings.push("Recording requested but no path provided".to_string());
            emit_progress(window, "recording", "skipped", "No recording path");
        }
    }

    // report.md is always generated last so it can list everything included.
    bail_cancel!();
    emit_progress(window, "report", "running", "Writing report.md");
    let markdown = build_report_markdown(
        req,
        &device_name,
        &android_version,
        app_version.as_deref(),
        &included_files,
        &warnings,
        &created_at,
    );
    // Insert report.md at the front of the archive.
    entries.insert(
        0,
        ZipEntry {
            name: "report.md".to_string(),
            source: ZipSource::Bytes(markdown.into_bytes()),
        },
    );
    included_files.insert(0, "report.md".to_string());
    emit_progress(window, "report", "done", "report.md written");

    // Create the ZIP.
    emit_progress(window, "package", "running", "Packaging ZIP");
    let filename = build_bug_report_filename(&device_name, &timestamp);
    let zip_path = Path::new(&req.output_dir).join(&filename);

    let zip_result = create_zip_archive(&zip_path, &entries);

    // Always clean up temp dir.
    let _ = std::fs::remove_dir_all(&temp_dir);

    match zip_result {
        Ok(_) => {
            emit_progress(window, "package", "done", "ZIP created");
            Ok(BugReportResult {
                success: true,
                zip_path: zip_path.to_string_lossy().to_string(),
                filename,
                included_files,
                warnings,
                error: None,
                cancelled: false,
            })
        }
        Err(e) => {
            emit_progress(window, "package", "failed", &e);
            Ok(BugReportResult {
                success: false,
                zip_path: String::new(),
                filename,
                included_files,
                warnings,
                error: Some(format!("Failed to create ZIP: {}", e)),
                cancelled: false,
            })
        }
    }
}

async fn collect_device_info(
    serial: &str,
    custom_path: Option<String>,
) -> Result<(String, String), String> {
    let getprop = adb::run_adb_text(
        Some(serial),
        &["shell", "getprop"],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| e.message())?;

    let wm_size = adb::run_adb_text(
        Some(serial),
        &["shell", "wm", "size"],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    let wm_density = adb::run_adb_text(
        Some(serial),
        &["shell", "wm", "density"],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    let battery = adb::run_adb_text(
        Some(serial),
        &["shell", "dumpsys", "battery"],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    let df = adb::run_adb_text(
        Some(serial),
        &["shell", "df"],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    let android_version =
        extract_getprop(&getprop, "ro.build.version.release").unwrap_or_else(|| "unknown".into());
    let model = extract_getprop(&getprop, "ro.product.model").unwrap_or_default();
    let manufacturer = extract_getprop(&getprop, "ro.product.manufacturer").unwrap_or_default();
    let sdk = extract_getprop(&getprop, "ro.build.version.sdk").unwrap_or_default();

    let json = serde_json::json!({
        "serial": serial,
        "manufacturer": manufacturer,
        "model": model,
        "androidVersion": android_version,
        "sdk": sdk,
        "screenSize": wm_size,
        "screenDensity": wm_density,
        "battery": battery,
        "storage": df,
        "getprop": getprop.trim(),
    });

    let text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    Ok((text, android_version))
}

async fn collect_app_info(
    serial: &str,
    package: &str,
    custom_path: Option<String>,
) -> Result<(String, Option<String>), String> {
    let dump = adb::run_adb_text(
        Some(serial),
        &["shell", "dumpsys", "package", package],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| e.message())?;

    let path = adb::run_adb_text(
        Some(serial),
        &["shell", "pm", "path", package],
        custom_path.clone(),
        INFO_TIMEOUT_SECS,
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    let version = extract_version_name(&dump);

    let json = serde_json::json!({
        "package": package,
        "versionName": version,
        "apkPaths": path,
        "dumpsys": dump.trim(),
    });

    let text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    Ok((text, version))
}

async fn collect_logcat(
    serial: &str,
    package: Option<&str>,
    custom_path: Option<String>,
) -> Result<String, String> {
    let raw = adb::run_adb_text(
        Some(serial),
        &["logcat", "-d", "-v", "threadtime"],
        custom_path,
        LOGCAT_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| e.message())?;

    match package.filter(|p| !p.trim().is_empty()) {
        Some(pkg) => Ok(filter_logcat_for_package(&raw, pkg.trim())),
        None => Ok(raw),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> BugReportRequest {
        BugReportRequest {
            device_serial: "ABC123".to_string(),
            device_name: Some("Pixel 7".to_string()),
            title: "Crash on login".to_string(),
            description: "App crashes".to_string(),
            steps: "1. Open app\n2. Tap login".to_string(),
            expected: "Logs in".to_string(),
            actual: "Crashes".to_string(),
            package_name: Some("com.example.app".to_string()),
            output_dir: ".".to_string(),
            include_current_screenshot: false,
            current_screenshot_path: None,
            include_new_screenshot: false,
            include_logcat: false,
            include_device_info: false,
            include_app_info: false,
            include_recording: false,
            recording_path: None,
            custom_path: None,
        }
    }

    #[test]
    fn filename_format_and_sanitization() {
        let f = build_bug_report_filename("Pixel 7 Pro", "2026-07-16_10-30-00");
        assert_eq!(f, "BugReport_Pixel_7_Pro_2026-07-16_10-30-00.zip");
        let f2 = build_bug_report_filename("bad/name:1", "2026-07-16_10-30-00");
        assert_eq!(f2, "BugReport_bad_name_1_2026-07-16_10-30-00.zip");
    }

    #[test]
    fn getprop_extraction() {
        let out = "[ro.build.version.release]: [13]\n[ro.product.model]: [Pixel 7]\n";
        assert_eq!(
            extract_getprop(out, "ro.build.version.release"),
            Some("13".to_string())
        );
        assert_eq!(
            extract_getprop(out, "ro.product.model"),
            Some("Pixel 7".to_string())
        );
        assert_eq!(extract_getprop(out, "missing.key"), None);
    }

    #[test]
    fn version_name_extraction() {
        let dump = "  versionCode=42\n  versionName=1.2.3\n";
        assert_eq!(extract_version_name(dump), Some("1.2.3".to_string()));
        assert_eq!(extract_version_name("nothing here"), None);
    }

    #[test]
    fn logcat_filter_keeps_package_and_crashes() {
        let logcat = "\
07-16 10:00:00.000  100  100 I other: unrelated line
07-16 10:00:01.000  200  200 I com.example.app: my log line
07-16 10:00:02.000  300  300 E AndroidRuntime: FATAL EXCEPTION: main
\tat com.foo.Bar.baz(Bar.java:1)
\tat com.foo.Qux.run(Qux.java:2)
07-16 10:00:03.000  400  400 I other: another unrelated line";
        let filtered = filter_logcat_for_package(logcat, "com.example.app");
        assert!(filtered.contains("my log line"));
        assert!(filtered.contains("FATAL EXCEPTION"));
        assert!(filtered.contains("Bar.java:1"));
        assert!(filtered.contains("Qux.java:2"));
        assert!(!filtered.contains("unrelated line"));
        assert!(!filtered.contains("another unrelated line"));
    }

    #[test]
    fn report_markdown_contains_all_sections() {
        let req = sample_request();
        let md = build_report_markdown(
            &req,
            "Pixel 7",
            "13",
            Some("1.2.3"),
            &["report.md".to_string(), "logcat.txt".to_string()],
            &["Logcat collection failed: timeout".to_string()],
            "2026-07-16T10:30:00+00:00",
        );
        assert!(md.contains("# Crash on login"));
        assert!(md.contains("**Android version:** 13"));
        assert!(md.contains("**App version:** 1.2.3"));
        assert!(md.contains("## Steps to Reproduce"));
        assert!(md.contains("## Expected Result"));
        assert!(md.contains("## Actual Result"));
        assert!(md.contains("logcat.txt"));
        assert!(md.contains("Logcat collection failed: timeout"));
    }

    #[test]
    fn report_markdown_handles_empty_fields() {
        let mut req = sample_request();
        req.title = "".to_string();
        req.description = "".to_string();
        req.package_name = None;
        let md = build_report_markdown(&req, "Dev", "unknown", None, &[], &[], "now");
        assert!(md.contains("# Untitled Bug Report"));
        assert!(md.contains("_Not provided_"));
        assert!(md.contains("_None_"));
        assert!(!md.contains("**App version:**"));
    }

    #[test]
    fn zip_creation_roundtrip() {
        let dir = std::env::temp_dir().join(format!("scrcpygui-zip-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // One entry from bytes, one from a file on disk.
        let file_path = dir.join("source.txt");
        std::fs::write(&file_path, b"file contents").unwrap();

        let zip_path = dir.join("out.zip");
        let entries = vec![
            ZipEntry {
                name: "report.md".to_string(),
                source: ZipSource::Bytes(b"# Report".to_vec()),
            },
            ZipEntry {
                name: "data/source.txt".to_string(),
                source: ZipSource::Path(file_path.clone()),
            },
        ];
        create_zip_archive(&zip_path, &entries).unwrap();

        let f = std::fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(f).unwrap();
        assert_eq!(archive.len(), 2);
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"report.md".to_string()));
        assert!(names.contains(&"data/source.txt".to_string()));

        use std::io::Read;
        let mut s = String::new();
        archive
            .by_name("report.md")
            .unwrap()
            .read_to_string(&mut s)
            .unwrap();
        assert_eq!(s, "# Report");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn partial_failure_still_lists_successful_files() {
        // Simulate the state after logcat failed but device-info succeeded:
        // report markdown should surface the warning and still list the file.
        let req = sample_request();
        let included = vec!["report.md".to_string(), "device-info.json".to_string()];
        let warnings = vec!["Logcat collection failed: device offline".to_string()];
        let md = build_report_markdown(&req, "Pixel 7", "13", None, &included, &warnings, "now");
        assert!(md.contains("device-info.json"));
        assert!(md.contains("Logcat collection failed: device offline"));
    }
}
