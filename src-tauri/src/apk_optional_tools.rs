//! Optional JADX/Apktool integration for the APK Toolkit.
//!
//! This module never invokes a shell and accepts only the two explicitly
//! supported tools. Generated output is isolated below the application's data
//! directory, while stdout/stderr are drained into a bounded log tail.

use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::{self, Duration},
};

const VERSION_TIMEOUT: Duration = Duration::from_secs(8);
const JOB_POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_LOG_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_OUTPUT_FILES: usize = 25_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApkOptionalTool {
    Jadx,
    Apktool,
}

impl ApkOptionalTool {
    fn executable_candidates(self) -> &'static [&'static str] {
        match self {
            Self::Jadx => &["jadx", "jadx.exe", "jadx.bat"],
            Self::Apktool => &["apktool", "apktool.exe", "apktool.bat"],
        }
    }

    fn path_executable(self) -> &'static str {
        match self {
            Self::Jadx => "jadx",
            Self::Apktool => "apktool",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalToolInfo {
    pub tool: ApkOptionalTool,
    pub available: bool,
    pub executable_path: Option<String>,
    pub configured_path: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalRuntimeInfo {
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalToolsDetection {
    pub custom_directory: Option<String>,
    pub java_runtime: ApkOptionalRuntimeInfo,
    pub tools: Vec<ApkOptionalToolInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApkOptionalToolJobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl ApkOptionalToolJobState {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalToolJobStatus {
    pub job_id: String,
    pub tool: ApkOptionalTool,
    pub state: ApkOptionalToolJobState,
    pub input_path: String,
    pub output_directory: String,
    pub log_path: String,
    pub log_tail: String,
    pub output_bytes: u64,
    pub output_files: usize,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug)]
struct JobRecord {
    status: ApkOptionalToolJobStatus,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
pub struct ApkOptionalToolsState {
    custom_directory: Mutex<Option<PathBuf>>,
    custom_files: Mutex<HashMap<ApkOptionalTool, PathBuf>>,
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolCommand {
    program: PathBuf,
    prefix_args: Vec<String>,
    display_path: PathBuf,
}

impl Drop for ApkOptionalToolsState {
    fn drop(&mut self) {
        if let Ok(jobs) = self.jobs.lock() {
            for record in jobs.values() {
                record.cancel.store(true, Ordering::Release);
            }
        }
    }
}

fn validate_custom_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Tool directory must be an absolute path".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot access tool directory: {error}"))?;
    if !canonical.is_dir() {
        return Err("Tool directory is not a directory".to_string());
    }
    Ok(canonical)
}

fn validate_custom_file(tool: ApkOptionalTool, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Tool file must be an absolute path".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot access tool file: {error}"))?;
    if !canonical.is_file() {
        return Err("Tool path is not a file".to_string());
    }

    let file_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_candidate = tool
        .executable_candidates()
        .iter()
        .any(|candidate| file_name == candidate.to_ascii_lowercase());
    let is_apktool_jar = tool == ApkOptionalTool::Apktool
        && file_name.starts_with("apktool")
        && canonical
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"));
    if !is_candidate && !is_apktool_jar {
        return Err(match tool {
            ApkOptionalTool::Jadx => "Select the JADX CLI file (jadx, jadx.exe, or jadx.bat)",
            ApkOptionalTool::Apktool => {
                "Select apktool, apktool.exe, apktool.bat, or an apktool*.jar file"
            }
        }
        .to_string());
    }
    Ok(canonical)
}

fn executable_in_directory(tool: ApkOptionalTool, directory: &Path) -> Option<PathBuf> {
    tool.executable_candidates()
        .iter()
        .map(|name| directory.join(name))
        .find(|path| path.is_file())
}

fn tool_command(
    tool: ApkOptionalTool,
    custom_directory: Option<&Path>,
    custom_file: Option<&Path>,
) -> ToolCommand {
    let selected = custom_file
        .map(Path::to_path_buf)
        .or_else(|| custom_directory.and_then(|directory| executable_in_directory(tool, directory)))
        .unwrap_or_else(|| PathBuf::from(tool.path_executable()));
    let is_jar = selected
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"));
    if is_jar {
        ToolCommand {
            program: PathBuf::from("java"),
            prefix_args: vec!["-jar".to_string(), selected.to_string_lossy().into_owned()],
            display_path: selected,
        }
    } else {
        ToolCommand {
            program: selected.clone(),
            prefix_args: Vec::new(),
            display_path: selected,
        }
    }
}

fn validate_apk_input(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("APK input path must be absolute".to_string());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("apk") {
        return Err("Input must be an .apk file".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot access APK input: {error}"))?;
    if !canonical.is_file() {
        return Err("APK input is not a file".to_string());
    }
    Ok(canonical)
}

fn tool_arguments(tool: ApkOptionalTool, input: &Path, output: &Path) -> Vec<String> {
    let input = input.to_string_lossy().into_owned();
    let output = output.to_string_lossy().into_owned();
    match tool {
        ApkOptionalTool::Jadx => vec!["--output-dir".into(), output, "--no-replace".into(), input],
        ApkOptionalTool::Apktool => vec![
            "decode".into(),
            "--force".into(),
            "--output".into(),
            output,
            input,
        ],
    }
}

fn output_first_line(stdout: &[u8], stderr: &[u8]) -> String {
    let raw = if stdout.is_empty() { stderr } else { stdout };
    String::from_utf8_lossy(raw)
        .lines()
        .next()
        .unwrap_or("unknown")
        .trim()
        .chars()
        .take(256)
        .collect()
}

async fn detect_java_runtime() -> ApkOptionalRuntimeInfo {
    let result = time::timeout(
        VERSION_TIMEOUT,
        Command::new("java")
            .arg("-version")
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    match result {
        Ok(Ok(output)) if output.status.success() => ApkOptionalRuntimeInfo {
            available: true,
            version: Some(output_first_line(&output.stdout, &output.stderr)),
            reason: None,
        },
        Ok(Ok(output)) => ApkOptionalRuntimeInfo {
            available: false,
            version: None,
            reason: Some(format!("Java version check exited with {}", output.status)),
        },
        Ok(Err(error)) => ApkOptionalRuntimeInfo {
            available: false,
            version: None,
            reason: Some(format!("Java is not available on PATH: {error}")),
        },
        Err(_) => ApkOptionalRuntimeInfo {
            available: false,
            version: None,
            reason: Some("Java version detection timed out".to_string()),
        },
    }
}

async fn detect_tool(
    tool: ApkOptionalTool,
    custom_directory: Option<&Path>,
    custom_file: Option<&Path>,
) -> ApkOptionalToolInfo {
    let command = tool_command(tool, custom_directory, custom_file);
    if custom_file.is_none() && custom_directory.is_some() && !command.display_path.is_file() {
        return ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: None,
            configured_path: None,
            version: None,
            reason: Some("Executable was not found in the configured directory".to_string()),
        };
    }

    let mut version_args = command.prefix_args.clone();
    version_args.push("--version".to_string());
    let result = time::timeout(
        VERSION_TIMEOUT,
        Command::new(&command.program)
            .args(version_args)
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    match result {
        Ok(Ok(output)) if output.status.success() => {
            let version = output_first_line(&output.stdout, &output.stderr);
            ApkOptionalToolInfo {
                tool,
                available: true,
                executable_path: Some(command.display_path.to_string_lossy().into_owned()),
                configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
                version: Some(version),
                reason: None,
            }
        }
        Ok(Ok(output)) => ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: Some(command.display_path.to_string_lossy().into_owned()),
            configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
            version: None,
            reason: Some(format!("Version command exited with {}", output.status)),
        },
        Ok(Err(error)) => ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: None,
            configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
            version: None,
            reason: Some(
                if command.prefix_args.first().map(String::as_str) == Some("-jar") {
                    format!("Java is required to run this JAR and was not available: {error}")
                } else {
                    format!("Tool is not available: {error}")
                },
            ),
        },
        Err(_) => ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: Some(command.display_path.to_string_lossy().into_owned()),
            configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
            version: None,
            reason: Some("Version detection timed out".to_string()),
        },
    }
}

async fn read_bounded(mut reader: impl AsyncRead + Unpin) -> Vec<u8> {
    let mut retained = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let Ok(count) = reader.read(&mut buffer).await else {
            break;
        };
        if count == 0 {
            break;
        }
        let remaining = MAX_LOG_BYTES.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..count.min(remaining)]);
    }
    retained
}

