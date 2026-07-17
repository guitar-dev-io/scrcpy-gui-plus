// App / package manager backend.
//
// Exposes a strict, allowlisted set of package management actions. The
// frontend can only ask for one of the named actions below; it can never pass
// an arbitrary shell command. Every ADB invocation is routed through the
// centralized `crate::adb` service (arguments passed as an array, never
// concatenated into a shell string) and both the device serial and the target
// package name are validated before use.

use crate::adb::{self, AdbError};
use serde::Serialize;

const ACTION_TIMEOUT_SECS: u64 = 20;
const LIST_TIMEOUT_SECS: u64 = 20;
const INFO_TIMEOUT_SECS: u64 = 15;
const UNINSTALL_TIMEOUT_SECS: u64 = 60;

/// Result of a single app action (launch, force-stop, clear data, ...).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppActionResult {
    pub success: bool,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// A single installed package entry.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageEntry {
    pub package_name: String,
    /// True when the package lives in a system partition (`pm list -s`).
    pub system: bool,
}

/// Result of listing packages.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageListResult {
    pub success: bool,
    pub packages: Vec<PackageEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Result of querying a single package's version metadata.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfoResult {
    pub success: bool,
    pub package_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn action_ok(action: &str, output: Option<String>) -> AppActionResult {
    AppActionResult {
        success: true,
        action: action.to_string(),
        output,
        error: None,
        error_code: None,
    }
}

fn action_err(action: &str, e: &AdbError) -> AppActionResult {
    AppActionResult {
        success: false,
        action: action.to_string(),
        output: None,
        error: Some(e.message()),
        error_code: Some(e.code().to_string()),
    }
}

fn action_err_msg(action: &str, code: &str, msg: String) -> AppActionResult {
    AppActionResult {
        success: false,
        action: action.to_string(),
        output: None,
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

/// The set of app actions the frontend may request.
pub fn is_allowed_app_action(action: &str) -> bool {
    matches!(
        action,
        "launch"
            | "force_stop"
            | "restart"
            | "clear_data"
            | "clear_cache"
            | "open_settings"
            | "uninstall"
    )
}

/// Build the fixed adb argument vector for a simple (single adb call) action.
/// Multi-step actions (`restart`) are handled separately. The package name is
/// always validated by the caller before this runs.
fn simple_action_args(action: &str, package: &str) -> Option<Vec<String>> {
    let args: Vec<String> = match action {
        // `monkey` launches the default LAUNCHER activity without needing to
        // resolve the exact component name.
        "launch" => vec![
            "shell".into(),
            "monkey".into(),
            "-p".into(),
            package.into(),
            "-c".into(),
            "android.intent.category.LAUNCHER".into(),
            "1".into(),
        ],
        "force_stop" => vec![
            "shell".into(),
            "am".into(),
            "force-stop".into(),
            package.into(),
        ],
        // Wipes all app data + cache (equivalent to "Clear storage").
        "clear_data" => vec!["shell".into(), "pm".into(), "clear".into(), package.into()],
        "open_settings" => vec![
            "shell".into(),
            "am".into(),
            "start".into(),
            "-a".into(),
            "android.settings.APPLICATION_DETAILS_SETTINGS".into(),
            "-d".into(),
            format!("package:{}", package),
        ],
        "uninstall" => vec!["uninstall".into(), package.into()],
        _ => return None,
    };
    Some(args)
}

async fn launch_app(serial: &str, package: &str, custom_path: Option<String>) -> AppActionResult {
    let args = simple_action_args("launch", package).unwrap();
    let borrowed: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match adb::run_adb_text(Some(serial), &borrowed, custom_path, ACTION_TIMEOUT_SECS).await {
        Ok(out) => {
            // `monkey` prints "No activities found to run" (still exit 0) when a
            // package has no launcher activity; surface that as a failure.
            if out.contains("No activities found") || out.contains("Error") {
                action_err_msg("launch", "no_launcher", out.trim().to_string())
            } else {
                action_ok("launch", Some(out.trim().to_string()))
            }
        }
        Err(e) => action_err("launch", &e),
    }
}

/// Clear cache. Android has no non-root per-package cache clear, so this trims
/// cached data device-wide on a best-effort basis. The frontend labels it as a
/// device-wide action to keep the behaviour honest.
async fn clear_cache(serial: &str, custom_path: Option<String>) -> AppActionResult {
    let args = ["shell", "pm", "trim-caches", "1000000000000"];
    match adb::run_adb_text(Some(serial), &args, custom_path, ACTION_TIMEOUT_SECS).await {
        Ok(out) => action_ok("clear_cache", Some(out.trim().to_string())),
        Err(e) => action_err("clear_cache", &e),
    }
}

/// Execute a single validated app action.
#[tauri::command]
pub async fn app_action(
    serial: String,
    package: String,
    action: String,
    custom_path: Option<String>,
) -> AppActionResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();

    if let Err(e) = adb::validate_serial(&serial) {
        return action_err(&action, &e);
    }

    if !is_allowed_app_action(&action) {
        return action_err_msg(
            &action,
            "invalid_action",
            format!("Unsupported action: {}", action),
        );
    }

    // `clear_cache` operates device-wide and needs no package.
    if action == "clear_cache" {
        return clear_cache(&serial, custom_path).await;
    }

    if let Err(e) = adb::validate_package_name(&package) {
        return action_err(&action, &e);
    }

    if action == "launch" {
        return launch_app(&serial, &package, custom_path).await;
    }

    if action == "restart" {
        // Force-stop, then relaunch.
        let stop_args = simple_action_args("force_stop", &package).unwrap();
        let stop_borrowed: Vec<&str> = stop_args.iter().map(|s| s.as_str()).collect();
        if let Err(e) = adb::run_adb_text(
            Some(&serial),
            &stop_borrowed,
            custom_path.clone(),
            ACTION_TIMEOUT_SECS,
        )
        .await
        {
            return action_err("restart", &e);
        }
        return match launch_app(&serial, &package, custom_path).await {
            r if r.success => action_ok("restart", r.output),
            r => AppActionResult {
                action: "restart".to_string(),
                ..r
            },
        };
    }

    let args = match simple_action_args(&action, &package) {
        Some(a) => a,
        None => {
            return action_err_msg(
                &action,
                "invalid_action",
                format!("Unsupported action: {}", action),
            )
        }
    };
    let borrowed: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let timeout = if action == "uninstall" {
        UNINSTALL_TIMEOUT_SECS
    } else {
        ACTION_TIMEOUT_SECS
    };

    match adb::run_adb_text(Some(&serial), &borrowed, custom_path, timeout).await {
        Ok(out) => {
            let trimmed = out.trim();
            // `pm uninstall` / `pm clear` print "Success" or "Failure [reason]".
            if trimmed.starts_with("Failure") || trimmed.contains("Failure [") {
                action_err_msg(&action, "failed", trimmed.to_string())
            } else {
                action_ok(&action, Some(trimmed.to_string()))
            }
        }
        Err(e) => action_err(&action, &e),
    }
}

/// Parse `pm list packages` output lines of the form `package:com.example`.
fn parse_package_lines(text: &str, system: bool) -> Vec<PackageEntry> {
    let mut out: Vec<PackageEntry> = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let name = line.strip_prefix("package:").unwrap_or(line).trim();
            if name.is_empty() {
                None
            } else {
                Some(PackageEntry {
                    package_name: name.to_string(),
                    system,
                })
            }
        })
        .collect();
    out.sort_by(|a, b| a.package_name.cmp(&b.package_name));
    out
}

