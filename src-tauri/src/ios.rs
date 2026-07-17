// iOS support (Phase 1: view-only screen mirroring on macOS via pymobiledevice3).
//
// The earlier AVFoundation/ffmpeg approach is dead on modern macOS (26+): the OS
// no longer publishes a connected iPhone as a CoreMediaIO/AVFoundation capture
// device, so ffmpeg can never see it. This module uses a completely different,
// working mechanism: the iOS *developer* debug interface, driven by
// `pymobiledevice3` (usbmux + lockdown + DVT). This path is proven to work on
// macOS 26 with an iOS 16 device, with NO sudo, NO tunneld (that's iOS 17+
// only), and NO WebDriverAgent (that's for touch control, a later phase).
//
// Screen streaming: we spawn a small persistent Python helper (embedded below)
// that connects once via the DVT Screenshot service and loops capturing PNG
// frames, writing each as `[u32 big-endian length][png bytes]` to stdout. Rust
// reads that framed stream and forwards each frame to the webview as a base64
// data URL via the `ios-frame` event. Frame rate is hardware-limited by the iOS
// debug interface (~2-15 fps depending on device) — fine for viewing.

use crate::commands::create_command;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader as StdBufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// Guard against a corrupt/rogue frame header requesting an absurd allocation.
/// Full-resolution iPhone PNG frames are a few MB; 64 MB is a generous ceiling.
const MAX_FRAME_BYTES: u32 = 64 * 1024 * 1024;

/// The persistent frame streamer. Written to a temp file and run with the
/// Python interpreter that owns pymobiledevice3 (resolved from its shebang).
const STREAMER_SCRIPT: &str = r#"import sys, asyncio, struct
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot

async def main():
    udid = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    out = sys.stdout.buffer
    lockdown = await create_using_usbmux(serial=udid)
    async with DvtProvider(lockdown) as dvt, Screenshot(dvt) as screenshot:
        sys.stderr.write("ios-stream: connected\n")
        sys.stderr.flush()
        while True:
            png = await screenshot.get_screenshot()
            out.write(struct.pack(">I", len(png)))
            out.write(png)
            out.flush()

try:
    asyncio.run(main())
except (BrokenPipeError, KeyboardInterrupt):
    pass
except Exception as e:
    sys.stderr.write(f"ios-stream-error: {e}\n")
    sys.exit(1)
"#;

/// State holding in-flight iOS mirror (streamer) processes keyed by device UDID.
pub struct IosState {
    pub processes: Mutex<HashMap<String, tokio::process::Child>>,
}

impl Default for IosState {
    fn default() -> Self {
        IosState {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IosDeviceInfo {
    pub udid: String,
    pub name: String,
    pub product_type: String,
    pub product_version: String,
    pub connection_type: String,
}

fn detect_host_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// The app-managed virtual environment bin dir (created by `install_pymobiledevice3`).
/// Lives under the OS app-data dir so it survives app updates and needs no admin.
fn managed_venv_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("ios-tools").join("venv"))
}

fn managed_venv_bin(app_handle: &AppHandle) -> Option<PathBuf> {
    managed_venv_dir(app_handle).map(|d| d.join("bin"))
}

/// Locate the `pymobiledevice3` executable, in priority order:
///   1. a user-configured folder
///   2. the app-managed venv (installed from within the app)
///   3. a login-shell PATH (covers Homebrew `/opt/homebrew/bin` and pipx `~/.local/bin`)
fn resolve_pymobiledevice3(managed_bin: Option<PathBuf>, custom: Option<String>) -> Option<String> {
    if let Some(dir) = custom {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            let p = Path::new(trimmed).join("pymobiledevice3");
            if p.exists() && p.is_file() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }

    if let Some(bin) = managed_bin {
        let p = bin.join("pymobiledevice3");
        if p.exists() && p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }

    // Use a login shell so we inherit the user's real PATH (GUI apps launched
    // from Finder otherwise have a minimal PATH).
    let out = std::process::Command::new("sh")
        .arg("-lc")
        .arg("command -v pymobiledevice3")
        .output()
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

/// Resolve an absolute path to a system Python (>= 3.10) suitable for creating
/// the managed venv. Tries common interpreter names via a login shell PATH.
async fn find_system_python() -> Option<String> {
    for cand in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
    ] {
        let out = std::process::Command::new("sh")
            .arg("-lc")
            .arg(format!("command -v {}", cand))
            .output()
            .ok();
        let path = match out {
            Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => continue,
        };
        if path.is_empty() {
            continue;
        }
        // Gate on version >= 3.10 (pymobiledevice3 requirement).
        let ok = create_command(&path)
            .args([
                "-c",
                "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)",
            ])
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(path);
        }
    }
    None
}

