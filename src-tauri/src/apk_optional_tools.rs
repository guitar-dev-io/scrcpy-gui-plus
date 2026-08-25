//! Optional JADX/Apktool integration for the APK Toolkit.
//!
//! This module never invokes a shell and accepts only the two explicitly
//! supported tools. Generated output is isolated below the application's data
//! directory, while stdout/stderr are drained into a bounded log tail.

use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::{self, Duration},
};

const VERSION_TIMEOUT: Duration = Duration::from_secs(8);
const JOB_POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_LOG_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_OUTPUT_FILES: usize = 25_000;
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;
const MAX_JADX_EXTRACTED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_JADX_ENTRIES: usize = 10_000;
const JADX_VERSION: &str = "1.5.6";
const JADX_URL: &str = "https://github.com/skylot/jadx/releases/download/v1.5.6/jadx-1.5.6.zip";
const JADX_SHA256: &str = "545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974";
const APKTOOL_VERSION: &str = "3.0.3";
const APKTOOL_URL: &str =
    "https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar";
const APKTOOL_SHA256: &str = "dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423";
const INSTALL_PROGRESS_EVENT: &str = "apk-optional-tools-install-progress";

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
    pub managed: bool,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalToolsInstallProgress {
    pub phase: String,
    pub tool: Option<ApkOptionalTool>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub completed_tools: usize,
    pub total_tools: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkOptionalToolsInstallResult {
    pub install_directory: String,
    pub jadx_version: String,
    pub apktool_version: String,
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
    install_running: Mutex<bool>,
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

#[derive(Debug, Clone, Copy)]
enum ManagedArchiveKind {
    JadxZip,
    ApktoolJar,
}

#[derive(Debug, Clone, Copy)]
struct ManagedAsset {
    tool: ApkOptionalTool,
    version: &'static str,
    url: &'static str,
    file_name: &'static str,
    sha256: &'static str,
    kind: ManagedArchiveKind,
}

const MANAGED_ASSETS: [ManagedAsset; 2] = [
    ManagedAsset {
        tool: ApkOptionalTool::Jadx,
        version: JADX_VERSION,
        url: JADX_URL,
        file_name: "jadx-1.5.6.zip",
        sha256: JADX_SHA256,
        kind: ManagedArchiveKind::JadxZip,
    },
    ManagedAsset {
        tool: ApkOptionalTool::Apktool,
        version: APKTOOL_VERSION,
        url: APKTOOL_URL,
        file_name: "apktool_3.0.3.jar",
        sha256: APKTOOL_SHA256,
        kind: ManagedArchiveKind::ApktoolJar,
    },
];

fn managed_tools_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("apk-toolkit").join("managed-tools"))
        .map_err(|error| format!("Cannot locate the managed tools directory: {error}"))
}

fn managed_tool_path(root: &Path, tool: ApkOptionalTool) -> PathBuf {
    match tool {
        ApkOptionalTool::Jadx => {
            let executable = if cfg!(target_os = "windows") {
                "jadx.bat"
            } else {
                "jadx"
            };
            root.join("jadx")
                .join(JADX_VERSION)
                .join("bin")
                .join(executable)
        }
        ApkOptionalTool::Apktool => root
            .join("apktool")
            .join(APKTOOL_VERSION)
            .join(format!("apktool_{APKTOOL_VERSION}.jar")),
    }
}

fn installed_managed_tool(root: &Path, tool: ApkOptionalTool) -> Option<PathBuf> {
    let path = managed_tool_path(root, tool);
    path.is_file().then_some(path)
}

fn emit_install_progress(
    app: &AppHandle,
    phase: &str,
    tool: Option<ApkOptionalTool>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    completed_tools: usize,
    message: impl Into<String>,
) {
    let _ = app.emit(
        INSTALL_PROGRESS_EVENT,
        ApkOptionalToolsInstallProgress {
            phase: phase.to_string(),
            tool,
            downloaded_bytes,
            total_bytes,
            completed_tools,
            total_tools: MANAGED_ASSETS.len(),
            message: message.into(),
        },
    );
}

#[cfg(test)]
fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    bytes_to_hex(&digest)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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

fn executable_in_search_directories(
    tool: ApkOptionalTool,
    directories: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    directories
        .into_iter()
        .find_map(|directory| executable_in_directory(tool, &directory))
}

fn resolve_path_executable(tool: ApkOptionalTool) -> PathBuf {
    let mut directories = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    // Desktop apps launched from Finder/Dock do not inherit the interactive
    // shell PATH on macOS. Check the standard Homebrew locations explicitly;
    // the Linuxbrew prefix covers the equivalent GUI-launch case on Linux.
    #[cfg(unix)]
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ]);

    executable_in_search_directories(tool, directories)
        .unwrap_or_else(|| PathBuf::from(tool.path_executable()))
}

