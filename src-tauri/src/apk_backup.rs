//! Enriched, app-data-free APK Set backup archives.
//!
//! Device discovery and pulling remain owned by `apk_toolkit`; APK inspection
//! remains owned by `apk_analyzer`. This module only composes those results
//! into and validates the stable backup container.

use crate::{
    apk_analyzer::{self, ApkAnalysisResult},
    apk_toolkit::{self, ApkArtifactKind, ApkExportMode, ApkExportResult},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

const FORMAT_NAME: &str = "mobile-device-studio-apk-set";
const SCHEMA_VERSION: u8 = 1;
const MAX_OUTPUT_ATTEMPTS: usize = 10_000;
const MAX_ARCHIVE_ENTRIES: usize = 512;
const MAX_JSON_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkSetFileMetadata {
    pub archive_path: String,
    pub source_path: String,
    pub kind: String,
    pub split_name: Option<String>,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApkSetMetadata {
    schema_version: u8,
    format: String,
    package_name: String,
    device_serial: String,
    created_at: String,
    includes_app_data: bool,
    complete: bool,
    partial: bool,
    files: Vec<ApkSetFileMetadata>,
    analysis: Option<ApkSetAnalysisSummary>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApkSetAnalysisSummary {
    package_name: Option<String>,
    app_label: Option<String>,
    version_name: Option<String>,
    version_code: Option<String>,
    min_sdk: Option<String>,
    target_sdk: Option<String>,
    base_apk_sha256: String,
    native_abis: Vec<String>,
    native_libraries: Vec<ApkSetNativeLibrarySummary>,
    components: Vec<ApkSetComponentSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApkSetNativeLibrarySummary {
    abi: String,
    name: String,
    archive_path: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApkSetComponentSummary {
    kind: String,
    name: String,
    exported: Option<bool>,
    enabled: Option<bool>,
    launcher: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkSetBackupResult {
    pub success: bool,
    pub partial: bool,
    pub package_name: String,
    pub device_serial: String,
    pub output_path: Option<String>,
    pub exported_count: usize,
    pub failed_count: usize,
    pub analysis_available: bool,
    pub validation: Option<ApkSetValidationResult>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkSetValidationResult {
    pub valid: bool,
    pub path: String,
    pub schema_version: Option<u8>,
    pub package_name: Option<String>,
    pub apk_count: usize,
    pub partial: Option<bool>,
    pub includes_app_data: Option<bool>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

fn backup_failure(
    serial: &str,
    package: &str,
    code: &str,
    error: impl Into<String>,
) -> ApkSetBackupResult {
    ApkSetBackupResult {
        success: false,
        partial: false,
        package_name: package.to_string(),
        device_serial: serial.to_string(),
        output_path: None,
        exported_count: 0,
        failed_count: 0,
        analysis_available: false,
        validation: None,
        warnings: Vec::new(),
        error: Some(error.into()),
        error_code: Some(code.to_string()),
    }
}

fn validate_output_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    let output = PathBuf::from(trimmed);
    if trimmed.is_empty() || trimmed.contains('\0') || !output.is_absolute() {
        return Err("Output directory must be a non-empty absolute path".to_string());
    }
    std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
    if !output.is_dir() {
        return Err("Output destination is not a directory".to_string());
    }
    Ok(output)
}

fn allocate_output(root: &Path, package: &str) -> Result<PathBuf, String> {
    for suffix in 1..=MAX_OUTPUT_ATTEMPTS {
        let stem = if suffix == 1 {
            format!("{package}-backup")
        } else {
            format!("{package}-backup-{suffix}")
        };
        let path = root.join(format!("{stem}.apkset"));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Could not allocate a unique APK Set backup name".to_string())
}

fn safe_archive_apk_path(path: &str) -> bool {
    path.starts_with("apk/")
        && path.ends_with(".apk")
        && !path.contains('\\')
        && !path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "..")
}

fn extract_base_for_analysis(
    source_archive: &Path,
    archive_path: &str,
    output: &Path,
) -> Result<(), String> {
    if !safe_archive_apk_path(archive_path) {
        return Err("Base APK archive path is unsafe".to_string());
    }
    let file = File::open(source_archive).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut entry = archive
        .by_name(archive_path)
        .map_err(|error| error.to_string())?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| error.to_string())?;
    std::io::copy(&mut entry, &mut target).map_err(|error| error.to_string())?;
    target.sync_all().map_err(|error| error.to_string())
}

fn analysis_summary(analysis: &ApkAnalysisResult) -> ApkSetAnalysisSummary {
    ApkSetAnalysisSummary {
        package_name: analysis.manifest.package_name.clone(),
        app_label: analysis.manifest.app_label.clone(),
        version_name: analysis.manifest.version_name.clone(),
        version_code: analysis.manifest.version_code.clone(),
        min_sdk: analysis.manifest.min_sdk.clone(),
        target_sdk: analysis.manifest.target_sdk.clone(),
        base_apk_sha256: analysis.sha256.clone(),
        native_abis: analysis.native_abis.clone(),
        native_libraries: analysis
            .native_libraries
            .iter()
            .map(|library| ApkSetNativeLibrarySummary {
                abi: library.abi.clone(),
                name: library.name.clone(),
                archive_path: library.archive_path.clone(),
                size_bytes: library.size_bytes,
            })
            .collect(),
        components: analysis
            .components
            .iter()
            .map(|component| ApkSetComponentSummary {
                kind: component.kind.clone(),
                name: component.name.clone(),
                exported: component.exported,
                enabled: component.enabled,
                launcher: component.launcher,
            })
            .collect(),
    }
}

fn copy_hashed(mut input: impl Read, output: &mut impl Write) -> Result<(u64, String), String> {
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        hasher.update(&buffer[..count]);
        total += count as u64;
    }
    Ok((total, hex_upper(&hasher.finalize())))
}

fn create_enriched_archive(
    source_archive: &Path,
    destination: &Path,
    export: &ApkExportResult,
    analysis: Option<&ApkAnalysisResult>,
    warnings: &[String],
) -> Result<(), String> {
    let result = (|| {
        let source = File::open(source_archive).map_err(|error| error.to_string())?;
        let mut source = zip::ZipArchive::new(source).map_err(|error| error.to_string())?;
        let output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|error| error.to_string())?;
        let mut writer = zip::ZipWriter::new(output);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let compressed = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer
            .add_directory("apk/", stored)
            .map_err(|error| error.to_string())?;
        let mut metadata_files = Vec::new();
        for file in export.files.iter().filter(|file| file.success) {
            let archive_path = file
                .archive_path
                .as_deref()
                .ok_or_else(|| "Exported APK is missing its archive path".to_string())?;
            if !safe_archive_apk_path(archive_path) {
                return Err("Exported APK has an unsafe archive path".to_string());
            }
            let entry = source
                .by_name(archive_path)
                .map_err(|error| format!("{archive_path}: {error}"))?;
            writer
                .start_file(archive_path, stored)
                .map_err(|error| error.to_string())?;
            let (size_bytes, sha256) = copy_hashed(entry, &mut writer)?;
            metadata_files.push(ApkSetFileMetadata {
                archive_path: archive_path.to_string(),
                source_path: file.remote_path.clone(),
                kind: match file.kind {
                    ApkArtifactKind::Base => "base",
                    ApkArtifactKind::Split => "split",
                }
                .to_string(),
                split_name: file.split_name.clone(),
                size_bytes,
                sha256,
            });
        }
        let metadata = ApkSetMetadata {
            schema_version: SCHEMA_VERSION,
            format: FORMAT_NAME.to_string(),
            package_name: export.package_name.clone(),
            device_serial: export.device_serial.clone(),
            created_at: Utc::now().to_rfc3339(),
            includes_app_data: false,
            complete: export.failed_count == 0,
            partial: export.failed_count > 0,
            files: metadata_files,
            analysis: analysis.map(analysis_summary),
            warnings: warnings.to_vec(),
        };
        let permissions = serde_json::json!({
            "schemaVersion": SCHEMA_VERSION,
            "packageName": export.package_name,
            "permissions": analysis.map(|value| value.permissions.as_slice()).unwrap_or(&[]),
        });
        let signature = serde_json::json!({
            "schemaVersion": SCHEMA_VERSION,
            "packageName": export.package_name,
            "baseApkSha256": analysis.map(|value| value.sha256.as_str()),
            "signing": analysis.map(|value| &value.signing),
        });
        for (name, bytes) in [
            ("metadata.json", serde_json::to_vec_pretty(&metadata)),
            ("permissions.json", serde_json::to_vec_pretty(&permissions)),
            ("signature.json", serde_json::to_vec_pretty(&signature)),
        ] {
            writer
                .start_file(name, compressed)
                .map_err(|error| error.to_string())?;
            writer
                .write_all(&bytes.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        }
        writer.finish().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}

fn validation_failure(path: &Path, code: &str, error: impl Into<String>) -> ApkSetValidationResult {
    ApkSetValidationResult {
        valid: false,
        path: path.to_string_lossy().into_owned(),
        schema_version: None,
        package_name: None,
        apk_count: 0,
        partial: None,
        includes_app_data: None,
        warnings: Vec::new(),
        error: Some(error.into()),
        error_code: Some(code.to_string()),
    }
}

fn read_bounded_entry(archive: &mut zip::ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = archive.by_name(name).map_err(|error| error.to_string())?;
    if entry.size() > MAX_JSON_BYTES {
        return Err(format!("{name} exceeds the metadata size limit"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub fn validate_apk_set_file(path: impl AsRef<Path>) -> ApkSetValidationResult {
    let path = path.as_ref();
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => return validation_failure(path, "open_failed", error.to_string()),
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(error) => return validation_failure(path, "invalid_zip", error.to_string()),
    };
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return validation_failure(path, "too_many_entries", "APK Set has too many entries");
    }
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(error) => return validation_failure(path, "invalid_entry", error.to_string()),
        };
        let name = entry.name().to_string();
        let allowed = name == "apk/"
            || safe_archive_apk_path(&name)
            || matches!(
                name.as_str(),
                "metadata.json" | "permissions.json" | "signature.json"
            );
        if !allowed {
            return validation_failure(path, "unsafe_entry", format!("Unexpected entry: {name}"));
        }
        names.push(name);
    }
    for required in ["metadata.json", "permissions.json", "signature.json"] {
        if !names.iter().any(|name| name == required) {
            return validation_failure(path, "missing_metadata", format!("Missing {required}"));
        }
    }
    let metadata: ApkSetMetadata = match read_bounded_entry(&mut archive, "metadata.json")
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
    {
        Ok(metadata) => metadata,
        Err(error) => return validation_failure(path, "invalid_metadata", error),
    };
    if metadata.schema_version != SCHEMA_VERSION || metadata.format != FORMAT_NAME {
        return validation_failure(path, "unsupported_schema", "Unsupported APK Set schema");
    }
    if metadata.includes_app_data {
        return validation_failure(
            path,
            "app_data_forbidden",
            "APK Set must not contain app data",
        );
    }
    let mut warnings = Vec::new();
    for file in &metadata.files {
        if !safe_archive_apk_path(&file.archive_path) {
            return validation_failure(
                path,
                "unsafe_entry",
                "Metadata contains an unsafe APK path",
            );
        }
        let mut entry = match archive.by_name(&file.archive_path) {
            Ok(entry) => entry,
            Err(error) => return validation_failure(path, "missing_apk", error.to_string()),
        };
        let mut hasher = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = match entry.read(&mut buffer) {
                Ok(count) => count,
                Err(error) => return validation_failure(path, "read_failed", error.to_string()),
            };
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            total += count as u64;
        }
        if total != file.size_bytes || hex_upper(&hasher.finalize()) != file.sha256 {
            return validation_failure(
                path,
                "hash_mismatch",
                format!("{} failed integrity validation", file.archive_path),
            );
        }
    }
    if metadata.partial {
        warnings.push("Backup is partial; one or more split APKs were unavailable".to_string());
    }
    ApkSetValidationResult {
        valid: true,
        path: path.to_string_lossy().into_owned(),
        schema_version: Some(metadata.schema_version),
        package_name: Some(metadata.package_name),
        apk_count: metadata.files.len(),
        partial: Some(metadata.partial),
        includes_app_data: Some(metadata.includes_app_data),
        warnings,
        error: None,
        error_code: None,
    }
}

#[tauri::command]
pub async fn create_apk_set_backup(
    app_handle: tauri::AppHandle,
    serial: String,
    package: String,
    output_dir: String,
    custom_path: Option<String>,
) -> ApkSetBackupResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    let output_root = match validate_output_directory(&output_dir) {
        Ok(path) => path,
        Err(error) => return backup_failure(&serial, &package, "invalid_destination", error),
    };
    let staging_root = match app_handle.path().app_cache_dir() {
        Ok(path) => path.join("apk-backup-staging").join(format!(
            "{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        )),
        Err(error) => {
            return backup_failure(&serial, &package, "cache_unavailable", error.to_string())
        }
    };
    if let Err(error) = std::fs::create_dir_all(&staging_root) {
        return backup_failure(&serial, &package, "cache_unavailable", error.to_string());
    }
    let export = apk_toolkit::apk_export_package(
        serial.clone(),
        package.clone(),
        staging_root.to_string_lossy().into_owned(),
        custom_path,
        None,
        Some(ApkExportMode::ApkSetZip),
    )
    .await;
    let result = create_from_export(&output_root, &staging_root, &export);
    let _ = std::fs::remove_dir_all(&staging_root);
    result
}

fn create_from_export(
    output_root: &Path,
    staging_root: &Path,
    export: &ApkExportResult,
) -> ApkSetBackupResult {
    let source_path = match export.output_path.as_deref() {
        Some(path) => PathBuf::from(path),
        None => {
            let mut failure = backup_failure(
                &export.device_serial,
                &export.package_name,
                export.error_code.as_deref().unwrap_or("export_failed"),
                export
                    .error
                    .clone()
                    .unwrap_or_else(|| "APK export failed".to_string()),
            );
            failure.exported_count = export.exported_count;
            failure.failed_count = export.failed_count;
            failure.warnings = export.warnings.clone();
            return failure;
        }
    };
    let base = export
        .files
        .iter()
        .find(|file| file.success && file.kind == ApkArtifactKind::Base);
    let Some(base) = base else {
        return backup_failure(
            &export.device_serial,
            &export.package_name,
            "base_apk_missing",
            "Base APK export failed; no backup was published",
        );
    };
    let analysis_path = staging_root.join("base-analysis.apk");
    let mut warnings = export.warnings.clone();
    let analysis = base
        .archive_path
        .as_deref()
        .ok_or_else(|| "Base APK archive path is missing".to_string())
        .and_then(|path| extract_base_for_analysis(&source_path, path, &analysis_path))
        .and_then(|_| apk_analyzer::analyze_apk_file(&analysis_path));
    let analysis = match analysis {
        Ok(analysis) => Some(analysis),
        Err(error) => {
            warnings.push(format!("Base APK analysis unavailable: {error}"));
            None
        }
    };
    let destination = match allocate_output(output_root, &export.package_name) {
        Ok(path) => path,
        Err(error) => {
            return backup_failure(
                &export.device_serial,
                &export.package_name,
                "create_destination_failed",
                error,
            )
        }
    };
    if let Err(error) = create_enriched_archive(
        &source_path,
        &destination,
        export,
        analysis.as_ref(),
        &warnings,
    ) {
        return backup_failure(
            &export.device_serial,
            &export.package_name,
            "packaging_failed",
            error,
        );
    }
    let validation = validate_apk_set_file(&destination);
    if !validation.valid {
        let _ = std::fs::remove_file(&destination);
        return backup_failure(
            &export.device_serial,
            &export.package_name,
            "validation_failed",
            validation
                .error
                .clone()
                .unwrap_or_else(|| "Backup validation failed".to_string()),
        );
    }
    ApkSetBackupResult {
        success: export.failed_count == 0,
        partial: export.failed_count > 0,
        package_name: export.package_name.clone(),
        device_serial: export.device_serial.clone(),
        output_path: Some(destination.to_string_lossy().into_owned()),
        exported_count: export.exported_count,
        failed_count: export.failed_count,
        analysis_available: analysis.is_some(),
        validation: Some(validation),
        warnings,
        error: export.error.clone(),
        error_code: export.error_code.clone(),
    }
}

#[tauri::command]
pub async fn validate_apk_set_archive(path: String) -> ApkSetValidationResult {
    let path = PathBuf::from(path.trim());
    tauri::async_runtime::spawn_blocking(move || validate_apk_set_file(path))
        .await
        .unwrap_or_else(|error| {
            validation_failure(Path::new(""), "worker_failed", error.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let value = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("apk-backup-{value}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn fixture_export(source: &Path, partial: bool) -> ApkExportResult {
        ApkExportResult {
            success: !partial,
            partial,
            package_name: "com.example.app".to_string(),
            device_serial: "device".to_string(),
            mode: ApkExportMode::ApkSetZip,
            progress_granularity: "file".to_string(),
            destination_dir: source
                .parent()
                .map(|path| path.to_string_lossy().into_owned()),
            metadata_path: None,
            metadata_archive_path: Some("metadata.json".to_string()),
            output_path: Some(source.to_string_lossy().into_owned()),
            files: vec![apk_toolkit::ApkExportFileResult {
                remote_path: "/data/app/example/base.apk".to_string(),
                local_file_name: "base.apk".to_string(),
                kind: ApkArtifactKind::Base,
                split_name: None,
                size_bytes: Some(3),
                success: true,
                local_path: None,
                archive_path: Some("apk/base.apk".to_string()),
                error: None,
                error_code: None,
            }],
            exported_count: 1,
            failed_count: usize::from(partial),
            warnings: Vec::new(),
            error: partial.then(|| "split failed".to_string()),
            error_code: partial.then(|| "partial_export".to_string()),
        }
    }

    fn source_archive(path: &Path) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.add_directory("apk/", options).unwrap();
        writer.start_file("apk/base.apk", options).unwrap();
        writer.write_all(b"apk").unwrap();
        writer.start_file("metadata.json", options).unwrap();
        writer.write_all(b"{}").unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn writes_stable_enriched_layout_and_reopens_with_hash_validation() {
        let root = temp_dir();
        let source = root.join("source.zip");
        source_archive(&source);
        let export = fixture_export(&source, false);
        let output = root.join("backup.apkset");
        create_enriched_archive(&source, &output, &export, None, &[]).unwrap();
        let validation = validate_apk_set_file(&output);
        assert!(validation.valid, "{:?}", validation.error);
        assert_eq!(validation.apk_count, 1);
        assert_eq!(validation.includes_app_data, Some(false));
        let file = File::open(&output).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        for name in [
            "apk/base.apk",
            "metadata.json",
            "permissions.json",
            "signature.json",
        ] {
            assert!(archive.by_name(name).is_ok(), "missing {name}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_output_names_are_safe_and_partial_metadata_is_explicit() {
        let root = temp_dir();
        let first = allocate_output(&root, "com.example.app").unwrap();
        std::fs::write(&first, b"occupied").unwrap();
        let second = allocate_output(&root, "com.example.app").unwrap();
        assert_ne!(first, second);
        assert!(second.ends_with("com.example.app-backup-2.apkset"));

        let source = root.join("source.zip");
        source_archive(&source);
        let export = fixture_export(&source, true);
        create_enriched_archive(
            &source,
            &second,
            &export,
            None,
            &["split unavailable".to_string()],
        )
        .unwrap();
        let validation = validate_apk_set_file(&second);
        assert!(validation.valid);
        assert_eq!(validation.partial, Some(true));
        assert!(!validation.warnings.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validator_rejects_hash_tampering_unsafe_entries_and_app_data_flag() {
        let root = temp_dir();
        let unsafe_path = root.join("unsafe.apkset");
        let file = File::create(&unsafe_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("../data/private.db", options).unwrap();
        writer.write_all(b"secret").unwrap();
        writer.finish().unwrap();
        assert_eq!(
            validate_apk_set_file(&unsafe_path).error_code.as_deref(),
            Some("unsafe_entry")
        );

        let malformed_archive = |path: &Path, includes_app_data: bool| {
            let metadata = ApkSetMetadata {
                schema_version: SCHEMA_VERSION,
                format: FORMAT_NAME.to_string(),
                package_name: "com.example.app".to_string(),
                device_serial: "device".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                includes_app_data,
                complete: true,
                partial: false,
                files: vec![ApkSetFileMetadata {
                    archive_path: "apk/base.apk".to_string(),
                    source_path: "/data/app/base.apk".to_string(),
                    kind: "base".to_string(),
                    split_name: None,
                    size_bytes: 3,
                    sha256: "INCORRECT".to_string(),
                }],
                analysis: None,
                warnings: Vec::new(),
            };
            let file = File::create(path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            writer.add_directory("apk/", options).unwrap();
            writer.start_file("apk/base.apk", options).unwrap();
            writer.write_all(b"apk").unwrap();
            for (name, data) in [
                ("metadata.json", serde_json::to_vec(&metadata).unwrap()),
                ("permissions.json", b"{}".to_vec()),
                ("signature.json", b"{}".to_vec()),
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(&data).unwrap();
            }
            writer.finish().unwrap();
        };
        let tampered = root.join("tampered.apkset");
        malformed_archive(&tampered, false);
        assert_eq!(
            validate_apk_set_file(&tampered).error_code.as_deref(),
            Some("hash_mismatch")
        );
        let app_data = root.join("app-data.apkset");
        malformed_archive(&app_data, true);
        assert_eq!(
            validate_apk_set_file(&app_data).error_code.as_deref(),
            Some("app_data_forbidden")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
