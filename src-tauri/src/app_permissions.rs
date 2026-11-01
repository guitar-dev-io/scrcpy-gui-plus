// App permission manager backend.
//
// Reads an app's permissions from `dumpsys package <pkg>` and grants or
// revokes runtime permissions with `pm grant` / `pm revoke`, so testers can
// flip a permission or put an app back to "never asked" without the Settings
// app. Serial, package and permission names are validated; every adb call is
// a fixed argument vector.

use crate::adb::{self, AdbError};
use crate::device_conditions::shell_output_error;
use serde::Serialize;

const PERMISSION_TIMEOUT_SECS: u64 = 20;

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionKind {
    /// Dangerous permission the user (or `pm grant`) controls.
    Runtime,
    /// Granted at install time; cannot be changed.
    Install,
    /// Requested in the manifest but not reported as install or runtime
    /// (normal permission on some builds, or not applicable to this SDK).
    Requested,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPermission {
    pub name: String,
    pub kind: PermissionKind,
    pub granted: Option<bool>,
    pub flags: Vec<String>,
    /// Fixed by the system or a device policy: `pm` cannot change it.
    pub fixed: bool,
}

/// `android.permission.CAMERA`-style names only.
pub fn validate_permission_name(name: &str) -> Result<(), String> {
    let segments: Vec<&str> = name.split('.').collect();
    let valid = !name.is_empty()
        && name.len() <= 255
        && segments.len() >= 2
        && segments.iter().all(|seg| {
            let mut chars = seg.chars();
            matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid permission name: {name:?}"))
    }
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// "android.permission.CAMERA: granted=false, flags=[ USER_SET|USER_FIXED ]"
fn parse_permission_line(line: &str) -> Option<(String, Option<bool>, Vec<String>)> {
    let line = line.trim();
    let (name, rest) = match line.split_once(':') {
        Some((name, rest)) => (name.trim(), rest),
        None => (line.split(',').next().unwrap_or(line).trim(), ""),
    };
    validate_permission_name(name).ok()?;
    let granted = if rest.contains("granted=true") {
        Some(true)
    } else if rest.contains("granted=false") {
        Some(false)
    } else {
        None
    };
    let flags = rest
        .split_once("flags=[")
        .and_then(|(_, tail)| tail.split_once(']'))
        .map(|(inner, _)| {
            inner
                .split('|')
                .map(str::trim)
                .filter(|flag| !flag.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Some((name.to_string(), granted, flags))
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Requested,
    Install,
    Runtime,
}

/// Parse the permission sections of `dumpsys package <pkg>` for user 0.
/// Runtime permissions first, then install, then requested-only; each group
/// sorted by name.
pub fn parse_package_permissions(dump: &str) -> Vec<AppPermission> {
    let mut requested: Vec<String> = Vec::new();
    let mut install: Vec<(String, Option<bool>, Vec<String>)> = Vec::new();
    let mut runtime: Vec<(String, Option<bool>, Vec<String>)> = Vec::new();
    let mut section: Option<(Section, usize)> = None;
    let mut seen_package = false;
    let mut seen_runtime = false;

    for line in dump.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Updated system apps repeat their package block under this header.
        if trimmed.starts_with("Hidden system packages:") {
            break;
        }
        if trimmed.starts_with("Package [") {
            if seen_package {
                break;
            }
            seen_package = true;
        }

        let indent = indent_of(line);
        if let Some((_, header_indent)) = section {
            if indent <= header_indent {
                section = None;
            }
        }

        match trimmed {
            "requested permissions:" => {
                section = Some((Section::Requested, indent));
                continue;
            }
            "install permissions:" => {
                section = Some((Section::Install, indent));
                continue;
            }
            "runtime permissions:" => {
                // Only the first user (user 0).
                section = if seen_runtime {
                    None
                } else {
                    Some((Section::Runtime, indent))
                };
                seen_runtime = true;
                continue;
            }
            _ => {}
        }

        let Some((current, _)) = section else {
            continue;
        };
        let Some(entry) = parse_permission_line(trimmed) else {
            continue;
        };
        match current {
            Section::Requested => requested.push(entry.0),
            Section::Install => install.push(entry),
            Section::Runtime => runtime.push(entry),
        }
    }

    let mut permissions: Vec<AppPermission> = Vec::new();
    let mut known = std::collections::HashSet::new();
    let mut add = |kind, (name, granted, flags): (String, Option<bool>, Vec<String>)| {
        if !known.insert(name.clone()) {
            return;
        }
        let fixed = flags
            .iter()
            .any(|flag| flag == "SYSTEM_FIXED" || flag == "POLICY_FIXED");
        permissions.push(AppPermission {
            name,
            kind,
            granted,
            flags,
            fixed,
        });
    };
    runtime.sort_by(|a, b| a.0.cmp(&b.0));
    install.sort_by(|a, b| a.0.cmp(&b.0));
    requested.sort();
    for entry in runtime {
        add(PermissionKind::Runtime, entry);
    }
    for entry in install {
        add(PermissionKind::Install, entry);
    }
    for name in requested {
        add(PermissionKind::Requested, (name, None, Vec::new()));
    }
    permissions
}

/// `pm grant|revoke <pkg> <permission>`
pub fn grant_args<'a>(package: &'a str, permission: &'a str, granted: bool) -> Vec<&'a str> {
    vec![
        "shell",
        "pm",
        if granted { "grant" } else { "revoke" },
        package,
        permission,
    ]
}

/// Clears "user set" / "don't ask again" so the app may prompt again.
pub fn clear_user_flags_args<'a>(package: &'a str, permission: &'a str) -> Vec<&'a str> {
    vec![
        "shell",
        "pm",
        "clear-permission-flags",
        package,
        permission,
        "user-set",
        "user-fixed",
    ]
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPermissionsResult {
    pub success: bool,
    pub package: String,
    pub permissions: Vec<AppPermission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionChangeResult {
    pub success: bool,
    /// Permissions actually changed.
    pub changed: Vec<String>,
    /// "permission: error" for each one that failed.
    pub failures: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn change_error(code: &str, message: String) -> PermissionChangeResult {
    PermissionChangeResult {
        success: false,
        changed: vec![],
        failures: vec![],
        error: Some(message),
        error_code: Some(code.to_string()),
    }
}

fn validate_target(serial: &str, package: &str) -> Result<(), AdbError> {
    adb::validate_serial(serial)?;
    adb::validate_package_name(package)
}

async fn run_checked(
    serial: &str,
    args: &[&str],
    custom_path: &Option<String>,
) -> Result<String, String> {
    match adb::run_adb_text(
        Some(serial),
        args,
        custom_path.clone(),
        PERMISSION_TIMEOUT_SECS,
    )
    .await
    {
        Ok(output) => match shell_output_error(&output) {
            Some(message) => Err(message),
            None => Ok(output),
        },
        Err(e) => Err(e.message()),
    }
}

async fn read_permissions(
    serial: &str,
    package: &str,
    custom_path: &Option<String>,
) -> Result<Vec<AppPermission>, String> {
    let dump = run_checked(
        serial,
        &["shell", "dumpsys", "package", package],
        custom_path,
    )
    .await?;
    if !dump.contains("Package [") {
        return Err(format!("{package} is not installed"));
    }
    Ok(parse_package_permissions(&dump))
}

/// List an app's permissions with their current state.
#[tauri::command]
pub async fn get_app_permissions(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> AppPermissionsResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    let fail = |code: &str, message: String| AppPermissionsResult {
        success: false,
        package: package.clone(),
        permissions: vec![],
        error: Some(message),
        error_code: Some(code.to_string()),
    };
    if let Err(e) = validate_target(&serial, &package) {
        return fail(e.code(), e.message());
    }
    match read_permissions(&serial, &package, &custom_path).await {
        Ok(permissions) => AppPermissionsResult {
            success: true,
            package,
            permissions,
            error: None,
            error_code: None,
        },
        Err(message) => fail("command_failed", message),
    }
}

/// Grant or revoke one runtime permission.
#[tauri::command]
pub async fn set_app_permission(
    serial: String,
    package: String,
    permission: String,
    granted: bool,
    custom_path: Option<String>,
) -> PermissionChangeResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    let permission = permission.trim().to_string();
    if let Err(e) = validate_target(&serial, &package) {
        return change_error(e.code(), e.message());
    }
    if let Err(message) = validate_permission_name(&permission) {
        return change_error("invalid_permission", message);
    }
    match run_checked(
        &serial,
        &grant_args(&package, &permission, granted),
        &custom_path,
    )
    .await
    {
        Ok(_) => PermissionChangeResult {
            success: true,
            changed: vec![permission],
            failures: vec![],
            error: None,
            error_code: None,
        },
        Err(message) => change_error("command_failed", message),
    }
}

/// Put every changeable runtime permission back to "not granted, never
/// asked": revoke the granted ones and clear the user-set / don't-ask-again
/// flags (best effort; older Android has no `clear-permission-flags`).
#[tauri::command]
pub async fn reset_app_permissions(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> PermissionChangeResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    if let Err(e) = validate_target(&serial, &package) {
        return change_error(e.code(), e.message());
    }
    let permissions = match read_permissions(&serial, &package, &custom_path).await {
        Ok(permissions) => permissions,
        Err(message) => return change_error("command_failed", message),
    };

    let mut changed = Vec::new();
    let mut failures = Vec::new();
    for permission in permissions
        .iter()
        .filter(|p| p.kind == PermissionKind::Runtime && !p.fixed)
    {
        let mut touched = false;
        if permission.granted == Some(true) {
            match run_checked(
                &serial,
                &grant_args(&package, &permission.name, false),
                &custom_path,
            )
            .await
            {
                Ok(_) => touched = true,
                Err(message) => {
                    failures.push(format!("{}: {message}", permission.name));
                    continue;
                }
            }
        }
        let has_user_flags = permission
            .flags
            .iter()
            .any(|flag| flag == "USER_SET" || flag == "USER_FIXED");
        if has_user_flags
            && run_checked(
                &serial,
                &clear_user_flags_args(&package, &permission.name),
                &custom_path,
            )
            .await
            .is_ok()
        {
            touched = true;
        }
        if touched {
            changed.push(permission.name.clone());
        }
    }

    PermissionChangeResult {
        success: failures.is_empty(),
        changed,
        error: (!failures.is_empty()).then(|| failures.join("; ")),
        error_code: (!failures.is_empty()).then(|| "partial_failure".to_string()),
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = "\
Activity Resolver Table:
  Non-Data Actions:
      android.intent.action.MAIN:
        1a2b3c com.example.shop/.MainActivity filter 4d5e
Packages:
  Package [com.example.shop] (a1b2c3):
    userId=10234
    pkg=Package{a1b2c3 com.example.shop}
    declared permissions:
      com.example.shop.permission.C2D_MESSAGE: prot=signature, INSTALLED
    requested permissions:
      android.permission.INTERNET
      android.permission.CAMERA
      android.permission.ACCESS_FINE_LOCATION
      android.permission.POST_NOTIFICATIONS
      android.permission.READ_SMS: restricted=true
      com.google.android.c2dm.permission.RECEIVE
    install permissions:
      android.permission.INTERNET: granted=true
      com.google.android.c2dm.permission.RECEIVE: granted=true
    User 0: ceDataInode=12345 installed=true hidden=false suspended=false
      gids=[3003]
      runtime permissions:
        android.permission.ACCESS_FINE_LOCATION: granted=false, flags=[ USER_SET|USER_FIXED|USER_SENSITIVE_WHEN_GRANTED]
        android.permission.CAMERA: granted=true, flags=[ USER_SET|USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]
        android.permission.POST_NOTIFICATIONS: granted=true, flags=[ SYSTEM_FIXED|GRANTED_BY_DEFAULT]
    User 10: ceDataInode=0 installed=true
      runtime permissions:
        android.permission.CAMERA: granted=false
Hidden system packages:
  Package [com.example.shop] (ffff):
    install permissions:
      android.permission.BLUETOOTH: granted=true
";

    #[test]
    fn parses_permission_sections_for_user_zero() {
        let permissions = parse_package_permissions(DUMP);
        let names: Vec<(&str, PermissionKind)> = permissions
            .iter()
            .map(|p| (p.name.as_str(), p.kind))
            .collect();
        assert_eq!(
            names,
            vec![
                (
                    "android.permission.ACCESS_FINE_LOCATION",
                    PermissionKind::Runtime
                ),
                ("android.permission.CAMERA", PermissionKind::Runtime),
                (
                    "android.permission.POST_NOTIFICATIONS",
                    PermissionKind::Runtime
                ),
                ("android.permission.INTERNET", PermissionKind::Install),
                (
                    "com.google.android.c2dm.permission.RECEIVE",
                    PermissionKind::Install
                ),
                ("android.permission.READ_SMS", PermissionKind::Requested),
            ]
        );

        let camera = &permissions[1];
        assert_eq!(camera.granted, Some(true), "user 0, not user 10");
        assert!(camera.flags.contains(&"USER_SET".to_string()));
        assert!(!camera.fixed);

        let location = &permissions[0];
        assert_eq!(location.granted, Some(false));
        assert!(location.flags.contains(&"USER_FIXED".to_string()));

        assert!(permissions[2].fixed, "SYSTEM_FIXED");
        assert_eq!(permissions[3].granted, Some(true));
        assert_eq!(permissions[5].granted, None);
        assert!(!permissions
            .iter()
            .any(|p| p.name == "android.permission.BLUETOOTH"));
        assert!(!permissions.iter().any(|p| p.name.contains("C2D_MESSAGE")));
    }

    #[test]
    fn handles_empty_and_permissionless_dumps() {
        assert!(parse_package_permissions("").is_empty());
        assert!(
            parse_package_permissions("Packages:\n  Package [com.x.y] (1):\n    userId=1\n")
                .is_empty()
        );
    }

    #[test]
    fn validates_permission_names() {
        assert!(validate_permission_name("android.permission.CAMERA").is_ok());
        assert!(validate_permission_name("com.google.android.c2dm.permission.RECEIVE").is_ok());
        for bad in [
            "",
            "CAMERA",
            "android.permission.CAMERA; reboot",
            "android..CAMERA",
            "android.permission.CAMERA ",
            "a.b$c",
        ] {
            assert!(validate_permission_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn builds_fixed_pm_arguments() {
        assert_eq!(
            grant_args("com.example.shop", "android.permission.CAMERA", true),
            vec![
                "shell",
                "pm",
                "grant",
                "com.example.shop",
                "android.permission.CAMERA"
            ]
        );
        assert_eq!(
            grant_args("com.example.shop", "android.permission.CAMERA", false)[2],
            "revoke"
        );
        assert_eq!(
            clear_user_flags_args("com.example.shop", "android.permission.CAMERA")[2..],
            [
                "clear-permission-flags",
                "com.example.shop",
                "android.permission.CAMERA",
                "user-set",
                "user-fixed"
            ]
        );
    }
}