fn output_usage(root: &Path) -> Result<(u64, usize), String> {
    let mut bytes = 0_u64;
    let mut files = 0_usize;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                files = files.saturating_add(1);
                bytes = bytes
                    .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            }
            if files > MAX_OUTPUT_FILES || bytes > MAX_OUTPUT_BYTES {
                return Ok((bytes, files));
            }
        }
    }
    Ok((bytes, files))
}

fn update_job(
    jobs: &Mutex<HashMap<String, JobRecord>>,
    job_id: &str,
    update: impl FnOnce(&mut ApkOptionalToolJobStatus),
) {
    if let Ok(mut jobs) = jobs.lock() {
        if let Some(record) = jobs.get_mut(job_id) {
            update(&mut record.status);
        }
    }
}

async fn run_job(
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
    job_id: String,
    executable: PathBuf,
    args: Vec<String>,
    output_directory: PathBuf,
    log_path: PathBuf,
    cancel: Arc<AtomicBool>,
) {
    update_job(&jobs, &job_id, |status| {
        status.state = ApkOptionalToolJobState::Running;
        status.started_at = Some(Utc::now().to_rfc3339());
    });

    let spawn = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawn {
        Ok(child) => child,
        Err(error) => {
            update_job(&jobs, &job_id, |status| {
                status.state = ApkOptionalToolJobState::Failed;
                status.error = Some(format!("Failed to start tool: {error}"));
                status.finished_at = Some(Utc::now().to_rfc3339());
            });
            return;
        }
    };

    let stdout_task = child
        .stdout
        .take()
        .map(|stdout| tokio::spawn(read_bounded(stdout)));
    let stderr_task = child
        .stderr
        .take()
        .map(|stderr| tokio::spawn(read_bounded(stderr)));
    let mut interval = time::interval(JOB_POLL_INTERVAL);
    let (process_status, forced_error) = loop {
        tokio::select! {
            result = child.wait() => break (result, None),
            _ = interval.tick() => {
                if cancel.load(Ordering::Acquire) {
                    let _ = child.start_kill();
                    break (child.wait().await, Some("Job was cancelled".to_string()));
                }
                match output_usage(&output_directory) {
                    Ok((bytes, files)) => {
                        update_job(&jobs, &job_id, |status| {
                            status.output_bytes = bytes;
                            status.output_files = files;
                        });
                        if bytes > MAX_OUTPUT_BYTES || files > MAX_OUTPUT_FILES {
                            let _ = child.start_kill();
                            break (child.wait().await, Some("Generated output exceeded the safety limit".to_string()));
                        }
                    }
                    Err(error) => {
                        let _ = child.start_kill();
                        break (child.wait().await, Some(format!("Cannot inspect generated output: {error}")));
                    }
                }
            }
        }
    };

    let mut log = Vec::new();
    if let Some(task) = stdout_task {
        if let Ok(bytes) = task.await {
            log.extend_from_slice(&bytes[..bytes.len().min(MAX_LOG_BYTES)]);
        }
    }
    if let Some(task) = stderr_task {
        if let Ok(bytes) = task.await {
            if !log.is_empty() && log.len() < MAX_LOG_BYTES {
                log.push(b'\n');
            }
            let remaining = MAX_LOG_BYTES.saturating_sub(log.len());
            log.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
    }
    let _ = tokio::fs::write(&log_path, &log).await;
    let log_tail = String::from_utf8_lossy(&log).into_owned();
    let (output_bytes, output_files) = output_usage(&output_directory).unwrap_or((0, 0));
    update_job(&jobs, &job_id, |status| {
        status.log_tail = log_tail;
        status.output_bytes = output_bytes;
        status.output_files = output_files;
        status.finished_at = Some(Utc::now().to_rfc3339());
        match process_status {
            Ok(exit) => {
                status.exit_code = exit.code();
                if cancel.load(Ordering::Acquire) {
                    status.state = ApkOptionalToolJobState::Cancelled;
                    status.error = Some("Job was cancelled".to_string());
                } else if let Some(error) = forced_error {
                    status.state = ApkOptionalToolJobState::Failed;
                    status.error = Some(error);
                } else if exit.success() {
                    status.state = ApkOptionalToolJobState::Succeeded;
                } else {
                    status.state = ApkOptionalToolJobState::Failed;
                    status.error = Some(format!("Tool exited with {exit}"));
                }
            }
            Err(error) => {
                status.state = ApkOptionalToolJobState::Failed;
                status.error = Some(format!("Failed while waiting for tool: {error}"));
            }
        }
    });
}

#[tauri::command]
pub fn set_apk_optional_tools_directory(
    state: State<'_, ApkOptionalToolsState>,
    directory: Option<String>,
) -> Result<Option<String>, String> {
    let directory = directory
        .map(PathBuf::from)
        .map(|path| validate_custom_directory(&path))
        .transpose()?;
    let display = directory
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    *state
        .custom_directory
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())? = directory;
    Ok(display)
}

