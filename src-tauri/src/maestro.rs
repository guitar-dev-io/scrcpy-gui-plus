use crate::adb;
use crate::commands::create_command;
use crate::screenshot::validate_png;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager, State, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration};

const RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const ADB_FOREGROUND_TIMEOUT_SECS: u64 = 10;
const MAX_LOG_BYTES: usize = 200_000;
const MAX_FLOW_BYTES: usize = 1_000_000;
const WASHXPRESS_FLOW: &str = include_str!("../../.maestro/washxpress-smoke.yaml");
const ARTIFACT_WALK_DEPTH: usize = 3;
const MAX_ARTIFACT_COUNT: usize = 6;
const MAX_ARTIFACT_BYTES: u64 = 3 * 1024 * 1024;

struct ActiveRun {
    generation: u64,
    cancel: Option<oneshot::Sender<()>>,
    cancel_requested: bool,
}

#[derive(Default)]
pub struct MaestroState {
    active_runs: Mutex<HashMap<String, ActiveRun>>,
    next_generation: AtomicU64,
}

impl MaestroState {
    fn register(&self, run_id: &str) -> Result<(u64, oneshot::Receiver<()>), String> {
        let (cancel, receiver) = oneshot::channel();
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let mut active_runs = self
            .active_runs
            .lock()
            .map_err(|_| "Maestro run state is unavailable".to_string())?;
        if active_runs.contains_key(run_id) {
            return Err(format!(
                "A Maestro run with id '{run_id}' is already active"
            ));
        }
        active_runs.insert(
            run_id.to_string(),
            ActiveRun {
                generation,
                cancel: Some(cancel),
                cancel_requested: false,
            },
        );
        Ok((generation, receiver))
    }

