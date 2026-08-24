//! Safe local APK content extraction for the optional desktop toolkit.

use serde::Serialize;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkContentsExtractionResult {
    pub success: bool,
    pub output_path: Option<String>,
    pub extracted_files: usize,
    pub extracted_bytes: u64,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

fn failure(code: &str, message: impl Into<String>) -> ApkContentsExtractionResult {
    ApkContentsExtractionResult {
        success: false,
        output_path: None,
        extracted_files: 0,
        extracted_bytes: 0,
        error: Some(message.into()),
        error_code: Some(code.to_string()),
    }
}

fn validate_apk(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path.trim());
    if path.trim().is_empty() || !candidate.is_file() {
        return Err("APK file was not found".to_string());
    }
    if !candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("apk"))
    {
        return Err("Only .apk files can be extracted".to_string());
    }
    candidate
        .canonicalize()
        .map_err(|error| format!("Could not resolve APK path: {error}"))
}

fn unique_destination(root: &Path, stem: &str) -> io::Result<PathBuf> {
    std::fs::create_dir_all(root)?;
    let safe_stem: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    for suffix in 1..=10_000 {
        let name = if suffix == 1 {
            format!("{}-contents", safe_stem.trim_matches('.'))
        } else {
            format!("{}-contents-{suffix}", safe_stem.trim_matches('.'))
        };
        let destination = root.join(name);
        match std::fs::create_dir(&destination) {
            Ok(()) => return Ok(destination),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Could not allocate a unique extraction directory",
    ))
}

fn extract(path: &Path, output_root: &Path) -> Result<ApkContentsExtractionResult, String> {
    if !output_root.is_absolute() {
        return Err("Extraction destination must be an absolute path".to_string());
    }
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Invalid APK archive: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "APK contains more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }
    let total = (0..archive.len()).try_fold(0_u64, |total, index| {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        total
            .checked_add(entry.size())
            .filter(|size| *size <= MAX_UNCOMPRESSED_BYTES)
            .ok_or_else(|| "APK uncompressed size exceeds the extraction limit".to_string())
    })?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("apk");
    let destination = unique_destination(output_root, stem).map_err(|error| error.to_string())?;
    let extraction = (|| -> Result<usize, String> {
        let mut extracted_files = 0;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("Unsafe archive entry: {}", entry.name()))?
                .to_path_buf();
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(format!(
                    "Symbolic-link archive entry is not allowed: {}",
                    entry.name()
                ));
            }
            let output = destination.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
                continue;
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut target = File::create_new(&output).map_err(|error| error.to_string())?;
            io::copy(&mut entry, &mut target).map_err(|error| error.to_string())?;
            extracted_files += 1;
        }
        Ok(extracted_files)
    })();
    match extraction {
        Ok(extracted_files) => Ok(ApkContentsExtractionResult {
            success: true,
            output_path: Some(destination.to_string_lossy().to_string()),
            extracted_files,
            extracted_bytes: total,
            error: None,
            error_code: None,
        }),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&destination);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn extract_apk_contents(path: String, output_dir: String) -> ApkContentsExtractionResult {
    let path = match validate_apk(&path) {
        Ok(path) => path,
        Err(error) => return failure("invalid_apk", error),
    };
    let output = PathBuf::from(output_dir.trim());
    match tauri::async_runtime::spawn_blocking(move || extract(&path, &output)).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => failure("extract_failed", error),
        Err(error) => failure("worker_failed", error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_safely_and_uses_duplicate_safe_directories() {
        let root = std::env::temp_dir().join(format!("apk-archive-{}", std::process::id()));
        let apk = root.join("demo.apk");
        std::fs::create_dir_all(&root).unwrap();
        let file = File::create(&apk).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("res/icon.png", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"icon").unwrap();
        writer.finish().unwrap();
        let first = extract(&apk, &root).unwrap();
        let second = extract(&apk, &root).unwrap();
        assert_ne!(first.output_path, second.output_path);
        assert_eq!(first.extracted_files, 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_apk_inputs_and_relative_destinations() {
        assert!(validate_apk("missing.apk").is_err());
        assert!(extract(Path::new("missing.apk"), Path::new("relative")).is_err());
    }
}
