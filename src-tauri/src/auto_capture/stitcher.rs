use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{imageops, DynamicImage, GenericImageView, ImageFormat, RgbaImage};
use std::io::Cursor;
use std::path::{Path, PathBuf};

use crate::screenshot::{sanitize_filename_component, write_unique_file_atomically};

use super::model::{
    AutoCaptureError, AutoCaptureErrorCode, AutoCaptureResult, CaptureRegion, CAPTURE_SOURCE_ADB,
};

#[derive(Debug)]
pub struct BuiltLongScreenshot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Stores only accepted, non-overlapping RGBA segments. It checks frame,
/// height, and memory budgets before each crop and allocates the final canvas
/// exactly once during PNG encoding.
pub struct LongScreenshotBuilder {
    width: u32,
    max_frames: u32,
    max_height: u32,
    max_memory_bytes: u64,
    segments: Vec<RgbaImage>,
    total_height: u32,
    stored_bytes: u64,
    accepted_frames: u32,
}

impl LongScreenshotBuilder {
    pub fn new(width: u32, max_frames: u32, max_height: u32, max_memory_mb: u32) -> Self {
        Self {
            width,
            max_frames,
            max_height,
            max_memory_bytes: u64::from(max_memory_mb) * 1024 * 1024,
            segments: Vec::new(),
            total_height: 0,
            stored_bytes: 0,
            accepted_frames: 0,
        }
    }

    pub fn add_region(
        &mut self,
        frame: &RgbaImage,
        region: CaptureRegion,
    ) -> Result<(), AutoCaptureError> {
        let region = region
            .clamp_to(frame.width(), frame.height())
            .ok_or_else(|| {
                AutoCaptureError::new(
                    AutoCaptureErrorCode::ImageProcessingFailed,
                    "The selected capture region is empty",
                )
            })?;
        let segment = frame
            .view(region.left, region.top, region.width(), region.height())
            .to_image();
        self.add_segment(segment)
    }