/// List installed packages.
///
/// `filter` is one of: `all`, `third_party`, `system`, `enabled`, `disabled`.
/// For `all` we mark system packages by cross-referencing the `-s` list so the
/// UI can visually distinguish user vs system apps.
#[tauri::command]
pub async fn list_packages(
    serial: String,
    filter: Option<String>,
    custom_path: Option<String>,
) -> PackageListResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return PackageListResult {
            success: false,
            packages: Vec::new(),
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        };
    }

    let filter = filter.unwrap_or_else(|| "all".to_string());
    let extra_flag: Option<&str> = match filter.as_str() {
        "third_party" => Some("-3"),
        "system" => Some("-s"),
        "enabled" => Some("-e"),
        "disabled" => Some("-d"),
        _ => None,
    };

    let mut args: Vec<&str> = vec!["shell", "pm", "list", "packages"];
    if let Some(flag) = extra_flag {
        args.push(flag);
    }

    let text = match adb::run_adb_text(Some(&serial), &args, custom_path.clone(), LIST_TIMEOUT_SECS)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            return PackageListResult {
                success: false,
                packages: Vec::new(),
                error: Some(e.message()),
                error_code: Some(e.code().to_string()),
            }
        }
    };

    // The `-s` filter is inherently "system"; everything else defaults to
    // non-system. For the "all" view, fetch the system list once to tag them.
    let mut packages = parse_package_lines(&text, filter == "system");

    if filter == "all" {
        if let Ok(sys_text) = adb::run_adb_text(
            Some(&serial),
            &["shell", "pm", "list", "packages", "-s"],
            custom_path,
            LIST_TIMEOUT_SECS,
        )
        .await
        {
            let system_set: std::collections::HashSet<String> =
                parse_package_lines(&sys_text, true)
                    .into_iter()
                    .map(|p| p.package_name)
                    .collect();
            for pkg in packages.iter_mut() {
                pkg.system = system_set.contains(&pkg.package_name);
            }
        }
    }

    PackageListResult {
        success: true,
        packages,
        error: None,
        error_code: None,
    }
}

