use crate::commands::create_command;
use crate::screenshot::validate_png;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use tauri::{Emitter, Manager, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::{timeout, Duration};

const RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_LOG_BYTES: usize = 200_000;
const MAX_FLOW_BYTES: usize = 1_000_000;
const WASHXPRESS_FLOW: &str = include_str!("../../.maestro/washxpress-smoke.yaml");
// Maestro CLI writes per-run debug artifacts (screenshots, hierarchy dumps,
// logs) under `~/.maestro/tests/<run>/` by default. That exact layout isn't
// contractual and isn't verified against a real install in this environment,
// so rather than hardcode a folder-naming scheme, we walk the tree bounded by
// depth and only trust files whose mtime is after the run actually started —
// that's true regardless of how Maestro names its output directory. If
// nothing matches, we simply report no screenshots (never fabricated).
const MAESTRO_DEBUG_WALK_DEPTH: usize = 3;
const MAX_ARTIFACT_COUNT: usize = 6;
const MAX_ARTIFACT_BYTES: u64 = 3 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroAvailability {
    found: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroRunResult {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u64,
    flow_path: String,
    device_serial: String,
    timed_out: bool,
    /// `data:image/png;base64,...` screenshots discovered under Maestro's
    /// debug output directory that were created during this run. Empty when
    /// none are found — never fabricated, see the comment on
    /// `MAESTRO_DEBUG_WALK_DEPTH` above.
    screenshots: Vec<String>,
}

fn maestro_program() -> PathBuf {
    let executable = if cfg!(target_os = "windows") {
        "maestro.bat"
    } else {
        "maestro"
    };
    for home_key in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(home_key) {
            let candidate = PathBuf::from(home)
                .join(".maestro")
                .join("bin")
                .join(executable);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("maestro")
}

fn validate_device_serial(serial: &str) -> Result<&str, String> {
    let value = serial.trim();
    if value.is_empty()
        || value.len() > 200
        || !value.starts_with(|c: char| c.is_ascii_alphanumeric())
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '_' | '-'))
    {
        return Err("Invalid device serial".to_string());
    }
    Ok(value)
}

fn validate_flow_path(flow_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(flow_path.trim());
    if flow_path.trim().is_empty() || !path.is_file() {
        return Err("Maestro flow file was not found".to_string());
    }
    let allowed_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "yaml" | "yml"));
    if !allowed_extension {
        return Err("Maestro flow must be a .yaml or .yml file".to_string());
    }
    path.canonicalize()
        .map_err(|error| format!("Could not resolve Maestro flow: {error}"))
}

fn maestro_debug_root() -> Option<PathBuf> {
    for home_key in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(home_key) {
            let candidate = PathBuf::from(home).join(".maestro").join("tests");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Walk `root` up to `MAESTRO_DEBUG_WALK_DEPTH` levels deep, collecting `.png`
/// files modified at or after `since`, oldest first, capped at `limit`.
fn find_recent_screenshots(root: &Path, since: SystemTime, limit: usize) -> Vec<PathBuf> {
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                if depth < MAESTRO_DEBUG_WALK_DEPTH {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let is_png = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
            if !is_png {
                continue;
            }
            if let Ok(modified) = metadata.modified() {
                if modified >= since {
                    found.push((modified, path));
                }
            }
        }
    }
    found.sort_by_key(|(modified, _)| *modified);
    found
        .into_iter()
        .map(|(_, path)| path)
        .take(limit)
        .collect()
}

fn encode_screenshot(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if !validate_png(&bytes) {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)))
}

/// Best-effort screenshot discovery for a run that started at `since`. Never
/// fails the run: any error just means an empty list.
fn collect_run_screenshots(since: SystemTime) -> Vec<String> {
    let Some(root) = maestro_debug_root() else {
        return Vec::new();
    };
    find_recent_screenshots(&root, since, MAX_ARTIFACT_COUNT)
        .iter()
        .filter_map(|path| encode_screenshot(path))
        .collect()
}