/// Resolve the Python interpreter that owns pymobiledevice3. Console scripts
/// created by pip/pipx embed the absolute interpreter path in their shebang,
/// so reading the first line is the most reliable approach (handles venvs and
/// pipx symlinks). Falls back to a sibling `python3`, then bare `python3`.
pub fn resolve_python_from_shebang(exe: &str, first_line: Option<&str>) -> String {
    // Prefer the interpreter that lives alongside the console script. For a venv
    // or pipx install, `<bin>/python3` is the exact interpreter that owns
    // pymobiledevice3. This must take priority over the shebang, because when the
    // install path contains spaces (e.g. "Application Support"), pip emits a
    // polyglot `#!/bin/sh` wrapper whose shebang is NOT a Python interpreter.
    if let Some(parent) = Path::new(exe).parent() {
        for name in ["python3", "python"] {
            let sibling = parent.join(name);
            if sibling.exists() {
                return sibling.to_string_lossy().to_string();
            }
        }
    }

    // Otherwise fall back to the shebang, but only accept a genuine Python
    // interpreter (ignore `/bin/sh` wrappers and the like).
    if let Some(line) = first_line {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("#!") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if let Some(&first) = parts.first() {
                // "#!/usr/bin/env python3" -> take the arg after env.
                if first.ends_with("env") {
                    if let Some(&second) = parts.get(1) {
                        if second.contains("python") {
                            return second.to_string();
                        }
                    }
                } else if first.contains("python") {
                    return first.to_string();
                }
            }
        }
    }

    "python3".to_string()
}

fn resolve_python_for(exe: &str) -> String {
    let real = std::fs::canonicalize(exe)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| exe.to_string());
    let first_line = std::fs::File::open(&real).ok().and_then(|f| {
        let mut line = String::new();
        StdBufReader::new(f).read_line(&mut line).ok().map(|_| line)
    });
    resolve_python_from_shebang(&real, first_line.as_deref())
}

