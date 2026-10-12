// QR Studio device commands.
//
// - `qr_send_to_device`: pushes a QR PNG held in memory to the device's
//   Downloads folder (`adb push`, array args, no shell) and asks the media
//   scanner to index it on a best-effort basis.
// - `qr_decode_image`: decodes QR codes in a PNG/JPEG image (rqrr, pure Rust).
// - `qr_capture_and_decode`: grabs the device screen, decodes every QR code on
//   it and returns a small thumbnail. The full frame is never written to disk
//   and never crosses IPC.

use crate::adb;
use crate::deep_link::sh_quote;
use crate::screenshot;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    imageops::{self, FilterType},
    DynamicImage, ImageFormat, ImageReader, Limits,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncWriteExt;

/// Timeout for the device screen capture used by Capture & Decode.
const QR_CAPTURE_TIMEOUT_SECS: u64 = 30;
const PUSH_TIMEOUT_SECS: u64 = 60;
const SCAN_TIMEOUT_SECS: u64 = 15;
const MAX_SEND_BYTES: usize = 8 * 1024 * 1024;
const MAX_DECODE_BYTES: usize = 10 * 1024 * 1024;
const MAX_DIMENSION: u32 = 8000;
/// Upper bound for the decoder's working allocations (8000x8000 RGBA = 256 MiB).
const MAX_DECODE_ALLOC_BYTES: u64 = 512 * 1024 * 1024;
const MAX_STEM_CHARS: usize = 80;
const THUMBNAIL_MAX_WIDTH: u32 = 480;
const REMOTE_DIR: &str = "/sdcard/Download";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

type CodedError = (String, String);