/// Extract `versionName` and `versionCode` from `dumpsys package` output.
fn parse_version_info(text: &str) -> (Option<String>, Option<String>) {
    let mut version_name = None;
    let mut version_code = None;
    for line in text.lines() {
        let line = line.trim();
        if version_name.is_none() {
            if let Some(rest) = line.strip_prefix("versionName=") {
                let val = rest.split_whitespace().next().unwrap_or("").to_string();
                if !val.is_empty() {
                    version_name = Some(val);
                }
            }
        }
        if version_code.is_none() {
            if let Some(idx) = line.find("versionCode=") {
                let rest = &line[idx + "versionCode=".len()..];
                let val = rest.split_whitespace().next().unwrap_or("").to_string();
                if !val.is_empty() {
                    version_code = Some(val);
                }
            }
        }
        if version_name.is_some() && version_code.is_some() {
            break;
        }
    }
    (version_name, version_code)
}

/// Query version metadata for a single package.
#[tauri::command]
pub async fn get_package_info(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> PackageInfoResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();

    if let Err(e) = adb::validate_serial(&serial) {
        return PackageInfoResult {
            success: false,
            package_name: package,
            version_name: None,
            version_code: None,
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        };
    }
    if let Err(e) = adb::validate_package_name(&package) {
        return PackageInfoResult {
            success: false,
            package_name: package,
            version_name: None,
            version_code: None,
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        };
    }

    let args = ["shell", "dumpsys", "package", package.as_str()];
    match adb::run_adb_text(Some(&serial), &args, custom_path, INFO_TIMEOUT_SECS).await {
        Ok(text) => {
            let (version_name, version_code) = parse_version_info(&text);
            PackageInfoResult {
                success: true,
                package_name: package,
                version_name,
                version_code,
                error: None,
                error_code: None,
            }
        }
        Err(e) => PackageInfoResult {
            success: false,
            package_name: package,
            version_name: None,
            version_code: None,
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_known_actions() {
        for a in [
            "launch",
            "force_stop",
            "restart",
            "clear_data",
            "clear_cache",
            "open_settings",
            "uninstall",
        ] {
            assert!(is_allowed_app_action(a), "expected {} allowed", a);
        }
    }

    #[test]
    fn allowlist_rejects_unknown_actions() {
        assert!(!is_allowed_app_action(""));
        assert!(!is_allowed_app_action("reboot"));
        assert!(!is_allowed_app_action("pm clear com.x; rm -rf /"));
        assert!(!is_allowed_app_action("LAUNCH"));
    }

    #[test]
    fn simple_action_args_never_contain_shell_metachars() {
        let pkg = "com.example.app";
        for a in [
            "launch",
            "force_stop",
            "clear_data",
            "open_settings",
            "uninstall",
        ] {
            let args = simple_action_args(a, pkg).unwrap();
            for arg in &args {
                assert!(!arg.contains(';'));
                assert!(!arg.contains('|'));
                assert!(!arg.contains('&'));
            }
        }
    }

    #[test]
    fn open_settings_builds_package_uri() {
        let args = simple_action_args("open_settings", "com.example.app").unwrap();
        assert!(args.contains(&"package:com.example.app".to_string()));
    }

    #[test]
    fn uninstall_uses_no_shell() {
        let args = simple_action_args("uninstall", "com.example.app").unwrap();
        assert_eq!(args[0], "uninstall");
        assert!(!args.contains(&"shell".to_string()));
    }

    #[test]
    fn parse_package_lines_strips_prefix_and_sorts() {
        let text = "package:com.zeta.app\npackage:com.alpha.app\n\npackage:com.beta.app\n";
        let parsed = parse_package_lines(text, false);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].package_name, "com.alpha.app");
        assert_eq!(parsed[1].package_name, "com.beta.app");
        assert_eq!(parsed[2].package_name, "com.zeta.app");
    }

    #[test]
    fn parse_version_info_extracts_name_and_code() {
        let text = "  Package [com.example.app]\n    versionCode=123 minSdk=21 targetSdk=33\n    versionName=1.2.3\n";
        let (name, code) = parse_version_info(text);
        assert_eq!(name, Some("1.2.3".to_string()));
        assert_eq!(code, Some("123".to_string()));
    }

    #[test]
    fn parse_version_info_handles_missing() {
        let text = "no relevant fields here";
        let (name, code) = parse_version_info(text);
        assert_eq!(name, None);
        assert_eq!(code, None);
    }
}
