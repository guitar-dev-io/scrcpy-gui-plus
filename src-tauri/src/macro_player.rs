// Macro replay backend.
//
// Executes a single validated macro input action against a device via
// `adb shell input`. Only a fixed set of action kinds is accepted and every
// coordinate/keycode is a validated integer, so nothing user-supplied is ever
// interpolated into a shell string. Text input is sent as a single argument to
// `input text` (spaces encoded as %s, the adb convention).

use crate::adb::{self, AdbError};
use serde::{Deserialize, Serialize};

const ACTION_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// A single macro action. `wait` and `screenshot` are handled entirely on the
/// frontend (timing / capture) and never reach this command.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MacroAction {
    Tap {
        x: i32,
        y: i32,
    },
    Swipe {
        x1: i32,
        y1: i32,
        x2: i32,
        y2: i32,
        duration_ms: u32,
    },
    Text {
        value: String,
    },
    Keyevent {
        keycode: i32,
    },
}

fn ok() -> MacroResult {
    MacroResult {
        success: true,
        error: None,
        error_code: None,
    }
}

fn err(e: &AdbError) -> MacroResult {
    MacroResult {
        success: false,
        error: Some(e.message()),
        error_code: Some(e.code().to_string()),
    }
}

fn err_msg(code: &str, msg: String) -> MacroResult {
    MacroResult {
        success: false,
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

/// Encode text for `adb shell input text`: spaces become %s and a conservative
/// allowlist of characters is enforced to avoid shell-sensitive input. Rejects
/// anything outside a safe printable set.
fn encode_input_text(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Err("empty text".to_string());
    }
    if value.len() > 1000 {
        return Err("text too long".to_string());
    }
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            ' ' => out.push_str("%s"),
            'a'..='z' | 'A'..='Z' | '0'..='9' => out.push(ch),
            '.' | ',' | '_' | '-' | '@' | '/' | ':' | '+' | '=' | '!' | '?' | '#' => out.push(ch),
            _ => return Err(format!("unsupported character: {:?}", ch)),
        }
    }
    Ok(out)
}

/// Execute one macro action.
#[tauri::command]
pub async fn run_macro_action(
    serial: String,
    action: MacroAction,
    custom_path: Option<String>,
) -> MacroResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return err(&e);
    }

    // Build a fully-numeric / encoded argument vector.
    let args: Vec<String> = match action {
        MacroAction::Tap { x, y } => {
            if !(0..=20000).contains(&x) || !(0..=20000).contains(&y) {
                return err_msg("invalid_coords", "coordinates out of range".to_string());
            }
            vec![
                "shell".into(),
                "input".into(),
                "tap".into(),
                x.to_string(),
                y.to_string(),
            ]
        }
        MacroAction::Swipe {
            x1,
            y1,
            x2,
            y2,
            duration_ms,
        } => {
            for v in [x1, y1, x2, y2] {
                if !(0..=20000).contains(&v) {
                    return err_msg("invalid_coords", "coordinates out of range".to_string());
                }
            }
            let dur = duration_ms.min(60_000);
            vec![
                "shell".into(),
                "input".into(),
                "swipe".into(),
                x1.to_string(),
                y1.to_string(),
                x2.to_string(),
                y2.to_string(),
                dur.to_string(),
            ]
        }
        MacroAction::Text { value } => {
            let encoded = match encode_input_text(&value) {
                Ok(e) => e,
                Err(m) => return err_msg("invalid_text", m),
            };
            vec!["shell".into(), "input".into(), "text".into(), encoded]
        }
        MacroAction::Keyevent { keycode } => {
            if !(0..=300).contains(&keycode) {
                return err_msg("invalid_keycode", "keycode out of range".to_string());
            }
            vec![
                "shell".into(),
                "input".into(),
                "keyevent".into(),
                keycode.to_string(),
            ]
        }
    };

    let borrowed: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match adb::run_adb_text(Some(&serial), &borrowed, custom_path, ACTION_TIMEOUT_SECS).await {
        Ok(_) => ok(),
        Err(e) => err(&e),
    }
}

/// Maximum recording length `screenrecord` accepts (also its default cap).
const MAX_RECORD_SECS: u32 = 180;

/// Record the device screen for a fixed duration, then pull the MP4 to
/// `output_dir`. Unlike the toolbar's start/stop recording (which is stateful),
/// this is a single self-contained step suitable for macro replay: it uses
/// `screenrecord --time-limit` so the on-device capture stops on its own.
#[tauri::command]
pub async fn macro_record_screen(
    serial: String,
    seconds: u32,
    output_dir: String,
    custom_path: Option<String>,
) -> MacroResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return err(&e);
    }
    if output_dir.trim().is_empty() {
        return err_msg("invalid_output_dir", "No output directory set".to_string());
    }

    let secs = seconds.clamp(1, MAX_RECORD_SECS);

    let remote_serial: String = serial
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let remote_path = format!(
        "/sdcard/scrcpygui-macro-{}-{}.mp4",
        remote_serial,
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    // `--time-limit` makes screenrecord exit on its own after `secs`; allow a
    // generous margin over the recording duration for the command timeout.
    let secs_str = secs.to_string();
    let record_args = vec![
        "shell",
        "screenrecord",
        "--time-limit",
        secs_str.as_str(),
        remote_path.as_str(),
    ];
    if let Err(e) = adb::run_adb_text(
        Some(&serial),
        &record_args,
        custom_path.clone(),
        (secs as u64) + 30,
    )
    .await
    {
        return err(&e);
    }

    // Give the device a moment to finalize the MP4 before pulling.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let filename = remote_path
        .rsplit('/')
        .next()
        .unwrap_or("recording.mp4")
        .to_string();
    let local_path = std::path::Path::new(output_dir.trim()).join(&filename);
    let local_str = local_path.to_string_lossy().to_string();

    let pull_res = adb::run_adb_text(
        Some(&serial),
        &["pull", remote_path.as_str(), local_str.as_str()],
        custom_path.clone(),
        120,
    )
    .await;

    // Best-effort cleanup of the on-device file regardless of pull outcome.
    let _ = adb::run_adb_text(
        Some(&serial),
        &["shell", "rm", "-f", remote_path.as_str()],
        custom_path,
        ACTION_TIMEOUT_SECS,
    )
    .await;

    match pull_res {
        Ok(_) => ok(),
        Err(e) => err(&e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_input_text_encodes_spaces() {
        assert_eq!(encode_input_text("hello world").unwrap(), "hello%sworld");
    }

    #[test]
    fn encode_input_text_allows_safe_symbols() {
        assert_eq!(
            encode_input_text("user.name@example.com").unwrap(),
            "user.name@example.com"
        );
    }

    #[test]
    fn encode_input_text_rejects_shell_metachars() {
        assert!(encode_input_text("rm; reboot").is_err());
        assert!(encode_input_text("a`b").is_err());
        assert!(encode_input_text("a|b").is_err());
        assert!(encode_input_text("$(x)").is_err());
    }

    #[test]
    fn encode_input_text_rejects_empty() {
        assert!(encode_input_text("").is_err());
    }
}
