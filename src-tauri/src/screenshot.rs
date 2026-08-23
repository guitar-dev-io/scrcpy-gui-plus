// Screenshot capture backend.
//
// Captures the Android screen at native resolution via
// `adb -s <serial> exec-out screencap -p`, validates the PNG payload and
// writes it to a (configurable) directory. Scroll capture additionally swipes
// the device, detects vertical overlap, and stitches only newly exposed rows.
// Only file metadata ever crosses back to the frontend; image bytes stay in Rust.

use crate::adb::{self, AdbError};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    imageops, DynamicImage, GenericImageView, ImageError, ImageFormat, ImageReader, Limits,
    RgbaImage,
};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;
use tokio::time::{sleep, Duration};

/// PNG magic number.
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Timeout for a screencap (large screens on slow USB can be a few seconds).
const SCREENSHOT_TIMEOUT_SECS: u64 = 30;

/// Timeout for a single live-preview frame. Shorter than a saved screenshot so
/// a slow/stalled frame does not back up the polling loop.
const PREVIEW_TIMEOUT_SECS: u64 = 12;

const DEFAULT_SCROLL_SEGMENTS: u32 = 6;
const MIN_SCROLL_SEGMENTS: u32 = 2;
const MAX_SCROLL_SEGMENTS: u32 = 10;
const DEFAULT_SCROLL_DELAY_MS: u64 = 650;
const MIN_SCROLL_DELAY_MS: u64 = 250;
const MAX_SCROLL_DELAY_MS: u64 = 2_000;
const SCROLL_ACTION_TIMEOUT_SECS: u64 = 15;
const MAX_FRAME_DIMENSION: u32 = 8_192;
const MAX_FRAME_PIXELS: u64 = 20_000_000;
const MAX_FRAME_ALLOCATION_BYTES: u64 = 128 * 1024 * 1024;
const MAX_SCROLL_PIXELS: u64 = 48_000_000;
const MAX_OVERLAP_DIFFERENCE: f64 = 36.0;
const MIN_OVERLAP_CONFIDENCE_MARGIN: f64 = 1.25;
const SAME_FRAME_DIFFERENCE: f64 = 1.0;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub success: bool,
    pub path: String,
    pub filename: String,
    pub device_serial: String,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub termination_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl ScreenshotResult {
    fn failure(device_serial: &str, captured_at: &str, err: &AdbError) -> Self {
        Self::failure_msg(device_serial, captured_at, err.code(), err.message())
    }

    pub(crate) fn failure_msg(
        device_serial: &str,
        captured_at: &str,
        code: &str,
        msg: String,
    ) -> Self {
        ScreenshotResult {
            success: false,
            path: String::new(),
            filename: String::new(),
            device_serial: device_serial.to_string(),
            captured_at: captured_at.to_string(),
            device_name: None,
            source_kind: None,
            source_id: None,
            source_name: None,
            capture_kind: None,
            segment_count: None,
            width: None,
            height: None,
            complete: None,
            termination_reason: None,
            error: Some(msg),
            error_code: Some(code.to_string()),
        }
    }
}

/// Validate, persist and describe a native PNG capture from a non-ADB source.
/// Keeping this helper beside the existing image limits and atomic writer
/// ensures host screenshots follow the same safety and history contract.
pub(crate) fn persist_png_screenshot(
    directory: &Path,
    bytes: &[u8],
    device_serial: &str,
    device_name: &str,
    source_kind: &str,
    source_id: &str,
    source_name: &str,
    captured_at: &str,
) -> ScreenshotResult {
    if !validate_png(bytes) {
        return ScreenshotResult::failure_msg(
            device_serial,
            captured_at,
            "corrupt_png",
            "macOS returned an empty or invalid PNG image".to_string(),
        );
    }

    let frame = match decode_png_frame(bytes) {
        Ok(frame) => frame,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(device_serial, captured_at, &code, message)
        }
    };
    let (width, height) = frame.dimensions();
    let requested_filename =
        build_screenshot_filename(device_name, device_serial, &now_timestamp());
    let (full_path, filename) =
        match write_unique_file_atomically(directory, &requested_filename, bytes) {
            Ok(saved) => saved,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(device_serial, captured_at, &code, message)
            }
        };

    ScreenshotResult {
        success: true,
        path: full_path.to_string_lossy().to_string(),
        filename,
        device_serial: device_serial.to_string(),
        captured_at: captured_at.to_string(),
        device_name: Some(device_name.to_string()),
        source_kind: Some(source_kind.to_string()),
        source_id: Some(source_id.to_string()),
        source_name: Some(source_name.to_string()),
        capture_kind: Some("screen".to_string()),
        segment_count: Some(1),
        width: Some(width),
        height: Some(height),
        complete: Some(true),
        termination_reason: None,
        error: None,
        error_code: None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
    pub device_serial: String,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub custom_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollScreenshotRequest {
    pub device_serial: String,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub custom_path: Option<String>,
    #[serde(default)]
    pub max_segments: Option<u32>,
    #[serde(default)]
    pub scroll_delay_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalScreenshotRequest {
    pub image_data: String,
    pub device_serial: String,
    #[serde(default)]
    pub device_name: Option<String>,
    pub source_kind: String,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
}

/// Replace characters that are invalid or unsafe in filenames across
/// Windows / macOS / Linux with underscores and collapse whitespace.
pub fn sanitize_filename_component(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c if c.is_whitespace() => '_',
            c => c,
        })
        .collect();

    let mut result = String::with_capacity(cleaned.len());
    let mut prev_underscore = false;
    for c in cleaned.chars() {
        if c == '_' {
            if !prev_underscore {
                result.push(c);
            }
            prev_underscore = true;
        } else {
            result.push(c);
            prev_underscore = false;
        }
    }
    let trimmed = result.trim_matches(|c| c == '_' || c == '.').to_string();
    if trimmed.is_empty() {
        "device".to_string()
    } else {
        trimmed
    }
}

