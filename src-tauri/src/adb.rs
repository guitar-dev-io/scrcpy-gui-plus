// Centralized ADB execution service.
//
// All new features (screenshot capture, device control, bug reports) route
// their ADB usage through this module so that process spawning, timeouts,
// argument passing and error classification stay consistent and injection
// safe. Arguments are always passed as an array (never concatenated into a
// shell string) and the device serial / package name are validated before
// use.

use crate::commands::{create_command, get_binary_path};
use std::process::Stdio;
use tokio::time::{timeout, Duration};

/// Structured, user-facing ADB error categories.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdbError {
    /// The adb executable could not be located / spawned.
    NotFound,
    /// Device reported as offline.
    Offline,
    /// Device is not authorized for debugging.
    Unauthorized,
    /// Device disappeared / not connected.
    Disconnected,
    /// Permission denied (writing files, shell restrictions).
    PermissionDenied,
    /// The shell was denied input-event injection (screen off/locked, or an
    /// Android build that blocks `input` injection).
    InjectDenied,
    /// The command exceeded its timeout budget.
    Timeout,
    /// Invalid / unsafe device serial.
    InvalidSerial,
    /// Invalid / unsafe package name.
    InvalidPackage,
    /// Any other failure, carrying the raw message.
    Failed(String),
}

impl AdbError {
    /// Short stable code for the frontend to branch on if needed.
    pub fn code(&self) -> &'static str {
        match self {
            AdbError::NotFound => "adb_not_found",
            AdbError::Offline => "device_offline",
            AdbError::Unauthorized => "device_unauthorized",
            AdbError::Disconnected => "device_disconnected",
            AdbError::PermissionDenied => "permission_denied",
            AdbError::InjectDenied => "inject_denied",
            AdbError::Timeout => "timeout",
            AdbError::InvalidSerial => "invalid_serial",
            AdbError::InvalidPackage => "invalid_package",
            AdbError::Failed(_) => "failed",
        }
    }

    /// Human readable message.
    pub fn message(&self) -> String {
        match self {
            AdbError::NotFound => "ADB executable not found".to_string(),
            AdbError::Offline => "Device is offline".to_string(),
            AdbError::Unauthorized => {
                "Device is unauthorized (accept the USB debugging prompt)".to_string()
            }
            AdbError::Disconnected => "Device disconnected or not found".to_string(),
            AdbError::PermissionDenied => "Permission denied".to_string(),
            AdbError::InjectDenied => {
                "Cannot inject input: wake and unlock the device screen, then try again".to_string()
            }
            AdbError::Timeout => "ADB command timed out".to_string(),
            AdbError::InvalidSerial => "Invalid device serial".to_string(),
            AdbError::InvalidPackage => "Invalid package name".to_string(),
            AdbError::Failed(msg) => msg.clone(),
        }
    }
}

impl std::fmt::Display for AdbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

impl std::error::Error for AdbError {}

/// Validate a device serial before it is ever passed to adb.
///
/// Accepts USB serials (alphanumeric) and network serials in the
/// `host:port` / `ip:port` form. Rejects anything containing whitespace or
/// shell metacharacters to stay defensive even though arguments are passed
/// as an array.
pub fn validate_serial(serial: &str) -> Result<(), AdbError> {
    if serial.is_empty() || serial.len() > 128 {
        return Err(AdbError::InvalidSerial);
    }
    let valid = serial
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(AdbError::InvalidSerial)
    }
}

/// Validate an Android package name (e.g. `com.example.app`).
pub fn validate_package_name(pkg: &str) -> Result<(), AdbError> {
    if pkg.is_empty() || pkg.len() > 255 {
        return Err(AdbError::InvalidPackage);
    }
    // Must contain at least one dot and be composed of dot separated segments
    // that start with a letter or underscore and contain only word chars.
    let segments: Vec<&str> = pkg.split('.').collect();
    if segments.len() < 2 {
        return Err(AdbError::InvalidPackage);
    }
    let ok = segments.iter().all(|seg| {
        !seg.is_empty()
            && seg
                .chars()
                .next()
                .map(|c| c.is_ascii_alphabetic() || c == '_')
                .unwrap_or(false)
            && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    });
    if ok {
        Ok(())
    } else {
        Err(AdbError::InvalidPackage)
    }
}

/// Classify an adb stderr blob into a structured error.
pub fn classify_adb_error(stderr: &str) -> AdbError {
    let lower = stderr.to_lowercase();
    if lower.contains("inject_events")
        || lower.contains("injecting input events")
        || (lower.contains("securityexception") && lower.contains("input"))
    {
        AdbError::InjectDenied
    } else if lower.contains("unauthorized") {
        AdbError::Unauthorized
    } else if lower.contains("offline") {
        AdbError::Offline
    } else if lower.contains("device not found")
        || lower.contains("not found")
        || lower.contains("no devices")
        || lower.contains("no such device")
        || lower.contains("device '") && lower.contains("' not found")
    {
        AdbError::Disconnected
    } else if lower.contains("permission denied") || lower.contains("operation not permitted") {
        AdbError::PermissionDenied
    } else {
        AdbError::Failed(stderr.trim().to_string())
    }
}