fn coded(code: &str, message: impl Into<String>) -> CodedError {
    (code.to_string(), message.into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrDeviceResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_on_device: Option<String>,
    /// Whether the media-scanner broadcast succeeded (best effort).
    pub scan: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl QrDeviceResult {
    fn failure((code, message): CodedError) -> Self {
        Self {
            success: false,
            path_on_device: None,
            scan: false,
            error: Some(message),
            error_code: Some(code),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeResult {
    pub success: bool,
    pub texts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl DecodeResult {
    fn ok(texts: Vec<String>) -> Self {
        Self {
            success: true,
            texts,
            error: None,
            error_code: None,
        }
    }

    fn failure((code, message): CodedError) -> Self {
        Self {
            success: false,
            texts: Vec::new(),
            error: Some(message),
            error_code: Some(code),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDecodeResult {
    pub success: bool,
    pub texts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_png_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl CaptureDecodeResult {
    fn failure((code, message): CodedError) -> Self {
        Self {
            success: false,
            texts: Vec::new(),
            thumbnail_png_base64: None,
            error: Some(message),
            error_code: Some(code),
        }
    }
}

/// Stable short content hash: lowercase hex of the first 4 bytes of SHA-256.
/// Unlike `DefaultHasher` this is identical across builds and Rust releases.
fn short_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest[..4].iter().map(|b| format!("{b:02x}")).collect()
}

/// File name without directories or the last extension.
fn stem_of(filename: &str) -> &str {
    let base = filename
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("");
    match base.rfind('.') {
        Some(index) if index > 0 => &base[..index],
        _ => base,
    }
}

/// Remote file name: `<sanitized stem, max 80 chars>-<hash8>.png`. The same
/// bytes always map to the same name; different bytes never collide silently.
fn build_remote_name(filename: &str, bytes: &[u8]) -> String {
    let sanitized = screenshot::sanitize_filename_component(stem_of(filename));
    let truncated: String = sanitized.chars().take(MAX_STEM_CHARS).collect();
    let trimmed = truncated.trim_matches(|c| c == '_' || c == '.');
    let stem = if trimmed.is_empty() {
        "device"
    } else {
        trimmed
    };
    format!("{stem}-{}.png", short_hash(bytes))
}

/// Temp file that is removed when dropped, so every exit path cleans up.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn unique_temp_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "scrcpy-gui-plus-qr-{}-{nanos}-{sequence}.png",
        std::process::id()
    ))
}

async fn send_to_device(
    serial: &str,
    filename: &str,
    png_base64: &str,
    custom_path: Option<String>,
) -> Result<(String, bool), CodedError> {
    adb::validate_serial(serial).map_err(|e| coded(e.code(), e.message()))?;

    if png_base64.len() > MAX_SEND_BYTES / 3 * 4 + 8 {
        return Err(coded("too_large", "Image is larger than 8 MB"));
    }
    let bytes = STANDARD
        .decode(png_base64.trim())
        .map_err(|e| coded("invalid_input", format!("Invalid image data: {e}")))?;
    if bytes.len() > MAX_SEND_BYTES {
        return Err(coded("too_large", "Image is larger than 8 MB"));
    }
    if !screenshot::validate_png(&bytes) {
        return Err(coded("invalid_input", "Image is not a PNG"));
    }

    let name = build_remote_name(filename, &bytes);
    let remote = format!("{REMOTE_DIR}/{name}");

    let temp = TempFile(unique_temp_path());
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp.0)
        .await
        .map_err(|e| coded("temp_file_failed", format!("Cannot create temp file: {e}")))?;
    file.write_all(&bytes)
        .await
        .map_err(|e| coded("temp_file_failed", format!("Cannot write temp file: {e}")))?;
    file.flush()
        .await
        .map_err(|e| coded("temp_file_failed", format!("Cannot write temp file: {e}")))?;
    drop(file);

    let local = temp
        .0
        .to_str()
        .ok_or_else(|| coded("temp_file_failed", "Temp path is not valid UTF-8"))?;
    adb::run_adb_text(
        Some(serial),
        &["push", local, &remote],
        custom_path.clone(),
        PUSH_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| coded(e.code(), e.message()))?;

    // Best effort: let the gallery/Files app see the new file.
    let uri = sh_quote(&format!("file://{remote}"));
    let scan = adb::run_adb_text(
        Some(serial),
        &[
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            &uri,
        ],
        custom_path,
        SCAN_TIMEOUT_SECS,
    )
    .await
    .is_ok();

    Ok((remote, scan))
}

/// Push a QR PNG to `/sdcard/Download/<name>.png` on the device.
#[tauri::command]
pub async fn qr_send_to_device(
    serial: String,
    filename: String,
    png_base64: String,
    custom_path: Option<String>,
) -> QrDeviceResult {
    let serial = serial.trim().to_string();
    match send_to_device(&serial, &filename, &png_base64, custom_path).await {
        Ok((path, scan)) => QrDeviceResult {
            success: true,
            path_on_device: Some(path),
            scan,
            error: None,
            error_code: None,
        },
        Err(e) => {
            eprintln!("qr_send_to_device failed: [{}] {}", e.0, e.1);
            QrDeviceResult::failure(e)
        }
    }
}

/// Detect and decode every QR code in an 8-bit greyscale image.
fn decode_qr_from_luma(width: usize, height: usize, luma: &[u8]) -> Vec<String> {
    let needed = width.checked_mul(height).unwrap_or(0);
    if needed == 0 || luma.len() < needed {
        return Vec::new();
    }
    let mut prepared =
        rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| luma[y * width + x]);
    let mut texts: Vec<String> = Vec::new();
    for grid in prepared.detect_grids() {
        if let Ok((_meta, text)) = grid.decode() {
            if !texts.contains(&text) {
                texts.push(text);
            }
        }
    }
    texts
}

/// Validate (PNG/JPEG only, dimensions <= 8000x8000) and decode an image.
fn decode_to_image(bytes: &[u8]) -> Result<DynamicImage, CodedError> {
    let guessed = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| coded("invalid_input", format!("Cannot read image: {e}")))?;
    let format = match guessed.format() {
        Some(f @ (ImageFormat::Png | ImageFormat::Jpeg)) => f,
        Some(_) => {
            return Err(coded(
                "unsupported_format",
                "Only PNG and JPEG images are supported",
            ))
        }
        None => return Err(coded("invalid_input", "Data is not a recognised image")),
    };
    let (width, height) = guessed
        .into_dimensions()
        .map_err(|e| coded("invalid_input", format!("Cannot read image: {e}")))?;
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(coded(
            "too_large",
            format!("Image is larger than {MAX_DIMENSION}x{MAX_DIMENSION} pixels"),
        ));
    }

    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| coded("invalid_input", format!("Cannot decode image: {e}")))
}

fn decode_texts_from_image(image: &DynamicImage) -> Vec<String> {
    let luma = image.to_luma8();
    decode_qr_from_luma(luma.width() as usize, luma.height() as usize, luma.as_raw())
}

/// Full `qr_decode_image` pipeline on a base64 payload (blocking work).
fn decode_payload(bytes_base64: &str) -> DecodeResult {
    let outcome = (|| -> Result<Vec<String>, CodedError> {
        let encoded = bytes_base64.trim();
        if encoded.is_empty() {
            return Err(coded("invalid_input", "No image data provided"));
        }
        if encoded.len() > MAX_DECODE_BYTES / 3 * 4 + 8 {
            return Err(coded("too_large", "Image is larger than 10 MB"));
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|e| coded("invalid_input", format!("Invalid image data: {e}")))?;
        if bytes.len() > MAX_DECODE_BYTES {
            return Err(coded("too_large", "Image is larger than 10 MB"));
        }
        let image = decode_to_image(&bytes)?;
        let texts = decode_texts_from_image(&image);
        if texts.is_empty() {
            return Err(coded("no_qr_found", "No QR code found in the image"));
        }
        Ok(texts)
    })();
    match outcome {
        Ok(texts) => DecodeResult::ok(texts),
        Err(e) => DecodeResult::failure(e),
    }
}

/// Decode QR codes from a PNG/JPEG image supplied as base64.
#[tauri::command]
pub async fn qr_decode_image(bytes_base64: String) -> DecodeResult {
    match tokio::task::spawn_blocking(move || decode_payload(&bytes_base64)).await {
        Ok(result) => {
            if !result.success && result.error_code.as_deref() != Some("no_qr_found") {
                eprintln!(
                    "qr_decode_image failed: [{}] {}",
                    result.error_code.as_deref().unwrap_or("unknown"),
                    result.error.as_deref().unwrap_or("")
                );
            }
            result
        }
        Err(e) => {
            eprintln!("qr_decode_image task failed: {e}");
            DecodeResult::failure(coded("decode_failed", "Decoder stopped unexpectedly"))
        }
    }
}

/// Decode a captured frame and build a PNG thumbnail (<= 480 px wide).
fn analyze_frame(frame: &[u8]) -> Result<(Vec<String>, String), CodedError> {
    let image = decode_to_image(frame)?;
    let texts = decode_texts_from_image(&image);

    let rgba = image.to_rgba8();
    let thumb = if rgba.width() > THUMBNAIL_MAX_WIDTH {
        let height = ((u64::from(rgba.height()) * u64::from(THUMBNAIL_MAX_WIDTH))
            / u64::from(rgba.width()))
        .max(1) as u32;
        imageops::resize(&rgba, THUMBNAIL_MAX_WIDTH, height, FilterType::Triangle)
    } else {
        rgba
    };
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(thumb)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| coded("encode_failed", format!("Cannot encode thumbnail: {e}")))?;
    Ok((texts, STANDARD.encode(&png)))
}