/// Parse the JSON array printed by `pymobiledevice3 usbmux list`. Deduplicates
/// by UDID, preferring a USB connection over Network when a device is reachable
/// both ways.
pub fn parse_usbmux_devices(json_str: &str) -> Vec<IosDeviceInfo> {
    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut by_udid: HashMap<String, IosDeviceInfo> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for entry in arr {
        let udid = entry
            .get("UniqueDeviceID")
            .or_else(|| entry.get("Identifier"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if udid.is_empty() {
            continue;
        }
        let connection_type = entry
            .get("ConnectionType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let info = IosDeviceInfo {
            udid: udid.clone(),
            name: entry
                .get("DeviceName")
                .and_then(|v| v.as_str())
                .unwrap_or("iOS Device")
                .to_string(),
            product_type: entry
                .get("ProductType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            product_version: entry
                .get("ProductVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            connection_type: connection_type.clone(),
        };

        match by_udid.get(&udid) {
            Some(existing) => {
                // Prefer USB over any other connection type.
                if existing.connection_type != "USB" && connection_type == "USB" {
                    by_udid.insert(udid, info);
                }
            }
            None => {
                order.push(udid.clone());
                by_udid.insert(udid, info);
            }
        }
    }

    order
        .into_iter()
        .filter_map(|u| by_udid.remove(&u))
        .collect()
}

/// Report whether iOS mirroring is supported here and whether pymobiledevice3
/// is installed.
#[tauri::command]
pub async fn check_ios_support(
    app_handle: AppHandle,
    custom_path: Option<String>,
) -> serde_json::Value {
    let host_os = detect_host_os();
    let supported = host_os == "macos";

    if !supported {
        return json!({
            "hostOs": host_os,
            "supported": false,
            "found": false,
            "message": "iOS mirroring is currently only supported on macOS",
        });
    }

    let exe = resolve_pymobiledevice3(managed_venv_bin(&app_handle), custom_path);
    let found = exe.is_some();

    let version = if let Some(ref e) = exe {
        create_command(e)
            .arg("version")
            .output()
            .await
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        None
    };

    let message = if found {
        "iOS mirroring ready".to_string()
    } else {
        "pymobiledevice3 not installed. Click Install to set it up automatically.".to_string()
    };

    json!({
        "hostOs": host_os,
        "supported": true,
        "found": found,
        "version": version,
        "message": message,
    })
}

/// Enumerate connected iOS devices via `pymobiledevice3 usbmux list`.
#[tauri::command]
pub async fn get_ios_devices(
    app_handle: AppHandle,
    custom_path: Option<String>,
) -> serde_json::Value {
    if detect_host_os() != "macos" {
        return json!({ "supported": false, "devices": [] });
    }

    let exe = match resolve_pymobiledevice3(managed_venv_bin(&app_handle), custom_path) {
        Some(e) => e,
        None => {
            return json!({ "supported": true, "found": false, "devices": [] });
        }
    };

    // NB: `usbmux list` prints a JSON array to stdout when not attached to a TTY
    // (which is always the case here). Do NOT pass `--no-color`; it is not a
    // valid option for this subcommand and makes the command error out.
    let output = create_command(&exe).args(["usbmux", "list"]).output().await;

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let devices = parse_usbmux_devices(&stdout);
            json!({ "supported": true, "found": true, "devices": devices })
        }
        Err(e) => {
            json!({ "supported": true, "found": true, "error": true, "message": e.to_string(), "devices": [] })
        }
    }
}

/// Start streaming the given device's screen (view-only) to the frontend.
#[tauri::command]
pub async fn start_ios_mirror(
    window: Window,
    state: State<'_, IosState>,
    udid: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    if detect_host_os() != "macos" {
        return Ok(
            json!({ "success": false, "message": "iOS mirroring is only supported on macOS" }),
        );
    }

    {
        let processes = state.processes.lock().unwrap();
        if processes.contains_key(&udid) {
            return Ok(
                json!({ "success": false, "message": "A mirror session is already running for this device" }),
            );
        }
    }

    let managed_bin = managed_venv_bin(window.app_handle());
    let exe = match resolve_pymobiledevice3(managed_bin, custom_path) {
        Some(e) => e,
        None => {
            return Ok(json!({ "success": false, "message": "pymobiledevice3 not found" }));
        }
    };
    let python = resolve_python_for(&exe);

    // Write the embedded streamer to a temp file.
    let script_path = std::env::temp_dir().join("scrcpygui-ios-stream.py");
    if let Err(e) = std::fs::write(&script_path, STREAMER_SCRIPT) {
        return Ok(
            json!({ "success": false, "message": format!("Failed to write streamer: {}", e) }),
        );
    }

    let _ = window.emit(
        "scrcpy-log",
        format!("[SYSTEM] Starting iOS mirror (view-only) for {}...", udid),
    );

    let mut child = match create_command(&python)
        .arg(&script_path)
        .arg(&udid)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Failed to launch streamer: {}", e);
            let _ = window.emit("scrcpy-log", format!("[SYSTEM] {}", msg));
            return Ok(json!({ "success": false, "message": msg }));
        }
    };

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // Forward diagnostic lines from the streamer into the shared log panel.
    let win_err = window.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit("scrcpy-log", format!("[iOS] {}", line));
        }
    });

    // Read length-prefixed PNG frames and forward them to the webview.
    let win_frame = window.clone();
    let udid_frame = udid.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut seq: u64 = 0;
        loop {
            let mut header = [0u8; 4];
            if reader.read_exact(&mut header).await.is_err() {
                break;
            }
            let len = u32::from_be_bytes(header);
            if len == 0 || len > MAX_FRAME_BYTES {
                break;
            }
            let mut buf = vec![0u8; len as usize];
            if reader.read_exact(&mut buf).await.is_err() {
                break;
            }
            seq += 1;
            let data_url = format!("data:image/png;base64,{}", BASE64.encode(&buf));
            let _ = win_frame.emit(
                "ios-frame",
                json!({ "udid": udid_frame, "seq": seq, "data": data_url }),
            );
        }
    });

    state.processes.lock().unwrap().insert(udid.clone(), child);
    let _ = window.emit("ios-status", json!({ "udid": udid, "running": true }));

    // Monitor for process exit so the frontend can clear the running state.
    let udid_mon = udid.clone();
    let window_mon = window.clone();
    let app_handle = window.app_handle().clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let state_mon = app_handle.state::<IosState>();
            let exited = {
                let mut processes = state_mon.processes.lock().unwrap();
                match processes.get_mut(&udid_mon) {
                    Some(child) => match child.try_wait() {
                        Ok(Some(_)) => {
                            processes.remove(&udid_mon);
                            true
                        }
                        Ok(None) => false,
                        Err(_) => {
                            processes.remove(&udid_mon);
                            true
                        }
                    },
                    None => true, // removed by stop_ios_mirror
                }
            };
            if exited {
                let _ =
                    window_mon.emit("ios-status", json!({ "udid": udid_mon, "running": false }));
                break;
            }
        }
    });

    Ok(json!({ "success": true, "message": "iOS mirror started" }))
}