    fn cancel(&self, run_id: &str) -> Result<bool, String> {
        let mut active_runs = self
            .active_runs
            .lock()
            .map_err(|_| "Maestro run state is unavailable".to_string())?;
        let Some(active_run) = active_runs.get_mut(run_id) else {
            return Ok(false);
        };
        let Some(sender) = active_run.cancel.take() else {
            return Ok(false);
        };
        if sender.send(()).is_ok() {
            active_run.cancel_requested = true;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Removes only the matching run generation and reports whether a
    /// cancellation was accepted before another terminal outcome deregistered
    /// the run.
    fn finish(&self, run_id: &str, generation: u64) -> bool {
        if let Ok(mut active_runs) = self.active_runs.lock() {
            let should_remove = active_runs
                .get(run_id)
                .is_some_and(|active_run| active_run.generation == generation);
            if should_remove {
                return active_runs
                    .remove(run_id)
                    .is_some_and(|active_run| active_run.cancel_requested);
            }
        }
        false
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroAvailability {
    found: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroArtifact {
    kind: &'static str,
    path: String,
    size_bytes: u64,
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
    cancelled: bool,
    /// Legacy immediate-preview field. Artifact paths are available in
    /// `artifacts` and remain valid after this result is discarded.
    screenshots: Vec<String>,
    artifacts: Vec<MaestroArtifact>,
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
    if !value.starts_with(|character: char| character.is_ascii_alphanumeric()) {
        return Err("Invalid device serial".to_string());
    }
    adb::validate_serial(value).map_err(|_| "Invalid device serial".to_string())?;
    Ok(value)
}

fn validate_run_id(run_id: &str) -> Result<&str, String> {
    let value = run_id.trim();
    if value.is_empty()
        || value.len() > 200
        || !value.starts_with(|character: char| character.is_ascii_alphanumeric())
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid Maestro run id".to_string());
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

fn prepare_artifact_directory(
    app_handle: &tauri::AppHandle,
    run_id: &str,
) -> Result<PathBuf, String> {
    let root = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("maestro-runs");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create Maestro artifact root: {error}"))?;
    let run_directory = root.join(run_id);
    std::fs::create_dir(&run_directory)
        .map_err(|error| format!("Could not create Maestro artifact directory: {error}"))?;
    run_directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve Maestro artifact directory: {error}"))
}

fn find_screenshots(root: &Path, limit: usize) -> Vec<PathBuf> {
    let canonical_root = match root.canonicalize() {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let mut stack = vec![(canonical_root.clone(), 0)];
    while let Some((directory, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                if depth < ARTIFACT_WALK_DEPTH {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let is_png = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
            if !is_png || metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES {
                continue;
            }
            let Ok(canonical_path) = path.canonicalize() else {
                continue;
            };
            if !canonical_path.starts_with(&canonical_root) {
                continue;
            }
            found.push((
                metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                canonical_path,
            ));
        }
    }
    found.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    found
        .into_iter()
        .map(|(_, path)| path)
        .take(limit)
        .collect()
}

fn collect_run_artifacts(root: &Path) -> (Vec<MaestroArtifact>, Vec<String>) {
    let collected: Vec<(MaestroArtifact, String)> = find_screenshots(root, MAX_ARTIFACT_COUNT)
        .into_iter()
        .filter_map(|path| {
            let metadata = std::fs::metadata(&path).ok()?;
            let bytes = std::fs::read(&path).ok()?;
            if !validate_png(&bytes) {
                return None;
            }
            Some((
                MaestroArtifact {
                    kind: "screenshot",
                    path: path.to_string_lossy().to_string(),
                    size_bytes: metadata.len(),
                },
                format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
            ))
        })
        .collect();
    collected.into_iter().unzip()
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

fn parse_component_package(line: &str) -> Option<String> {
    line.split_whitespace().find_map(|raw_token| {
        let token = raw_token.trim_matches(|character: char| {
            matches!(
                character,
                '{' | '}' | '[' | ']' | '(' | ')' | ',' | ':' | '='
            )
        });
        let (package, activity) = token.split_once('/')?;
        if activity.is_empty() {
            return None;
        }
        let package = package.rsplit(['{', '=']).next().unwrap_or(package);
        let package = package
            .rsplit_once(':')
            .map_or(package, |(_, suffix)| suffix)
            .trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '_' && character != '.'
            });
        adb::validate_package_name(package).ok()?;
        Some(package.to_string())
    })
}

fn parse_foreground_package(output: &str) -> Option<String> {
    const MARKERS: [&str; 6] = [
        "mResumedActivity",
        "topResumedActivity",
        "ResumedActivity",
        "mCurrentFocus",
        "mFocusedApp",
        "mFocusedWindow",
    ];
    MARKERS.iter().find_map(|marker| {
        output
            .lines()
            .filter(|line| line.contains(marker))
            .find_map(parse_component_package)
    })
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

#[tauri::command]
pub fn cancel_maestro_run(state: State<'_, MaestroState>, run_id: String) -> Result<bool, String> {
    let run_id = validate_run_id(&run_id)?;
    state.cancel(run_id)
}

#[tauri::command]
pub async fn get_foreground_app_package(
    serial: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let serial = validate_device_serial(&serial)?.to_string();
    let activity_result = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "activity", "activities"],
        custom_path.clone(),
        ADB_FOREGROUND_TIMEOUT_SECS,
    )
    .await;
    if let Ok(activity_output) = &activity_result {
        if let Some(package) = parse_foreground_package(activity_output) {
            return Ok(package);
        }
    }

    let window_result = adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "window", "windows"],
        custom_path,
        ADB_FOREGROUND_TIMEOUT_SECS,
    )
    .await;
    match window_result {
        Ok(window_output) => parse_foreground_package(&window_output)
            .ok_or_else(|| "Could not determine the foreground app package".to_string()),
        Err(window_error) => {
            let activity_error = activity_result
                .err()
                .map(|error| format!("; activity query failed: {error}"))
                .unwrap_or_default();
            Err(format!(
                "Window query failed: {window_error}{activity_error}"
            ))
        }
    }
}

enum RunCompletion {
    Exited(std::io::Result<std::process::ExitStatus>),
    TimedOut,
    Cancelled,
}

#[tauri::command]
pub async fn run_maestro_test(
    app_handle: tauri::AppHandle,
    window: Window,
    state: State<'_, MaestroState>,
    flow_path: String,
    device_serial: String,
    run_id: String,
) -> Result<MaestroRunResult, String> {
    let serial = validate_device_serial(&device_serial)?.to_string();
    let path = validate_flow_path(&flow_path)?;
    let run_id = validate_run_id(&run_id)?.to_string();
    let (generation, mut cancel_receiver) = state.register(&run_id)?;

    let artifact_directory = match prepare_artifact_directory(&app_handle, &run_id) {
        Ok(directory) => directory,
        Err(error) => {
            state.finish(&run_id, generation);
            return Err(error);
        }
    };
    let started = Instant::now();
    let mut command = create_command(maestro_program());
    command
        .kill_on_drop(true)
        .arg("--device")
        .arg(&serial)
        .arg("--no-ansi")
        .arg("test")
        .arg("--debug-output")
        .arg(&artifact_directory)
        .arg("--test-output-dir")
        .arg(&artifact_directory)
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            state.finish(&run_id, generation);
            return Err(format!("Could not start Maestro CLI: {error}"));
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            state.finish(&run_id, generation);
            return Err("Failed to capture Maestro stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            state.finish(&run_id, generation);
            return Err("Failed to capture Maestro stderr".to_string());
        }
    };

    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stdout_task = {
        let buffer = stdout_buffer.clone();
        let window = window.clone();
        let event_run_id = run_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut buffer) = buffer.lock() {
                    if !buffer.is_empty() {
                        buffer.push('\n');
                    }
                    buffer.push_str(&line);
                }
                let _ = window.emit(
                    "maestro-run-progress",
                    json!({ "runId": event_run_id, "line": line }),
                );
            }
        })
    };
    let stderr_task = {
        let buffer = stderr_buffer.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut buffer) = buffer.lock() {
                    if !buffer.is_empty() {
                        buffer.push('\n');
                    }
                    buffer.push_str(&line);
                }
            }
        })
    };

    let mut completion = tokio::select! {
        biased;
        _ = &mut cancel_receiver => RunCompletion::Cancelled,
        status = child.wait() => RunCompletion::Exited(status),
        _ = sleep(RUN_TIMEOUT) => RunCompletion::TimedOut,
    };
    // Close the cancellation window before any post-processing. If a cancel
    // sender won the state lock after process exit but before deregistration,
    // honor that accepted cancellation in the returned result.
    if state.finish(&run_id, generation) {
        completion = RunCompletion::Cancelled;
    }
    if matches!(
        completion,
        RunCompletion::TimedOut | RunCompletion::Cancelled
    ) {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let stdout_text = stdout_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stderr_text = stderr_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let (artifacts, screenshots) = collect_run_artifacts(&artifact_directory);

    let result = match completion {
        RunCompletion::Exited(Ok(status)) => Ok(MaestroRunResult {
            success: status.success(),
            exit_code: status.code(),
            stdout: bounded_log(stdout_text.as_bytes()),
            stderr: bounded_log(stderr_text.as_bytes()),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: false,
            cancelled: false,
            screenshots,
            artifacts,
        }),
        RunCompletion::Exited(Err(error)) => Err(format!("Maestro CLI process error: {error}")),
        RunCompletion::TimedOut => Ok(MaestroRunResult {
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
            cancelled: false,
            screenshots,
            artifacts,
        }),
        RunCompletion::Cancelled => Ok(MaestroRunResult {
            success: false,
            exit_code: None,
            stdout: bounded_log(stdout_text.as_bytes()),
            stderr: bounded_log(format!("{stderr_text}\nMaestro test cancelled").as_bytes()),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: false,
            cancelled: true,
            screenshots,
            artifacts,
        }),
    };
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn png_bytes() -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"fake-image-data");
        bytes
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let directory = std::env::temp_dir().join(format!(
                "maestro_rs_test_{label}_{}_{}",
                std::process::id(),
                sequence
            ));
            std::fs::create_dir_all(&directory).unwrap();
            TempDir(directory)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn validates_serials_and_run_ids() {
        assert!(validate_device_serial("emulator-5554").is_ok());
        assert!(validate_device_serial("192.168.1.4:5555").is_ok());
        assert!(validate_device_serial("--help").is_err());
        assert!(validate_device_serial("serial; reboot").is_err());
        assert!(validate_run_id("maestro-run-123_4").is_ok());
        assert!(validate_run_id("../other-run").is_err());
        assert!(validate_run_id("--argument").is_err());
    }

    #[test]
    fn cancellation_registration_is_duplicate_safe_and_generation_safe() {
        let state = MaestroState::default();
        let (first_generation, mut first_receiver) = state.register("run-1").unwrap();
        assert!(state.register("run-1").is_err());
        assert_eq!(state.cancel("run-1"), Ok(true));
        assert_eq!(state.cancel("run-1"), Ok(false));
        assert!(matches!(first_receiver.try_recv(), Ok(())));
        assert!(!state.finish("run-1", first_generation.wrapping_add(1)));
        assert!(state.register("run-1").is_err());
        assert!(state.finish("run-1", first_generation));
        assert!(state.register("run-1").is_ok());
    }

    #[test]
    fn parses_foreground_activity_and_window_fixtures() {
        let fixtures = [
            (
                "mResumedActivity: ActivityRecord{abc u0 com.example/.MainActivity t42}",
                "com.example",
            ),
            (
                "topResumedActivity=ActivityRecord{abc u10 org.example.app/org.example.app.HomeActivity t7}",
                "org.example.app",
            ),
            (
                "mCurrentFocus=Window{123 u0 io.sample.app/io.sample.app.MainActivity}\r\n",
                "io.sample.app",
            ),
            (
                "mFocusedApp=ActivityRecord{abc u0 com.android.launcher3/.Launcher t1}",
                "com.android.launcher3",
            ),
            (
                "ResumedActivity: ComponentInfo{dev.example.product/.MainActivity}",
                "dev.example.product",
            ),
        ];
        for (output, expected) in fixtures {
            assert_eq!(parse_foreground_package(output).as_deref(), Some(expected));
        }
    }

    #[test]
    fn ignores_null_or_malformed_foreground_entries() {
        assert_eq!(parse_foreground_package("mCurrentFocus=null"), None);
        assert_eq!(
            parse_foreground_package("mResumedActivity: ActivityRecord{abc u0 invalid/.Main}"),
            None
        );
        assert_eq!(
            parse_foreground_package("random com.example/.NotForeground"),
            None
        );
    }

    #[test]
    fn artifact_collection_is_scoped_bounded_and_typed() {
        let directory = TempDir::new("artifacts");
        let nested = directory.0.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("valid.png"), png_bytes()).unwrap();
        std::fs::write(nested.join("invalid.png"), b"not a png").unwrap();
        std::fs::write(nested.join("notes.txt"), b"ignored").unwrap();

        let (artifacts, screenshots) = collect_run_artifacts(&directory.0);
        assert_eq!(artifacts.len(), 1);
        assert_eq!(screenshots.len(), 1);
        assert_eq!(artifacts[0].kind, "screenshot");
        assert!(Path::new(&artifacts[0].path).starts_with(directory.0.canonicalize().unwrap()));
        assert!(screenshots[0].starts_with("data:image/png;base64,"));
        assert_eq!(artifacts[0].size_bytes, png_bytes().len() as u64);
    }

    #[test]
    fn screenshot_discovery_respects_limit() {
        let directory = TempDir::new("limit");
        for index in 0..10 {
            std::fs::write(directory.0.join(format!("s{index}.png")), png_bytes()).unwrap();
        }
        assert_eq!(find_screenshots(&directory.0, 3).len(), 3);
    }
}