/// Capture the device screen, decode every QR code on it, return a thumbnail.
/// An empty `texts` list is a valid result (no QR code visible).
#[tauri::command]
pub async fn qr_capture_and_decode(
    serial: String,
    custom_path: Option<String>,
) -> CaptureDecodeResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return CaptureDecodeResult::failure(coded(e.code(), e.message()));
    }
    let frame =
        match screenshot::capture_png_frame(&serial, custom_path, QR_CAPTURE_TIMEOUT_SECS).await {
            Ok(frame) => frame,
            Err(e) => {
                eprintln!("qr_capture_and_decode capture failed: [{}] {}", e.0, e.1);
                return CaptureDecodeResult::failure(e);
            }
        };
    match tokio::task::spawn_blocking(move || analyze_frame(&frame)).await {
        Ok(Ok((texts, thumbnail))) => CaptureDecodeResult {
            success: true,
            texts,
            thumbnail_png_base64: Some(thumbnail),
            error: None,
            error_code: None,
        },
        Ok(Err(e)) => {
            eprintln!("qr_capture_and_decode decode failed: [{}] {}", e.0, e.1);
            CaptureDecodeResult::failure(e)
        }
        Err(e) => {
            eprintln!("qr_capture_and_decode task failed: {e}");
            CaptureDecodeResult::failure(coded("decode_failed", "Decoder stopped unexpectedly"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GrayImage;
    use qrcode::{Color, QrCode};

    #[test]
    fn short_hash_is_a_fixed_known_vector() {
        // First 4 bytes of SHA-256("abc") = ba7816bf8f01cfea...
        assert_eq!(short_hash(b"abc"), "ba7816bf");
        assert_eq!(short_hash(b"abc").len(), 8);
    }

    #[test]
    fn remote_name_always_ends_in_png() {
        let exe = build_remote_name("a.exe", b"x");
        assert!(exe.ends_with(".png"));
        assert!(exe.starts_with("a-"));
        let traversal = build_remote_name("../x", b"x");
        assert!(traversal.ends_with(".png"));
        assert_eq!(traversal, format!("x-{}.png", short_hash(b"x")));
        assert!(!traversal.contains('/'));
        assert!(build_remote_name("Wi-Fi QR", b"x").starts_with("Wi-Fi_QR-"));
    }

    #[test]
    fn remote_name_caps_multibyte_stem_at_80_chars() {
        let long = "日".repeat(200);
        let name = build_remote_name(&format!("{long}.png"), b"x");
        let stem = name
            .strip_suffix(&format!("-{}.png", short_hash(b"x")))
            .unwrap();
        assert_eq!(stem.chars().count(), 80);
        assert!(stem.chars().all(|c| c == '日'));
    }

    #[test]
    fn remote_name_uses_device_for_empty_stem() {
        let expected = format!("device-{}.png", short_hash(b"x"));
        assert_eq!(build_remote_name("", b"x"), expected);
        assert_eq!(build_remote_name("   ", b"x"), expected);
        assert_eq!(build_remote_name("...", b"x"), expected);
    }

    #[test]
    fn remote_name_depends_on_content_only_for_hash() {
        assert_eq!(
            build_remote_name("a", b"same"),
            build_remote_name("a", b"same")
        );
        assert_ne!(
            build_remote_name("a", b"one"),
            build_remote_name("a", b"two")
        );
    }

    /// Render `text` as a QR code: 4-module quiet zone, 8 px per module.
    fn qr_luma(text: &str) -> GrayImage {
        let code = QrCode::new(text.as_bytes()).unwrap();
        let modules = code.width();
        let colors = code.to_colors();
        let (quiet, scale) = (4usize, 8usize);
        let side = ((modules + quiet * 2) * scale) as u32;
        GrayImage::from_fn(side, side, |x, y| {
            let mx = (x as usize / scale).checked_sub(quiet);
            let my = (y as usize / scale).checked_sub(quiet);
            match (mx, my) {
                (Some(mx), Some(my)) if mx < modules && my < modules => {
                    if colors[my * modules + mx] == Color::Dark {
                        image::Luma([0])
                    } else {
                        image::Luma([255])
                    }
                }
                _ => image::Luma([255]),
            }
        })
    }

    fn encode(image: GrayImage, format: ImageFormat) -> Vec<u8> {
        let mut out = Vec::new();
        DynamicImage::ImageLuma8(image)
            .write_to(&mut Cursor::new(&mut out), format)
            .unwrap();
        out
    }

    #[test]
    fn decodes_png_round_trip() {
        let text = "https://example.com/path?a=1&b=2";
        let b64 = STANDARD.encode(encode(qr_luma(text), ImageFormat::Png));
        let result = decode_payload(&b64);
        assert!(result.success, "{:?}", result.error);
        assert_eq!(result.texts, vec![text.to_string()]);
    }

    #[test]
    fn decodes_jpeg_round_trip() {
        let text = "WIFI:T:WPA;S:Cafe;P:secret;;";
        let b64 = STANDARD.encode(encode(qr_luma(text), ImageFormat::Jpeg));
        let result = decode_payload(&b64);
        assert!(result.success, "{:?}", result.error);
        assert_eq!(result.texts, vec![text.to_string()]);
    }

    #[test]
    fn analyze_frame_returns_texts_and_small_thumbnail() {
        let text = "myapp://screen/42";
        let frame = encode(qr_luma(text), ImageFormat::Png);
        let (texts, thumb_b64) = analyze_frame(&frame).unwrap();
        assert_eq!(texts, vec![text.to_string()]);
        let thumb = image::load_from_memory(&STANDARD.decode(thumb_b64).unwrap()).unwrap();
        assert!(thumb.width() <= THUMBNAIL_MAX_WIDTH);
        assert!(thumb.height() >= 1);
    }

    #[test]
    fn decode_rejects_invalid_base64() {
        let result = decode_payload("not base64 !!!");
        assert!(!result.success);
        assert_eq!(result.error_code.as_deref(), Some("invalid_input"));
        assert_eq!(
            decode_payload("").error_code.as_deref(),
            Some("invalid_input")
        );
    }

    #[test]
    fn decode_rejects_oversize_payload() {
        let b64 = STANDARD.encode(vec![0u8; MAX_DECODE_BYTES + 1]);
        let result = decode_payload(&b64);
        assert_eq!(result.error_code.as_deref(), Some("too_large"));
    }

    #[test]
    fn decode_rejects_oversize_dimensions() {
        let wide = GrayImage::from_pixel(MAX_DIMENSION + 1, 1, image::Luma([255]));
        let b64 = STANDARD.encode(encode(wide, ImageFormat::Png));
        assert_eq!(
            decode_payload(&b64).error_code.as_deref(),
            Some("too_large")
        );
    }

    #[test]
    fn decode_rejects_non_image_and_unsupported_formats() {
        let junk = STANDARD.encode(b"definitely not an image");
        assert_eq!(
            decode_payload(&junk).error_code.as_deref(),
            Some("invalid_input")
        );

        let gif = STANDARD.encode(b"GIF89a\x01\x00\x01\x00\x00\x00\x00;");
        assert_eq!(
            decode_payload(&gif).error_code.as_deref(),
            Some("unsupported_format")
        );

        let mut webp = b"RIFF\x1a\x00\x00\x00WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0u8; 16]);
        assert_eq!(
            decode_payload(&STANDARD.encode(webp)).error_code.as_deref(),
            Some("unsupported_format")
        );
    }

    #[test]
    fn blank_image_reports_no_qr_found() {
        let blank = GrayImage::from_pixel(200, 200, image::Luma([255]));
        let b64 = STANDARD.encode(encode(blank, ImageFormat::Png));
        let result = decode_payload(&b64);
        assert!(!result.success);
        assert_eq!(result.error_code.as_deref(), Some("no_qr_found"));
    }
}
