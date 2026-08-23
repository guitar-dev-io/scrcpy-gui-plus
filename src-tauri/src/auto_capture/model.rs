use serde::{Deserialize, Serialize};

pub const CAPTURE_SOURCE_ADB: &str = "ADB_SCREENCAP_PNG";

fn default_max_frames() -> u32 {
    30
}
fn default_max_height() -> u32 {
    100_000
}
fn default_max_memory_mb() -> u32 {
    512
}
fn default_end_confirmations() -> u32 {
    2
}
fn default_true() -> bool {
    true
}
fn default_stability_interval_ms() -> u64 {
    100
}
fn default_stability_timeout_ms() -> u64 {
    1_500
}
fn default_stability_threshold() -> f64 {
    5.0
}
fn default_stable_samples() -> u32 {
    2
}
fn default_scroll_x() -> f64 {
    0.5
}
fn default_scroll_start_y() -> f64 {
    0.78
}
fn default_scroll_end_y() -> f64 {
    0.28
}
fn default_scroll_duration_ms() -> u64 {
    400
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutoCaptureStatus {
    #[default]
    Idle,
    Starting,
    Capturing,
    Scrolling,
    WaitingStable,
    Processing,
    Stitching,
    Stopping,
    Completed,
    Stopped,
    Failed,
    Cancelled,
}

impl AutoCaptureStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Stopped | Self::Failed | Self::Cancelled
        )
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        use AutoCaptureStatus::*;
        if self == next {
            return true;
        }
        match self {
            Idle => matches!(next, Starting | Cancelled),
            Starting => matches!(next, Capturing | Stopping | Failed | Cancelled),
            Capturing => matches!(
                next,
                Scrolling | Processing | Stitching | Stopping | Failed | Cancelled
            ),
            Scrolling => matches!(next, WaitingStable | Stopping | Failed | Cancelled),
            WaitingStable => {
                matches!(next, Processing | Stopping | Failed | Cancelled)
            }
            Processing => matches!(next, Scrolling | Stitching | Stopping | Failed | Cancelled),
            Stopping => matches!(next, Stitching | Stopped | Failed | Cancelled),
            Stitching => matches!(next, Completed | Stopped | Failed | Cancelled),
            Completed | Stopped | Failed | Cancelled => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScrollDirection {
    #[default]
    Down,
    Up,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScrollMode {
    #[default]
    Auto,
    Short,
    Medium,
    Long,
    Custom,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FixedRegionMode {
    #[default]
    Auto,
    Manual,
    Off,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutputFormat {
    #[default]
    Png,
    Jpeg,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutoCaptureErrorCode {
    DeviceDisconnected,
    ScreenCaptureFailed,
    ScrollFailed,
    StreamUnavailable,
    NoScrollableRegion,
    StabilityTimeout,
    ImageProcessingFailed,
    OutputTooLarge,
    CaptureLimitReached,
    DimensionChanged,
    Busy,
    InvalidConfig,
    UnsupportedDirection,
    UnsupportedOutputFormat,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureError {
    pub code: AutoCaptureErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AutoCaptureError {
    pub fn new(code: AutoCaptureErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        code: AutoCaptureErrorCode,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details: Some(details.into()),
        }
    }
}

pub type AutoCaptureApiError = AutoCaptureError;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerminationReason {
    ContentEnd,
    SegmentLimit,
    AlignmentLost,
    UserStopped,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureTermination {
    pub reason: TerminationReason,
    pub complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<AutoCaptureErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
}

impl CaptureRegion {
    pub fn width(self) -> u32 {
        self.right.saturating_sub(self.left)
    }

    pub fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top)
    }

    pub fn is_valid(self) -> bool {
        self.width() > 2 && self.height() > 2
    }

    pub fn clamp_to(self, width: u32, height: u32) -> Option<Self> {
        let clamped = Self {
            left: self.left.min(width),
            top: self.top.min(height),
            right: self.right.min(width),
            bottom: self.bottom.min(height),
        };
        clamped.is_valid().then_some(clamped)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedBounds {
    #[serde(default)]
    pub top: u32,
    #[serde(default)]
    pub bottom: u32,
}

/// Normalized gesture coordinates measured inside the effective capture
/// region (UIAutomator/manual/viewport) for every scroll mode, including
/// CUSTOM. Device dimensions are still sent in the scrcpy wire packet.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ScrollSettings {
    #[serde(default = "default_scroll_x")]
    pub start_x: f64,
    #[serde(default = "default_scroll_start_y")]
    pub start_y: f64,
    #[serde(default = "default_scroll_x")]
    pub end_x: f64,
    #[serde(default = "default_scroll_end_y")]
    pub end_y: f64,
    #[serde(default = "default_scroll_duration_ms")]
    pub duration_ms: u64,
}

impl Default for ScrollSettings {
    fn default() -> Self {
        Self {
            start_x: default_scroll_x(),
            start_y: default_scroll_start_y(),
            end_x: default_scroll_x(),
            end_y: default_scroll_end_y(),
            duration_ms: default_scroll_duration_ms(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct StabilitySettings {
    #[serde(default = "default_stability_interval_ms")]
    pub interval_ms: u64,
    #[serde(default = "default_stability_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_stability_threshold")]
    pub difference_threshold: f64,
    #[serde(default = "default_stable_samples")]
    pub stable_samples: u32,
}

impl Default for StabilitySettings {
    fn default() -> Self {
        Self {
            interval_ms: default_stability_interval_ms(),
            timeout_ms: default_stability_timeout_ms(),
            difference_threshold: default_stability_threshold(),
            stable_samples: default_stable_samples(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct OutputSettings {
    #[serde(default)]
    pub directory: Option<String>,
    #[serde(default)]
    pub format: OutputFormat,
}

impl Default for OutputSettings {
    fn default() -> Self {
        Self {
            directory: None,
            format: OutputFormat::Png,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoCaptureConfig {
    pub device_id: String,
    pub device_name: Option<String>,
    pub custom_path: Option<String>,
    pub direction: ScrollDirection,
    pub scroll_mode: ScrollMode,
    pub scroll_settings: ScrollSettings,
    pub stability: StabilitySettings,
    #[serde(default = "default_max_frames")]
    pub max_frames: u32,
    #[serde(default = "default_max_height")]
    pub max_height: u32,
    #[serde(default = "default_max_memory_mb")]
    pub max_memory_mb: u32,
    #[serde(default = "default_end_confirmations")]
    pub end_confirmations: u32,
    pub fixed_region_mode: FixedRegionMode,
    pub manual_region: Option<CaptureRegion>,
    pub manual_fixed_bounds: Option<FixedBounds>,
    #[serde(default = "default_true")]
    pub remove_status_bar: bool,
    #[serde(default = "default_true")]
    pub remove_navigation_bar: bool,
    #[serde(default = "default_true")]
    pub remove_sticky_header: bool,
    #[serde(default = "default_true")]
    pub remove_sticky_footer: bool,
    #[serde(default = "default_true")]
    pub detect_region: bool,
    #[serde(default)]
    pub require_scrollable_region: bool,
    #[serde(default = "default_true")]
    pub stitch: bool,
    #[serde(default)]
    pub save_individual_frames: bool,
    #[serde(default)]
    pub debug: bool,
    pub output: OutputSettings,
}

impl Default for AutoCaptureConfig {
    fn default() -> Self {
        Self {
            device_id: String::new(),
            device_name: None,
            custom_path: None,
            direction: ScrollDirection::Down,
            scroll_mode: ScrollMode::Auto,
            scroll_settings: ScrollSettings::default(),
            stability: StabilitySettings::default(),
            max_frames: default_max_frames(),
            max_height: default_max_height(),
            max_memory_mb: default_max_memory_mb(),
            end_confirmations: default_end_confirmations(),
            fixed_region_mode: FixedRegionMode::Auto,
            manual_region: None,
            manual_fixed_bounds: None,
            remove_status_bar: true,
            remove_navigation_bar: true,
            remove_sticky_header: true,
            remove_sticky_footer: true,
            detect_region: true,
            require_scrollable_region: false,
            stitch: true,
            save_individual_frames: false,
            debug: false,
            output: OutputSettings::default(),
        }
    }
}

impl AutoCaptureConfig {
    pub fn validated(mut self) -> Result<Self, AutoCaptureApiError> {
        self.device_id = self.device_id.trim().to_string();
        if self.device_id.is_empty() {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::InvalidConfig,
                "deviceId is required",
            ));
        }
        if self.direction != ScrollDirection::Down {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::UnsupportedDirection,
                "Only DOWN auto capture is supported in this MVP",
            ));
        }
        if self.output.format != OutputFormat::Png {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::UnsupportedOutputFormat,
                "PNG is the only output format supported in this MVP",
            ));
        }
        if let Some(region) = self.manual_region {
            if !region.is_valid() {
                return Err(AutoCaptureError::new(
                    AutoCaptureErrorCode::InvalidConfig,
                    "manualRegion must have positive width and height",
                ));
            }
        }
        if self.fixed_region_mode == FixedRegionMode::Manual && self.manual_fixed_bounds.is_none() {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::InvalidConfig,
                "manualFixedBounds is required when fixedRegionMode is MANUAL",
            ));
        }

        self.max_frames = self.max_frames.clamp(1, 200);
        self.max_height = self.max_height.clamp(256, 250_000);
        self.max_memory_mb = self.max_memory_mb.clamp(16, 2_048);
        self.end_confirmations = self.end_confirmations.clamp(2, 5);
        self.stability.interval_ms = self.stability.interval_ms.clamp(80, 120);
        self.stability.timeout_ms = self.stability.timeout_ms.clamp(300, 10_000);
        self.stability.stable_samples = self.stability.stable_samples.clamp(2, 5);
        if !self.stability.difference_threshold.is_finite() {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::InvalidConfig,
                "stability differenceThreshold must be finite",
            ));
        }
        self.stability.difference_threshold = self.stability.difference_threshold.clamp(0.5, 30.0);

        match self.scroll_mode {
            ScrollMode::Auto => {
                self.scroll_settings = ScrollSettings::default();
            }
            ScrollMode::Short => {
                self.scroll_settings = ScrollSettings {
                    start_x: 0.5,
                    start_y: 0.68,
                    end_x: 0.5,
                    end_y: 0.50,
                    duration_ms: 300,
                };
            }
            ScrollMode::Medium => {
                self.scroll_settings = ScrollSettings {
                    start_x: 0.5,
                    start_y: 0.76,
                    end_x: 0.5,
                    end_y: 0.36,
                    duration_ms: 400,
                };
            }
            ScrollMode::Long => {
                self.scroll_settings = ScrollSettings {
                    start_x: 0.5,
                    start_y: 0.82,
                    end_x: 0.5,
                    end_y: 0.18,
                    duration_ms: 550,
                };
            }
            ScrollMode::Custom => {
                let values = [
                    self.scroll_settings.start_x,
                    self.scroll_settings.start_y,
                    self.scroll_settings.end_x,
                    self.scroll_settings.end_y,
                ];
                if values.iter().any(|value| !value.is_finite()) {
                    return Err(AutoCaptureError::new(
                        AutoCaptureErrorCode::InvalidConfig,
                        "Custom scroll coordinates must be finite",
                    ));
                }
                self.scroll_settings.start_x = self.scroll_settings.start_x.clamp(0.0, 1.0);
                self.scroll_settings.start_y = self.scroll_settings.start_y.clamp(0.0, 1.0);
                self.scroll_settings.end_x = self.scroll_settings.end_x.clamp(0.0, 1.0);
                self.scroll_settings.end_y = self.scroll_settings.end_y.clamp(0.0, 1.0);
                self.scroll_settings.duration_ms =
                    self.scroll_settings.duration_ms.clamp(100, 2_000);
                if self.scroll_settings.start_y <= self.scroll_settings.end_y {
                    return Err(AutoCaptureError::new(
                        AutoCaptureErrorCode::InvalidConfig,
                        "A DOWN custom swipe requires startY greater than endY",
                    ));
                }
            }
        }

        self.device_name = self
            .device_name
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.custom_path = self
            .custom_path
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.output.directory = self
            .output
            .directory
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureResult {
    pub path: String,
    pub filename: String,
    pub width: u32,
    pub height: u32,
    pub capture_count: u32,
    pub complete: bool,
    pub partial: bool,
    pub capture_source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub individual_frames: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureSession {
    pub id: String,
    pub device_id: String,
    pub status: AutoCaptureStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub capture_count: u32,
    pub current_progress: f32,
    pub paused: bool,
    pub direction: ScrollDirection,
    pub scroll_mode: ScrollMode,
    pub scroll_settings: ScrollSettings,
    pub stability: StabilitySettings,
    pub output: OutputSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AutoCaptureResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AutoCaptureError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub termination: Option<AutoCaptureTermination>,
}

impl AutoCaptureSession {
    pub fn new(id: String, config: &AutoCaptureConfig) -> Self {
        let now = now_iso();
        Self {
            id,
            device_id: config.device_id.clone(),
            status: AutoCaptureStatus::Idle,
            created_at: now.clone(),
            updated_at: now,
            started_at: None,
            completed_at: None,
            capture_count: 0,
            current_progress: 0.0,
            paused: false,
            direction: config.direction,
            scroll_mode: config.scroll_mode,
            scroll_settings: config.scroll_settings.clone(),
            stability: config.stability.clone(),
            output: config.output.clone(),
            result: None,
            error: None,
            termination: None,
        }
    }

    pub fn transition(&mut self, next: AutoCaptureStatus) -> Result<(), AutoCaptureError> {
        // Repeating a state transition is an idempotent no-op. In particular,
        // terminal snapshots must not get a new completion timestamp or become
        // mutable after publication.
        if self.status == next {
            return Ok(());
        }
        if !self.status.can_transition_to(next) {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::InvalidConfig,
                "Invalid auto-capture state transition",
                format!("{:?} -> {:?}", self.status, next),
            ));
        }
        self.status = next;
        let now = now_iso();
        self.updated_at = now.clone();
        if next == AutoCaptureStatus::Starting && self.started_at.is_none() {
            self.started_at = Some(now.clone());
        }
        if next.is_terminal() {
            self.completed_at = Some(now);
            self.paused = false;
            self.current_progress = if next == AutoCaptureStatus::Completed {
                1.0
            } else {
                self.current_progress
            };
        }
        Ok(())
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureDiagnostics {
    pub capture_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region_source: Option<String>,
    /// Full raw frame bounds used to scale non-destructive debug overlays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_frame_region: Option<CaptureRegion>,
    /// Region copied exactly once from the first raw frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_top_region: Option<CaptureRegion>,
    /// ROI used for overlap/displacement detection and body stitching.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrollable_region: Option<CaptureRegion>,
    /// Region copied exactly once from the last raw frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_bottom_region: Option<CaptureRegion>,
    /// Portion of the current matching ROI aligned with the previous frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_overlap_region: Option<CaptureRegion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stability_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap_confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub stability_timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverable_error: Option<AutoCaptureError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl AutoCaptureDiagnostics {
    pub fn adb_capture() -> Self {
        Self {
            capture_source: CAPTURE_SOURCE_ADB.to_string(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoCaptureEventPayload {
    pub id: String,
    pub device_id: String,
    pub status: AutoCaptureStatus,
    pub timestamp: String,
    pub capture_count: u32,
    pub current_progress: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AutoCaptureResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AutoCaptureError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub termination: Option<AutoCaptureTermination>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<AutoCaptureDiagnostics>,
}

impl AutoCaptureEventPayload {
    pub fn from_session(session: &AutoCaptureSession) -> Self {
        Self {
            id: session.id.clone(),
            device_id: session.device_id.clone(),
            status: session.status,
            timestamp: now_iso(),
            capture_count: session.capture_count,
            current_progress: session.current_progress,
            frame_index: None,
            thumbnail_data_url: None,
            result_path: session.result.as_ref().map(|result| result.path.clone()),
            result: session.result.clone(),
            error: session.error.clone(),
            termination: session.termination.clone(),
            diagnostics: None,
        }
    }
}

pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_status_transitions_are_enforced() {
        let config = AutoCaptureConfig {
            device_id: "emulator-5554".into(),
            ..Default::default()
        };
        let mut session = AutoCaptureSession::new("capture-1".into(), &config);
        session.transition(AutoCaptureStatus::Starting).unwrap();
        session.transition(AutoCaptureStatus::Capturing).unwrap();
        session.transition(AutoCaptureStatus::Scrolling).unwrap();
        session
            .transition(AutoCaptureStatus::WaitingStable)
            .unwrap();
        session.transition(AutoCaptureStatus::Processing).unwrap();
        session.transition(AutoCaptureStatus::Stitching).unwrap();
        session.transition(AutoCaptureStatus::Completed).unwrap();
        assert!(session.status.is_terminal());
        assert!(session.transition(AutoCaptureStatus::Capturing).is_err());
    }

    #[test]
    fn repeated_terminal_transition_is_idempotent() {
        let config = AutoCaptureConfig {
            device_id: "emulator-5554".into(),
            ..Default::default()
        };
        let mut session = AutoCaptureSession::new("capture-terminal".into(), &config);
        session.transition(AutoCaptureStatus::Starting).unwrap();
        session.transition(AutoCaptureStatus::Capturing).unwrap();
        session.transition(AutoCaptureStatus::Stitching).unwrap();
        session.transition(AutoCaptureStatus::Completed).unwrap();
        let completed_at = session.completed_at.clone();
        let updated_at = session.updated_at.clone();
        session.transition(AutoCaptureStatus::Completed).unwrap();
        assert_eq!(session.completed_at, completed_at);
        assert_eq!(session.updated_at, updated_at);
    }

    #[test]
    fn config_defaults_and_clamps_match_mvp_contract() {
        let config = AutoCaptureConfig {
            device_id: " emulator-5554 ".into(),
            max_frames: 0,
            stability: StabilitySettings {
                interval_ms: 5,
                timeout_ms: 50,
                ..Default::default()
            },
            ..Default::default()
        }
        .validated()
        .unwrap();
        assert_eq!(config.device_id, "emulator-5554");
        assert_eq!(config.max_frames, 1);
        assert_eq!(config.stability.interval_ms, 80);
        assert_eq!(config.stability.timeout_ms, 300);
        assert_eq!(config.scroll_settings.duration_ms, 400);
        assert_eq!(config.end_confirmations, 2);
    }

    #[test]
    fn unsupported_direction_and_format_are_typed() {
        let direction = AutoCaptureConfig {
            device_id: "device".into(),
            direction: ScrollDirection::Left,
            ..Default::default()
        }
        .validated()
        .unwrap_err();
        assert_eq!(direction.code, AutoCaptureErrorCode::UnsupportedDirection);

        let format = AutoCaptureConfig {
            device_id: "device".into(),
            output: OutputSettings {
                directory: None,
                format: OutputFormat::Jpeg,
            },
            ..Default::default()
        }
        .validated()
        .unwrap_err();
        assert_eq!(format.code, AutoCaptureErrorCode::UnsupportedOutputFormat);
    }
}