/// Stop an in-flight iOS mirror stream.
#[tauri::command]
pub async fn stop_ios_mirror(
    state: State<'_, IosState>,
    udid: String,
) -> Result<serde_json::Value, String> {
    let child = {
        let mut processes = state.processes.lock().unwrap();
        processes.remove(&udid)
    };

    if let Some(mut c) = child {
        if let Some(pid) = c.id() {
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .arg(pid.to_string())
                    .output();
            }
            #[cfg(target_os = "windows")]
            {
                let _ = c.kill().await;
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        } else {
            let _ = c.kill().await;
        }
    }

    Ok(json!({ "success": true, "message": "iOS mirror stopped" }))
}

/// Install pymobiledevice3 into an app-managed virtual environment, so the user
/// never has to touch a terminal. Requires a system Python 3.10+ (only the
/// stdlib `venv` module + network access; no admin rights). Progress is streamed
/// to the shared log panel.
#[tauri::command]
pub async fn install_pymobiledevice3(
    app_handle: AppHandle,
    window: Window,
) -> Result<serde_json::Value, String> {
    if detect_host_os() != "macos" {
        return Ok(
            json!({ "success": false, "message": "iOS mirroring is only supported on macOS" }),
        );
    }

    let _ = window.emit(
        "scrcpy-log",
        "[iOS] Locating a system Python (3.10+)...".to_string(),
    );

    let python = match find_system_python().await {
        Some(p) => p,
        None => {
            let msg = "No Python 3.10+ found. Install Python first (e.g. `brew install python`), then retry.";
            let _ = window.emit("scrcpy-log", format!("[iOS] {}", msg));
            return Ok(json!({ "success": false, "message": msg }));
        }
    };
    let _ = window.emit("scrcpy-log", format!("[iOS] Using Python: {}", python));

    let venv_dir = match managed_venv_dir(&app_handle) {
        Some(d) => d,
        None => {
            return Ok(
                json!({ "success": false, "message": "Could not resolve app data directory" }),
            )
        }
    };
    if let Some(parent) = venv_dir.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 1. Create the virtual environment.
    let _ = window.emit(
        "scrcpy-log",
        "[iOS] Creating virtual environment...".to_string(),
    );
    let venv_out = create_command(&python)
        .arg("-m")
        .arg("venv")
        .arg(&venv_dir)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !venv_out.status.success() {
        let err = String::from_utf8_lossy(&venv_out.stderr).trim().to_string();
        let _ = window.emit("scrcpy-log", format!("[iOS] venv failed: {}", err));
        return Ok(
            json!({ "success": false, "message": format!("venv creation failed: {}", err) }),
        );
    }

    // 2. pip install pymobiledevice3 (stream progress).
    let pip = venv_dir.join("bin").join("pip");
    let _ = window.emit(
        "scrcpy-log",
        "[iOS] Installing pymobiledevice3 (this can take a minute)...".to_string(),
    );

    let mut child = create_command(&pip)
        .args(["install", "--upgrade", "pymobiledevice3"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pip: {}", e))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let win_out = window.clone();
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_out.emit("scrcpy-log", format!("[pip] {}", line));
        }
    });
    let win_err = window.clone();
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit("scrcpy-log", format!("[pip] {}", line));
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = out_task.await;
    let _ = err_task.await;

    if !status.success() {
        let _ = window.emit("scrcpy-log", "[iOS] pip install failed.".to_string());
        return Ok(
            json!({ "success": false, "message": "pip install failed. See log for details." }),
        );
    }

    // 3. Verify.
    let exe = venv_dir.join("bin").join("pymobiledevice3");
    let ok = exe.exists() && exe.is_file();
    if ok {
        let _ = window.emit(
            "scrcpy-log",
            "[iOS] pymobiledevice3 installed successfully.".to_string(),
        );
    }
    Ok(json!({
        "success": ok,
        "message": if ok { "pymobiledevice3 installed" } else { "Install finished but executable not found" },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usbmux_and_dedupes_preferring_usb() {
        let json = r#"[
            {"ConnectionType":"Network","DeviceName":"My iPhone","Identifier":"abc","ProductType":"iPhone10,5","ProductVersion":"16.7","UniqueDeviceID":"abc"},
            {"ConnectionType":"USB","DeviceName":"My iPhone","Identifier":"abc","ProductType":"iPhone10,5","ProductVersion":"16.7","UniqueDeviceID":"abc"}
        ]"#;
        let devices = parse_usbmux_devices(json);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].udid, "abc");
        assert_eq!(devices[0].name, "My iPhone");
        assert_eq!(devices[0].connection_type, "USB");
        assert_eq!(devices[0].product_version, "16.7");
    }

    #[test]
    fn parses_multiple_distinct_devices() {
        let json = r#"[
            {"ConnectionType":"USB","DeviceName":"iPhone A","UniqueDeviceID":"aaa","ProductType":"iPhone10,5","ProductVersion":"16.7"},
            {"ConnectionType":"USB","DeviceName":"iPad B","UniqueDeviceID":"bbb","ProductType":"iPad8,1","ProductVersion":"17.2"}
        ]"#;
        let devices = parse_usbmux_devices(json);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].udid, "aaa");
        assert_eq!(devices[1].udid, "bbb");
    }

    #[test]
    fn parse_usbmux_handles_garbage() {
        assert!(parse_usbmux_devices("not json").is_empty());
        assert!(parse_usbmux_devices("{}").is_empty());
        assert!(parse_usbmux_devices("[]").is_empty());
    }

    #[test]
    fn shebang_resolves_direct_interpreter() {
        let py = resolve_python_from_shebang(
            "/opt/venv/bin/pymobiledevice3",
            Some("#!/opt/venv/bin/python3\n"),
        );
        assert_eq!(py, "/opt/venv/bin/python3");
    }

    #[test]
    fn shebang_resolves_env_form() {
        let py = resolve_python_from_shebang(
            "/somewhere/pymobiledevice3",
            Some("#!/usr/bin/env python3.14\n"),
        );
        assert_eq!(py, "python3.14");
    }

    #[test]
    fn shebang_falls_back_to_bare_python3() {
        // No shebang, and parent dir has no python3 sibling -> bare python3.
        let py = resolve_python_from_shebang(
            "/nonexistent-dir-xyz/pymobiledevice3",
            Some("not a shebang line"),
        );
        assert_eq!(py, "python3");
    }

    #[test]
    fn shebang_rejects_non_python_sh_wrapper() {
        // pip emits a `#!/bin/sh` polyglot wrapper when the venv path contains
        // spaces. That must NOT be treated as the Python interpreter; with no
        // resolvable sibling we fall back to bare python3.
        let py =
            resolve_python_from_shebang("/nonexistent-dir-xyz/pymobiledevice3", Some("#!/bin/sh"));
        assert_eq!(py, "python3");
        assert_ne!(py, "/bin/sh");
    }
}