/// Build the default screenshot filename:
/// `<DeviceName>_<Serial>_<YYYY-MM-DD_HH-mm-ss>.png`
pub fn build_screenshot_filename(device_name: &str, serial: &str, timestamp: &str) -> String {
    let name = sanitize_filename_component(device_name);
    let serial = sanitize_filename_component(serial);
    format!("{}_{}_{}.png", name, serial, timestamp)
}

fn build_scroll_screenshot_filename(device_name: &str, serial: &str, timestamp: &str) -> String {
    let name = sanitize_filename_component(device_name);
    let serial = sanitize_filename_component(serial);
    format!("{}_{}_scroll_{}.png", name, serial, timestamp)
}

/// Validate that the byte payload begins with a PNG signature and is non-trivial.
pub fn validate_png(bytes: &[u8]) -> bool {
    bytes.len() > PNG_SIGNATURE.len() && bytes[..PNG_SIGNATURE.len()] == PNG_SIGNATURE
}

/// Resolve the directory to save screenshots into, creating it if missing.
/// Falls back to `<Pictures>/ScrcpyGUI` when no directory is configured.
pub fn resolve_screenshot_dir(
    custom: Option<&str>,
    default_base: &Path,
) -> Result<PathBuf, String> {
    let dir = match custom {
        Some(c) if !c.trim().is_empty() => PathBuf::from(c.trim()),
        _ => default_base.join("ScrcpyGUI"),
    };

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Invalid output directory ({}): {}", dir.display(), e))?;
    } else if !dir.is_dir() {
        return Err(format!("Output path is not a directory: {}", dir.display()));
    }
    Ok(dir)
}

fn now_timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

fn now_scroll_timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d_%H-%M-%S-%3f")
        .to_string()
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

pub(crate) fn resolve_output_dir(
    app_handle: &tauri::AppHandle,
    requested: Option<&str>,
) -> Result<PathBuf, (String, String)> {
    let base = app_handle
        .path()
        .picture_dir()
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|error| ("invalid_output_dir".to_string(), error.to_string()))?;
    resolve_screenshot_dir(requested, &base)
        .map_err(|error| ("invalid_output_dir".to_string(), error))
}

pub(crate) async fn capture_png_frame(
    serial: &str,
    custom_path: Option<String>,
    timeout_secs: u64,
) -> Result<Vec<u8>, (String, String)> {
    let output = adb::run_adb_bytes(
        Some(serial),
        &["exec-out", "screencap", "-p"],
        custom_path,
        timeout_secs,
    )
    .await
    .map_err(|error| (error.code().to_string(), error.message()))?;

    if !validate_png(&output.stdout) {
        return Err((
            "corrupt_png".to_string(),
            "Captured data is empty or not a valid PNG".to_string(),
        ));
    }

    Ok(output.stdout)
}

pub(crate) fn decode_png_frame(bytes: &[u8]) -> Result<RgbaImage, (String, String)> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_FRAME_DIMENSION);
    limits.max_image_height = Some(MAX_FRAME_DIMENSION);
    limits.max_alloc = Some(MAX_FRAME_ALLOCATION_BYTES);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|error| {
        let code = if matches!(error, ImageError::Limits(_)) {
            "size_limit"
        } else {
            "decode_failed"
        };
        (code.to_string(), error.to_string())
    })?;
    let (width, height) = decoded.dimensions();
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_FRAME_PIXELS {
        return Err((
            "size_limit".to_string(),
            "The device frame exceeded the safe image-size limit".to_string(),
        ));
    }
    Ok(decoded.into_rgba8())
}

