// Deep link launcher backend.
//
// Fires an ACTION_VIEW intent with a user-supplied URI at the device, and
// generates a QR code (SVG) for the URI so it can be scanned by another
// device. The device serial and optional package are validated; the URI is
// passed to adb as a single array argument (never concatenated into a shell
// string) so it cannot break out into additional commands.

use crate::adb::{self, AdbError};
use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};
use serde::Serialize;

const LAUNCH_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn ok(output: Option<String>) -> DeepLinkResult {
    DeepLinkResult {
        success: true,
        output,
        error: None,
        error_code: None,
    }
}

fn err(e: &AdbError) -> DeepLinkResult {
    DeepLinkResult {
        success: false,
        output: None,
        error: Some(e.message()),
        error_code: Some(e.code().to_string()),
    }
}

fn err_msg(code: &str, msg: String) -> DeepLinkResult {
    DeepLinkResult {
        success: false,
        output: None,
        error: Some(msg),
        error_code: Some(code.to_string()),
    }
}

/// Reject obviously malformed / empty URIs early. Real validation is delegated
/// to Android; this just guards against empty input and control characters.
fn validate_uri(uri: &str) -> Result<(), String> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return Err("URI is empty".to_string());
    }
    if trimmed.len() > 4096 {
        return Err("URI is too long".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("URI contains control characters".to_string());
    }
    Ok(())
}

/// Launch a deep link via `am start -a android.intent.action.VIEW -d <uri>`.
/// When `package` is provided the intent is constrained to it (`-p <package>`).
#[tauri::command]
pub async fn launch_deep_link(
    serial: String,
    uri: String,
    package: Option<String>,
    custom_path: Option<String>,
) -> DeepLinkResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return err(&e);
    }
    let uri = uri.trim().to_string();
    if let Err(m) = validate_uri(&uri) {
        return err_msg("invalid_uri", m);
    }

    let pkg = package.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    if let Some(ref p) = pkg {
        if let Err(e) = adb::validate_package_name(p) {
            return err(&e);
        }
    }

    let mut args: Vec<String> = vec![
        "shell".into(),
        "am".into(),
        "start".into(),
        "-a".into(),
        "android.intent.action.VIEW".into(),
        "-d".into(),
        uri.clone(),
    ];
    if let Some(ref p) = pkg {
        args.push("-p".into());
        args.push(p.clone());
    }

    let borrowed: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match adb::run_adb_text(Some(&serial), &borrowed, custom_path, LAUNCH_TIMEOUT_SECS).await {
        Ok(out) => {
            let trimmed = out.trim();
            // `am start` prints "Error: ..." to stdout when no activity handles
            // the intent, while still exiting 0.
            if trimmed.contains("Error:")
                || trimmed.contains("does not exist")
                || trimmed.contains("No Activity found")
            {
                err_msg("no_handler", trimmed.to_string())
            } else {
                ok(Some(trimmed.to_string()))
            }
        }
        Err(e) => err(&e),
    }
}

/// Generate an SVG QR code for arbitrary text (typically a deep link URI).
#[tauri::command]
pub fn generate_qr_svg(text: String) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Nothing to encode".to_string());
    }
    if trimmed.len() > 4096 {
        return Err("Text is too long to encode".to_string());
    }
    let code = QrCode::with_error_correction_level(trimmed.as_bytes(), EcLevel::M)
        .map_err(|e| e.to_string())?;
    let svg = code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#e4e4e7"))
        .light_color(svg::Color("#09090b"))
        .quiet_zone(true)
        .build();
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_uri_accepts_common_schemes() {
        assert!(validate_uri("https://example.com/path?x=1").is_ok());
        assert!(validate_uri("myapp://screen/42").is_ok());
        assert!(validate_uri("intent://scan/#Intent;scheme=zxing;end").is_ok());
    }

    #[test]
    fn validate_uri_rejects_empty_and_control() {
        assert!(validate_uri("").is_err());
        assert!(validate_uri("   ").is_err());
        assert!(validate_uri("bad\nuri").is_err());
    }

    #[test]
    fn generate_qr_svg_produces_svg() {
        let svg = generate_qr_svg("https://example.com".to_string()).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn generate_qr_svg_rejects_empty() {
        assert!(generate_qr_svg("".to_string()).is_err());
        assert!(generate_qr_svg("   ".to_string()).is_err());
    }
}