fn tool_command(
    tool: ApkOptionalTool,
    custom_directory: Option<&Path>,
    custom_file: Option<&Path>,
    managed_file: Option<&Path>,
) -> ToolCommand {
    let selected = custom_file
        .map(Path::to_path_buf)
        .or_else(|| custom_directory.and_then(|directory| executable_in_directory(tool, directory)))
        .or_else(|| managed_file.map(Path::to_path_buf))
        .unwrap_or_else(|| resolve_path_executable(tool));
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
    } else if cfg!(target_os = "windows")
        && selected
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("bat"))
    {
        ToolCommand {
            program: PathBuf::from("cmd.exe"),
            prefix_args: vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                selected.to_string_lossy().into_owned(),
            ],
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
    managed_file: Option<&Path>,
) -> ApkOptionalToolInfo {
    let command = tool_command(tool, custom_directory, custom_file, managed_file);
    if custom_file.is_none() && custom_directory.is_some() && !command.display_path.is_file() {
        return ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: None,
            configured_path: None,
            managed: false,
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
                managed: custom_file.is_none()
                    && custom_directory.is_none()
                    && managed_file.is_some(),
                version: Some(version),
                reason: None,
            }
        }
        Ok(Ok(output)) => ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: Some(command.display_path.to_string_lossy().into_owned()),
            configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
            managed: custom_file.is_none() && custom_directory.is_none() && managed_file.is_some(),
            version: None,
            reason: Some(format!("Version command exited with {}", output.status)),
        },
        Ok(Err(error)) => ApkOptionalToolInfo {
            tool,
            available: false,
            executable_path: None,
            configured_path: custom_file.map(|path| path.to_string_lossy().into_owned()),
            managed: custom_file.is_none() && custom_directory.is_none() && managed_file.is_some(),
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
            managed: custom_file.is_none() && custom_directory.is_none() && managed_file.is_some(),
            version: None,
            reason: Some("Version detection timed out".to_string()),
        },
    }
}

async fn download_managed_asset(
    app: &AppHandle,
    client: &reqwest::Client,
    asset: ManagedAsset,
    destination: &Path,
    completed_tools: usize,
) -> Result<(), String> {
    emit_install_progress(
        app,
        "downloading",
        Some(asset.tool),
        0,
        None,
        completed_tools,
        format!(
            "Downloading {} {}",
            asset.tool.path_executable(),
            asset.version
        ),
    );
    let mut response = client
        .get(asset.url)
        .send()
        .await
        .map_err(|error| format!("Cannot download {}: {error}", asset.file_name))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cannot download {}: server returned {}",
            asset.file_name,
            response.status()
        ));
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_DOWNLOAD_BYTES) {
        return Err(format!(
            "{} exceeds the download size limit",
            asset.file_name
        ));
    }
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Cannot create download directory: {error}"))?;
    }
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| format!("Cannot create {}: {error}", destination.display()))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Download interrupted for {}: {error}", asset.file_name))?
    {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "{} exceeds the download size limit",
                asset.file_name
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Cannot write {}: {error}", asset.file_name))?;
        emit_install_progress(
            app,
            "downloading",
            Some(asset.tool),
            downloaded,
            total,
            completed_tools,
            format!(
                "Downloading {} {}",
                asset.tool.path_executable(),
                asset.version
            ),
        );
    }
    file.flush()
        .await
        .map_err(|error| format!("Cannot finish {}: {error}", asset.file_name))?;

    emit_install_progress(
        app,
        "verifying",
        Some(asset.tool),
        downloaded,
        total,
        completed_tools,
        format!("Verifying {} checksum", asset.file_name),
    );
    let actual = bytes_to_hex(&hasher.finalize());
    if actual != asset.sha256 {
        return Err(format!(
            "Checksum verification failed for {} (expected {}, got {})",
            asset.file_name, asset.sha256, actual
        ));
    }
    Ok(())
}