/// Decode an image received from an external live source. Only PNG and JPEG
/// are accepted; the frame is bounded before it is normalized and persisted.
pub(crate) fn decode_image_frame(bytes: &[u8]) -> Result<RgbaImage, (String, String)> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| ("decode_failed".to_string(), error.to_string()))?;
    let format = reader.format();
    if !matches!(format, Some(ImageFormat::Png) | Some(ImageFormat::Jpeg)) {
        return Err((
            "unsupported_image".to_string(),
            "External capture must be a PNG or JPEG image".to_string(),
        ));
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_FRAME_DIMENSION);
    limits.max_image_height = Some(MAX_FRAME_DIMENSION);
    limits.max_alloc = Some(MAX_FRAME_ALLOCATION_BYTES);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|error| {
        let code = if matches!(error, ImageError::Limits(_)) {
            "size_limit"
        } else {
            "decode_failed"
        };
        (code.to_string(), error.to_string())
    })?;
    let (width, height) = decoded.dimensions();
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_FRAME_PIXELS {
        return Err((
            "size_limit".to_string(),
            "The external frame exceeded the safe image-size limit".to_string(),
        ));
    }
    Ok(decoded.into_rgba8())
}

async fn swipe_for_scroll(
    serial: &str,
    width: u32,
    height: u32,
    custom_path: Option<String>,
) -> Result<(), (String, String)> {
    let x = width / 2;
    // Keep the gesture deliberately short and slow. Some RecyclerViews keep
    // coasting after even a moderate ADB swipe, which can leave too little
    // shared content for safe alignment.
    let from_y = height.saturating_mul(65) / 100;
    let to_y = height.saturating_mul(57) / 100;
    let args = [
        "shell".to_string(),
        "input".to_string(),
        "swipe".to_string(),
        x.to_string(),
        from_y.to_string(),
        x.to_string(),
        to_y.to_string(),
        "1000".to_string(),
    ];
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    adb::run_adb_text(
        Some(serial),
        &borrowed,
        custom_path,
        SCROLL_ACTION_TIMEOUT_SECS,
    )
    .await
    .map(|_| ())
    .map_err(|error| (error.code().to_string(), error.message()))
}

fn content_bounds(height: u32) -> Option<(u32, u32)> {
    if height < 120 {
        return None;
    }
    let top = (height.saturating_mul(12) / 100).max(1);
    let bottom = height.saturating_sub((height.saturating_mul(8) / 100).max(1));
    (bottom > top + 32).then_some((top, bottom))
}

fn pixel_luma(pixel: [u8; 4]) -> i32 {
    (77 * i32::from(pixel[0]) + 150 * i32::from(pixel[1]) + 29 * i32::from(pixel[2])) >> 8
}

fn pixel_gradients(image: &RgbaImage, x: u32, y: u32) -> (i32, i32) {
    let center = pixel_luma(image.get_pixel(x, y).0);
    let right = pixel_luma(image.get_pixel(x + 1, y).0);
    let below = pixel_luma(image.get_pixel(x, y + 1).0);
    (right - center, below - center)
}

/// Mean difference between informative edge samples in equally-sized regions.
/// Flat pixels are ignored so repeated white/list backgrounds cannot dominate
/// the score and hide the text/icon alignment that identifies the real shift.
fn sampled_region_difference(
    first: &RgbaImage,
    second: &RgbaImage,
    first_y: u32,
    second_y: u32,
    rows: u32,
) -> f64 {
    if first.width() != second.width()
        || first_y.saturating_add(rows) > first.height()
        || second_y.saturating_add(rows) > second.height()
        || rows < 2
        || first.width() < 3
    {
        return f64::MAX;
    }

    let width = first.width();
    let x_start = width / 10;
    let x_end = width.saturating_sub(x_start).max(x_start + 2);
    let x_step = ((x_end - x_start) / 120).max(1);
    let y_step = (rows / 160).max(1);
    let mut difference = 0u64;
    let mut samples = 0u64;

    let mut y = 0;
    while y + 1 < rows {
        let mut x = x_start;
        while x + 1 < x_end {
            let first_y = first_y + y;
            let second_y = second_y + y;
            let (first_dx, first_dy) = pixel_gradients(first, x, first_y);
            let (second_dx, second_dy) = pixel_gradients(second, x, second_y);
            let first_strength = first_dx.abs() + first_dy.abs();
            let second_strength = second_dx.abs() + second_dy.abs();
            if first_strength.max(second_strength) >= 12 {
                let a = first.get_pixel(x, first_y).0;
                let b = second.get_pixel(x, second_y).0;
                let color_difference = (0..3)
                    .map(|channel| u64::from(a[channel].abs_diff(b[channel])))
                    .sum::<u64>()
                    / 3;
                difference += u64::from(first_dx.abs_diff(second_dx));
                difference += u64::from(first_dy.abs_diff(second_dy));
                difference += color_difference;
                samples += 1;
            }
            x = x.saturating_add(x_step);
        }
        y = y.saturating_add(y_step);
    }

    if samples < 24 {
        f64::MAX
    } else {
        difference as f64 / (samples as f64 * 3.0)
    }
}

