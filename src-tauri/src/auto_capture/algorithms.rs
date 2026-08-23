use image::{GenericImageView, RgbaImage};

use crate::screenshot::{find_vertical_overlap, frames_are_nearly_identical};

use super::model::{CaptureRegion, FixedBounds};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameComparison {
    pub score: f64,
    pub changed_ratio: f64,
}

/// Stratified frame comparison used by stability and end detection. The top
/// 15% of per-sample differences is discarded so a clock, spinner, or small
/// video tile does not keep an otherwise settled screen unstable forever.
pub struct FrameComparator;

impl FrameComparator {
    pub fn compare(
        first: &RgbaImage,
        second: &RgbaImage,
        region: CaptureRegion,
    ) -> Option<FrameComparison> {
        if first.dimensions() != second.dimensions() {
            return None;
        }
        let region = region.clamp_to(first.width(), first.height())?;
        let columns = 36u32.min(region.width()).max(1);
        let rows = 54u32.min(region.height()).max(1);
        let mut differences = Vec::with_capacity((columns * rows) as usize);
        for row in 0..rows {
            let y = region.top
                + ((u64::from(row) * u64::from(region.height().saturating_sub(1)))
                    / u64::from(rows.saturating_sub(1).max(1))) as u32;
            for column in 0..columns {
                let x = region.left
                    + ((u64::from(column) * u64::from(region.width().saturating_sub(1)))
                        / u64::from(columns.saturating_sub(1).max(1))) as u32;
                let a = first.get_pixel(x, y).0;
                let b = second.get_pixel(x, y).0;
                let difference = (0..3)
                    .map(|channel| f64::from(a[channel].abs_diff(b[channel])))
                    .sum::<f64>()
                    / 3.0;
                differences.push(difference);
            }
        }
        if differences.is_empty() {
            return None;
        }
        differences.sort_by(f64::total_cmp);
        let retained = ((differences.len() as f64) * 0.85).ceil() as usize;
        let retained = retained.clamp(1, differences.len());
        let score = differences[..retained].iter().sum::<f64>() / retained as f64;
        let changed_ratio = differences.iter().filter(|value| **value > 12.0).count() as f64
            / differences.len() as f64;
        Some(FrameComparison {
            score,
            changed_ratio,
        })
    }

    pub fn is_tolerantly_stable(comparison: FrameComparison, threshold: f64) -> bool {
        comparison.score <= threshold && comparison.changed_ratio <= 0.18
    }
}

#[derive(Clone, Debug)]
pub struct ScreenStabilityDetector {
    threshold: f64,
    required_samples: u32,
    consecutive_stable: u32,
}

impl ScreenStabilityDetector {
    pub fn new(threshold: f64, required_samples: u32) -> Self {
        Self {
            threshold,
            required_samples: required_samples.max(2),
            consecutive_stable: 0,
        }
    }

    pub fn observe(&mut self, comparison: FrameComparison) -> bool {
        if FrameComparator::is_tolerantly_stable(comparison, self.threshold) {
            self.consecutive_stable += 1;
        } else {
            self.consecutive_stable = 0;
        }
        self.consecutive_stable >= self.required_samples
    }

