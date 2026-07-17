// Device file manager backend.
//
// Browses the device filesystem over ADB and moves files in/out. Safety model
// for on-device shell commands: remote paths are validated to a conservative
// charset (no shell metacharacters, no quotes; spaces are allowed) and then
// wrapped in single quotes when composing the device shell command. Because
// the path can contain no single quote and no other shell-sensitive character,
// the single-quoted form is safe, and the whole command is still passed to adb
// as a single argument (no host shell is ever involved).

use crate::adb;
use serde::Serialize;

const LIST_TIMEOUT_SECS: u64 = 20;
const ACTION_TIMEOUT_SECS: u64 = 30;
const TRANSFER_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_link: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub success: bool,
    pub path: String,
    pub entries: Vec<FileEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Validate a remote (device) path. Allows POSIX path chars + spaces, rejects
/// anything that could break out of the single-quoted device shell command.
fn validate_remote_path(path: &str) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("empty path".to_string());
    }
    if !p.starts_with('/') {
        return Err("path must be absolute".to_string());
    }
    if p.len() > 1024 {
        return Err("path too long".to_string());
    }
    let bad = [
        '\'', '"', '`', '$', ';', '|', '&', '<', '>', '\n', '\r', '\\', '*', '?',
    ];
    if p.chars().any(|c| bad.contains(&c) || c.is_control()) {
        return Err("path contains disallowed characters".to_string());
    }
    Ok(())
}

/// Wrap a validated path in single quotes for the device shell. Safe because
/// the path is guaranteed to contain no single quote.
fn quote(path: &str) -> String {
    format!("'{}'", path.trim())
}

fn list_err(path: &str, code: &str, msg: String) -> ListResult {
    ListResult {
        success: false,
        path: path.to_string(),
        entries: Vec::new(),
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

fn fs_err(code: &str, msg: String) -> FsResult {
    FsResult {
        success: false,
        path: None,
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

/// Parse a `ls -la` listing into structured entries. Tolerant of the toybox /
/// toolbox long format:
///   drwxrwx--x 4 root sdcard_rw 4096 2024-06-01 10:00 Android
fn parse_ls(output: &str) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() || line.starts_with("total ") {
            continue;
        }
        let perms = match line.split_whitespace().next() {
            Some(p) => p,
            None => continue,
        };
        // A long-format line begins with a 10-char permission field.
        let first = perms.chars().next().unwrap_or(' ');
        if perms.len() < 10 || !matches!(first, 'd' | '-' | 'l' | 'c' | 'b' | 'p' | 's') {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 8 {
            continue;
        }
        let is_dir = first == 'd';
        let is_link = first == 'l';
        let size = cols[4].parse::<u64>().ok();
        let modified = Some(format!("{} {}", cols[5], cols[6]));
        // Name is everything after the time column; strip symlink target.
        let mut name = cols[7..].join(" ");
        if is_link {
            if let Some(idx) = name.find(" -> ") {
                name = name[..idx].to_string();
            }
        }
        if name == "." || name == ".." || name.is_empty() {
            continue;
        }
        entries.push(FileEntry {
            name,
            is_dir,
            is_link,
            size,
            modified,
        });
    }
    // Directories first, then alphabetical.
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

/// List a directory on the device.
#[tauri::command]
pub async fn fm_list_dir(serial: String, path: String, custom_path: Option<String>) -> ListResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return list_err(&path, e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&path) {
        return list_err(&path, "invalid_path", m);
    }

    // Append a trailing slash so `ls` lists the *contents* of the directory
    // even when the path is a symlink (e.g. `/sdcard -> /storage/self/primary`).
    // Without it, `ls -la /sdcard` prints only the single symlink line and the
    // browser looks empty.
    let listing_path = format!("{}/", path.trim().trim_end_matches('/'));
    let cmd = format!("ls -la {}", quote(&listing_path));
    match adb::run_adb_text(
        Some(&serial),
        &["shell", &cmd],
        custom_path,
        LIST_TIMEOUT_SECS,
    )
    .await
    {
        Ok(out) => {
            // adb shell returns permission/errno text on stdout for failures.
            let lower = out.to_lowercase();
            if lower.contains("permission denied") {
                return list_err(&path, "permission_denied", "Permission denied".to_string());
            }
            if lower.contains("no such file") || lower.contains("not a directory") {
                return list_err(&path, "not_found", "Path not found".to_string());
            }
            ListResult {
                success: true,
                path: path.trim_end_matches('/').to_string(),
                entries: parse_ls(&out),
                error: None,
                error_code: None,
            }
        }
        Err(e) => list_err(&path, e.code(), e.message()),
    }
}

/// Pull a remote file/dir to a local directory. Returns the local path.
#[tauri::command]
pub async fn fm_pull(
    serial: String,
    remote_path: String,
    local_dir: String,
    custom_path: Option<String>,
) -> FsResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return fs_err(e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&remote_path) {
        return fs_err("invalid_path", m);
    }

    let filename = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("file")
        .to_string();
    let local_path = std::path::Path::new(&local_dir).join(&filename);
    let local_str = local_path.to_string_lossy().to_string();

    match adb::run_adb_text(
        Some(&serial),
        &["pull", remote_path.trim(), &local_str],
        custom_path,
        TRANSFER_TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => FsResult {
            success: true,
            path: Some(local_str),
            error: None,
            error_code: None,
        },
        Err(e) => fs_err(e.code(), e.message()),
    }
}

/// Push a local file to a remote directory on the device.
#[tauri::command]
pub async fn fm_push(
    serial: String,
    local_path: String,
    remote_dir: String,
    custom_path: Option<String>,
) -> FsResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return fs_err(e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&remote_dir) {
        return fs_err("invalid_path", m);
    }

    match adb::run_adb_text(
        Some(&serial),
        &["push", local_path.trim(), remote_dir.trim()],
        custom_path,
        TRANSFER_TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => FsResult {
            success: true,
            path: Some(remote_dir.trim().to_string()),
            error: None,
            error_code: None,
        },
        Err(e) => fs_err(e.code(), e.message()),
    }
}

/// Delete a file or directory on the device (recursive).
#[tauri::command]
pub async fn fm_delete(serial: String, path: String, custom_path: Option<String>) -> FsResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return fs_err(e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&path) {
        return fs_err("invalid_path", m);
    }
    // Guard against catastrophic targets.
    let normalized = path.trim().trim_end_matches('/');
    if normalized.is_empty() || normalized == "/" || normalized == "/sdcard" && path.trim() == "/" {
        return fs_err("refused", "Refusing to delete a root path".to_string());
    }

    let cmd = format!("rm -rf {}", quote(&path));
    match adb::run_adb_text(
        Some(&serial),
        &["shell", &cmd],
        custom_path,
        ACTION_TIMEOUT_SECS,
    )
    .await
    {
        Ok(out) => {
            if out.to_lowercase().contains("permission denied") {
                return fs_err("permission_denied", "Permission denied".to_string());
            }
            FsResult {
                success: true,
                path: Some(path.trim().to_string()),
                error: None,
                error_code: None,
            }
        }
        Err(e) => fs_err(e.code(), e.message()),
    }
}