pub(crate) fn frames_are_nearly_identical(
    previous: &RgbaImage,
    current: &RgbaImage,
    top: u32,
    bottom: u32,
) -> bool {
    sampled_region_difference(previous, current, top, top, bottom - top) <= SAME_FRAME_DIFFERENCE
}

pub(crate) fn find_vertical_overlap(
    previous: &RgbaImage,
    current: &RgbaImage,
    top: u32,
    bottom: u32,
) -> Option<(u32, f64)> {
    if previous.dimensions() != current.dimensions() || bottom <= top {
        return None;
    }

    let content_height = bottom - top;
    // Compare the middle of the viewport rather than anchoring at `top`.
    // Collapsing app bars can change height after the first swipe, while rows
    // below 25% of the screen still move by the actual content displacement.
    let match_top = top.max(previous.height().saturating_mul(25) / 100);
    if bottom <= match_top + 64 {
        return None;
    }
    let match_height = bottom - match_top;
    let minimum_comparison_rows = (match_height / 4).max(64);
    let maximum_shift = previous
        .height()
        .saturating_mul(65)
        .checked_div(100)?
        .min(match_height.saturating_sub(minimum_comparison_rows));
    if maximum_shift == 0 {
        return None;
    }

    let score_shift = |shift: u32| {
        sampled_region_difference(
            previous,
            current,
            match_top + shift,
            match_top,
            match_height - shift,
        )
    };
    let step = (match_height / 400).max(1);
    let mut candidates = Vec::new();
    let mut shift = 1u32;
    while shift <= maximum_shift {
        candidates.push((shift, score_shift(shift)));
        shift = shift.saturating_add(step);
    }

    let coarse_shift = candidates
        .iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))?
        .0;
    let refine_start = coarse_shift.saturating_sub(step).max(1);
    let refine_end = coarse_shift.saturating_add(step).min(maximum_shift);
    for candidate in refine_start..=refine_end {
        candidates.push((candidate, score_shift(candidate)));
    }
    candidates.sort_by(|left, right| left.1.total_cmp(&right.1));

    let best = *candidates.first()?;
    if best.1 > MAX_OVERLAP_DIFFERENCE {
        return None;
    }
    let ambiguity_separation = (previous.height() / 20).max(16);
    if let Some(runner_up) = candidates
        .iter()
        .find(|candidate| candidate.0.abs_diff(best.0) >= ambiguity_separation)
    {
        if runner_up.1 <= best.1 + MIN_OVERLAP_CONFIDENCE_MARGIN {
            return None;
        }
    }

    // The caller consumes overlap, while matching is clearer in terms of the
    // newly exposed row count (the vertical shift).
    Some((content_height.saturating_sub(best.0), best.1))
}

fn io_error(error: std::io::Error) -> (String, String) {
    let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
        "permission_denied"
    } else {
        "write_failed"
    };
    (code.to_string(), error.to_string())
}