fn extract_jadx_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|error| format!("Cannot open JADX archive: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("Cannot read JADX archive: {error}"))?;
    if archive.len() > MAX_JADX_ENTRIES {
        return Err("JADX archive contains too many entries".to_string());
    }
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create JADX install directory: {error}"))?;
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot read JADX archive entry: {error}"))?;
        if entry.encrypted() || entry.is_symlink() {
            return Err(format!("Unsafe JADX archive entry: {}", entry.name()));
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe JADX archive path: {}", entry.name()))?;
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
        {
            return Err(format!("Unsafe JADX archive path: {}", entry.name()));
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > MAX_JADX_EXTRACTED_BYTES {
            return Err("JADX archive exceeds the extraction size limit".to_string());
        }
        let output = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output)
                .map_err(|error| format!("Cannot create {}: {error}", output.display()))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
        }
        let mut target = File::create(&output)
            .map_err(|error| format!("Cannot create {}: {error}", output.display()))?;
        let copied = std::io::copy(&mut entry, &mut target)
            .map_err(|error| format!("Cannot extract {}: {error}", output.display()))?;
        if copied != entry.size() {
            return Err(format!("Incomplete JADX archive entry: {}", entry.name()));
        }
    }

    let executable = if cfg!(target_os = "windows") {
        destination.join("bin").join("jadx.bat")
    } else {
        destination.join("bin").join("jadx")
    };
    if !executable.is_file() || !destination.join("lib").is_dir() {
        return Err("JADX archive is missing its CLI executable or libraries".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&executable)
            .map_err(|error| format!("Cannot inspect JADX executable: {error}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions)
            .map_err(|error| format!("Cannot make JADX executable: {error}"))?;
    }
    Ok(())
}

fn replace_install_directory(staged: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Invalid managed tool destination".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create managed tool directory: {error}"))?;
    let backup = parent.join(format!(".previous-{:016x}", rand::rng().random::<u64>()));
    let had_previous = destination.exists();
    if had_previous {
        std::fs::rename(destination, &backup)
            .map_err(|error| format!("Cannot prepare managed tool update: {error}"))?;
    }
    if let Err(error) = std::fs::rename(staged, destination) {
        if had_previous {
            let _ = std::fs::rename(&backup, destination);
        }
        return Err(format!(
            "Cannot activate managed tool installation: {error}"
        ));
    }
    if had_previous {
        let _ = std::fs::remove_dir_all(backup);
    }
    Ok(())
}

async fn install_managed_assets(
    app: &AppHandle,
    root: &Path,
    staging: &Path,
) -> Result<ApkOptionalToolsInstallResult, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!(
            "scrcpy-gui-plus/{} optional-tools-installer",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("Cannot create download client: {error}"))?;

    for (index, asset) in MANAGED_ASSETS.iter().copied().enumerate() {
        let archive_path = staging.join("downloads").join(asset.file_name);
        download_managed_asset(app, &client, asset, &archive_path, index).await?;
        emit_install_progress(
            app,
            "installing",
            Some(asset.tool),
            0,
            None,
            index,
            format!(
                "Installing {} {}",
                asset.tool.path_executable(),
                asset.version
            ),
        );
        let staged_install = staging.join(format!("{}-install", asset.tool.path_executable()));
        let destination = root.join(asset.tool.path_executable()).join(asset.version);
        match asset.kind {
            ManagedArchiveKind::JadxZip => {
                let archive = archive_path.clone();
                let target = staged_install.clone();
                tokio::task::spawn_blocking(move || extract_jadx_archive(&archive, &target))
                    .await
                    .map_err(|error| format!("JADX extraction task failed: {error}"))??;
            }
            ManagedArchiveKind::ApktoolJar => {
                tokio::fs::create_dir_all(&staged_install)
                    .await
                    .map_err(|error| format!("Cannot create Apktool install directory: {error}"))?;
                tokio::fs::copy(&archive_path, staged_install.join(asset.file_name))
                    .await
                    .map_err(|error| format!("Cannot install Apktool: {error}"))?;
            }
        }
        replace_install_directory(&staged_install, &destination)?;
        emit_install_progress(
            app,
            "installed",
            Some(asset.tool),
            0,
            None,
            index + 1,
            format!(
                "Installed {} {}",
                asset.tool.path_executable(),
                asset.version
            ),
        );
    }

    let notices = format!(
        "Managed APK Toolkit tools\n\nJADX {JADX_VERSION}\nSource: https://github.com/skylot/jadx\nLicense: Apache-2.0\nArtifact: {JADX_URL}\nSHA-256: {JADX_SHA256}\n\nApktool {APKTOOL_VERSION}\nSource: https://github.com/iBotPeaches/Apktool\nLicense: Apache-2.0\nArtifact: {APKTOOL_URL}\nSHA-256: {APKTOOL_SHA256}\n"
    );
    tokio::fs::write(root.join("THIRD_PARTY_NOTICES.txt"), notices)
        .await
        .map_err(|error| format!("Cannot write managed tool notices: {error}"))?;
    emit_install_progress(
        app,
        "complete",
        None,
        0,
        None,
        MANAGED_ASSETS.len(),
        "JADX and Apktool are ready",
    );
    Ok(ApkOptionalToolsInstallResult {
        install_directory: root.to_string_lossy().into_owned(),
        jadx_version: JADX_VERSION.to_string(),
        apktool_version: APKTOOL_VERSION.to_string(),
    })
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
pub async fn install_apk_optional_tools(
    app: AppHandle,
    state: State<'_, ApkOptionalToolsState>,
) -> Result<ApkOptionalToolsInstallResult, String> {
    {
        let mut running = state
            .install_running
            .lock()
            .map_err(|_| "Optional tool installer state is unavailable".to_string())?;
        if *running {
            return Err("Optional tools are already being installed".to_string());
        }
        *running = true;
    }

    let result = async {
        let root = managed_tools_root(&app)?;
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(|error| format!("Cannot create managed tools directory: {error}"))?;
        let staging = root.join(format!(
            ".install-{}-{:016x}",
            Utc::now().format("%Y%m%d%H%M%S%3f"),
            rand::rng().random::<u64>()
        ));
        tokio::fs::create_dir_all(&staging)
            .await
            .map_err(|error| format!("Cannot create installer staging directory: {error}"))?;
        let installed = install_managed_assets(&app, &root, &staging).await;
        let _ = tokio::fs::remove_dir_all(&staging).await;
        installed
    }
    .await;

    if let Ok(mut running) = state.install_running.lock() {
        *running = false;
    }
    if let Err(error) = &result {
        emit_install_progress(&app, "failed", None, 0, None, 0, error);
    }
    result
}