    /// Adds a preprocessed tail whose width already matches the stitch canvas.
    /// This is used when a caller needs to conceal a viewport-fixed overlay
    /// before the segment becomes part of the final panorama.
    pub fn add_segment(&mut self, segment: RgbaImage) -> Result<(), AutoCaptureError> {
        if segment.width() != self.width {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::DimensionChanged,
                "Capture segment width changed during stitching",
                format!("expected {}, got {}", self.width, segment.width()),
            ));
        }
        if self.accepted_frames >= self.max_frames {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::CaptureLimitReached,
                "The configured frame limit was reached",
            ));
        }
        self.ensure_segment_budget(segment.height())?;
        self.stored_bytes += rgba_bytes(segment.width(), segment.height());
        self.total_height += segment.height();
        self.accepted_frames += 1;
        self.segments.push(segment);
        Ok(())
    }

    pub fn replace_first_region(
        &mut self,
        frame: &RgbaImage,
        region: CaptureRegion,
    ) -> Result<(), AutoCaptureError> {
        if self.segments.is_empty() {
            return self.add_region(frame, region);
        }
        let region = region
            .clamp_to(frame.width(), frame.height())
            .ok_or_else(|| {
                AutoCaptureError::new(
                    AutoCaptureErrorCode::ImageProcessingFailed,
                    "The fixed-region crop is empty",
                )
            })?;
        if region.width() != self.width {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::DimensionChanged,
                "Fixed-region width differs from the stitch width",
            ));
        }
        let old_height = self.segments[0].height();
        let new_total = self
            .total_height
            .saturating_sub(old_height)
            .saturating_add(region.height());
        let old_bytes = rgba_bytes(self.segments[0].width(), old_height);
        let new_bytes = rgba_bytes(region.width(), region.height());
        let new_stored = self
            .stored_bytes
            .saturating_sub(old_bytes)
            .saturating_add(new_bytes);
        self.ensure_totals(new_total, new_stored)?;
        self.segments[0] = frame
            .view(region.left, region.top, region.width(), region.height())
            .to_image();
        self.total_height = new_total;
        self.stored_bytes = new_stored;
        Ok(())
    }

    fn ensure_segment_budget(&self, additional_height: u32) -> Result<(), AutoCaptureError> {
        let total_height = self
            .total_height
            .checked_add(additional_height)
            .ok_or_else(output_too_large)?;
        let stored_bytes = self
            .stored_bytes
            .checked_add(rgba_bytes(self.width, additional_height))
            .ok_or_else(output_too_large)?;
        self.ensure_totals(total_height, stored_bytes)
    }

    fn ensure_totals(&self, total_height: u32, stored_bytes: u64) -> Result<(), AutoCaptureError> {
        if total_height > self.max_height {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::OutputTooLarge,
                "The stitched screenshot would exceed maxHeight",
                format!("{} > {} pixels", total_height, self.max_height),
            ));
        }
        let final_canvas_bytes = rgba_bytes(self.width, total_height);
        if stored_bytes.saturating_add(final_canvas_bytes) > self.max_memory_bytes {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::OutputTooLarge,
                "The stitched screenshot would exceed maxMemoryMb",
                format!(
                    "{} bytes needed, {} bytes allowed",
                    stored_bytes.saturating_add(final_canvas_bytes),
                    self.max_memory_bytes
                ),
            ));
        }
        Ok(())
    }

    pub fn total_height(&self) -> u32 {
        self.total_height
    }

    pub fn accepted_frames(&self) -> u32 {
        self.accepted_frames
    }

    pub fn stored_bytes(&self) -> u64 {
        self.stored_bytes
    }

    #[cfg(test)]
    pub fn build_png(self) -> Result<BuiltLongScreenshot, AutoCaptureError> {
        self.build_png_with_external_bytes(0)
    }

    #[cfg(test)]
    pub fn build_png_with_external_bytes(
        self,
        external_bytes: u64,
    ) -> Result<BuiltLongScreenshot, AutoCaptureError> {
        self.build_png_with_edge_regions(None, None, external_bytes)
    }

    /// Builds the panorama from body-only segments and optional edge regions
    /// sourced from raw frames. Edge regions are copied directly into the
    /// final canvas; they are never used for overlap matching and never need
    /// to be stored as cropped frame replacements.
    pub fn build_png_with_edge_regions(
        self,
        fixed_top: Option<(&RgbaImage, CaptureRegion)>,
        fixed_bottom: Option<(&RgbaImage, CaptureRegion)>,
        external_bytes: u64,
    ) -> Result<BuiltLongScreenshot, AutoCaptureError> {
        let edge_height = fixed_top
            .map(|(_, region)| region.height())
            .unwrap_or(0)
            .saturating_add(fixed_bottom.map(|(_, region)| region.height()).unwrap_or(0));
        let final_height = self
            .total_height
            .checked_add(edge_height)
            .ok_or_else(output_too_large)?;
        let final_canvas_bytes = rgba_bytes(self.width, final_height);
        let projected_peak = self
            .stored_bytes
            .saturating_add(final_canvas_bytes.saturating_mul(2))
            .saturating_add(external_bytes);
        if projected_peak > self.max_memory_bytes {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::OutputTooLarge,
                "Final PNG encoding would exceed maxMemoryMb",
                format!(
                    "{} bytes needed, {} bytes allowed",
                    projected_peak, self.max_memory_bytes
                ),
            ));
        }
        if self.segments.is_empty() || self.total_height == 0 {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::ImageProcessingFailed,
                "No usable frames were captured",
            ));
        }
        self.ensure_totals(final_height, self.stored_bytes)?;
        for (frame, region) in [fixed_top, fixed_bottom].into_iter().flatten() {
            let valid = region
                .clamp_to(frame.width(), frame.height())
                .is_some_and(|region| region.width() == self.width);
            if !valid {
                return Err(AutoCaptureError::new(
                    AutoCaptureErrorCode::DimensionChanged,
                    "Fixed edge region differs from the stitch width",
                ));
            }
        }

        let mut stitched = RgbaImage::new(self.width, final_height);
        let mut y = 0u32;
        if let Some((frame, region)) = fixed_top {
            copy_region(&mut stitched, frame, region, 0);
            y = y.saturating_add(region.height());
        }
        for segment in self.segments {
            imageops::replace(&mut stitched, &segment, 0, i64::from(y));
            y = y.saturating_add(segment.height());
        }
        if let Some((frame, region)) = fixed_bottom {
            copy_region(&mut stitched, frame, region, y);
        }
        let mut cursor = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(stitched)
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|error| {
                AutoCaptureError::with_details(
                    AutoCaptureErrorCode::ImageProcessingFailed,
                    "Could not encode the long screenshot",
                    error.to_string(),
                )
            })?;
        Ok(BuiltLongScreenshot {
            png: cursor.into_inner(),
            width: self.width,
            height: final_height,
        })
    }
}