#[tauri::command]
pub fn set_apk_optional_tool_path(
    state: State<'_, ApkOptionalToolsState>,
    tool: ApkOptionalTool,
    path: Option<String>,
) -> Result<Option<String>, String> {
    let path = path
        .map(PathBuf::from)
        .map(|path| validate_custom_file(tool, &path))
        .transpose()?;
    let display = path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let mut custom_files = state
        .custom_files
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())?;
    if let Some(path) = path {
        custom_files.insert(tool, path);
    } else {
        custom_files.remove(&tool);
    }
    Ok(display)
}

#[tauri::command]
pub async fn detect_apk_optional_tools(
    state: State<'_, ApkOptionalToolsState>,
) -> Result<ApkOptionalToolsDetection, String> {
    let custom = state
        .custom_directory
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())?
        .clone();
    let custom_files = state
        .custom_files
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())?
        .clone();
    let java_runtime = detect_java_runtime().await;
    let mut tools = Vec::with_capacity(2);
    for tool in [ApkOptionalTool::Jadx, ApkOptionalTool::Apktool] {
        tools.push(
            detect_tool(
                tool,
                custom.as_deref(),
                custom_files.get(&tool).map(PathBuf::as_path),
            )
            .await,
        );
    }
    Ok(ApkOptionalToolsDetection {
        custom_directory: custom.map(|path| path.to_string_lossy().into_owned()),
        java_runtime,
        tools,
    })
}