/// Create a directory on the device (mkdir -p).
#[tauri::command]
pub async fn fm_mkdir(serial: String, path: String, custom_path: Option<String>) -> FsResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return fs_err(e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&path) {
        return fs_err("invalid_path", m);
    }

    let cmd = format!("mkdir -p {}", quote(&path));
    match adb::run_adb_text(
        Some(&serial),
        &["shell", &cmd],
        custom_path,
        ACTION_TIMEOUT_SECS,
    )
    .await
    {
        Ok(out) => {
            if out.to_lowercase().contains("permission denied") {
                return fs_err("permission_denied", "Permission denied".to_string());
            }
            FsResult {
                success: true,
                path: Some(path.trim().to_string()),
                error: None,
                error_code: None,
            }
        }
        Err(e) => fs_err(e.code(), e.message()),
    }
}

/// Pull a remote file into the app cache dir and return the local path, for
/// previewing images without cluttering the user's chosen download folder.
#[tauri::command]
pub async fn fm_preview_file(
    app_handle: tauri::AppHandle,
    serial: String,
    remote_path: String,
    custom_path: Option<String>,
) -> FsResult {
    use tauri::Manager;

    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return fs_err(e.code(), e.message());
    }
    if let Err(m) = validate_remote_path(&remote_path) {
        return fs_err("invalid_path", m);
    }

    let cache_dir = match app_handle.path().app_cache_dir() {
        Ok(d) => d.join("fm-preview"),
        Err(e) => return fs_err("no_cache_dir", e.to_string()),
    };
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        return fs_err("cache_failed", e.to_string());
    }

    let filename = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("preview")
        .to_string();
    let local_path = cache_dir.join(&filename);
    let local_str = local_path.to_string_lossy().to_string();

    match adb::run_adb_text(
        Some(&serial),
        &["pull", remote_path.trim(), &local_str],
        custom_path,
        TRANSFER_TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => FsResult {
            success: true,
            path: Some(local_str),
            error: None,
            error_code: None,
        },
        Err(e) => fs_err(e.code(), e.message()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_remote_path_accepts_normal() {
        assert!(validate_remote_path("/sdcard/Download").is_ok());
        assert!(validate_remote_path("/sdcard/My Folder/pic.png").is_ok());
    }

    #[test]
    fn validate_remote_path_rejects_dangerous() {
        assert!(validate_remote_path("").is_err());
        assert!(validate_remote_path("relative/path").is_err());
        assert!(validate_remote_path("/sdcard/a; rm -rf /").is_err());
        assert!(validate_remote_path("/sdcard/$(reboot)").is_err());
        assert!(validate_remote_path("/sdcard/a'b").is_err());
        assert!(validate_remote_path("/sdcard/*").is_err());
    }

    #[test]
    fn quote_wraps_in_single_quotes() {
        assert_eq!(quote("/sdcard/My Folder"), "'/sdcard/My Folder'");
    }

    #[test]
    fn parse_ls_parses_entries() {
        let out = "total 12\n\
drwxrwx--x 4 root sdcard_rw 4096 2024-06-01 10:00 Android\n\
-rw-rw---- 1 u0_a1 u0_a1 1234 2024-06-02 11:30 note.txt\n\
lrwxrwxrwx 1 root root 21 2024-01-01 00:00 sdcard -> /storage/emulated/0\n";
        let entries = parse_ls(out);
        assert_eq!(entries.len(), 3);
        // Dir sorts first.
        assert_eq!(entries[0].name, "Android");
        assert!(entries[0].is_dir);
        let note = entries.iter().find(|e| e.name == "note.txt").unwrap();
        assert!(!note.is_dir);
        assert_eq!(note.size, Some(1234));
        let link = entries.iter().find(|e| e.name == "sdcard").unwrap();
        assert!(link.is_link);
    }

    #[test]
    fn parse_ls_handles_spaces_in_name() {
        let out = "-rw-rw---- 1 u0_a1 u0_a1 10 2024-06-02 11:30 my photo.jpg\n";
        let entries = parse_ls(out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "my photo.jpg");
    }

    #[test]
    fn parse_ls_skips_dotdirs() {
        let out = "drwx------ 2 root root 4096 2024-06-01 10:00 .\n\
drwx------ 2 root root 4096 2024-06-01 10:00 ..\n";
        assert_eq!(parse_ls(out).len(), 0);
    }
}