fn copy_region(
    destination: &mut RgbaImage,
    source: &RgbaImage,
    region: CaptureRegion,
    destination_y: u32,
) {
    for y in 0..region.height() {
        for x in 0..region.width() {
            *destination.get_pixel_mut(x, destination_y + y) =
                *source.get_pixel(region.left + x, region.top + y);
        }
    }
}

pub fn encode_rgba_png(image: RgbaImage) -> Result<Vec<u8>, AutoCaptureError> {
    let mut cursor = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| {
            AutoCaptureError::with_details(
                AutoCaptureErrorCode::ImageProcessingFailed,
                "Could not encode a PNG frame",
                error.to_string(),
            )
        })?;
    Ok(cursor.into_inner())
}

fn rgba_bytes(width: u32, height: u32) -> u64 {
    u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(4)
}

fn output_too_large() -> AutoCaptureError {
    AutoCaptureError::new(
        AutoCaptureErrorCode::OutputTooLarge,
        "The stitched screenshot size overflowed",
    )
}

pub fn thumbnail_data_url(frame: &RgbaImage) -> Result<String, AutoCaptureError> {
    let thumbnail = imageops::thumbnail(frame, 120, 200);
    let mut cursor = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(thumbnail)
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| {
            AutoCaptureError::with_details(
                AutoCaptureErrorCode::ImageProcessingFailed,
                "Could not encode the frame thumbnail",
                error.to_string(),
            )
        })?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(cursor.into_inner())
    ))
}

#[derive(Debug)]
pub struct SavedCapture {
    pub result: AutoCaptureResult,
    cleanup_path: PathBuf,
    cleanup_is_directory: bool,
}

impl SavedCapture {
    pub fn discard(&self) {
        if self.cleanup_is_directory {
            let _ = std::fs::remove_dir_all(&self.cleanup_path);
        } else {
            let _ = std::fs::remove_file(&self.cleanup_path);
        }
    }
}

pub struct ExportCaptureRequest<'a> {
    pub output_directory: &'a Path,
    pub session_id: &'a str,
    pub device_name: &'a str,
    pub device_id: &'a str,
    pub final_png: &'a [u8],
    pub width: u32,
    pub height: u32,
    pub capture_count: u32,
    pub complete: bool,
    pub individual_frames: &'a [Vec<u8>],
    pub save_individual_frames: bool,
}

pub fn export_capture(request: ExportCaptureRequest<'_>) -> Result<SavedCapture, AutoCaptureError> {
    if request.save_individual_frames {
        export_capture_session_directory(request)
    } else {
        let device = sanitize_filename_component(request.device_name);
        let serial = sanitize_filename_component(request.device_id);
        let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S-%3f");
        let requested_filename = format!("{device}_{serial}_auto_{timestamp}.png");
        let (path, filename) = write_unique_file_atomically(
            request.output_directory,
            &requested_filename,
            request.final_png,
        )
        .map_err(map_output_error)?;
        Ok(SavedCapture {
            cleanup_path: path.clone(),
            cleanup_is_directory: false,
            result: AutoCaptureResult {
                path: path.to_string_lossy().to_string(),
                filename,
                width: request.width,
                height: request.height,
                capture_count: request.capture_count,
                complete: request.complete,
                partial: !request.complete,
                capture_source: CAPTURE_SOURCE_ADB.to_string(),
                individual_frames: Vec::new(),
            },
        })
    }
}