fn candidate_output_path(
    directory: &Path,
    requested_filename: &str,
    suffix: u32,
) -> (PathBuf, String) {
    if suffix == 0 {
        return (
            directory.join(requested_filename),
            requested_filename.to_string(),
        );
    }
    let path = Path::new(requested_filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("screenshot");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let filename = format!("{}-{}.{}", stem, suffix, extension);
    (directory.join(&filename), filename)
}

/// Publish a fully-written image without clobbering an existing capture. A
/// same-directory hard link makes the complete temp inode visible atomically;
/// filesystems without hard-link support fall back to a no-clobber direct write.
pub(crate) fn write_unique_file_atomically(
    directory: &Path,
    requested_filename: &str,
    bytes: &[u8],
) -> Result<(PathBuf, String), (String, String)> {
    let (temp_path, mut temp_file) = loop {
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp_path = directory.join(format!(
            ".scrcpy-gui-screenshot-{}-{}.part",
            std::process::id(),
            sequence
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => break (temp_path, file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(io_error(error)),
        }
    };

    if let Err(error) = temp_file
        .write_all(bytes)
        .and_then(|_| temp_file.sync_all())
    {
        let _ = std::fs::remove_file(&temp_path);
        return Err(io_error(error));
    }
    drop(temp_file);

    for suffix in 0..10_000 {
        let (candidate, filename) = candidate_output_path(directory, requested_filename, suffix);
        match std::fs::hard_link(&temp_path, &candidate) {
            Ok(()) => {
                let _ = std::fs::remove_file(&temp_path);
                return Ok((candidate, filename));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                let mut destination = match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&candidate)
                {
                    Ok(file) => file,
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        let _ = std::fs::remove_file(&temp_path);
                        return Err(io_error(error));
                    }
                };
                if let Err(error) = destination
                    .write_all(bytes)
                    .and_then(|_| destination.sync_all())
                {
                    drop(destination);
                    let _ = std::fs::remove_file(&candidate);
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(io_error(error));
                }
                let _ = std::fs::remove_file(&temp_path);
                return Ok((candidate, filename));
            }
        }
    }

    let _ = std::fs::remove_file(&temp_path);
    Err((
        "write_failed".to_string(),
        "Could not reserve a unique screenshot filename".to_string(),
    ))
}

fn stitch_pieces(width: u32, pieces: &[RgbaImage]) -> Result<RgbaImage, (String, String)> {
    let total_height = pieces
        .iter()
        .try_fold(0u32, |height, piece| height.checked_add(piece.height()));
    let Some(total_height) = total_height else {
        return Err((
            "size_limit".to_string(),
            "The stitched screenshot is too tall".to_string(),
        ));
    };
    if width as u64 * total_height as u64 > MAX_SCROLL_PIXELS {
        return Err((
            "size_limit".to_string(),
            "The stitched screenshot exceeded the safe image-size limit".to_string(),
        ));
    }

    let mut stitched = RgbaImage::new(width, total_height);
    let mut y = 0u32;
    for piece in pieces {
        imageops::replace(&mut stitched, piece, 0, i64::from(y));
        y += piece.height();
    }
    Ok(stitched)
}

/// Return the default screenshot directory path (created on demand).
#[tauri::command]
pub async fn get_default_screenshot_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let base = app_handle
        .path()
        .picture_dir()
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|e| e.to_string())?;
    let dir = resolve_screenshot_dir(None, &base)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Capture a screenshot from the given device and persist it as a PNG file.