#[tauri::command]
pub async fn start_apk_optional_tool_job(
    app: AppHandle,
    state: State<'_, ApkOptionalToolsState>,
    tool: ApkOptionalTool,
    input_path: String,
) -> Result<ApkOptionalToolJobStatus, String> {
    let input = validate_apk_input(Path::new(&input_path))?;
    let custom = state
        .custom_directory
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())?
        .clone();
    let custom_file = state
        .custom_files
        .lock()
        .map_err(|_| "Optional tool settings are unavailable".to_string())?
        .get(&tool)
        .cloned();
    let detected = detect_tool(tool, custom.as_deref(), custom_file.as_deref()).await;
    if !detected.available {
        return Err(detected
            .reason
            .unwrap_or_else(|| "Optional tool is not installed".to_string()));
    }
    let command = tool_command(tool, custom.as_deref(), custom_file.as_deref());
    let workspace = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot locate application data directory: {error}"))?
        .join("apk-toolkit")
        .join("optional-tool-jobs");
    tokio::fs::create_dir_all(&workspace)
        .await
        .map_err(|error| format!("Cannot create tool workspace: {error}"))?;
    let job_id = format!(
        "{}-{:016x}",
        Utc::now().format("%Y%m%d%H%M%S%3f"),
        rand::rng().random::<u64>()
    );
    let job_directory = workspace.join(&job_id);
    let output_directory = job_directory.join("output");
    tokio::fs::create_dir_all(&output_directory)
        .await
        .map_err(|error| format!("Cannot create job output directory: {error}"))?;
    let log_path = job_directory.join("tool.log");
    let status = ApkOptionalToolJobStatus {
        job_id: job_id.clone(),
        tool,
        state: ApkOptionalToolJobState::Queued,
        input_path: input.to_string_lossy().into_owned(),
        output_directory: output_directory.to_string_lossy().into_owned(),
        log_path: log_path.to_string_lossy().into_owned(),
        log_tail: String::new(),
        output_bytes: 0,
        output_files: 0,
        started_at: None,
        finished_at: None,
        exit_code: None,
        error: None,
    };
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .map_err(|_| "Optional tool jobs are unavailable".to_string())?
        .insert(
            job_id.clone(),
            JobRecord {
                status: status.clone(),
                cancel: Arc::clone(&cancel),
            },
        );
    let jobs = Arc::clone(&state.jobs);
    let mut args = command.prefix_args;
    args.extend(tool_arguments(tool, &input, &output_directory));
    tokio::spawn(run_job(
        jobs,
        job_id,
        command.program,
        args,
        output_directory,
        log_path,
        cancel,
    ));
    Ok(status)
}

#[tauri::command]
pub fn get_apk_optional_tool_job(
    state: State<'_, ApkOptionalToolsState>,
    job_id: String,
) -> Result<ApkOptionalToolJobStatus, String> {
    state
        .jobs
        .lock()
        .map_err(|_| "Optional tool jobs are unavailable".to_string())?
        .get(&job_id)
        .map(|record| record.status.clone())
        .ok_or_else(|| "Optional tool job was not found".to_string())
}

