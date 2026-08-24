//! Secure installed-APK discovery and export support.
//!
//! Package and serial inputs use the centralized ADB validators. Remote paths
//! come only from `pm path`, are independently validated, and are passed as
//! argument-array entries (never interpolated into a host or device shell).

use crate::adb::{self, AdbError};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

const DISCOVERY_TIMEOUT_SECS: u64 = 20;
const SIZE_TIMEOUT_SECS: u64 = 10;
const PULL_TIMEOUT_SECS: u64 = 300;
const MAX_APK_ARTIFACTS: usize = 128;
const MAX_DESTINATION_ATTEMPTS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApkArtifactKind {
    Base,
    Split,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApkExportMode {
    /// Export the selected artifacts (or every artifact) to a new folder.
    #[default]
    Folder,
    /// Export only the base APK to a new folder.
    BaseOnly,
    /// Export an installable APK Set ZIP with stable `apk/` + `metadata.json` layout.
    ApkSetZip,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkArtifact {
    pub remote_path: String,
    pub file_name: String,
    pub kind: ApkArtifactKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkDiscoveryResult {
    pub success: bool,
    pub package_name: String,
    pub artifacts: Vec<ApkArtifact>,
    pub total_size_bytes: u64,
    pub size_complete: bool,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkExportFileResult {
    pub remote_path: String,
    pub local_file_name: String,
    pub kind: ApkArtifactKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkExportResult {
    pub success: bool,
    pub partial: bool,
    pub package_name: String,
    pub device_serial: String,
    pub mode: ApkExportMode,
    /// ADB does not provide reliable cross-platform byte progress. Callers can
    /// report progress after each entry in `files` instead.
    pub progress_granularity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_archive_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub files: Vec<ApkExportFileResult>,
    pub exported_count: usize,
    pub failed_count: usize,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApkExportManifest<'a> {
    schema_version: u8,
    package_name: &'a str,
    device_serial: &'a str,
    exported_at: String,
    mode: ApkExportMode,
    progress_granularity: &'static str,
    files: &'a [ApkExportFileResult],
}

fn adb_failure(package: &str, error: &AdbError) -> ApkDiscoveryResult {
    ApkDiscoveryResult {
        success: false,
        package_name: package.to_string(),
        artifacts: Vec::new(),
        total_size_bytes: 0,
        size_complete: false,
        warnings: Vec::new(),
        error: Some(error.message()),
        error_code: Some(error.code().to_string()),
    }
}

fn export_failure(
    serial: &str,
    package: &str,
    code: &str,
    message: impl Into<String>,
    mode: ApkExportMode,
) -> ApkExportResult {
    ApkExportResult {
        success: false,
        partial: false,
        package_name: package.to_string(),
        device_serial: serial.to_string(),
        mode,
        progress_granularity: "file".to_string(),
        destination_dir: None,
        metadata_path: None,
        metadata_archive_path: None,
        output_path: None,
        files: Vec::new(),
        exported_count: 0,
        failed_count: 0,
        warnings: Vec::new(),
        error: Some(message.into()),
        error_code: Some(code.to_string()),
    }
}

/// Installed APK paths have no reason to contain shell punctuation. Keeping a
/// strict allowlist is defensive because `adb shell` implementations differ in
/// how they preserve argument boundaries.
fn validate_remote_apk_path(path: &str) -> Result<(), &'static str> {
    if path.is_empty() || path.len() > 2048 || !path.starts_with('/') {
        return Err("APK path must be a non-empty absolute path");
    }
    if !path.ends_with(".apk") {
        return Err("Package Manager returned a non-APK path");
    }
    if path.split('/').any(|part| part == "..") {
        return Err("APK path contains traversal");
    }
    if !path.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(character, '/' | '.' | '_' | '-' | '+' | '=' | '@' | '~')
    }) {
        return Err("APK path contains unsupported characters");
    }
    Ok(())
}

fn remote_file_name(path: &str) -> Option<&str> {
    path.rsplit('/').next().filter(|name| !name.is_empty())
}

fn split_name_from_file(file_name: &str, fallback: usize) -> String {
    let stem = file_name.strip_suffix(".apk").unwrap_or(file_name);
    let name = stem.strip_prefix("split_").unwrap_or(stem);
    if name.is_empty() || name == "base" {
        format!("split_{fallback}")
    } else {
        name.to_string()
    }
}

fn parse_pm_paths(output: &str) -> (Vec<ApkArtifact>, Vec<String>) {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    let mut warnings = Vec::new();
    for line in output.lines() {
        let Some(raw_path) = line.trim().strip_prefix("package:") else {
            continue;
        };
        let path = raw_path.trim();
        if let Err(message) = validate_remote_apk_path(path) {
            warnings.push(format!("Ignored unsafe package path: {message}"));
            continue;
        }
        if seen.insert(path.to_string()) {
            paths.push(path.to_string());
        }
        if paths.len() == MAX_APK_ARTIFACTS {
            warnings.push(format!(
                "Package path list was limited to {MAX_APK_ARTIFACTS} artifacts"
            ));
            break;
        }
    }

    let base_index = paths
        .iter()
        .position(|path| remote_file_name(path) == Some("base.apk"))
        .or_else(|| {
            paths.iter().position(|path| {
                remote_file_name(path)
                    .map(|name| !name.starts_with("split_"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(0);

    let artifacts = paths
        .into_iter()
        .enumerate()
        .map(|(index, remote_path)| {
            let original_name = remote_file_name(&remote_path)
                .unwrap_or("split.apk")
                .to_string();
            let kind = if index == base_index {
                ApkArtifactKind::Base
            } else {
                ApkArtifactKind::Split
            };
            let split_name = (kind == ApkArtifactKind::Split)
                .then(|| split_name_from_file(&original_name, index));
            ApkArtifact {
                remote_path,
                file_name: if kind == ApkArtifactKind::Base {
                    "base.apk".to_string()
                } else {
                    original_name
                },
                kind,
                split_name,
                size_bytes: None,
                size_error: None,
            }
        })
        .collect();
    (artifacts, warnings)
}

fn safe_split_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(180)
        .collect();
    let trimmed = sanitized.trim_matches(['.', '_', '-']);
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn export_file_names(artifacts: &[ApkArtifact]) -> Vec<String> {
    let mut used = HashSet::new();
    artifacts
        .iter()
        .enumerate()
        .map(|(index, artifact)| {
            let stem = match artifact.kind {
                ApkArtifactKind::Base => "base".to_string(),
                ApkArtifactKind::Split => {
                    let split_name = artifact
                        .split_name
                        .clone()
                        .unwrap_or_else(|| format!("split_{index}"));
                    format!("split_{}", safe_split_component(&split_name))
                }
            };
            let mut candidate = format!("{stem}.apk");
            let mut duplicate = 2;
            while !used.insert(candidate.to_ascii_lowercase()) {
                candidate = format!("{stem}-{duplicate}.apk");
                duplicate += 1;
            }
            candidate
        })
        .collect()
}

fn create_unique_destination(root: &Path, package: &str) -> Result<PathBuf, std::io::Error> {
    std::fs::create_dir_all(root)?;
    if !root.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "Export destination is not a directory",
        ));
    }
    for suffix in 1..=MAX_DESTINATION_ATTEMPTS {
        let name = if suffix == 1 {
            format!("{package}-apks")
        } else {
            format!("{package}-apks-{suffix}")
        };
        let destination = root.join(name);
        match std::fs::create_dir(&destination) {
            Ok(()) => return Ok(destination),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "Could not allocate a unique export directory",
    ))
}

fn validate_local_destination(value: &str) -> Result<&Path, &'static str> {
    let trimmed = value.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty() || value.contains('\0') || !path.is_absolute() {
        return Err("Export destination must be a valid absolute directory path");
    }
    Ok(path)
}

fn create_unique_apk_set_destination(
    root: &Path,
    package: &str,
) -> Result<(PathBuf, PathBuf), std::io::Error> {
    std::fs::create_dir_all(root)?;
    if !root.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "Export destination is not a directory",
        ));
    }
    for suffix in 1..=MAX_DESTINATION_ATTEMPTS {
        let stem = if suffix == 1 {
            format!("{package}-apk-set")
        } else {
            format!("{package}-apk-set-{suffix}")
        };
        let archive = root.join(format!("{stem}.zip"));
        if archive.exists() {
            continue;
        }
        let staging = root.join(format!(".{stem}.staging"));
        match std::fs::create_dir(&staging) {
            Ok(()) => return Ok((staging, archive)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "Could not allocate a unique APK Set destination",
    ))
}

fn select_artifacts(
    artifacts: &[ApkArtifact],
    mode: ApkExportMode,
    selected_paths: Option<&[String]>,
) -> Result<Vec<ApkArtifact>, String> {
    let requested = selected_paths.filter(|paths| !paths.is_empty());
    if let Some(paths) = requested {
        if paths.len() > MAX_APK_ARTIFACTS {
            return Err(format!(
                "Selection exceeds the {MAX_APK_ARTIFACTS}-artifact limit"
            ));
        }
        for path in paths {
            validate_remote_apk_path(path)
                .map_err(|message| format!("Invalid selected APK path: {message}"))?;
        }
    }

    let selected = if mode == ApkExportMode::BaseOnly {
        artifacts
            .iter()
            .find(|artifact| artifact.kind == ApkArtifactKind::Base)
            .cloned()
            .into_iter()
            .collect::<Vec<_>>()
    } else if let Some(paths) = requested {
        let requested: HashSet<&str> = paths.iter().map(String::as_str).collect();
        if requested.len() != paths.len() {
            return Err("Selected APK paths contain duplicates".to_string());
        }
        let selected: Vec<_> = artifacts
            .iter()
            .filter(|artifact| requested.contains(artifact.remote_path.as_str()))
            .cloned()
            .collect();
        if selected.len() != requested.len() {
            return Err("Selection contains an APK path not reported by this package".to_string());
        }
        selected
    } else {
        artifacts.to_vec()
    };
    if selected.is_empty() {
        return Err("No APK artifacts were selected for export".to_string());
    }
    if mode == ApkExportMode::ApkSetZip
        && !selected
            .iter()
            .any(|artifact| artifact.kind == ApkArtifactKind::Base)
    {
        return Err("APK Set selection must include the base APK".to_string());
    }
    Ok(selected)
}

fn write_apk_set_archive(
    archive_path: &Path,
    staging: &Path,
    metadata: &[u8],
    files: &[ApkExportFileResult],
) -> Result<(), String> {
    let result = (|| {
        let output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(archive_path)
            .map_err(|error| error.to_string())?;
        let mut writer = zip::ZipWriter::new(output);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let compressed = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer
            .add_directory("apk/", stored)
            .map_err(|error| error.to_string())?;
        for file in files.iter().filter(|file| file.success) {
            let source = staging.join(&file.local_file_name);
            writer
                .start_file(format!("apk/{}", file.local_file_name), stored)
                .map_err(|error| error.to_string())?;
            let mut input = std::fs::File::open(&source)
                .map_err(|error| format!("{}: {error}", source.display()))?;
            std::io::copy(&mut input, &mut writer).map_err(|error| error.to_string())?;
        }
        writer
            .start_file("metadata.json", compressed)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(metadata)
            .map_err(|error| error.to_string())?;
        writer.finish().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(archive_path);
    }
    result
}

pub(crate) async fn discover(
    serial: &str,
    package: &str,
    custom_path: Option<String>,
) -> ApkDiscoveryResult {
    if let Err(error) = adb::validate_serial(serial) {
        return adb_failure(package, &error);
    }
    if let Err(error) = adb::validate_package_name(package) {
        return adb_failure(package, &error);
    }
    let output = match adb::run_adb_text(
        Some(serial),
        &["shell", "pm", "path", package],
        custom_path.clone(),
        DISCOVERY_TIMEOUT_SECS,
    )
    .await
    {
        Ok(output) => output,
        Err(error) => return adb_failure(package, &error),
    };
    let (mut artifacts, mut warnings) = parse_pm_paths(&output);
    if artifacts.is_empty() {
        let unsafe_paths = !warnings.is_empty();
        return ApkDiscoveryResult {
            success: false,
            package_name: package.to_string(),
            artifacts: Vec::new(),
            total_size_bytes: 0,
            size_complete: false,
            warnings,
            error: Some("Package Manager did not return any safe APK paths".to_string()),
            error_code: Some(
                if unsafe_paths {
                    "unsafe_package_paths"
                } else {
                    "package_not_found"
                }
                .to_string(),
            ),
        };
    }

    for artifact in &mut artifacts {
        match adb::run_adb_text(
            Some(serial),
            &["shell", "stat", "-c", "%s", &artifact.remote_path],
            custom_path.clone(),
            SIZE_TIMEOUT_SECS,
        )
        .await
        {
            Ok(output) => match output.trim().parse::<u64>() {
                Ok(size) => artifact.size_bytes = Some(size),
                Err(_) => {
                    let message = "Device returned an unreadable APK size".to_string();
                    artifact.size_error = Some(message.clone());
                    warnings.push(format!("{}: {message}", artifact.file_name));
                }
            },
            Err(error) => {
                let message = error.message();
                artifact.size_error = Some(message.clone());
                warnings.push(format!(
                    "{}: size unavailable ({message})",
                    artifact.file_name
                ));
            }
        }
    }
    let size_complete = artifacts
        .iter()
        .all(|artifact| artifact.size_bytes.is_some());
    let total_size_bytes = artifacts
        .iter()
        .filter_map(|artifact| artifact.size_bytes)
        .sum();
    artifacts.sort_by(|left, right| {
        let left_rank = usize::from(left.kind == ApkArtifactKind::Split);
        let right_rank = usize::from(right.kind == ApkArtifactKind::Split);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    ApkDiscoveryResult {
        success: true,
        package_name: package.to_string(),
        artifacts,
        total_size_bytes,
        size_complete,
        warnings,
        error: None,
        error_code: None,
    }
}

#[tauri::command]
pub async fn apk_discover_splits(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> ApkDiscoveryResult {
    discover(serial.trim(), package.trim(), custom_path).await
}

#[tauri::command]
pub async fn apk_export_package(
    serial: String,
    package: String,
    local_dir: String,
    custom_path: Option<String>,
    selected_paths: Option<Vec<String>>,
    mode: Option<ApkExportMode>,
) -> ApkExportResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    let mode = mode.unwrap_or_default();
    let local_root = match validate_local_destination(&local_dir) {
        Ok(path) => path,
        Err(error) => return export_failure(&serial, &package, "invalid_destination", error, mode),
    };
    let discovery = discover(&serial, &package, custom_path.clone()).await;
    if !discovery.success {
        return export_failure(
            &serial,
            &package,
            discovery
                .error_code
                .as_deref()
                .unwrap_or("discovery_failed"),
            discovery
                .error
                .unwrap_or_else(|| "APK discovery failed".to_string()),
            mode,
        );
    }
    let artifacts = match select_artifacts(&discovery.artifacts, mode, selected_paths.as_deref()) {
        Ok(artifacts) => artifacts,
        Err(error) => return export_failure(&serial, &package, "invalid_selection", error, mode),
    };
    let (destination, archive_path) = match mode {
        ApkExportMode::ApkSetZip => match create_unique_apk_set_destination(local_root, &package) {
            Ok((staging, archive)) => (staging, Some(archive)),
            Err(error) => {
                return export_failure(
                    &serial,
                    &package,
                    "create_destination_failed",
                    format!("Failed to create APK Set destination: {error}"),
                    mode,
                )
            }
        },
        ApkExportMode::Folder | ApkExportMode::BaseOnly => {
            match create_unique_destination(local_root, &package) {
                Ok(destination) => (destination, None),
                Err(error) => {
                    return export_failure(
                        &serial,
                        &package,
                        "create_destination_failed",
                        format!("Failed to create export destination: {error}"),
                        mode,
                    )
                }
            }
        }
    };
    let local_names = export_file_names(&artifacts);
    let mut files = Vec::with_capacity(artifacts.len());
    for (artifact, local_file_name) in artifacts.iter().zip(local_names) {
        let local_path = destination.join(&local_file_name);
        let local_string = local_path.to_string_lossy().to_string();
        match adb::run_adb_text(
            Some(&serial),
            &["pull", &artifact.remote_path, &local_string],
            custom_path.clone(),
            PULL_TIMEOUT_SECS,
        )
        .await
        {
            Ok(_) => files.push(ApkExportFileResult {
                remote_path: artifact.remote_path.clone(),
                local_file_name,
                kind: artifact.kind,
                split_name: artifact.split_name.clone(),
                size_bytes: artifact.size_bytes,
                success: true,
                local_path: Some(local_string),
                archive_path: None,
                error: None,
                error_code: None,
            }),
            Err(error) => files.push(ApkExportFileResult {
                remote_path: artifact.remote_path.clone(),
                local_file_name,
                kind: artifact.kind,
                split_name: artifact.split_name.clone(),
                size_bytes: artifact.size_bytes,
                success: false,
                local_path: None,
                archive_path: None,
                error: Some(error.message()),
                error_code: Some(error.code().to_string()),
            }),
        }
    }

    if mode == ApkExportMode::ApkSetZip {
        for file in files.iter_mut().filter(|file| file.success) {
            file.archive_path = Some(format!("apk/{}", file.local_file_name));
        }
    }
    let exported_count = files.iter().filter(|file| file.success).count();
    let failed_count = files.len() - exported_count;
    let mut manifest_files = files.clone();
    if mode == ApkExportMode::ApkSetZip {
        for file in manifest_files.iter_mut().filter(|file| file.success) {
            // Staging is removed once the ZIP is finalized; archivePath is the
            // durable location consumers should use from saved metadata.
            file.local_path = None;
        }
    }
    let manifest = ApkExportManifest {
        schema_version: 2,
        package_name: &package,
        device_serial: &serial,
        exported_at: Utc::now().to_rfc3339(),
        mode,
        progress_granularity: "file",
        files: &manifest_files,
    };
    let metadata_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string());
    let mut cleanup_warning = None;
    let (metadata_path, metadata_archive_path, output_path, packaging_error) = match mode {
        ApkExportMode::ApkSetZip => {
            let archive = archive_path.as_ref().expect("APK Set archive path");
            match metadata_bytes
                .and_then(|bytes| write_apk_set_archive(archive, &destination, &bytes, &files))
            {
                Ok(()) => {
                    for file in files.iter_mut().filter(|file| file.success) {
                        file.local_path = None;
                    }
                    cleanup_warning = std::fs::remove_dir_all(&destination)
                        .err()
                        .map(|error| format!("Failed to remove staging directory: {error}"));
                    (
                        None,
                        Some("metadata.json".to_string()),
                        Some(archive.to_string_lossy().to_string()),
                        None,
                    )
                }
                Err(error) => (None, None, None, Some(error)),
            }
        }
        ApkExportMode::Folder | ApkExportMode::BaseOnly => {
            let metadata = destination.join("apk-export.json");
            let error = metadata_bytes
                .and_then(|bytes| {
                    std::fs::write(&metadata, bytes).map_err(|error| error.to_string())
                })
                .err();
            (
                error
                    .is_none()
                    .then(|| metadata.to_string_lossy().to_string()),
                None,
                Some(destination.to_string_lossy().to_string()),
                error,
            )
        }
    };
    let mut warnings = discovery.warnings;
    if let Some(error) = packaging_error.as_ref() {
        warnings.push(format!("Failed to finalize export: {error}"));
    }
    if let Some(warning) = cleanup_warning {
        warnings.push(warning);
    }
    let success = failed_count == 0 && packaging_error.is_none();
    let partial = exported_count > 0 && !success;
    let destination_dir = if mode == ApkExportMode::ApkSetZip && output_path.is_some() {
        Some(local_root.to_string_lossy().to_string())
    } else {
        Some(destination.to_string_lossy().to_string())
    };
    ApkExportResult {
        success,
        partial,
        package_name: package,
        device_serial: serial,
        mode,
        progress_granularity: "file".to_string(),
        destination_dir,
        metadata_path,
        metadata_archive_path,
        output_path,
        files,
        exported_count,
        failed_count,
        warnings,
        error: (!success).then(|| {
            if failed_count > 0 {
                format!("Failed to export {failed_count} APK file(s)")
            } else {
                "APK files exported but the output could not be finalized".to_string()
            }
        }),
        error_code: (!success).then(|| {
            if failed_count > 0 && exported_count > 0 {
                "partial_export".to_string()
            } else if failed_count > 0 {
                "export_failed".to_string()
            } else {
                "packaging_failed".to_string()
            }
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn fixture_artifacts() -> Vec<ApkArtifact> {
        parse_pm_paths(
            "package:/data/app/com.example/base.apk\n\
             package:/data/app/com.example/split_config.en.apk\n\
             package:/data/app/com.example/split_config.arm64_v8a.apk",
        )
        .0
    }

    #[test]
    fn parses_and_classifies_base_and_split_apks() {
        let (artifacts, warnings) = parse_pm_paths(
            "package:/data/app/~~token==/com.example-a==/split_config.en.apk\n\
             package:/data/app/~~token==/com.example-a==/base.apk\n\
             package:/data/app/~~token==/com.example-a==/split_config.arm64_v8a.apk\n",
        );
        assert!(warnings.is_empty());
        assert_eq!(artifacts.len(), 3);
        assert_eq!(artifacts[0].kind, ApkArtifactKind::Split);
        assert_eq!(artifacts[1].kind, ApkArtifactKind::Base);
        assert_eq!(artifacts[2].split_name.as_deref(), Some("config.arm64_v8a"));
    }

    #[test]
    fn falls_back_to_first_non_split_file_as_base() {
        let (artifacts, _) = parse_pm_paths(
            "package:/system/app/Legacy/Legacy.apk\npackage:/system/app/Legacy/split_hdpi.apk",
        );
        assert_eq!(artifacts[0].kind, ApkArtifactKind::Base);
        assert_eq!(artifacts[0].file_name, "base.apk");
        assert_eq!(artifacts[1].kind, ApkArtifactKind::Split);
    }

    #[test]
    fn rejects_unsafe_paths_and_deduplicates_pm_output() {
        let (artifacts, warnings) = parse_pm_paths(
            "package:/data/app/com.example/base.apk\n\
             package:/data/app/com.example/base.apk\n\
             package:/data/app/com.example/../../escape.apk\n\
             package:/data/app/com.example/bad;name.apk",
        );
        assert_eq!(artifacts.len(), 1);
        assert_eq!(warnings.len(), 2);
        assert!(validate_remote_apk_path("relative/base.apk").is_err());
        assert!(validate_remote_apk_path("/data/app/base.txt").is_err());
    }

    #[test]
    fn generates_stable_duplicate_safe_export_names() {
        let artifact = |split_name: Option<&str>| ApkArtifact {
            remote_path: "/data/app/x.apk".to_string(),
            file_name: "x.apk".to_string(),
            kind: if split_name.is_some() {
                ApkArtifactKind::Split
            } else {
                ApkArtifactKind::Base
            },
            split_name: split_name.map(str::to_string),
            size_bytes: None,
            size_error: None,
        };
        assert_eq!(
            export_file_names(&[
                artifact(None),
                artifact(Some("config/en")),
                artifact(Some("config/en")),
            ]),
            vec!["base.apk", "split_config_en.apk", "split_config_en-2.apk"]
        );
    }

    #[test]
    fn allocates_a_new_destination_without_overwriting_existing_export() {
        let root = std::env::temp_dir().join(format!(
            "apk-toolkit-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let first = create_unique_destination(&root, "com.example.app").unwrap();
        let second = create_unique_destination(&root, "com.example.app").unwrap();
        assert_eq!(first.file_name().unwrap(), "com.example.app-apks");
        assert_eq!(second.file_name().unwrap(), "com.example.app-apks-2");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selects_individual_artifacts_and_supports_base_only_mode() {
        let artifacts = fixture_artifacts();
        let selected_path = artifacts[1].remote_path.clone();
        let selected = select_artifacts(
            &artifacts,
            ApkExportMode::Folder,
            Some(std::slice::from_ref(&selected_path)),
        )
        .unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].remote_path, selected_path);

        let base_only = select_artifacts(
            &artifacts,
            ApkExportMode::BaseOnly,
            Some(&[artifacts[2].remote_path.clone()]),
        )
        .unwrap();
        assert_eq!(base_only.len(), 1);
        assert_eq!(base_only[0].kind, ApkArtifactKind::Base);
    }

    #[test]
    fn apk_set_selection_requires_base_and_rejects_unsafe_or_unknown_paths() {
        let artifacts = fixture_artifacts();
        assert!(select_artifacts(
            &artifacts,
            ApkExportMode::ApkSetZip,
            Some(&[artifacts[1].remote_path.clone()]),
        )
        .unwrap_err()
        .contains("base APK"));
        assert!(select_artifacts(
            &artifacts,
            ApkExportMode::Folder,
            Some(&["/data/app/com.example/bad;name.apk".to_string()]),
        )
        .unwrap_err()
        .contains("Invalid selected APK path"));
        assert!(select_artifacts(
            &artifacts,
            ApkExportMode::Folder,
            Some(&["/data/app/com.example/unknown.apk".to_string()]),
        )
        .unwrap_err()
        .contains("not reported"));
        assert!(validate_local_destination("").is_err());
        assert!(validate_local_destination("relative/output").is_err());
        assert!(validate_local_destination("/tmp/bad\0path").is_err());
    }

    #[test]
    fn creates_stable_apk_set_archive_layout_with_metadata_and_successes_only() {
        let root = std::env::temp_dir().join(format!(
            "apk-set-layout-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let staging = root.join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("base.apk"), b"base-bytes").unwrap();
        std::fs::write(staging.join("split_en.apk"), b"split-bytes").unwrap();
        let result = |name: &str, success: bool| ApkExportFileResult {
            remote_path: format!("/data/app/com.example/{name}"),
            local_file_name: name.to_string(),
            kind: if name == "base.apk" {
                ApkArtifactKind::Base
            } else {
                ApkArtifactKind::Split
            },
            split_name: (name != "base.apk").then(|| "en".to_string()),
            size_bytes: None,
            success,
            local_path: None,
            archive_path: success.then(|| format!("apk/{name}")),
            error: (!success).then(|| "pull failed".to_string()),
            error_code: (!success).then(|| "failed".to_string()),
        };
        let files = vec![
            result("base.apk", true),
            result("split_en.apk", true),
            result("split_missing.apk", false),
        ];
        let archive_path = root.join("set.zip");
        write_apk_set_archive(&archive_path, &staging, br#"{"schemaVersion":2}"#, &files).unwrap();

        let mut archive =
            zip::ZipArchive::new(std::fs::File::open(&archive_path).unwrap()).unwrap();
        let names: Vec<_> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["apk/", "apk/base.apk", "apk/split_en.apk", "metadata.json",]
        );
        let mut metadata = String::new();
        archive
            .by_name("metadata.json")
            .unwrap()
            .read_to_string(&mut metadata)
            .unwrap();
        assert_eq!(metadata, r#"{"schemaVersion":2}"#);
        assert!(archive.by_name("apk/split_missing.apk").is_err());
        drop(archive);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apk_set_paths_are_duplicate_safe_and_failed_archives_are_removed() {
        let root = std::env::temp_dir().join(format!(
            "apk-set-path-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let (first_staging, first_archive) =
            create_unique_apk_set_destination(&root, "com.example.app").unwrap();
        std::fs::write(&first_archive, b"occupied").unwrap();
        let (second_staging, second_archive) =
            create_unique_apk_set_destination(&root, "com.example.app").unwrap();
        assert_ne!(first_archive, second_archive);
        let missing = ApkExportFileResult {
            remote_path: "/data/app/base.apk".to_string(),
            local_file_name: "base.apk".to_string(),
            kind: ApkArtifactKind::Base,
            split_name: None,
            size_bytes: None,
            success: true,
            local_path: None,
            archive_path: Some("apk/base.apk".to_string()),
            error: None,
            error_code: None,
        };
        assert!(
            write_apk_set_archive(&second_archive, &second_staging, b"{}", &[missing]).is_err()
        );
        assert!(!second_archive.exists());
        std::fs::remove_dir_all(first_staging).unwrap();
        std::fs::remove_dir_all(second_staging).unwrap();
        std::fs::remove_file(first_archive).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