#[tauri::command]
pub async fn detect_apk_optional_tools(
    app: AppHandle,
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
    let managed_root = managed_tools_root(&app)?;
    let mut tools = Vec::with_capacity(2);
    for tool in [ApkOptionalTool::Jadx, ApkOptionalTool::Apktool] {
        let managed = installed_managed_tool(&managed_root, tool);
        tools.push(
            detect_tool(
                tool,
                custom.as_deref(),
                custom_files.get(&tool).map(PathBuf::as_path),
                managed.as_deref(),
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
    let managed_root = managed_tools_root(&app)?;
    let managed = installed_managed_tool(&managed_root, tool);
    let detected = detect_tool(
        tool,
        custom.as_deref(),
        custom_file.as_deref(),
        managed.as_deref(),
    )
    .await;
    if !detected.available {
        return Err(detected
            .reason
            .unwrap_or_else(|| "Optional tool is not installed".to_string()));
    }
    let command = tool_command(
        tool,
        custom.as_deref(),
        custom_file.as_deref(),
        managed.as_deref(),
    );
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
    use std::io::Write;
    use zip::write::SimpleFileOptions;

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
    fn finds_tools_in_gui_fallback_search_directories() {
        let directory = temp_path("fallback-search");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("apktool"), b"").unwrap();

        assert_eq!(
            executable_in_search_directories(
                ApkOptionalTool::Apktool,
                [temp_path("missing-search"), directory.clone()],
            ),
            Some(directory.join("apktool"))
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
        let command = tool_command(ApkOptionalTool::Apktool, None, Some(jar), None);
        assert_eq!(command.program, PathBuf::from("java"));
        assert_eq!(command.prefix_args, vec!["-jar", "/tmp/apktool_3.0.3.jar"]);
        assert_eq!(command.display_path, jar);
    }

    #[test]
    fn managed_tool_is_used_before_the_process_path() {
        let managed = Path::new("/managed/jadx/bin/jadx");
        let command = tool_command(ApkOptionalTool::Jadx, None, None, Some(managed));
        assert_eq!(command.program, managed);
        assert_eq!(command.display_path, managed);
    }

    #[test]
    fn pinned_asset_checksum_helper_matches_sha256() {
        assert_eq!(
            sha256_hex(b"scrcpy-gui-plus"),
            "93ec5ef1be492736084ef62d7c907d8f61800e6135d20442c77dd6e1f65ecbeb"
        );
    }

    #[test]
    fn extracts_a_bounded_jadx_archive_and_rejects_path_traversal() {
        let directory = temp_path("jadx-extraction");
        std::fs::create_dir_all(&directory).unwrap();
        let valid_archive = directory.join("valid.zip");
        {
            let mut writer = zip::ZipWriter::new(File::create(&valid_archive).unwrap());
            writer
                .start_file("bin/jadx", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"#!/bin/sh\n").unwrap();
            writer
                .start_file("lib/jadx-cli.jar", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"jar").unwrap();
            writer.finish().unwrap();
        }
        let extracted = directory.join("valid-output");
        extract_jadx_archive(&valid_archive, &extracted).unwrap();
        assert!(extracted.join("bin/jadx").is_file());
        assert!(extracted.join("lib/jadx-cli.jar").is_file());

        let unsafe_archive = directory.join("unsafe.zip");
        {
            let mut writer = zip::ZipWriter::new(File::create(&unsafe_archive).unwrap());
            writer
                .start_file("../escape", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"nope").unwrap();
            writer.finish().unwrap();
        }
        assert!(extract_jadx_archive(&unsafe_archive, &directory.join("unsafe-output")).is_err());
        assert!(!directory.join("escape").exists());
        std::fs::remove_dir_all(directory).unwrap();
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