#[tauri::command]
pub fn cancel_apk_optional_tool_job(
    state: State<'_, ApkOptionalToolsState>,
    job_id: String,
) -> Result<ApkOptionalToolJobStatus, String> {
    let jobs = state
        .jobs
        .lock()
        .map_err(|_| "Optional tool jobs are unavailable".to_string())?;
    let record = jobs
        .get(&job_id)
        .ok_or_else(|| "Optional tool job was not found".to_string())?;
    if !record.status.state.is_terminal() {
        record.cancel.store(true, Ordering::Release);
    }
    Ok(record.status.clone())
}

#[tauri::command]
pub async fn cleanup_apk_optional_tool_job(
    state: State<'_, ApkOptionalToolsState>,
    job_id: String,
) -> Result<bool, String> {
    let output_directory = {
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|_| "Optional tool jobs are unavailable".to_string())?;
        let record = jobs
            .get(&job_id)
            .ok_or_else(|| "Optional tool job was not found".to_string())?;
        if !record.status.state.is_terminal() {
            return Err("Running jobs must be cancelled before cleanup".to_string());
        }
        let output = PathBuf::from(&record.status.output_directory);
        jobs.remove(&job_id);
        output
    };
    let job_directory = output_directory
        .parent()
        .ok_or_else(|| "Invalid job directory".to_string())?;
    tokio::fs::remove_dir_all(job_directory)
        .await
        .map_err(|error| format!("Cannot remove job output: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "scrcpy-gui-plus-optional-tools-{name}-{:016x}",
            rand::rng().random::<u64>()
        ))
    }

    #[test]
    fn only_allowlisted_tool_names_are_resolved() {
        let directory = temp_path("allowlist");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("jadx"), b"").unwrap();
        std::fs::write(directory.join("anything-else"), b"").unwrap();
        assert_eq!(
            executable_in_directory(ApkOptionalTool::Jadx, &directory),
            Some(directory.join("jadx"))
        );
        assert_eq!(
            executable_in_directory(ApkOptionalTool::Apktool, &directory),
            None
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tool_arguments_keep_paths_as_individual_arguments() {
        let input = Path::new("/tmp/app name;touch nope.apk");
        let output = Path::new("/tmp/output name");
        let args = tool_arguments(ApkOptionalTool::Jadx, input, output);
        assert_eq!(args.len(), 4);
        assert_eq!(args[3], "/tmp/app name;touch nope.apk");
        assert!(!args.iter().any(|arg| arg == "sh" || arg == "-c"));
    }

    #[test]
    fn apktool_jar_uses_java_without_a_shell() {
        let jar = Path::new("/tmp/apktool_3.0.3.jar");
        let command = tool_command(ApkOptionalTool::Apktool, None, Some(jar));
        assert_eq!(command.program, PathBuf::from("java"));
        assert_eq!(command.prefix_args, vec!["-jar", "/tmp/apktool_3.0.3.jar"]);
        assert_eq!(command.display_path, jar);
    }

    #[test]
    fn custom_file_validation_is_tool_specific() {
        let directory = temp_path("custom-file");
        std::fs::create_dir_all(&directory).unwrap();
        let jar = directory.join("apktool_3.0.3.jar");
        let unrelated = directory.join("unrelated.jar");
        std::fs::write(&jar, b"jar").unwrap();
        std::fs::write(&unrelated, b"jar").unwrap();
        assert_eq!(
            validate_custom_file(ApkOptionalTool::Apktool, &jar).unwrap(),
            jar.canonicalize().unwrap()
        );
        assert!(validate_custom_file(ApkOptionalTool::Jadx, &jar).is_err());
        assert!(validate_custom_file(ApkOptionalTool::Apktool, &unrelated).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn version_output_prefers_stdout_and_supports_java_stderr() {
        assert_eq!(
            output_first_line(b"jadx 1.5.2\nmore", b"ignored"),
            "jadx 1.5.2"
        );
        assert_eq!(
            output_first_line(b"", b"openjdk version \"17.0.12\"\nmore"),
            "openjdk version \"17.0.12\""
        );
    }

    #[test]
    fn output_usage_ignores_symlinks_and_counts_regular_files() {
        let directory = temp_path("usage");
        std::fs::create_dir_all(directory.join("nested")).unwrap();
        std::fs::write(directory.join("nested/file.txt"), b"12345").unwrap();
        assert_eq!(output_usage(&directory).unwrap(), (5, 1));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn apk_input_requires_an_existing_absolute_apk() {
        assert!(validate_apk_input(Path::new("relative.apk")).is_err());
        assert!(validate_apk_input(Path::new("/definitely/missing.apk")).is_err());
    }
}