fn export_capture_session_directory(
    request: ExportCaptureRequest<'_>,
) -> Result<SavedCapture, AutoCaptureError> {
    let directory_name = format!(
        "capture-session-{}",
        sanitize_filename_component(request.session_id)
    );
    let directory = request.output_directory.join(directory_name);
    std::fs::create_dir(&directory).map_err(|error| {
        AutoCaptureError::with_details(
            AutoCaptureErrorCode::ImageProcessingFailed,
            "Could not create the capture-session output directory",
            error.to_string(),
        )
    })?;

    let write_result = (|| {
        let mut individual_paths = Vec::with_capacity(request.individual_frames.len());
        for (index, frame) in request.individual_frames.iter().enumerate() {
            let filename = format!("frame-{:03}.png", index + 1);
            let (path, _) = write_unique_file_atomically(&directory, &filename, frame)
                .map_err(map_output_error)?;
            individual_paths.push(path.to_string_lossy().to_string());
        }
        let (final_path, filename) =
            write_unique_file_atomically(&directory, "final.png", request.final_png)
                .map_err(map_output_error)?;
        Ok::<_, AutoCaptureError>((final_path, filename, individual_paths))
    })();

    match write_result {
        Ok((final_path, filename, individual_paths)) => Ok(SavedCapture {
            cleanup_path: directory,
            cleanup_is_directory: true,
            result: AutoCaptureResult {
                path: final_path.to_string_lossy().to_string(),
                filename,
                width: request.width,
                height: request.height,
                capture_count: request.capture_count,
                complete: request.complete,
                partial: !request.complete,
                capture_source: CAPTURE_SOURCE_ADB.to_string(),
                individual_frames: individual_paths,
            },
        }),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&directory);
            Err(error)
        }
    }
}

fn map_output_error((code, message): (String, String)) -> AutoCaptureError {
    AutoCaptureError::with_details(
        AutoCaptureErrorCode::ImageProcessingFailed,
        "Could not save the auto-capture output",
        format!("{code}: {message}"),
    )
}

#[cfg(test)]
mod tests {
    use image::Rgba;

    use super::*;

