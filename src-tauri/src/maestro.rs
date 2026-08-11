use crate::commands::create_command;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::Manager;
use tokio::time::{timeout, Duration};

const RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_LOG_BYTES: usize = 200_000;
const MAX_FLOW_BYTES: usize = 1_000_000;
const WASHXPRESS_FLOW: &str = include_str!("../../.maestro/washxpress-smoke.yaml");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroAvailability {
    found: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaestroRunResult {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u64,
    flow_path: String,
    device_serial: String,
    timed_out: bool,
}

fn maestro_program() -> PathBuf {
    let executable = if cfg!(target_os = "windows") {
        "maestro.bat"
    } else {
        "maestro"
    };
    for home_key in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(home_key) {
            let candidate = PathBuf::from(home)
                .join(".maestro")
                .join("bin")
                .join(executable);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("maestro")
}

fn validate_device_serial(serial: &str) -> Result<&str, String> {
    let value = serial.trim();
    if value.is_empty()
        || value.len() > 200
        || !value.starts_with(|c: char| c.is_ascii_alphanumeric())
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '_' | '-'))
    {
        return Err("Invalid device serial".to_string());
    }
    Ok(value)
}

fn validate_flow_path(flow_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(flow_path.trim());
    if flow_path.trim().is_empty() || !path.is_file() {
        return Err("Maestro flow file was not found".to_string());
    }
    let allowed_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "yaml" | "yml"));
    if !allowed_extension {
        return Err("Maestro flow must be a .yaml or .yml file".to_string());
    }
    path.canonicalize()
        .map_err(|error| format!("Could not resolve Maestro flow: {error}"))
}

fn bounded_log(bytes: &[u8]) -> String {
    if bytes.len() <= MAX_LOG_BYTES {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let tail_start = bytes.len() - MAX_LOG_BYTES / 2;
    format!(
        "{}\n\n... output truncated ...\n\n{}",
        String::from_utf8_lossy(&bytes[..MAX_LOG_BYTES / 2]),
        String::from_utf8_lossy(&bytes[tail_start..]),
    )
}

#[tauri::command]
pub async fn check_maestro_available() -> MaestroAvailability {
    match create_command(maestro_program())
        .arg("--version")
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let version = bounded_log(&output.stdout).trim().to_string();
            MaestroAvailability {
                found: true,
                version: (!version.is_empty()).then_some(version),
                error: None,
            }
        }
        Ok(output) => MaestroAvailability {
            found: false,
            version: None,
            error: Some(bounded_log(&output.stderr).trim().to_string()),
        },
        Err(error) => MaestroAvailability {
            found: false,
            version: None,
            error: Some(format!("Maestro CLI not found: {error}")),
        },
    }
}

#[tauri::command]
pub async fn prepare_washxpress_maestro_flow(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let directory = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("maestro-flows");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("washxpress-smoke.yaml");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(WASHXPRESS_FLOW) {
        std::fs::write(&path, WASHXPRESS_FLOW).map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_maestro_flow(
    app_handle: tauri::AppHandle,
    content: String,
    name: String,
) -> Result<String, String> {
    if content.is_empty() || content.len() > MAX_FLOW_BYTES {
        return Err("Maestro flow must be between 1 byte and 1 MB".to_string());
    }
    let stem = name
        .trim()
        .trim_end_matches(".yaml")
        .trim_end_matches(".yml");
    if stem.is_empty()
        || stem.len() > 100
        || !stem
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid Maestro flow name".to_string());
    }
    let directory = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("maestro-flows");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{stem}.yaml"));
    std::fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn run_maestro_test(
    flow_path: String,
    device_serial: String,
) -> Result<MaestroRunResult, String> {
    let serial = validate_device_serial(&device_serial)?.to_string();
    let path = validate_flow_path(&flow_path)?;
    let started = Instant::now();
    let mut command = create_command(maestro_program());
    command
        .kill_on_drop(true)
        .arg("--device")
        .arg(&serial)
        .arg("--no-ansi")
        .arg("test")
        .arg(&path);

    match timeout(RUN_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => Ok(MaestroRunResult {
            success: output.status.success(),
            exit_code: output.status.code(),
            stdout: bounded_log(&output.stdout),
            stderr: bounded_log(&output.stderr),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: false,
        }),
        Ok(Err(error)) => Err(format!("Could not start Maestro CLI: {error}")),
        Err(_) => Ok(MaestroRunResult {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: "Maestro test timed out after 10 minutes".to_string(),
            duration_ms: started.elapsed().as_millis() as u64,
            flow_path: path.to_string_lossy().to_string(),
            device_serial: serial,
            timed_out: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_realistic_adb_serials() {
        assert!(validate_device_serial("emulator-5554").is_ok());
        assert!(validate_device_serial("192.168.1.4:5555").is_ok());
    }

    #[test]
    fn rejects_serials_that_could_be_cli_arguments() {
        assert!(validate_device_serial("--help").is_err());
        assert!(validate_device_serial("serial; reboot").is_err());
    }
}