#[tauri::command]
pub async fn capture_screenshot(
    app_handle: tauri::AppHandle,
    request: ScreenshotRequest,
) -> ScreenshotResult {
    let captured_at = now_iso();
    let serial = request.device_serial.trim();

    if let Err(error) = adb::validate_serial(serial) {
        return ScreenshotResult::failure(serial, &captured_at, &error);
    }

    let directory = match resolve_output_dir(&app_handle, request.output_dir.as_deref()) {
        Ok(directory) => directory,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let bytes =
        match capture_png_frame(serial, request.custom_path.clone(), SCREENSHOT_TIMEOUT_SECS).await
        {
            Ok(bytes) => bytes,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };

    let device_name = request
        .device_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(serial);
    let requested_filename = build_screenshot_filename(device_name, serial, &now_timestamp());
    let (full_path, filename) =
        match write_unique_file_atomically(&directory, &requested_filename, &bytes) {
            Ok(saved) => saved,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };

    ScreenshotResult {
        success: true,
        path: full_path.to_string_lossy().to_string(),
        filename,
        device_serial: serial.to_string(),
        captured_at,
        device_name: Some(device_name.to_string()),
        source_kind: Some("android-adb".to_string()),
        source_id: Some(serial.to_string()),
        source_name: Some(device_name.to_string()),
        capture_kind: Some("screen".to_string()),
        segment_count: Some(1),
        width: None,
        height: None,
        complete: Some(true),
        termination_reason: None,
        error: None,
        error_code: None,
    }
}

/// Capture a vertically scrollable Android view by swiping and stitching the
/// non-overlapping part of each frame. The gesture changes the device's actual
/// scroll position and intentionally stops at the final captured position.
#[tauri::command]
pub async fn capture_scroll_screenshot(
    app_handle: tauri::AppHandle,
    request: ScrollScreenshotRequest,
) -> ScreenshotResult {
    let captured_at = now_iso();
    let serial = request.device_serial.trim();
    if let Err(error) = adb::validate_serial(serial) {
        return ScreenshotResult::failure(serial, &captured_at, &error);
    }

    let directory = match resolve_output_dir(&app_handle, request.output_dir.as_deref()) {
        Ok(directory) => directory,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    capture_scroll_screenshot_to_directory(request, directory, captured_at).await
}

/// Device-facing capture core shared by the Tauri command and the opt-in
/// hardware smoke test. Keeping this below the command ensures both paths use
/// exactly the same ADB, alignment, stitching, and persistence implementation.
async fn capture_scroll_screenshot_to_directory(
    request: ScrollScreenshotRequest,
    directory: PathBuf,
    captured_at: String,
) -> ScreenshotResult {
    let serial = request.device_serial.trim();
    let max_segments = request
        .max_segments
        .unwrap_or(DEFAULT_SCROLL_SEGMENTS)
        .clamp(MIN_SCROLL_SEGMENTS, MAX_SCROLL_SEGMENTS);
    let delay_ms = request
        .scroll_delay_ms
        .unwrap_or(DEFAULT_SCROLL_DELAY_MS)
        .clamp(MIN_SCROLL_DELAY_MS, MAX_SCROLL_DELAY_MS);

    let first_bytes =
        match capture_png_frame(serial, request.custom_path.clone(), SCREENSHOT_TIMEOUT_SECS).await
        {
            Ok(bytes) => bytes,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };
    let mut previous = match decode_png_frame(&first_bytes) {
        Ok(frame) => frame,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let (width, frame_height) = previous.dimensions();
    let Some((content_top, content_bottom)) = content_bounds(frame_height) else {
        return ScreenshotResult::failure_msg(
            serial,
            &captured_at,
            "size_limit",
            "The device frame is too small for scroll capture".to_string(),
        );
    };

    let mut pieces = vec![previous.view(0, 0, width, content_bottom).to_image()];
    let mut footer = previous
        .view(0, content_bottom, width, frame_height - content_bottom)
        .to_image();
    let mut segment_count = 1u32;
    let mut complete = false;
    let mut termination_reason = "segment_limit".to_string();

    for _ in 1..max_segments {
        if let Err((code, message)) =
            swipe_for_scroll(serial, width, frame_height, request.custom_path.clone()).await
        {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message);
        }
        sleep(Duration::from_millis(delay_ms)).await;

        let bytes =
            match capture_png_frame(serial, request.custom_path.clone(), SCREENSHOT_TIMEOUT_SECS)
                .await
            {
                Ok(bytes) => bytes,
                Err((code, message)) => {
                    return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
                }
            };
        let current = match decode_png_frame(&bytes) {
            Ok(frame) => frame,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };
        if current.dimensions() != (width, frame_height) {
            return ScreenshotResult::failure_msg(
                serial,
                &captured_at,
                "dimension_changed",
                "Screen dimensions changed during scroll capture".to_string(),
            );
        }

        let Some((overlap, _score)) =
            find_vertical_overlap(&previous, &current, content_top, content_bottom)
        else {
            // Only declare the end after alignment finds no movement. This
            // keeps a small but valid final scroll from being averaged away.
            if frames_are_nearly_identical(&previous, &current, content_top, content_bottom) {
                if segment_count == 1 {
                    return ScreenshotResult::failure_msg(
                        serial,
                        &captured_at,
                        "not_scrollable",
                        "The current screen did not move after the scroll gesture".to_string(),
                    );
                }
                footer = current
                    .view(0, content_bottom, width, frame_height - content_bottom)
                    .to_image();
                complete = true;
                termination_reason = "content_end".to_string();
                break;
            }
            if segment_count == 1 {
                return ScreenshotResult::failure_msg(
                    serial,
                    &captured_at,
                    "no_overlap",
                    "Could not align the screen after scrolling".to_string(),
                );
            }
            termination_reason = "alignment_lost".to_string();
            break;
        };

        let new_rows_start = content_top + overlap;
        let new_rows = content_bottom.saturating_sub(new_rows_start);
        if new_rows == 0 {
            complete = true;
            termination_reason = "content_end".to_string();
            break;
        }
        let minimum_new_rows = (frame_height.saturating_mul(3) / 100).max(8);
        if segment_count == 1 && new_rows < minimum_new_rows {
            return ScreenshotResult::failure_msg(
                serial,
                &captured_at,
                "not_scrollable",
                "The current screen moved only within the overscroll tolerance".to_string(),
            );
        }

        let projected_height = pieces
            .iter()
            .map(RgbaImage::height)
            .map(u64::from)
            .sum::<u64>()
            .saturating_add(u64::from(new_rows))
            .saturating_add(u64::from(frame_height - content_bottom));
        if u64::from(width).saturating_mul(projected_height) > MAX_SCROLL_PIXELS {
            return ScreenshotResult::failure_msg(
                serial,
                &captured_at,
                "size_limit",
                "The stitched screenshot exceeded the safe image-size limit".to_string(),
            );
        }

        // Append every confidently aligned tail, even a short final movement.
        pieces.push(current.view(0, new_rows_start, width, new_rows).to_image());
        footer = current
            .view(0, content_bottom, width, frame_height - content_bottom)
            .to_image();
        segment_count += 1;

        let minimum_new_rows = (frame_height.saturating_mul(3) / 100).max(8);
        if new_rows < minimum_new_rows {
            complete = true;
            termination_reason = "content_end".to_string();
            break;
        }
        previous = current;
    }

    if footer.height() > 0 {
        pieces.push(footer);
    }
    let stitched = match stitch_pieces(width, &pieces) {
        Ok(image) => image,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let stitched_height = stitched.height();
    let mut cursor = Cursor::new(Vec::new());
    if let Err(error) = DynamicImage::ImageRgba8(stitched).write_to(&mut cursor, ImageFormat::Png) {
        return ScreenshotResult::failure_msg(
            serial,
            &captured_at,
            "encode_failed",
            error.to_string(),
        );
    }

    let device_name = request
        .device_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(serial);
    let requested_filename =
        build_scroll_screenshot_filename(device_name, serial, &now_scroll_timestamp());
    let encoded = cursor.into_inner();
    let (full_path, filename) =
        match write_unique_file_atomically(&directory, &requested_filename, &encoded) {
            Ok(saved) => saved,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };

    ScreenshotResult {
        success: true,
        path: full_path.to_string_lossy().to_string(),
        filename,
        device_serial: serial.to_string(),
        captured_at,
        device_name: Some(device_name.to_string()),
        source_kind: Some("android-adb".to_string()),
        source_id: Some(serial.to_string()),
        source_name: Some(device_name.to_string()),
        capture_kind: Some("scroll".to_string()),
        segment_count: Some(segment_count),
        width: Some(width),
        height: Some(stitched_height),
        complete: Some(complete),
        termination_reason: Some(termination_reason),
        error: None,
        error_code: None,
    }
}

fn decode_external_image_data(value: &str) -> Result<Vec<u8>, (String, String)> {
    let encoded = value
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(value)
        .trim();
    if encoded.is_empty() {
        return Err((
            "empty_image".to_string(),
            "The external capture frame was empty".to_string(),
        ));
    }
    STANDARD.decode(encoded).map_err(|error| {
        (
            "invalid_image_data".to_string(),
            format!("Could not decode the external capture frame: {error}"),
        )
    })
}

/// Save a single PNG/JPEG frame produced by a non-ADB live source.
///
/// The image is decoded with the same bounded image limits used by Android
/// capture and normalized to PNG before being written atomically. This keeps
/// Companion JPEG frames and browser canvas PNG frames on one history path.
#[tauri::command]
pub async fn save_external_screenshot(
    app_handle: tauri::AppHandle,
    request: ExternalScreenshotRequest,
) -> ScreenshotResult {
    let captured_at = now_iso();
    let serial = request.device_serial.trim();
    if serial.is_empty() {
        return ScreenshotResult::failure_msg(
            serial,
            &captured_at,
            "no_source",
            "No external screen source was selected".to_string(),
        );
    }

    let directory = match resolve_output_dir(&app_handle, request.output_dir.as_deref()) {
        Ok(directory) => directory,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let raw_bytes = match decode_external_image_data(&request.image_data) {
        Ok(bytes) => bytes,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let frame = match decode_image_frame(&raw_bytes) {
        Ok(frame) => frame,
        Err((code, message)) => {
            return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
        }
    };
    let (width, height) = frame.dimensions();
    let mut cursor = Cursor::new(Vec::new());
    if let Err(error) = DynamicImage::ImageRgba8(frame).write_to(&mut cursor, ImageFormat::Png) {
        return ScreenshotResult::failure_msg(
            serial,
            &captured_at,
            "encode_failed",
            error.to_string(),
        );
    }

    let device_name = request
        .device_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(serial);
    let requested_filename = build_screenshot_filename(device_name, serial, &now_timestamp());
    let (full_path, filename) =
        match write_unique_file_atomically(&directory, &requested_filename, &cursor.into_inner()) {
            Ok(saved) => saved,
            Err((code, message)) => {
                return ScreenshotResult::failure_msg(serial, &captured_at, &code, message)
            }
        };

    ScreenshotResult {
        success: true,
        path: full_path.to_string_lossy().to_string(),
        filename,
        device_serial: serial.to_string(),
        captured_at,
        device_name: Some(device_name.to_string()),
        source_kind: Some(request.source_kind),
        source_id: Some(request.source_id.unwrap_or_else(|| serial.to_string())),
        source_name: Some(
            request
                .source_name
                .unwrap_or_else(|| device_name.to_string()),
        ),
        capture_kind: Some("screen".to_string()),
        segment_count: Some(1),
        width: Some(width),
        height: Some(height),
        complete: Some(true),
        termination_reason: None,
        error: None,
        error_code: None,
    }
}

/// Capture a single frame for the in-app live preview.
///
/// Reuses the same `adb exec-out screencap -p` path as the screenshot feature
/// but returns the PNG as a base64 string instead of writing it to disk.
#[tauri::command]
pub async fn capture_preview_frame(
    device_serial: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let serial = device_serial.trim();
    adb::validate_serial(serial).map_err(|error| error.message())?;
    let bytes = capture_png_frame(serial, custom_path, PREVIEW_TIMEOUT_SECS)
        .await
        .map_err(|(_, message)| message)?;
    Ok(STANDARD.encode(&bytes))
}

/// Delete a screenshot file (used when removing a history entry with the
/// "also delete file" option). Missing files are treated as success.
#[tauri::command]
pub async fn delete_screenshot_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_invalid_chars() {
        assert_eq!(sanitize_filename_component("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_filename_component("Pixel 7 Pro"), "Pixel_7_Pro");
        assert_eq!(
            sanitize_filename_component("weird<>:\"|?*name"),
            "weird_name"
        );
    }

    #[test]
    fn sanitize_collapses_and_trims() {
        assert_eq!(
            sanitize_filename_component("  spaced   out  "),
            "spaced_out"
        );
        assert_eq!(sanitize_filename_component("///"), "device");
        assert_eq!(sanitize_filename_component(""), "device");
        assert_eq!(sanitize_filename_component("...dots..."), "dots");
    }

    #[test]
    fn build_filename_matches_format() {
        let f = build_screenshot_filename("Pixel 7", "ABC123", "2026-07-16_10-30-00");
        assert_eq!(f, "Pixel_7_ABC123_2026-07-16_10-30-00.png");
    }

    #[test]
    fn build_filename_sanitizes_network_serial() {
        let f = build_screenshot_filename("Tablet", "192.168.1.5:5555", "2026-07-16_10-30-00");
        assert_eq!(f, "Tablet_192.168.1.5_5555_2026-07-16_10-30-00.png");
    }

    #[test]
    fn validate_png_signature() {
        let mut good = PNG_SIGNATURE.to_vec();
        good.extend_from_slice(&[0u8; 32]);
        assert!(validate_png(&good));

        assert!(!validate_png(&[]));
        assert!(!validate_png(b"not a png at all"));
        assert!(!validate_png(&PNG_SIGNATURE));
    }

    #[test]
    fn resolve_dir_defaults_to_scrcpygui() {
        let tmp = std::env::temp_dir().join(format!("scrcpygui_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let dir = resolve_screenshot_dir(None, &tmp).unwrap();
        assert!(dir.ends_with("ScrcpyGUI"));
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_dir_uses_custom_when_provided() {
        let tmp = std::env::temp_dir().join(format!("scrcpygui_custom_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let custom = tmp.to_string_lossy().to_string();
        let dir = resolve_screenshot_dir(Some(&custom), Path::new("/nonexistent")).unwrap();
        assert_eq!(dir, tmp);
        assert!(dir.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Opt-in real-device verification. This is ignored in normal CI because
    /// it captures and swipes the currently visible Android screen.
    #[tokio::test]
    #[ignore = "requires SCRCPY_GUI_E2E_SERIAL and a prepared scrollable screen"]
    async fn real_device_scroll_capture_smoke() {
        let serial = std::env::var("SCRCPY_GUI_E2E_SERIAL")
            .expect("SCRCPY_GUI_E2E_SERIAL must identify an attached Android device");
        let output_dir = PathBuf::from(
            std::env::var("SCRCPY_GUI_E2E_OUTPUT_DIR")
                .expect("SCRCPY_GUI_E2E_OUTPUT_DIR must be an existing directory"),
        );
        assert!(output_dir.is_dir(), "E2E output directory does not exist");
        adb::validate_serial(&serial).expect("E2E serial is invalid");

        let result = capture_scroll_screenshot_to_directory(
            ScrollScreenshotRequest {
                device_serial: serial,
                device_name: Some("ELS_NX9_E2E".to_string()),
                output_dir: None,
                custom_path: None,
                max_segments: Some(MAX_SCROLL_SEGMENTS),
                scroll_delay_ms: Some(800),
            },
            output_dir,
            now_iso(),
        )
        .await;

        println!(
            "E2E_RESULT success={} path={} segments={:?} width={:?} height={:?} complete={:?} termination={:?} error_code={:?} error={:?}",
            result.success,
            result.path,
            result.segment_count,
            result.width,
            result.height,
            result.complete,
            result.termination_reason,
            result.error_code,
            result.error,
        );
        assert!(
            result.success,
            "real-device scroll capture failed: {:?} {:?}",
            result.error_code, result.error
        );
        assert_eq!(result.capture_kind.as_deref(), Some("scroll"));
        assert!(result.segment_count.unwrap_or(0) >= 2);
        if let Ok(minimum_height) = std::env::var("SCRCPY_GUI_E2E_MIN_HEIGHT") {
            let minimum_height: u32 = minimum_height.parse().unwrap();
            assert!(result.height.unwrap_or(0) > minimum_height);
        }
    }
}