    #[cfg(test)]
    pub fn consecutive_stable(&self) -> u32 {
        self.consecutive_stable
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlapKind {
    Match,
    Identical,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OverlapResult {
    pub kind: OverlapKind,
    pub overlap_start: u32,
    pub overlap_end: u32,
    pub new_content_rows: u32,
    pub confidence: f64,
    pub score: f64,
}

pub struct OverlapDetector;

impl OverlapDetector {
    pub fn detect(
        previous: &RgbaImage,
        current: &RgbaImage,
        region: CaptureRegion,
    ) -> OverlapResult {
        if previous.dimensions() != current.dimensions() {
            return Self::none();
        }
        let Some(region) = region.clamp_to(previous.width(), previous.height()) else {
            return Self::none();
        };

        // The shared screenshot matcher derives its anchors and shift limits
        // from the supplied image dimensions. Localize every bounded pane in
        // both axes so those heuristics are relative to the effective capture
        // region, while retaining the allocation-free full-frame fast path.
        let is_full_frame = region.left == 0
            && region.top == 0
            && region.right == previous.width()
            && region.bottom == previous.height();
        let (previous_region, current_region);
        let (previous_ref, current_ref): (&RgbaImage, &RgbaImage) = if is_full_frame {
            (previous, current)
        } else {
            previous_region = previous
                .view(region.left, region.top, region.width(), region.height())
                .to_image();
            current_region = current
                .view(region.left, region.top, region.width(), region.height())
                .to_image();
            (&previous_region, &current_region)
        };
        let local_top = 0;
        let local_bottom = region.height();

        if frames_are_nearly_identical(previous_ref, current_ref, local_top, local_bottom) {
            return OverlapResult {
                kind: OverlapKind::Identical,
                overlap_start: region.top,
                overlap_end: region.bottom,
                new_content_rows: 0,
                confidence: 1.0,
                score: 0.0,
            };
        }

        let detected = find_vertical_overlap(previous_ref, current_ref, local_top, local_bottom)
            .map(|(overlap_rows, score)| (overlap_rows, score, 1.0))
            .or_else(|| Self::find_banded_overlap(previous_ref, current_ref));

        match detected {
            Some((overlap_rows, score, agreement)) => {
                let overlap_end = region.top.saturating_add(overlap_rows).min(region.bottom);
                let quality = (1.0 - score / 36.0).clamp(0.0, 1.0);
                OverlapResult {
                    kind: OverlapKind::Match,
                    overlap_start: region.top,
                    overlap_end,
                    new_content_rows: region.bottom.saturating_sub(overlap_end),
                    // A banded fallback is deliberately reported with lower
                    // confidence than a whole-pane match. Two independent
                    // bands agreeing is enough to recover a useful shift, but
                    // callers should still be able to distinguish it from the
                    // primary matcher in diagnostics.
                    confidence: (quality * (0.65 + 0.35 * agreement)).clamp(0.0, 1.0),
                    score,
                }
            }
            None => Self::none(),
        }
    }

    /// Retry alignment in independent vertical bands. A moving ad, video, or
    /// floating control can dominate the whole-pane score even though the
    /// document displacement is visible elsewhere. Requiring at least two
    /// bands to agree recovers that displacement without accepting a single
    /// accidental match from unrelated frames.
    fn find_banded_overlap(previous: &RgbaImage, current: &RgbaImage) -> Option<(u32, f64, f64)> {
        const BAND_COUNT: u32 = 4;
        const MIN_BAND_WIDTH: u32 = 32;
        const MIN_AGREEING_BANDS: usize = 2;

        if previous.dimensions() != current.dimensions() || previous.height() < 96 {
            return None;
        }
        let band_width = previous.width() / BAND_COUNT;
        if band_width < MIN_BAND_WIDTH {
            return None;
        }

        let mut candidates = Vec::with_capacity(BAND_COUNT as usize);
        for index in 0..BAND_COUNT {
            let left = index.saturating_mul(band_width);
            let right = if index + 1 == BAND_COUNT {
                previous.width()
            } else {
                left.saturating_add(band_width)
            };
            let width = right.saturating_sub(left);
            if width < MIN_BAND_WIDTH {
                continue;
            }

            let previous_band = previous.view(left, 0, width, previous.height()).to_image();
            let current_band = current.view(left, 0, width, current.height()).to_image();
            if let Some((overlap_rows, score)) =
                find_vertical_overlap(&previous_band, &current_band, 0, previous.height())
            {
                candidates.push((overlap_rows, score));
            }
        }
        if candidates.len() < MIN_AGREEING_BANDS {
            return None;
        }

        let tolerance = (previous.height() / 100).clamp(2, 12);
        let mut best_cluster: Vec<(u32, f64)> = Vec::new();
        let mut best_score = f64::MAX;
        for &(overlap_rows, _) in &candidates {
            let cluster: Vec<(u32, f64)> = candidates
                .iter()
                .copied()
                .filter(|(candidate, _)| candidate.abs_diff(overlap_rows) <= tolerance)
                .collect();
            let average_score =
                cluster.iter().map(|(_, score)| score).sum::<f64>() / cluster.len().max(1) as f64;
            if cluster.len() > best_cluster.len()
                || (cluster.len() == best_cluster.len() && average_score < best_score)
            {
                best_cluster = cluster;
                best_score = average_score;
            }
        }
        let contradictory_candidates = candidates.len().saturating_sub(best_cluster.len());
        if best_cluster.len() < MIN_AGREEING_BANDS || best_cluster.len() <= contradictory_candidates
        {
            // Never choose one side of a tied split-pane result (for example,
            // two bands moving with a nested scroller and two with the page).
            // Two-band recovery remains available when the other bands have
            // no usable texture, but every contradictory match must be a
            // strict minority.
            return None;
        }

        best_cluster.sort_by_key(|(overlap_rows, _)| *overlap_rows);
        let middle = best_cluster.len() / 2;
        let overlap_rows = if best_cluster.len() % 2 == 0 {
            best_cluster[middle - 1]
                .0
                .saturating_add(best_cluster[middle].0)
                / 2
        } else {
            best_cluster[middle].0
        };
        let agreement = best_cluster.len() as f64 / BAND_COUNT as f64;
        Some((overlap_rows, best_score, agreement))
    }

    fn none() -> OverlapResult {
        OverlapResult {
            kind: OverlapKind::None,
            overlap_start: 0,
            overlap_end: 0,
            new_content_rows: 0,
            confidence: 0.0,
            score: f64::MAX,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndObservation {
    Continuation,
    NoNewContent,
}

#[derive(Clone, Debug)]
pub struct EndOfScrollDetector {
    confirmations_required: u32,
    consecutive_no_new_content: u32,
}

impl EndOfScrollDetector {
    pub fn new(confirmations_required: u32) -> Self {
        Self {
            confirmations_required: confirmations_required.max(2),
            consecutive_no_new_content: 0,
        }
    }

    /// A continuation threshold relative to the effective scrollable region,
    /// not the full device viewport. This keeps SHORT swipes in bounded panes
    /// from being misclassified as end-of-content.
    pub fn minimum_new_rows(region: CaptureRegion) -> u32 {
        (region.height().saturating_mul(2) / 100).max(8)
    }

    pub fn observe(&mut self, observation: EndObservation) -> bool {
        match observation {
            EndObservation::Continuation => self.consecutive_no_new_content = 0,
            EndObservation::NoNewContent => self.consecutive_no_new_content += 1,
        }
        self.consecutive_no_new_content >= self.confirmations_required
    }

    #[cfg(test)]
    pub fn confirmations(&self) -> u32 {
        self.consecutive_no_new_content
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DetectedFixedBands {
    pub top: u32,
    pub bottom: u32,
}

pub struct FixedRegionDetector;

impl FixedRegionDetector {
    /// Parse the largest visible `scrollable="true"` UIAutomator node. This is
    /// deliberately a narrow attribute parser rather than a second XML stack;
    /// malformed dumps simply fall back to viewport vision unless strict mode
    /// was requested by the caller.
    pub fn largest_scrollable_region(xml: &str, width: u32, height: u32) -> Option<CaptureRegion> {
        let mut best: Option<CaptureRegion> = None;
        let mut rest = xml;
        while let Some(start) = rest.find("<node") {
            rest = &rest[start..];
            let Some(end) = rest.find('>') else {
                break;
            };
            let node = &rest[..=end];
            rest = &rest[end + 1..];
            if !node.contains("scrollable=\"true\"") || node.contains("visible-to-user=\"false\"") {
                continue;
            }
            let Some(bounds) = Self::attribute(node, "bounds")
                .and_then(Self::parse_android_bounds)
                .and_then(|region| region.clamp_to(width, height))
            else {
                continue;
            };
            if best
                .map(|current| {
                    bounds.width() as u64 * bounds.height() as u64
                        > current.width() as u64 * current.height() as u64
                })
                .unwrap_or(true)
            {
                best = Some(bounds);
            }
        }
        best
    }

    fn attribute<'a>(node: &'a str, name: &str) -> Option<&'a str> {
        let marker = format!("{name}=\"");
        let start = node.find(&marker)? + marker.len();
        let tail = &node[start..];
        let end = tail.find('"')?;
        Some(&tail[..end])
    }

    fn parse_android_bounds(value: &str) -> Option<CaptureRegion> {
        let numbers: Vec<u32> = value
            .split(|character: char| !character.is_ascii_digit())
            .filter(|piece| !piece.is_empty())
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        if numbers.len() != 4 {
            return None;
        }
        Some(CaptureRegion {
            left: numbers[0],
            top: numbers[1],
            right: numbers[2],
            bottom: numbers[3],
        })
    }

    pub fn apply_conservative_system_bars(
        mut region: CaptureRegion,
        frame_height: u32,
        remove_status_bar: bool,
        remove_navigation_bar: bool,
    ) -> CaptureRegion {
        if remove_status_bar && region.top == 0 {
            region.top = region
                .top
                .saturating_add((frame_height.saturating_mul(3) / 100).clamp(20, 96));
        }
        if remove_navigation_bar && region.bottom == frame_height {
            region.bottom = region
                .bottom
                .saturating_sub((frame_height.saturating_mul(4) / 100).clamp(24, 128));
        }
        region
    }

    pub fn apply_fixed_bounds(
        mut region: CaptureRegion,
        fixed: FixedBounds,
    ) -> Option<CaptureRegion> {
        region.top = region.top.saturating_add(fixed.top).min(region.bottom);
        region.bottom = region.bottom.saturating_sub(fixed.bottom).max(region.top);
        region.is_valid().then_some(region)
    }

    /// Detect same-position top/bottom bands after a confirmed scroll. Bands
    /// are capped at 20% of the region so flat list backgrounds cannot consume
    /// most of the real content.
    pub fn detect_sticky_bands(
        previous: &RgbaImage,
        current: &RgbaImage,
        region: CaptureRegion,
    ) -> DetectedFixedBands {
        if previous.dimensions() != current.dimensions() || !region.is_valid() {
            return DetectedFixedBands::default();
        }
        let chunk = (region.height() / 60).clamp(3, 12);
        let maximum = region.height() / 5;
        let mut top = 0;
        let mut offset = 0;
        while offset + chunk <= maximum {
            let score =
                Self::row_band_difference(previous, current, region, region.top + offset, chunk);
            if score > 3.0 {
                break;
            }
            top = offset + chunk;
            offset += chunk;
        }

        let mut bottom = 0;
        offset = 0;
        while offset + chunk <= maximum {
            let y = region.bottom.saturating_sub(offset + chunk);
            let score = Self::row_band_difference(previous, current, region, y, chunk);
            if score > 3.0 {
                break;
            }
            bottom = offset + chunk;
            offset += chunk;
        }
        DetectedFixedBands { top, bottom }
    }

    fn row_band_difference(
        first: &RgbaImage,
        second: &RgbaImage,
        region: CaptureRegion,
        y: u32,
        rows: u32,
    ) -> f64 {
        let x_step = (region.width() / 48).max(1);
        let y_step = (rows / 4).max(1);
        let mut total = 0u64;
        let mut samples = 0u64;
        let mut yy = y;
        while yy < y.saturating_add(rows).min(region.bottom) {
            let mut x = region.left;
            while x < region.right {
                let a = first.get_pixel(x, yy).0;
                let b = second.get_pixel(x, yy).0;
                total += (0..3)
                    .map(|channel| u64::from(a[channel].abs_diff(b[channel])))
                    .sum::<u64>();
                samples += 3;
                x = x.saturating_add(x_step);
            }
            yy = yy.saturating_add(y_step);
        }
        if samples == 0 {
            f64::MAX
        } else {
            total as f64 / samples as f64
        }
    }
}

/// A conservative rectangle containing a small UI element that stayed at the
/// same viewport position while the document underneath moved. These rects
/// are used only for newly exposed tail pixels; the scroll region and the
/// alignment result are never changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FixedOverlayRect {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
}

impl FixedOverlayRect {
    fn width(self) -> u32 {
        self.right.saturating_sub(self.left)
    }

    fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top)
    }
}

pub struct FixedOverlayDetector;

impl FixedOverlayDetector {
    const TILE: u32 = 8;
    const SAME_POSITION_LIMIT: f64 = 8.0;
    const MOVING_POSITION_MINIMUM: f64 = 24.0;
    const NEIGHBOUR_MOTION_MINIMUM: f64 = 18.0;
    const MIN_CONTRAST: u8 = 28;

    /// Finds small, high-contrast components that remain at the same viewport
    /// coordinate while the surrounding document moves. This intentionally
    /// prefers false negatives over masking real document content.
    pub fn detect(
        previous: &RgbaImage,
        current: &RgbaImage,
        region: CaptureRegion,
        scroll_shift: u32,
    ) -> Vec<FixedOverlayRect> {
        if scroll_shift == 0 || previous.dimensions() != current.dimensions() {
            return Vec::new();
        }
        let Some(region) = region.clamp_to(previous.width(), previous.height()) else {
            return Vec::new();
        };
        if region.width() < Self::TILE * 3 || region.height() < Self::TILE * 3 {
            return Vec::new();
        }

        let columns = (region.width().saturating_add(Self::TILE - 1)) / Self::TILE;
        let rows = (region.height().saturating_add(Self::TILE - 1)) / Self::TILE;
        let mut candidates = vec![false; (columns * rows) as usize];

        for tile_y in 0..rows {
            let y = region.top + tile_y * Self::TILE;
            let tile_height = Self::TILE.min(region.bottom.saturating_sub(y));
            for tile_x in 0..columns {
                let x = region.left + tile_x * Self::TILE;
                let tile_width = Self::TILE.min(region.right.saturating_sub(x));
                if tile_width == 0 || tile_height == 0 {
                    continue;
                }

                let same_position =
                    mean_difference(previous, current, x, y, x, y, tile_width, tile_height);
                if same_position > Self::SAME_POSITION_LIMIT {
                    continue;
                }

                let translated_motion = y.checked_add(scroll_shift).and_then(|translated_y| {
                    (translated_y.saturating_add(tile_height) <= region.bottom).then(|| {
                        mean_difference(
                            previous,
                            current,
                            x,
                            translated_y,
                            x,
                            y,
                            tile_width,
                            tile_height,
                        )
                    })
                });
                let neighbour_motion = neighbourhood_difference(
                    previous,
                    current,
                    region,
                    x,
                    y,
                    tile_width,
                    tile_height,
                );
                let has_motion_evidence = translated_motion.is_some_and(|value| {
                    value >= Self::MOVING_POSITION_MINIMUM && value > same_position + 8.0
                }) || (translated_motion.is_none()
                    && neighbour_motion >= Self::NEIGHBOUR_MOTION_MINIMUM);
                let contrast_left = x.saturating_sub(Self::TILE / 2).max(region.left);
                let contrast_top = y.saturating_sub(Self::TILE / 2).max(region.top);
                let contrast_right = x
                    .saturating_add(tile_width)
                    .saturating_add(Self::TILE / 2)
                    .min(region.right);
                let contrast_bottom = y
                    .saturating_add(tile_height)
                    .saturating_add(Self::TILE / 2)
                    .min(region.bottom);
                let has_contrast = luma_range(
                    current,
                    contrast_left,
                    contrast_top,
                    contrast_right.saturating_sub(contrast_left),
                    contrast_bottom.saturating_sub(contrast_top),
                ) >= Self::MIN_CONTRAST;
                if !has_motion_evidence || !has_contrast {
                    continue;
                }
                candidates[(tile_y * columns + tile_x) as usize] = true;
            }
        }

        let mut visited = vec![false; candidates.len()];
        let mut raw_rects = Vec::new();
        for start_y in 0..rows {
            for start_x in 0..columns {
                let start = (start_y * columns + start_x) as usize;
                if !candidates[start] || visited[start] {
                    continue;
                }
                let mut stack = vec![(start_x, start_y)];
                visited[start] = true;
                let mut min_x = start_x;
                let mut max_x = start_x;
                let mut min_y = start_y;
                let mut max_y = start_y;
                let mut tile_count = 0u32;

                while let Some((tile_x, tile_y)) = stack.pop() {
                    tile_count += 1;
                    min_x = min_x.min(tile_x);
                    max_x = max_x.max(tile_x);
                    min_y = min_y.min(tile_y);
                    max_y = max_y.max(tile_y);
                    for (next_x, next_y) in [
                        (tile_x.saturating_sub(1), tile_y),
                        (tile_x.saturating_add(1), tile_y),
                        (tile_x, tile_y.saturating_sub(1)),
                        (tile_x, tile_y.saturating_add(1)),
                        (tile_x.saturating_sub(1), tile_y.saturating_sub(1)),
                        (tile_x.saturating_add(1), tile_y.saturating_sub(1)),
                        (tile_x.saturating_sub(1), tile_y.saturating_add(1)),
                        (tile_x.saturating_add(1), tile_y.saturating_add(1)),
                    ] {
                        if next_x >= columns || next_y >= rows {
                            continue;
                        }
                        let index = (next_y * columns + next_x) as usize;
                        if candidates[index] && !visited[index] {
                            visited[index] = true;
                            stack.push((next_x, next_y));
                        }
                    }
                }

                let rect = FixedOverlayRect {
                    left: region.left + min_x * Self::TILE,
                    top: region.top + min_y * Self::TILE,
                    right: region
                        .left
                        .saturating_add((max_x + 1) * Self::TILE)
                        .min(region.right),
                    bottom: region
                        .top
                        .saturating_add((max_y + 1) * Self::TILE)
                        .min(region.bottom),
                };
                let touches_vertical_edge = rect.top <= region.top + Self::TILE
                    || rect.bottom + Self::TILE >= region.bottom;
                if tile_count >= 2
                    && rect.width() >= Self::TILE * 2
                    && rect.height() >= Self::TILE * 2
                    && rect.width() <= region.width() / 3
                    && rect.height() <= region.height() / 3
                    && !touches_vertical_edge
                {
                    raw_rects.push(rect);
                }
            }
        }

        // A true fixed overlay may contain flat interior tiles with no local
        // edges. Validate the shape-bearing components first, then retain only
        // their immediately adjacent raw components so the final rectangle
        // still covers the complete icon without allowing unrelated document
        // fragments to chain across the viewport.
        let validated: Vec<FixedOverlayRect> = raw_rects
            .iter()
            .copied()
            .filter(|rect| {
                fixed_shape_agreement(
                    previous,
                    current,
                    rect.left,
                    rect.top,
                    rect.width(),
                    rect.height(),
                )
            })
            .collect();
        let mut rects: Vec<FixedOverlayRect> = raw_rects
            .into_iter()
            .filter(|rect| {
                validated
                    .iter()
                    .any(|valid| *rect == *valid || overlay_rects_are_near(*rect, *valid))
            })
            .collect();
        merge_nearby_rects(&mut rects);
        rects
    }

    /// Conceals only the part of a detected fixed overlay that is present in
    /// an appended tail. A small edge interpolation avoids transparent holes
    /// or a hard rectangle in the final PNG. If no usable border exists, the
    /// original pixels are retained rather than destroying document content.
    pub fn conceal_tail(
        tail: &mut RgbaImage,
        origin_left: u32,
        origin_top: u32,
        rects: &[FixedOverlayRect],
    ) -> usize {
        let mut concealed = 0;
        for rect in rects {
            let left = rect.left.saturating_sub(origin_left);
            let top = rect.top.saturating_sub(origin_top);
            let right = rect.right.saturating_sub(origin_left).min(tail.width());
            let bottom = rect.bottom.saturating_sub(origin_top).min(tail.height());
            if left >= right || top >= bottom {
                continue;
            }

            let left_sample = left.checked_sub(1).map(|x| (x, true));
            let right_sample = (right < tail.width()).then_some((right, true));
            if left_sample.is_none() && right_sample.is_none() {
                continue;
            }
            for y in top..bottom {
                let left_pixel = left_sample.map(|(x, _)| *tail.get_pixel(x, y));
                let right_pixel = right_sample.map(|(x, _)| *tail.get_pixel(x, y));
                for x in left..right {
                    let replacement = match (left_pixel, right_pixel) {
                        (Some(left_pixel), Some(right_pixel)) => {
                            let position = x - left + 1;
                            let span = right - left + 1;
                            blend_pixel(left_pixel, right_pixel, position, span)
                        }
                        (Some(pixel), None) | (None, Some(pixel)) => pixel,
                        (None, None) => continue,
                    };
                    tail.put_pixel(x, y, replacement);
                }
            }
            concealed += 1;
        }
        concealed
    }
}

fn merge_nearby_rects(rects: &mut Vec<FixedOverlayRect>) {
    let mut index = 0;
    while index < rects.len() {
        let mut candidate = index + 1;
        while candidate < rects.len() {
            if overlay_rects_are_near(rects[index], rects[candidate]) {
                let merged = FixedOverlayRect {
                    left: rects[index].left.min(rects[candidate].left),
                    top: rects[index].top.min(rects[candidate].top),
                    right: rects[index].right.max(rects[candidate].right),
                    bottom: rects[index].bottom.max(rects[candidate].bottom),
                };
                rects[index] = merged;
                rects.remove(candidate);
                candidate = index + 1;
            } else {
                candidate += 1;
            }
        }
        index += 1;
    }
}

fn overlay_rects_are_near(left: FixedOverlayRect, right: FixedOverlayRect) -> bool {
    let horizontal_gap = if left.right < right.left {
        right.left - left.right
    } else if right.right < left.left {
        left.left - right.right
    } else {
        0
    };
    let vertical_gap = if left.bottom < right.top {
        right.top - left.bottom
    } else if right.bottom < left.top {
        left.top - right.bottom
    } else {
        0
    };
    horizontal_gap <= FixedOverlayDetector::TILE && vertical_gap <= FixedOverlayDetector::TILE
}

fn mean_difference(
    first: &RgbaImage,
    second: &RgbaImage,
    first_x: u32,
    first_y: u32,
    second_x: u32,
    second_y: u32,
    width: u32,
    height: u32,
) -> f64 {
    let mut total = 0u64;
    let mut samples = 0u64;
    let x_step = (width / 4).max(1);
    let y_step = (height / 4).max(1);
    let mut y = 0;
    while y < height {
        let mut x = 0;
        while x < width {
            let a = first.get_pixel(first_x + x, first_y + y).0;
            let b = second.get_pixel(second_x + x, second_y + y).0;
            total += (0..3)
                .map(|channel| u64::from(a[channel].abs_diff(b[channel])))
                .sum::<u64>();
            samples += 3;
            x = x.saturating_add(x_step);
        }
        y = y.saturating_add(y_step);
    }
    if samples == 0 {
        f64::MAX
    } else {
        total as f64 / samples as f64
    }
}

/// Confirms that a candidate retains the same foreground shape at the same
/// viewport position. A plain mean is unsafe for sparse text on a white
/// background: one dark pixel moving within an 8x8 tile can stay below the
/// mean-difference limit even though the glyph itself moved. Requiring
/// agreement at informative edges keeps true fixed icons while rejecting
/// document text and image fragments.
fn fixed_shape_agreement(
    first: &RgbaImage,
    second: &RgbaImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> bool {
    if width < 2 || height < 2 {
        return false;
    }

    let mut pixels = 0u32;
    let mut matching_pixels = 0u32;
    let mut informative = 0u32;
    let mut matching_informative = 0u32;

    for yy in 0..height {
        for xx in 0..width {
            let first_pixel = first.get_pixel(x + xx, y + yy).0;
            let second_pixel = second.get_pixel(x + xx, y + yy).0;
            let color_difference = (0..3)
                .map(|channel| u32::from(first_pixel[channel].abs_diff(second_pixel[channel])))
                .sum::<u32>()
                / 3;
            pixels += 1;
            if color_difference <= 12 {
                matching_pixels += 1;
            }

            if xx + 1 >= width || yy + 1 >= height {
                continue;
            }
            let first_right = first.get_pixel(x + xx + 1, y + yy).0;
            let first_below = first.get_pixel(x + xx, y + yy + 1).0;
            let second_right = second.get_pixel(x + xx + 1, y + yy).0;
            let second_below = second.get_pixel(x + xx, y + yy + 1).0;
            let first_luma = rgba_luma(first_pixel);
            let second_luma = rgba_luma(second_pixel);
            let first_dx = i16::from(rgba_luma(first_right)) - i16::from(first_luma);
            let first_dy = i16::from(rgba_luma(first_below)) - i16::from(first_luma);
            let second_dx = i16::from(rgba_luma(second_right)) - i16::from(second_luma);
            let second_dy = i16::from(rgba_luma(second_below)) - i16::from(second_luma);
            let first_strength = first_dx.abs() + first_dy.abs();
            let second_strength = second_dx.abs() + second_dy.abs();
            if first_strength.max(second_strength) < 18 {
                continue;
            }

            informative += 1;
            let gradient_difference = (first_dx - second_dx).abs() + (first_dy - second_dy).abs();
            if color_difference <= 16 && gradient_difference <= 24 {
                matching_informative += 1;
            }
        }
    }

    pixels > 0
        && matching_pixels.saturating_mul(100) >= pixels.saturating_mul(30)
        && informative >= 3
        && matching_informative >= 2
}

fn rgba_luma(pixel: [u8; 4]) -> u8 {
    ((77 * u16::from(pixel[0]) + 150 * u16::from(pixel[1]) + 29 * u16::from(pixel[2])) >> 8) as u8
}

fn neighbourhood_difference(
    first: &RgbaImage,
    second: &RgbaImage,
    region: CaptureRegion,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> f64 {
    let radius = FixedOverlayDetector::TILE.saturating_mul(3);
    let left = x.saturating_sub(radius);
    let top = y.saturating_sub(radius);
    let right = x
        .saturating_add(width)
        .saturating_add(radius)
        .min(region.right);
    let bottom = y
        .saturating_add(height)
        .saturating_add(radius)
        .min(region.bottom);
    let mut total = 0u64;
    let mut samples = 0u64;
    let mut yy = top;
    while yy < bottom {
        let mut xx = left;
        while xx < right {
            if xx < x || xx >= x.saturating_add(width) || yy < y || yy >= y.saturating_add(height) {
                let a = first.get_pixel(xx, yy).0;
                let b = second.get_pixel(xx, yy).0;
                total += (0..3)
                    .map(|channel| u64::from(a[channel].abs_diff(b[channel])))
                    .sum::<u64>();
                samples += 3;
            }
            xx = xx.saturating_add(2);
        }
        yy = yy.saturating_add(2);
    }
    if samples == 0 {
        0.0
    } else {
        total as f64 / samples as f64
    }
}

fn luma_range(image: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> u8 {
    let mut minimum = u8::MAX;
    let mut maximum = u8::MIN;
    let x_step = (width / 4).max(1);
    let y_step = (height / 4).max(1);
    let mut yy = 0;
    while yy < height {
        let mut xx = 0;
        while xx < width {
            let pixel = image.get_pixel(x + xx, y + yy).0;
            let luma =
                ((77 * u16::from(pixel[0]) + 150 * u16::from(pixel[1]) + 29 * u16::from(pixel[2]))
                    >> 8) as u8;
            minimum = minimum.min(luma);
            maximum = maximum.max(luma);
            xx = xx.saturating_add(x_step);
        }
        yy = yy.saturating_add(y_step);
    }
    maximum.saturating_sub(minimum)
}

fn blend_pixel(
    left: image::Rgba<u8>,
    right: image::Rgba<u8>,
    position: u32,
    span: u32,
) -> image::Rgba<u8> {
    let denominator = u64::from(span.max(1));
    let numerator = u64::from(position.min(span));
    image::Rgba(std::array::from_fn(|channel| {
        let left_value = u64::from(left[channel]);
        let right_value = u64::from(right[channel]);
        ((left_value * (denominator - numerator) + right_value * numerator) / denominator) as u8
    }))
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use super::*;

    fn content_frame(offset: u32, sticky_header: u32) -> RgbaImage {
        let width = 240;
        let height = 360;
        RgbaImage::from_fn(width, height, |x, y| {
            if y < sticky_header {
                return Rgba([20, 80, 180, 255]);
            }
            let source_y = y - sticky_header + offset;
            let stripe = (source_y / 9) % 17;
            Rgba([
                ((x * 11 + stripe * 23 + source_y) % 251) as u8,
                ((x * 3 + source_y * 7) % 241) as u8,
                ((stripe * 37 + x / 3) % 239) as u8,
                255,
            ])
        })
    }

    fn frame_with_fixed_overlay(offset: u32) -> RgbaImage {
        let mut image = content_frame(offset, 0);
        for y in 264..312 {
            for x in 176..224 {
                let dx = x as i32 - 200;
                let dy = y as i32 - 288;
                if dx * dx + dy * dy <= 22 * 22 {
                    image.put_pixel(x, y, Rgba([8, 8, 8, 255]));
                }
            }
        }
        for y in 256..272 {
            for x in 212..228 {
                image.put_pixel(x, y, Rgba([220, 30, 45, 255]));
            }
        }
        image
    }

    fn region(top: u32) -> CaptureRegion {
        CaptureRegion {
            left: 0,
            top,
            right: 240,
            bottom: 340,
        }
    }

    #[test]
    fn overlap_detector_finds_normal_scroll() {
        let first = content_frame(0, 0);
        let second = content_frame(80, 0);
        let overlap = OverlapDetector::detect(&first, &second, region(0));
        assert_eq!(overlap.kind, OverlapKind::Match);
        assert!(overlap.new_content_rows.abs_diff(80) <= 2, "{overlap:?}");
        assert!(overlap.confidence > 0.5);
    }

    #[test]
    fn overlap_detector_reports_none_for_unrelated_frames() {
        let first = content_frame(0, 0);
        let mut second = content_frame(0, 0);
        for (index, pixel) in second.pixels_mut().enumerate() {
            let value = ((index * 97 + 31) % 255) as u8;
            *pixel = Rgba([value, value.wrapping_mul(3), value.wrapping_mul(7), 255]);
        }
        assert_eq!(
            OverlapDetector::detect(&first, &second, region(0)).kind,
            OverlapKind::None
        );
    }

    #[test]
    fn overlap_detector_handles_small_scroll() {
        let first = content_frame(0, 0);
        let second = content_frame(14, 0);
        let overlap = OverlapDetector::detect(&first, &second, region(0));
        assert_eq!(overlap.kind, OverlapKind::Match);
        assert!(overlap.new_content_rows.abs_diff(14) <= 2, "{overlap:?}");
    }

    #[test]
    fn bounded_region_short_scroll_is_a_continuation() {
        let pane = CaptureRegion {
            left: 0,
            top: 1_000,
            right: 240,
            bottom: 1_200,
        };
        let frame = |offset: u32| {
            RgbaImage::from_fn(240, 2_400, |x, y| {
                let source_y = if (pane.top..pane.bottom).contains(&y) {
                    y.saturating_add(offset)
                } else {
                    y
                };
                let stripe = (source_y / 9) % 17;
                Rgba([
                    ((x * 11 + stripe * 23 + source_y) % 251) as u8,
                    ((x * 3 + source_y * 7) % 241) as u8,
                    ((stripe * 37 + x / 3) % 239) as u8,
                    255,
                ])
            })
        };
        // SHORT moves about 18% of the effective 200-row pane.
        let first = frame(0);
        let second = frame(36);
        let overlap = OverlapDetector::detect(&first, &second, pane);
        assert_eq!(overlap.kind, OverlapKind::Match);
        assert!(overlap.new_content_rows.abs_diff(36) <= 2, "{overlap:?}");
        assert!(overlap.new_content_rows < (2_400 * 2 / 100));
        assert!(
            overlap.new_content_rows >= EndOfScrollDetector::minimum_new_rows(pane),
            "{overlap:?}"
        );

        let mut detector = EndOfScrollDetector::new(2);
        assert!(!detector.observe(EndObservation::NoNewContent));
        assert!(!detector.observe(EndObservation::Continuation));
        assert_eq!(detector.confirmations(), 0);
    }

    #[test]
    fn upper_bounded_regions_are_matched_in_local_coordinates() {
        let moving_pane = CaptureRegion {
            left: 0,
            top: 100,
            right: 240,
            bottom: 500,
        };
        let frame = |offset: u32| {
            RgbaImage::from_fn(240, 2_400, |x, y| {
                let source_y = if (moving_pane.top..moving_pane.bottom).contains(&y) {
                    y.saturating_sub(moving_pane.top).saturating_add(offset)
                } else {
                    y
                };
                let stripe = (source_y / 11) % 19;
                Rgba([
                    ((x * 13 + stripe * 29 + source_y) % 251) as u8,
                    ((x * 5 + source_y * 7 + stripe) % 241) as u8,
                    ((stripe * 41 + x / 3 + source_y * 3) % 239) as u8,
                    255,
                ])
            })
        };
        let first = frame(0);
        let second = frame(36);

        for pane in [
            moving_pane,
            CaptureRegion {
                left: 24,
                right: 216,
                ..moving_pane
            },
        ] {
            let overlap = OverlapDetector::detect(&first, &second, pane);
            assert_eq!(overlap.kind, OverlapKind::Match, "{pane:?}: {overlap:?}");
            assert_eq!(overlap.overlap_start, pane.top);
            assert!(
                overlap.new_content_rows.abs_diff(36) <= 2,
                "{pane:?}: {overlap:?}"
            );
            assert!(
                overlap.overlap_end.abs_diff(pane.bottom - 36) <= 2,
                "{pane:?}: {overlap:?}"
            );
        }
    }

    #[test]
    fn overlap_detector_ignores_sticky_header_when_bounded() {
        let first = content_frame(0, 42);
        let second = content_frame(72, 42);
        let overlap = OverlapDetector::detect(&first, &second, region(42));
        assert_eq!(overlap.kind, OverlapKind::Match);
        assert!(overlap.new_content_rows.abs_diff(72) <= 2, "{overlap:?}");
        let bands = FixedRegionDetector::detect_sticky_bands(&first, &second, region(0));
        assert!(bands.top >= 36, "{bands:?}");
    }

    #[test]
    fn overlap_detector_reports_identical() {
        let first = content_frame(0, 0);
        let overlap = OverlapDetector::detect(&first, &first, region(0));
        assert_eq!(overlap.kind, OverlapKind::Identical);
        assert_eq!(overlap.new_content_rows, 0);
    }

    #[test]
    fn overlap_detector_tolerates_partially_changed_content() {
        let first = content_frame(0, 0);
        let mut second = content_frame(64, 0);
        for y in 120..155 {
            for x in 90..135 {
                second.put_pixel(x, y, Rgba([250, 20, 100, 255]));
            }
        }
        let overlap = OverlapDetector::detect(&first, &second, region(0));
        assert_eq!(overlap.kind, OverlapKind::Match);
        assert!(overlap.new_content_rows.abs_diff(64) <= 3, "{overlap:?}");
    }

    #[test]
    fn fixed_overlay_does_not_change_alignment_and_is_concealed_from_tail() {
        let first = frame_with_fixed_overlay(0);
        let second = frame_with_fixed_overlay(72);
        let pane = region(0);
        let overlap = OverlapDetector::detect(&first, &second, pane);
        assert_eq!(overlap.kind, OverlapKind::Match, "{overlap:?}");
        assert!(overlap.new_content_rows.abs_diff(72) <= 2, "{overlap:?}");

        let rects = FixedOverlayDetector::detect(&first, &second, pane, 72);
        assert!(!rects.is_empty(), "fixed overlay was not detected");
        let tail_top = pane.bottom - 72;
        let mut tail = second.view(0, tail_top, pane.width(), 72).to_image();
        assert!(
            FixedOverlayDetector::conceal_tail(&mut tail, 0, tail_top, &rects) > 0,
            "detected overlay did not intersect the appended tail"
        );
        assert_ne!(
            tail.get_pixel(200, 288 - tail_top).0,
            [8, 8, 8, 255],
            "rects={rects:?}"
        );
        assert_ne!(
            tail.get_pixel(220, 268 - tail_top).0,
            [220, 30, 45, 255],
            "rects={rects:?}"
        );
    }

    #[test]
    fn fixed_overlay_detector_uses_absolute_region_origin() {
        let first = frame_with_fixed_overlay(0);
        let second = frame_with_fixed_overlay(72);
        let pane = CaptureRegion {
            left: 24,
            top: 40,
            right: 240,
            bottom: 340,
        };
        let rects = FixedOverlayDetector::detect(&first, &second, pane, 72);
        assert!(
            !rects.is_empty(),
            "fixed overlay was not detected: {rects:?}"
        );

        let tail_top = pane.bottom - 72;
        let mut tail = second
            .view(pane.left, tail_top, pane.width(), pane.bottom - tail_top)
            .to_image();
        let sample_x = 200 - pane.left;
        let sample_y = 288 - tail_top;
        let before = *tail.get_pixel(sample_x, sample_y);
        assert!(
            FixedOverlayDetector::conceal_tail(&mut tail, pane.left, tail_top, &rects) > 0,
            "detected overlay did not intersect the non-zero-origin tail"
        );
        assert_ne!(*tail.get_pixel(sample_x, sample_y), before);
    }

    #[test]
    fn fixed_overlay_detector_handles_multiple_overlays() {
        let with_overlays = |offset| {
            let mut image = content_frame(offset, 0);
            for center_x in [48u32, 184u32] {
                for y in 264..312 {
                    for x in center_x - 24..center_x + 24 {
                        let dx = x as i32 - center_x as i32;
                        let dy = y as i32 - 288;
                        if dx * dx + dy * dy <= 22 * 22 {
                            image.put_pixel(x, y, Rgba([8, 8, 8, 255]));
                        }
                    }
                }
                for y in 256..272 {
                    for x in center_x + 12..center_x + 28 {
                        image.put_pixel(x, y, Rgba([220, 30, 45, 255]));
                    }
                }
            }
            image
        };
        let first = with_overlays(0);
        let second = with_overlays(72);
        let pane = region(0);
        let rects = FixedOverlayDetector::detect(&first, &second, pane, 72);
        assert!(rects.len() >= 2, "expected two overlays, got {rects:?}");

        let tail_top = pane.bottom - 72;
        let mut tail = second.view(0, tail_top, pane.width(), 72).to_image();
        let before = tail.clone();
        assert!(FixedOverlayDetector::conceal_tail(&mut tail, 0, tail_top, &rects) >= 2);
        let changed_pixels = before
            .pixels()
            .zip(tail.pixels())
            .filter(|(before, after)| before != after)
            .count();
        assert!(
            changed_pixels > 0,
            "concealment did not change any tail pixels"
        );
    }

    #[test]
    fn conceal_tail_keeps_pixels_when_overlay_has_no_usable_border() {
        let mut tail = RgbaImage::from_pixel(16, 16, Rgba([9, 9, 9, 255]));
        let before = tail.clone();
        let rect = FixedOverlayRect {
            left: 0,
            top: 0,
            right: tail.width(),
            bottom: tail.height(),
        };
        assert_eq!(
            FixedOverlayDetector::conceal_tail(&mut tail, 0, 0, &[rect]),
            0
        );
        assert_eq!(tail, before);
    }

    #[test]
    fn fixed_overlay_detector_rejects_moving_document_content() {
        let first = content_frame(0, 0);
        let second = content_frame(72, 0);
        assert!(FixedOverlayDetector::detect(&first, &second, region(0), 72).is_empty());
    }

    #[test]
    fn fixed_overlay_shape_guard_rejects_sparse_glyph_motion_hidden_by_mean() {
        let mut first = RgbaImage::from_pixel(16, 8, Rgba([255, 255, 255, 255]));
        let mut second = first.clone();
        for tile_left in [0, 8] {
            first.put_pixel(tile_left + 2, 3, Rgba([0, 0, 0, 255]));
            second.put_pixel(tile_left + 5, 3, Rgba([0, 0, 0, 255]));
        }

        for tile_left in [0, 8] {
            let mean = mean_difference(&first, &second, tile_left, 0, tile_left, 0, 8, 8);
            assert!(
                mean <= FixedOverlayDetector::SAME_POSITION_LIMIT,
                "fixture must reproduce the old mean-based false positive: {mean}"
            );
            assert!(
                !fixed_shape_agreement(&first, &second, tile_left, 0, 8, 8),
                "moving sparse glyph must not be treated as a fixed overlay"
            );
        }
    }

    #[test]
    fn fixed_overlay_shape_guard_keeps_a_stationary_icon_edge() {
        let mut first = RgbaImage::from_pixel(8, 8, Rgba([245, 245, 245, 255]));
        for y in 2..7 {
            for x in 2..7 {
                first.put_pixel(x, y, Rgba([20, 40, 120, 255]));
            }
        }
        let second = first.clone();
        assert!(fixed_shape_agreement(&first, &second, 0, 0, 8, 8));
    }

    #[test]
    fn end_detector_requires_two_confirmations_and_ignores_animation() {
        let mut detector = EndOfScrollDetector::new(2);
        assert!(!detector.observe(EndObservation::Continuation));
        assert!(!detector.observe(EndObservation::NoNewContent));
        // An animation/unaligned attempt is a continuation, so it cannot
        // contribute to (and deliberately resets) end confirmation.
        assert!(!detector.observe(EndObservation::Continuation));
        assert!(!detector.observe(EndObservation::NoNewContent));
        assert!(detector.observe(EndObservation::NoNewContent));
        assert_eq!(detector.confirmations(), 2);
        assert!(!detector.observe(EndObservation::Continuation));
        assert_eq!(detector.confirmations(), 0);
    }

    #[test]
    fn largest_visible_scrollable_bounds_are_parsed() {
        let xml = r#"<hierarchy><node scrollable="true" visible-to-user="true" bounds="[5,10][100,200]"/><node scrollable="true" visible-to-user="true" bounds="[0,20][220,330]"/></hierarchy>"#;
        assert_eq!(
            FixedRegionDetector::largest_scrollable_region(xml, 240, 360),
            Some(CaptureRegion {
                left: 0,
                top: 20,
                right: 220,
                bottom: 330,
            })
        );
    }

    #[test]
    fn stability_detector_requires_consecutive_samples() {
        let mut detector = ScreenStabilityDetector::new(5.0, 2);
        let stable = FrameComparison {
            score: 1.0,
            changed_ratio: 0.01,
        };
        assert!(!detector.observe(stable));
        assert!(detector.observe(stable));
        assert_eq!(detector.consecutive_stable(), 2);
    }
}
