// Custom command plugin backend.
//
// Runs a user-defined ADB command built from a template. Safety model:
//   * The command is provided as a list of already-split tokens (never a
//     shell string) and passed to adb as an argument array.
//   * The first token (the adb subcommand) must be on a strict allowlist.
//   * `{serial}` and `{package}` placeholders are substituted with validated
//     values.
//   * Every token is scanned for shell metacharacters and rejected if any are
//     found, as defence-in-depth even though no shell is involved.

use crate::adb::{self};
use crate::commands::{create_command, get_binary_path};
use serde::Serialize;
use std::process::Stdio;
use tokio::time::{timeout, Duration};

const COMMAND_TIMEOUT_SECS: u64 = 60;

/// adb subcommands a custom command is allowed to start with.
const ALLOWED_ADB_SUBCOMMANDS: &[&str] = &[
    "shell",
    "install",
    "uninstall",
    "pull",
    "push",
    "logcat",
    "getprop",
    "bugreport",
    "screencap",
    "screenrecord",
    "forward",
    "reverse",
    "reboot",
    "wait-for-device",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCommandResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn err(code: &str, msg: &str) -> CustomCommandResult {
    CustomCommandResult {
        success: false,
        stdout: None,
        stderr: None,
        error: Some(msg.to_string()),
        error_code: Some(code.to_string()),
    }
}

/// Reject tokens that contain shell-sensitive characters. Placeholders are
/// substituted before this runs so only concrete values are checked.
fn token_is_safe(token: &str) -> bool {
    !token.chars().any(|c| {
        matches!(
            c,
            ';' | '|' | '&' | '`' | '$' | '>' | '<' | '\n' | '\r' | '\\' | '"' | '\''
        )
    })
}

/// Substitute `{serial}` / `{package}` placeholders in a single token.
fn substitute(token: &str, serial: &str, package: Option<&str>) -> String {
    let mut out = token.replace("{serial}", serial);
    if let Some(pkg) = package {
        out = out.replace("{package}", pkg);
    }
    out
}

/// Validate + resolve a custom command's tokens into a safe adb argument list.
/// Returns Err(result) on any validation failure.
fn resolve_tokens(
    tokens: &[String],
    serial: &str,
    package: Option<&str>,
) -> Result<Vec<String>, CustomCommandResult> {
    if tokens.is_empty() {
        return Err(err("empty", "No command provided"));
    }
    if tokens.len() > 40 {
        return Err(err("too_long", "Too many command tokens"));
    }

    // Drop a leading literal "adb" if the user included it.
    let start = if tokens[0].eq_ignore_ascii_case("adb") { 1 } else { 0 };
    let effective = &tokens[start..];
    if effective.is_empty() {
        return Err(err("empty", "No command provided"));
    }

    let subcommand = effective[0].to_lowercase();
    if !ALLOWED_ADB_SUBCOMMANDS.contains(&subcommand.as_str()) {
        return Err(err(
            "not_allowed",
            &format!("adb subcommand '{}' is not allowed", subcommand),
        ));
    }

    // Reject a template that references {package} without one being provided.
    let uses_package = effective.iter().any(|t| t.contains("{package}"));
    if uses_package {
        match package {
            Some(p) if !p.is_empty() => {
                if adb::validate_package_name(p).is_err() {
                    return Err(err("invalid_package", "Invalid package name"));
                }
            }
            _ => return Err(err("package_required", "This command requires a package")),
        }
    }

    let mut resolved: Vec<String> = Vec::with_capacity(effective.len());
    for token in effective {
        let sub = substitute(token, serial, package);
        if !token_is_safe(&sub) {
            return Err(err(
                "unsafe_token",
                "Command contains disallowed characters",
            ));
        }
        resolved.push(sub);
    }
    Ok(resolved)
}

/// Execute a validated custom command against the device.
#[tauri::command]
pub async fn run_custom_command(
    serial: String,
    tokens: Vec<String>,
    package: Option<String>,
    custom_path: Option<String>,
) -> CustomCommandResult {
    let serial = serial.trim().to_string();
    if adb::validate_serial(&serial).is_err() {
        return err("invalid_serial", "Invalid device serial");
    }

    let pkg = package.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    let resolved = match resolve_tokens(&tokens, &serial, pkg.as_deref()) {
        Ok(r) => r,
        Err(e) => return e,
    };

    // Always target the specific device.
    let adb_path = get_binary_path("adb", custom_path);
    let mut full_args: Vec<String> = vec!["-s".to_string(), serial.clone()];
    full_args.extend(resolved);

    let child = create_command(&adb_path)
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            let code = if e.kind() == std::io::ErrorKind::NotFound {
                "adb_not_found"
            } else {
                "spawn_failed"
            };
            return err(code, &e.to_string());
        }
    };

    match timeout(
        Duration::from_secs(COMMAND_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => CustomCommandResult {
            success: output.status.success(),
            stdout: Some(String::from_utf8_lossy(&output.stdout).to_string()),
            stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
            error: None,
            error_code: None,
        },
        Ok(Err(e)) => err("io_error", &e.to_string()),
        Err(_) => err("timeout", "Command timed out"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_serial_placeholder() {
        let tokens = vec!["shell".into(), "ping".into(), "{serial}".into()];
        let out = resolve_tokens(&tokens, "ABC123", None).unwrap();
        assert_eq!(out, vec!["shell", "ping", "ABC123"]);
    }

    #[test]
    fn strips_leading_adb() {
        let tokens = vec!["adb".into(), "getprop".into()];
        let out = resolve_tokens(&tokens, "ABC123", None).unwrap();
        assert_eq!(out, vec!["getprop"]);
    }

    #[test]
    fn rejects_disallowed_subcommand() {
        let tokens = vec!["kill-server".into()];
        assert!(resolve_tokens(&tokens, "ABC123", None).is_err());
    }

    #[test]
    fn rejects_unsafe_tokens() {
        let tokens = vec!["shell".into(), "rm;reboot".into()];
        assert!(resolve_tokens(&tokens, "ABC123", None).is_err());
    }

    #[test]
    fn package_placeholder_requires_package() {
        let tokens = vec!["shell".into(), "am".into(), "start".into(), "{package}".into()];
        assert!(resolve_tokens(&tokens, "ABC123", None).is_err());
        let ok = resolve_tokens(&tokens, "ABC123", Some("com.example.app"));
        assert!(ok.is_ok());
        assert!(ok.unwrap().contains(&"com.example.app".to_string()));
    }

    #[test]
    fn rejects_invalid_package() {
        let tokens = vec!["shell".into(), "{package}".into()];
        assert!(resolve_tokens(&tokens, "ABC123", Some("bad;pkg")).is_err());
    }

    #[test]
    fn empty_tokens_rejected() {
        assert!(resolve_tokens(&[], "ABC123", None).is_err());
    }
}