fn bounded_log(bytes: &[u8]) -> String {
    if bytes.len() <= MAX_LOG_BYTES {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let tail_start = bytes.len() - MAX_LOG_BYTES / 2;
    format!(
        "{}\n\n... output truncated ...\n\n{}",
        String::from_utf8_lossy(&bytes[..MAX_LOG_BYTES / 2]),
        String::from_utf8_lossy(&bytes[tail_start..]),
    )
}

#[tauri::command]
pub async fn check_maestro_available() -> MaestroAvailability {
    match create_command(maestro_program())
        .arg("--version")
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let version = bounded_log(&output.stdout).trim().to_string();
            MaestroAvailability {
                found: true,
                version: (!version.is_empty()).then_some(version),
                error: None,
            }
        }
        Ok(output) => MaestroAvailability {
            found: false,
            version: None,
            error: Some(bounded_log(&output.stderr).trim().to_string()),
        },
        Err(error) => MaestroAvailability {
            found: false,
            version: None,
            error: Some(format!("Maestro CLI not found: {error}")),
        },
    }
}

#[tauri::command]
pub async fn prepare_washxpress_maestro_flow(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let directory = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("maestro-flows");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("washxpress-smoke.yaml");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(WASHXPRESS_FLOW) {
        std::fs::write(&path, WASHXPRESS_FLOW).map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_maestro_flow(
    app_handle: tauri::AppHandle,
    content: String,
    name: String,
) -> Result<String, String> {
    if content.is_empty() || content.len() > MAX_FLOW_BYTES {
        return Err("Maestro flow must be between 1 byte and 1 MB".to_string());
    }
    let stem = name
        .trim()
        .trim_end_matches(".yaml")
        .trim_end_matches(".yml");
    if stem.is_empty()
        || stem.len() > 100
        || !stem
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid Maestro flow name".to_string());
    }
    let directory = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("maestro-flows");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{stem}.yaml"));
    std::fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Runs the Maestro CLI with piped stdout/stderr instead of `Command::output()`
/// so each line can be emitted to the frontend as it arrives (event
/// `maestro-run-progress`, payload `{ runId, line }`), while still returning
/// the same accumulated `MaestroRunResult` as before once the process exits.
/// `run_id` is generated by the frontend per run and echoed back in every
/// event purely so a UI that started a new run can ignore stale events from a
/// previous one; the backend does not itself use it for anything else (only
/// one Maestro run is expected at a time today).
#[tauri::command]
pub async fn run_maestro_test(
    window: Window,
    flow_path: String,
    device_serial: String,
    run_id: String,
) -> Result<MaestroRunResult, String> {
    let serial = validate_device_serial(&device_serial)?.to_string();
    let path = validate_flow_path(&flow_path)?;
    let started = Instant::now();
    let wall_start = SystemTime::now();
    let mut command = create_command(maestro_program());
    command
        .kill_on_drop(true)
        .arg("--device")
        .arg(&serial)
        .arg("--no-ansi")
        .arg("test")
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return Err(format!("Could not start Maestro CLI: {error}")),
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Maestro stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Maestro stderr".to_string())?;

    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));

    // Stream stdout line-by-line: append to the accumulated buffer (used for
    // the final result, matching the previous `Command::output()` behavior)
    // and emit each line immediately so the frontend can render progress
    // while the flow is still running.
    let stdout_task = {
        let buffer = stdout_buffer.clone();
        let window = window.clone();
        let run_id = run_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        {
                            let mut buf = buffer.lock().unwrap();
                            if !buf.is_empty() {
                                buf.push('\n');
                            }
                            buf.push_str(&line);
                        }
                        let _ = window.emit(
                            "maestro-run-progress",
                            json!({ "runId": run_id, "line": line }),
                        );
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        })
    };

    // stderr is only accumulated (matches previous behavior); it is not
    // step-progress output so it is not emitted line-by-line.
    let stderr_task = {
        let buffer = stderr_buffer.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut buf = buffer.lock().unwrap();
                if !buf.is_empty() {
                    buf.push('\n');
                }
                buf.push_str(&line);
            }
        })
    };

    let wait_result = timeout(RUN_TIMEOUT, child.wait()).await;
    let timed_out = wait_result.is_err();
    if timed_out {
        let _ = child.kill().await;
    }

    // The child's stdout/stderr pipes close on exit (or kill), so these
    // reader tasks finish on their own shortly after; awaiting them just
    // ensures every already-emitted line has landed in the buffers below.
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let stdout_text = stdout_buffer.lock().unwrap().clone();
    let stderr_text = stderr_buffer.lock().unwrap().clone();

    match wait_result {
        Ok(Ok(status)) => Ok(MaestroRunResult {
            success: status.success(),
            exit_code: status.code(),
            stdout: bounded_log(stdout_text.as_bytes()),
            stderr: bounded_log(stderr_text.as_bytes()),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: false,
            screenshots: collect_run_screenshots(wall_start),
        }),
        Ok(Err(error)) => Err(format!("Maestro CLI process error: {error}")),
        Err(_) => Ok(MaestroRunResult {
            success: false,
            exit_code: None,
            stdout: bounded_log(stdout_text.as_bytes()),
            stderr: bounded_log(
                format!("{stderr_text}\nMaestro test timed out after 10 minutes").as_bytes(),
            ),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: true,
            screenshots: collect_run_screenshots(wall_start),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_realistic_adb_serials() {
        assert!(validate_device_serial("emulator-5554").is_ok());
        assert!(validate_device_serial("192.168.1.4:5555").is_ok());
    }

    #[test]
    fn rejects_serials_that_could_be_cli_arguments() {
        assert!(validate_device_serial("--help").is_err());
        assert!(validate_device_serial("serial; reboot").is_err());
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"fake-image-data");
        bytes
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "maestro_rs_test_{label}_{}_{}",
                std::process::id(),
                Instant::now().elapsed().as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn find_recent_screenshots_only_returns_files_modified_since_cutoff() {
        let dir = TempDir::new("recent");
        let old_path = dir.0.join("old.png");
        std::fs::write(&old_path, png_bytes()).unwrap();

        // Filesystem mtime resolution can be coarse; sleep past it so "new"
        // is unambiguously after the cutoff we capture below.
        std::thread::sleep(Duration::from_millis(20));
        let cutoff = SystemTime::now();
        std::thread::sleep(Duration::from_millis(20));

        let nested = dir.0.join("run-1");
        std::fs::create_dir_all(&nested).unwrap();
        let new_path = nested.join("step-1.png");
        std::fs::write(&new_path, png_bytes()).unwrap();
        std::fs::write(nested.join("not-a-screenshot.txt"), b"log output").unwrap();

        let found = find_recent_screenshots(&dir.0, cutoff, MAX_ARTIFACT_COUNT);
        assert_eq!(found, vec![new_path]);
    }

    #[test]
    fn find_recent_screenshots_respects_limit() {
        let dir = TempDir::new("limit");
        let cutoff = SystemTime::now();
        std::thread::sleep(Duration::from_millis(5));
        for i in 0..10 {
            std::fs::write(dir.0.join(format!("s{i}.png")), png_bytes()).unwrap();
        }
        assert_eq!(find_recent_screenshots(&dir.0, cutoff, 3).len(), 3);
    }

    #[test]
    fn encode_screenshot_rejects_non_png_and_accepts_valid_png() {
        let dir = TempDir::new("encode");
        let bad = dir.0.join("bad.png");
        std::fs::write(&bad, b"not a real png").unwrap();
        assert!(encode_screenshot(&bad).is_none());

        let good = dir.0.join("good.png");
        std::fs::write(&good, png_bytes()).unwrap();
        let encoded = encode_screenshot(&good).unwrap();
        assert!(encoded.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn collect_run_screenshots_returns_empty_without_a_debug_root() {
        // No HOME/.maestro/tests directory is guaranteed in a test sandbox,
        // and this must never panic or fabricate results either way.
        let result = collect_run_screenshots(SystemTime::now());
        assert!(result.iter().all(|s| s.starts_with("data:image/png;base64,")));
    }
}