/// Result of an ADB invocation with raw stdout bytes preserved (needed for
/// binary output such as PNG screencaps).
pub struct AdbOutput {
    pub stdout: Vec<u8>,
}

fn build_args(serial: Option<&str>, args: &[&str]) -> Result<Vec<String>, AdbError> {
    let mut full: Vec<String> = Vec::new();
    if let Some(s) = serial {
        validate_serial(s)?;
        full.push("-s".to_string());
        full.push(s.to_string());
    }
    for a in args {
        full.push((*a).to_string());
    }
    Ok(full)
}

/// Run an adb command, returning raw stdout bytes. Applies a timeout and
/// classifies failures. `serial` is validated when present.
pub async fn run_adb_bytes(
    serial: Option<&str>,
    args: &[&str],
    custom_path: Option<String>,
    timeout_secs: u64,
) -> Result<AdbOutput, AdbError> {
    let full_args = build_args(serial, args)?;
    let adb_path = get_binary_path("adb", custom_path);

    let child = create_command(&adb_path)
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err(AdbError::NotFound);
            }
            return Err(AdbError::Failed(e.to_string()));
        }
    };

    let output = match timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(AdbError::Failed(e.to_string())),
        Err(_) => return Err(AdbError::Timeout),
    };

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(classify_adb_error(&stderr));
    }

    // adb sometimes exits 0 but prints an error to stderr (e.g. transient).
    if output.stdout.is_empty() && !stderr.trim().is_empty() {
        let classified = classify_adb_error(&stderr);
        if !matches!(classified, AdbError::Failed(_)) {
            return Err(classified);
        }
    }

    Ok(AdbOutput {
        stdout: output.stdout,
    })
}

/// Run an adb command returning trimmed UTF-8 stdout text.
pub async fn run_adb_text(
    serial: Option<&str>,
    args: &[&str],
    custom_path: Option<String>,
    timeout_secs: u64,
) -> Result<String, AdbError> {
    let out = run_adb_bytes(serial, args, custom_path, timeout_secs).await?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_serial_accepts_usb_and_network() {
        assert!(validate_serial("emulator-5554").is_ok());
        assert!(validate_serial("ABCDEF123456").is_ok());
        assert!(validate_serial("192.168.1.10:5555").is_ok());
    }

    #[test]
    fn validate_serial_rejects_injection() {
        assert_eq!(validate_serial(""), Err(AdbError::InvalidSerial));
        assert_eq!(
            validate_serial("dev; rm -rf /"),
            Err(AdbError::InvalidSerial)
        );
        assert_eq!(validate_serial("dev ice"), Err(AdbError::InvalidSerial));
        assert_eq!(validate_serial("$(whoami)"), Err(AdbError::InvalidSerial));
    }

    #[test]
    fn validate_package_accepts_valid() {
        assert!(validate_package_name("com.example.app").is_ok());
        assert!(validate_package_name("org.mozilla.firefox").is_ok());
        assert!(validate_package_name("a.b").is_ok());
        assert!(validate_package_name("com.foo_bar.baz2").is_ok());
    }

    #[test]
    fn validate_package_rejects_invalid() {
        assert_eq!(validate_package_name(""), Err(AdbError::InvalidPackage));
        assert_eq!(
            validate_package_name("nodot"),
            Err(AdbError::InvalidPackage)
        );
        assert_eq!(
            validate_package_name("com..empty"),
            Err(AdbError::InvalidPackage)
        );
        assert_eq!(
            validate_package_name("1com.bad.start"),
            Err(AdbError::InvalidPackage)
        );
        assert_eq!(
            validate_package_name("com.bad;rm"),
            Err(AdbError::InvalidPackage)
        );
    }

    #[test]
    fn classify_recognizes_categories() {
        assert_eq!(
            classify_adb_error("error: device unauthorized"),
            AdbError::Unauthorized
        );
        assert_eq!(
            classify_adb_error("error: device offline"),
            AdbError::Offline
        );
        assert_eq!(
            classify_adb_error("error: device 'abc' not found"),
            AdbError::Disconnected
        );
        assert_eq!(
            classify_adb_error("adb: error: failed to copy: Permission denied"),
            AdbError::PermissionDenied
        );
        assert!(matches!(
            classify_adb_error("some other weird error"),
            AdbError::Failed(_)
        ));
    }

    #[test]
    fn classify_recognizes_input_injection_denied() {
        assert_eq!(
            classify_adb_error(
                "Exception occurred while executing 'keyevent': \
                 java.lang.SecurityException: Injecting input events requires \
                 the caller ... to have the INJECT_EVENTS permission."
            ),
            AdbError::InjectDenied
        );
        assert_eq!(AdbError::InjectDenied.code(), "inject_denied");
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(AdbError::NotFound.code(), "adb_not_found");
        assert_eq!(AdbError::Timeout.code(), "timeout");
    }
}