    fn frame(width: u32, height: u32, seed: u8) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            Rgba([
                seed.wrapping_add(x as u8),
                seed.wrapping_add(y as u8),
                seed,
                255,
            ])
        })
    }

    fn decode(png: &[u8]) -> RgbaImage {
        image::load_from_memory_with_format(png, ImageFormat::Png)
            .unwrap()
            .into_rgba8()
    }

    #[test]
    fn builder_stitches_two_frames_once() {
        let first = frame(20, 100, 1);
        let second = frame(20, 100, 2);
        let mut builder = LongScreenshotBuilder::new(20, 30, 1_000, 16);
        builder
            .add_region(
                &first,
                CaptureRegion {
                    left: 0,
                    top: 0,
                    right: 20,
                    bottom: 100,
                },
            )
            .unwrap();
        builder
            .add_region(
                &second,
                CaptureRegion {
                    left: 0,
                    top: 60,
                    right: 20,
                    bottom: 100,
                },
            )
            .unwrap();
        assert_eq!(builder.accepted_frames(), 2);
        let built = builder.build_png().unwrap();
        assert_eq!((built.width, built.height), (20, 140));
        assert_eq!(decode(&built.png).height(), 140);
    }

    #[test]
    fn builder_preserves_preprocessed_tail_pixels() {
        let first = RgbaImage::from_pixel(8, 8, Rgba([20, 20, 20, 255]));
        let mut cleaned_tail = RgbaImage::from_pixel(8, 8, Rgba([40, 40, 40, 255]));
        cleaned_tail.put_pixel(3, 3, Rgba([90, 100, 110, 255]));
        let mut builder = LongScreenshotBuilder::new(8, 4, 100, 16);
        builder
            .add_region(
                &first,
                CaptureRegion {
                    left: 0,
                    top: 0,
                    right: 8,
                    bottom: 8,
                },
            )
            .unwrap();
        builder.add_segment(cleaned_tail).unwrap();

        let built = builder.build_png().unwrap();
        let stitched = decode(&built.png);
        assert_eq!((stitched.width(), stitched.height()), (8, 16));
        assert_eq!(stitched.get_pixel(3, 11).0, [90, 100, 110, 255]);
    }

    #[test]
    fn builder_supports_multiple_overlap_sizes() {
        let source = frame(16, 120, 9);
        let mut builder = LongScreenshotBuilder::new(16, 10, 1_000, 16);
        for (top, expected_height) in [(0, 120), (80, 160), (50, 230)] {
            builder
                .add_region(
                    &source,
                    CaptureRegion {
                        left: 0,
                        top,
                        right: 16,
                        bottom: 120,
                    },
                )
                .unwrap();
            assert_eq!(builder.total_height(), expected_height);
        }
    }

    #[test]
    fn builder_can_remove_a_fixed_header_from_first_frame() {
        let source = frame(20, 100, 3);
        let mut builder = LongScreenshotBuilder::new(20, 10, 1_000, 16);
        builder
            .add_region(
                &source,
                CaptureRegion {
                    left: 0,
                    top: 0,
                    right: 20,
                    bottom: 100,
                },
            )
            .unwrap();
        builder
            .replace_first_region(
                &source,
                CaptureRegion {
                    left: 0,
                    top: 20,
                    right: 20,
                    bottom: 100,
                },
            )
            .unwrap();
        assert_eq!(builder.total_height(), 80);
    }

    #[test]
    fn builder_enforces_frame_height_and_memory_limits() {
        let source = frame(100, 100, 4);
        let region = CaptureRegion {
            left: 0,
            top: 0,
            right: 100,
            bottom: 100,
        };
        let mut frame_limited = LongScreenshotBuilder::new(100, 1, 1_000, 16);
        frame_limited.add_region(&source, region).unwrap();
        assert_eq!(
            frame_limited.add_region(&source, region).unwrap_err().code,
            AutoCaptureErrorCode::CaptureLimitReached
        );

        let mut height_limited = LongScreenshotBuilder::new(100, 10, 150, 16);
        height_limited.add_region(&source, region).unwrap();
        assert_eq!(
            height_limited.add_region(&source, region).unwrap_err().code,
            AutoCaptureErrorCode::OutputTooLarge
        );

        let large = frame(1024, 1024, 7);
        let mut memory_limited = LongScreenshotBuilder::new(1024, 10, 10_000, 16);
        memory_limited
            .add_region(
                &large,
                CaptureRegion {
                    left: 0,
                    top: 0,
                    right: 1024,
                    bottom: 1024,
                },
            )
            .unwrap();
        memory_limited
            .add_region(
                &large,
                CaptureRegion {
                    left: 0,
                    top: 0,
                    right: 1024,
                    bottom: 1024,
                },
            )
            .unwrap();
        assert_eq!(
            memory_limited
                .add_region(
                    &large,
                    CaptureRegion {
                        left: 0,
                        top: 0,
                        right: 1024,
                        bottom: 1024,
                    },
                )
                .unwrap_err()
                .code,
            AutoCaptureErrorCode::OutputTooLarge
        );

        let mut external_limited = LongScreenshotBuilder::new(100, 10, 1_000, 16);
        external_limited.add_region(&source, region).unwrap();
        assert_eq!(
            external_limited
                .build_png_with_external_bytes(16 * 1024 * 1024)
                .unwrap_err()
                .code,
            AutoCaptureErrorCode::OutputTooLarge
        );
    }

    #[test]
    fn thumbnail_is_small_png_data_url() {
        let data_url = thumbnail_data_url(&frame(1080, 2400, 1)).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
        assert!(data_url.len() < 200_000);
    }
}
