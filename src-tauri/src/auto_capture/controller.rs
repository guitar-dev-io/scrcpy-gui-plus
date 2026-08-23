use image::{GenericImageView, RgbaImage};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::sync::Notify;

use crate::adb;
use crate::embed_session::{
    ensure_auto_capture_control_session, release_auto_capture_session_lease,
    swipe_existing_session, EmbedSessionState, SerialSwipeError, SerialSwipeOutcome,
};
use crate::screenshot::{capture_png_frame, decode_png_frame, resolve_output_dir};
use crate::ui_inspector::dump_ui_hierarchy_xml;

use super::algorithms::{
    EndObservation, EndOfScrollDetector, FixedRegionDetector, FrameComparator, OverlapDetector,
    OverlapKind, ScreenStabilityDetector,
};
use super::model::{
    now_iso, AutoCaptureApiError, AutoCaptureConfig, AutoCaptureDiagnostics, AutoCaptureError,
    AutoCaptureErrorCode, AutoCaptureEventPayload, AutoCaptureResult, AutoCaptureSession,
    AutoCaptureStatus, AutoCaptureTermination, CaptureRegion, FixedBounds, FixedRegionMode,
    ScrollSettings, TerminationReason,
};
use super::stitcher::{
    encode_rgba_png, export_capture, thumbnail_data_url, ExportCaptureRequest,
    LongScreenshotBuilder, SavedCapture,
};

const CAPTURE_TIMEOUT_SECS: u64 = 30;
const SCROLL_TIMEOUT_SECS: u64 = 15;
const CONTROL_SESSION_READY_TIMEOUT: Duration = Duration::from_secs(3);
const CONTROL_SESSION_READY_POLL: Duration = Duration::from_millis(50);
const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSED: u8 = 1;
const CONTROL_STOP: u8 = 2;
const CONTROL_CANCEL: u8 = 3;
const CONTROL_FINISHED: u8 = 4;
const MAX_RETAINED_SESSIONS: usize = 128;
const THUMBNAIL_RESERVE_BYTES: u64 = 512 * 1024;
const PNG_RESERVE_OVERHEAD_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FlowSignal {
    Continue,
    Stop,
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FailureClaim {
    Won,
    Stop,
    Cancel,
    Finished,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputCommit {
    Published(AutoCaptureStatus),
    Cancelled,
}

#[derive(Debug)]
enum RunAbort {
    Stop,
    Cancel,
    Failure(AutoCaptureError),
}

type RunResult<T> = Result<T, RunAbort>;

#[derive(Default)]
struct JobControl {
    command: AtomicU8,
    notify: Notify,
}

impl JobControl {
    fn pause(&self) -> bool {
        let changed = self
            .command
            .compare_exchange(
                CONTROL_RUNNING,
                CONTROL_PAUSED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok();
        if changed {
            self.notify.notify_one();
        }
        changed
    }

    fn resume(&self) -> bool {
        let changed = self
            .command
            .compare_exchange(
                CONTROL_PAUSED,
                CONTROL_RUNNING,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok();
        if changed {
            self.notify.notify_one();
        }
        changed
    }

    fn request_stop(&self) -> bool {
        loop {
            let current = self.command.load(Ordering::SeqCst);
            if matches!(current, CONTROL_CANCEL | CONTROL_STOP | CONTROL_FINISHED) {
                return false;
            }
            if self
                .command
                .compare_exchange(current, CONTROL_STOP, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                self.notify.notify_one();
                return true;
            }
        }
    }

    fn request_cancel(&self) -> bool {
        loop {
            let current = self.command.load(Ordering::SeqCst);
            if matches!(current, CONTROL_CANCEL | CONTROL_FINISHED) {
                return false;
            }
            if self
                .command
                .compare_exchange(current, CONTROL_CANCEL, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                self.notify.notify_one();
                return true;
            }
        }
    }

    /// Atomically closes the stop/cancel acceptance window before publishing a
    /// terminal result. Callers must hold the session mutex until the matching
    /// terminal metadata has been committed.
    fn seal_terminal(&self) -> FlowSignal {
        loop {
            let current = self.command.load(Ordering::SeqCst);
            let outcome = match current {
                CONTROL_STOP => FlowSignal::Stop,
                CONTROL_CANCEL => FlowSignal::Cancel,
                CONTROL_FINISHED => return FlowSignal::Continue,
                _ => FlowSignal::Continue,
            };
            if self
                .command
                .compare_exchange(
                    current,
                    CONTROL_FINISHED,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_ok()
            {
                self.notify.notify_one();
                return outcome;
            }
        }
    }

    /// Give an already accepted stop/cancel priority over an operation error.
    /// When the failure wins, CONTROL_FINISHED is claimed atomically while the
    /// caller holds the session mutex and publishes FAILED before unlocking.
    fn claim_failure(&self) -> FailureClaim {
        loop {
            let current = self.command.load(Ordering::SeqCst);
            match current {
                CONTROL_STOP => return FailureClaim::Stop,
                CONTROL_CANCEL => return FailureClaim::Cancel,
                CONTROL_FINISHED => return FailureClaim::Finished,
                _ => {
                    if self
                        .command
                        .compare_exchange(
                            current,
                            CONTROL_FINISHED,
                            Ordering::SeqCst,
                            Ordering::SeqCst,
                        )
                        .is_ok()
                    {
                        self.notify.notify_one();
                        return FailureClaim::Won;
                    }
                }
            }
        }
    }

    fn signal(&self) -> FlowSignal {
        match self.command.load(Ordering::SeqCst) {
            CONTROL_STOP => FlowSignal::Stop,
            CONTROL_CANCEL => FlowSignal::Cancel,
            _ => FlowSignal::Continue,
        }
    }

    async fn checkpoint(&self, session: &Arc<Mutex<AutoCaptureSession>>) -> FlowSignal {
        loop {
            let notified = self.notify.notified();
            match self.command.load(Ordering::SeqCst) {
                CONTROL_RUNNING => {
                    set_paused(session, false);
                    return FlowSignal::Continue;
                }
                CONTROL_PAUSED => {
                    set_paused(session, true);
                    notified.await;
                }
                CONTROL_STOP => {
                    set_paused(session, false);
                    return FlowSignal::Stop;
                }
                CONTROL_CANCEL => {
                    set_paused(session, false);
                    return FlowSignal::Cancel;
                }
                _ => return FlowSignal::Cancel,
            }
        }
    }
}

struct ActiveJob {
    session_id: String,
    generation: u64,
    control: Arc<JobControl>,
}

#[derive(Default)]
struct AutoCaptureRegistry {
    active_by_device: HashMap<String, ActiveJob>,
    sessions: HashMap<String, Arc<Mutex<AutoCaptureSession>>>,
}

#[derive(Default)]
pub struct AutoCaptureState {
    registry: Mutex<AutoCaptureRegistry>,
    next_generation: AtomicU64,
    shutting_down: AtomicBool,
}

impl AutoCaptureState {
    fn register(&self, config: &AutoCaptureConfig) -> Result<RegisteredJob, AutoCaptureApiError> {
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::Cancelled,
                "The application is shutting down",
            ));
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let id = format!(
            "auto-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            generation
        );
        let control = Arc::new(JobControl::default());
        let mut session = AutoCaptureSession::new(id.clone(), config);
        session.transition(AutoCaptureStatus::Starting)?;
        let session = Arc::new(Mutex::new(session));

        let mut registry = self.registry.lock().map_err(|_| {
            AutoCaptureError::new(
                AutoCaptureErrorCode::StreamUnavailable,
                "Auto-capture state is unavailable",
            )
        })?;
        // Recheck while holding the same lock used by shutdown's sweep. This
        // closes the race where shutdown flips the flag and clears the map
        // while a previously admitted start is waiting to insert.
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err(AutoCaptureError::new(
                AutoCaptureErrorCode::Cancelled,
                "The application is shutting down",
            ));
        }
        if let Some(active) = registry.active_by_device.get(&config.device_id) {
            return Err(AutoCaptureError::with_details(
                AutoCaptureErrorCode::Busy,
                "An auto-capture job is already active for this device",
                format!("active session: {}", active.session_id),
            ));
        }
        prune_sessions(&mut registry.sessions);
        registry.sessions.insert(id.clone(), session.clone());
        registry.active_by_device.insert(
            config.device_id.clone(),
            ActiveJob {
                session_id: id.clone(),
                generation,
                control: control.clone(),
            },
        );
        Ok(RegisteredJob {
            generation,
            session,
            control,
        })
    }

    fn active_job(&self, session_id: &str) -> Result<ActiveJobHandle, AutoCaptureApiError> {
        let registry = self.registry.lock().map_err(|_| {
            AutoCaptureError::new(
                AutoCaptureErrorCode::StreamUnavailable,
                "Auto-capture state is unavailable",
            )
        })?;
        let (device_id, active) = registry
            .active_by_device
            .iter()
            .find(|(_, active)| active.session_id == session_id)
            .ok_or_else(|| {
                AutoCaptureError::new(
                    AutoCaptureErrorCode::InvalidConfig,
                    "Unknown or inactive auto-capture session",
                )
            })?;
        let session = registry.sessions.get(session_id).cloned().ok_or_else(|| {
            AutoCaptureError::new(
                AutoCaptureErrorCode::StreamUnavailable,
                "Auto-capture session metadata is unavailable",
            )
        })?;
        Ok(ActiveJobHandle {
            device_id: device_id.clone(),
            control: active.control.clone(),
            session,
        })
    }

    fn session(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<AutoCaptureSession>>, AutoCaptureApiError> {
        self.registry
            .lock()
            .map_err(|_| {
                AutoCaptureError::new(
                    AutoCaptureErrorCode::StreamUnavailable,
                    "Auto-capture state is unavailable",
                )
            })?
            .sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                AutoCaptureError::new(
                    AutoCaptureErrorCode::InvalidConfig,
                    "Unknown auto-capture session",
                )
            })
    }

    fn finish(&self, device_id: &str, session_id: &str, generation: u64) {
        if let Ok(mut registry) = self.registry.lock() {
            let should_remove = registry
                .active_by_device
                .get(device_id)
                .is_some_and(|active| {
                    active.session_id == session_id && active.generation == generation
                });
            if should_remove {
                registry.active_by_device.remove(device_id);
            }
        }
    }

    /// Synchronously marks all jobs cancelled and wakes every paused/sleeping
    /// task. The task itself owns all image memory and performs final cleanup;
    /// clearing the active map makes shutdown idempotent and prevents orphans.
    pub fn shutdown(&self) {
        if self.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut registry) = self.registry.lock() {
            let active_jobs: Vec<(String, Arc<JobControl>)> = registry
                .active_by_device
                .values()
                .map(|active| (active.session_id.clone(), active.control.clone()))
                .collect();
            for (session_id, control) in active_jobs {
                if control.request_cancel() {
                    if let Some(session) = registry.sessions.get(&session_id) {
                        mark_cancelled_metadata(session);
                    }
                }
            }
            registry.active_by_device.clear();
        }
    }
}

struct RegisteredJob {
    generation: u64,
    session: Arc<Mutex<AutoCaptureSession>>,
    control: Arc<JobControl>,
}

struct ActiveJobHandle {
    #[allow(dead_code)]
    device_id: String,
    control: Arc<JobControl>,
    session: Arc<Mutex<AutoCaptureSession>>,
}

struct ActiveRemovalGuard {
    app: AppHandle,
    device_id: String,
    session_id: String,
    generation: u64,
}

impl Drop for ActiveRemovalGuard {
    fn drop(&mut self) {
        self.app.state::<AutoCaptureState>().finish(
            &self.device_id,
            &self.session_id,
            self.generation,
        );
    }
}

struct RunContext {
    app: AppHandle,
    window: Window,
    session: Arc<Mutex<AutoCaptureSession>>,
    control: Arc<JobControl>,
    config: AutoCaptureConfig,
}

struct CapturedFrame {
    png: Vec<u8>,
    image: RgbaImage,
}

struct StabilityOutcome {
    frame: CapturedFrame,
    last_score: Option<f64>,
    timed_out: bool,
}

struct CaptureResources {
    builder: LongScreenshotBuilder,
    individual_frames: Vec<Vec<u8>>,
    raw_frames_bytes: u64,
    /// Untouched first full-resolution frame; source of fixedTop.
    first_raw: RgbaImage,
    /// Untouched latest full-resolution frame; source of fixedBottom.
    previous: RgbaImage,
    /// Final horizontal/vertical output bounds after configurable system-bar exclusion.
    output_region: CaptureRegion,
    /// Body-only ROI used for stability, overlap, displacement, and stitched tails.
    matching_roi: CaptureRegion,
}

#[derive(Clone, Copy)]
struct FinalDisposition {
    terminal_status: AutoCaptureStatus,
    termination_reason: TerminationReason,
    termination_code: Option<AutoCaptureErrorCode>,
    complete: bool,
}

#[tauri::command]
pub fn start_auto_capture(
    window: Window,
    state: State<'_, AutoCaptureState>,
    config: AutoCaptureConfig,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let config = config.validated()?;
    adb::validate_serial(&config.device_id).map_err(|error| {
        AutoCaptureError::with_details(
            AutoCaptureErrorCode::InvalidConfig,
            "deviceId is not a valid ADB serial",
            error.message(),
        )
    })?;
    let registered = state.register(&config)?;
    let snapshot = session_snapshot(&registered.session)?;
    emit_event(
        &window,
        "auto-capture-started",
        &registered.session,
        Some(AutoCaptureDiagnostics::adb_capture()),
        None,
        None,
    );
    log_line(
        &window,
        &snapshot.id,
        "INFO",
        "registered auto-capture job; captureSource=ADB_SCREENCAP_PNG",
    );

    let app = window.app_handle().clone();
    let task_window = window.clone();
    let task_config = config.clone();
    tauri::async_runtime::spawn(async move {
        run_auto_capture_job(
            app,
            task_window,
            registered.session,
            registered.control,
            task_config,
            registered.generation,
        )
        .await;
    });
    Ok(snapshot)
}

#[tauri::command]
pub fn pause_auto_capture(
    state: State<'_, AutoCaptureState>,
    session_id: String,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let active = state.active_job(session_id.trim())?;
    if active.control.pause() {
        set_paused(&active.session, true);
    }
    // Terminal publishers hold this mutex across CONTROL_FINISHED and the
    // terminal metadata commit, so a rejected command cannot see STITCHING.
    session_snapshot(&active.session)
}

#[tauri::command]
pub fn resume_auto_capture(
    state: State<'_, AutoCaptureState>,
    session_id: String,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let active = state.active_job(session_id.trim())?;
    if active.control.resume() {
        set_paused(&active.session, false);
    }
    session_snapshot(&active.session)
}

#[tauri::command]
pub fn stop_auto_capture(
    state: State<'_, AutoCaptureState>,
    session_id: String,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let active = state.active_job(session_id.trim())?;
    let accepted = active.control.request_stop();
    let snapshot = session_snapshot(&active.session)?;
    if !accepted {
        debug_assert!(
            snapshot.status.is_terminal() || active.control.signal() != FlowSignal::Continue
        );
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn cancel_auto_capture(
    state: State<'_, AutoCaptureState>,
    session_id: String,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let active = state.active_job(session_id.trim())?;
    let accepted = active.control.request_cancel();
    let snapshot = session_snapshot(&active.session)?;
    if !accepted {
        debug_assert!(
            snapshot.status.is_terminal() || active.control.signal() == FlowSignal::Cancel
        );
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn get_auto_capture_session(
    state: State<'_, AutoCaptureState>,
    session_id: String,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    let session = state.session(session_id.trim())?;
    session_snapshot(&session)
}

async fn run_auto_capture_job(
    app: AppHandle,
    window: Window,
    session: Arc<Mutex<AutoCaptureSession>>,
    control: Arc<JobControl>,
    config: AutoCaptureConfig,
    generation: u64,
) {
    let session_id = session
        .lock()
        .map(|value| value.id.clone())
        .unwrap_or_else(|_| "unknown".to_string());
    let _removal_guard = ActiveRemovalGuard {
        app: app.clone(),
        device_id: config.device_id.clone(),
        session_id: session_id.clone(),
        generation,
    };
    let context = RunContext {
        app,
        window,
        session,
        control,
        config,
    };

    let result = run_capture_loop(&context).await;
    match result {
        Ok(()) => {}
        Err(RunAbort::Stop) => {
            // A stop is normally consumed inside the loop where the builder is
            // available. Reaching here means no usable first frame existed.
            finish_without_output(
                &context,
                AutoCaptureStatus::Stopped,
                TerminationReason::UserStopped,
            );
        }
        Err(RunAbort::Cancel) => finish_cancelled(&context),
        Err(RunAbort::Failure(error)) => match finish_failed(&context, error) {
            FlowSignal::Continue => {}
            FlowSignal::Stop => finish_without_output(
                &context,
                AutoCaptureStatus::Stopped,
                TerminationReason::UserStopped,
            ),
            FlowSignal::Cancel => finish_cancelled(&context),
        },
    }

    // An auto-capture-owned scrcpy server is temporary. Exact-id release is a
    // no-op when this job reused a frontend/remote session or never acquired
    // a lease, and cannot clear a newer capture's lease.
    release_auto_capture_session_lease(&context.app, &context.window, &session_id).await;
}

async fn run_capture_loop(context: &RunContext) -> RunResult<()> {
    check_signal(context).await?;
    let output_directory =
        resolve_output_dir(&context.app, context.config.output.directory.as_deref()).map_err(
            |(code, message)| {
                RunAbort::Failure(AutoCaptureError::with_details(
                    AutoCaptureErrorCode::InvalidConfig,
                    "The output directory is unavailable",
                    format!("{code}: {message}"),
                ))
            },
        )?;

    set_status(context, AutoCaptureStatus::Capturing)?;
    let initial = capture_checked(context, None).await?;
    let dimensions = initial.image.dimensions();
    let (output_region, mut matching_roi, region_source, region_note) =
        determine_capture_regions(context, &initial.image).await?;
    let stop_after_initial = match context.control.checkpoint(&context.session).await {
        FlowSignal::Continue => false,
        FlowSignal::Stop => true,
        FlowSignal::Cancel => return Err(RunAbort::Cancel),
    };
    let mut diagnostics = AutoCaptureDiagnostics::adb_capture();
    diagnostics.region_source = Some(region_source);
    diagnostics.note = region_note;
    set_debug_regions(
        &mut diagnostics,
        dimensions,
        output_region,
        matching_roi,
        None,
    );

    let initial_peak = rgba_allocation_bytes(dimensions.0, dimensions.1)
        .saturating_mul(2)
        .saturating_add(initial.png.len() as u64)
        .saturating_add(
            rgba_allocation_bytes(matching_roi.width(), matching_roi.height()).saturating_mul(2),
        )
        .saturating_add(THUMBNAIL_RESERVE_BYTES);
    ensure_memory_budget(context, initial_peak, "initial frame preparation")?;

    let mut builder = LongScreenshotBuilder::new(
        matching_roi.width(),
        context.config.max_frames,
        context.config.max_height,
        context.config.max_memory_mb,
    );
    builder
        .add_region(&initial.image, matching_roi)
        .map_err(RunAbort::Failure)?;
    let initial_png_bytes = initial.png.len() as u64;
    let CapturedFrame {
        png: initial_png,
        image: initial_image,
    } = initial;
    let mut resources = CaptureResources {
        builder,
        individual_frames: if context.config.save_individual_frames {
            vec![initial_png]
        } else {
            Vec::new()
        },
        raw_frames_bytes: if context.config.save_individual_frames {
            initial_png_bytes
        } else {
            0
        },
        first_raw: initial_image.clone(),
        previous: initial_image,
        output_region,
        matching_roi,
    };
    ensure_retained_memory_budget(context, &resources)?;
    accept_frame(context, &resources.previous, diagnostics.clone())?;

    // Keep CaptureResources owned by this scope while the post-initial state
    // machine borrows it. If an operation fails after a stop was accepted, the
    // retained builder is still available for a partial STOPPED export.
    let capture_outcome: RunResult<FinalDisposition> = async {
        if stop_after_initial {
            return Err(RunAbort::Stop);
        }

        if context.config.max_frames == 1 {
            return Ok(FinalDisposition {
                terminal_status: AutoCaptureStatus::Completed,
                termination_reason: TerminationReason::SegmentLimit,
                termination_code: Some(AutoCaptureErrorCode::CaptureLimitReached),
                complete: false,
            });
        }

        let mut end_detector = EndOfScrollDetector::new(context.config.end_confirmations);
        let mut fixed_bands_applied = context.config.fixed_region_mode != FixedRegionMode::Auto;
        let mut observed_scroll_movement = false;

        loop {
            match context.control.checkpoint(&context.session).await {
                FlowSignal::Continue => {}
                FlowSignal::Stop => return Err(RunAbort::Stop),
                FlowSignal::Cancel => return Err(RunAbort::Cancel),
            }

            set_status(context, AutoCaptureStatus::Scrolling)?;
            emit_event(
                &context.window,
                "auto-capture-scrolling",
                &context.session,
                Some(AutoCaptureDiagnostics::adb_capture()),
                None,
                None,
            );
            let control_source =
                match perform_scroll(context, dimensions.0, dimensions.1, resources.matching_roi)
                    .await
                {
                    Ok(source) => source,
                    Err(RunAbort::Stop) => return Err(RunAbort::Stop),
                    Err(other) => return Err(other),
                };
            let used_adb_input = control_source == "ADB_INPUT";
            match check_signal(context).await {
                Ok(()) => {}
                Err(RunAbort::Stop) => return Err(RunAbort::Stop),
                Err(other) => return Err(other),
            }

            ensure_stability_memory_budget(context, &resources, dimensions)?;
            set_status(context, AutoCaptureStatus::WaitingStable)?;
            let mut stability =
                match wait_for_stability(context, dimensions, resources.matching_roi).await {
                    Ok(stability) => stability,
                    Err(RunAbort::Stop) => return Err(RunAbort::Stop),
                    Err(other) => return Err(other),
                };
            match check_signal(context).await {
                Ok(()) => {}
                Err(RunAbort::Stop) => return Err(RunAbort::Stop),
                Err(other) => return Err(other),
            }
            set_status(context, AutoCaptureStatus::Processing)?;

            diagnostics = AutoCaptureDiagnostics::adb_capture();
            diagnostics.control_source = Some(control_source);
            diagnostics.region_source = Some(if fixed_bands_applied {
                "FIXED_REGION".to_string()
            } else {
                "VIEWPORT_OR_UIAUTOMATOR".to_string()
            });
            diagnostics.stability_score = stability.last_score;
            diagnostics.stability_timed_out = stability.timed_out;
            if stability.timed_out {
                diagnostics.recoverable_error = Some(AutoCaptureError::new(
                    AutoCaptureErrorCode::StabilityTimeout,
                    "Screen stability timed out; the latest available frame was used",
                ));
                log_line(
                    &context.window,
                    &session_id(context),
                    "WARN",
                    "STABILITY_TIMEOUT recovered with latest ADB screenshot frame",
                );
            }

            ensure_processing_memory_budget(
                context,
                &resources,
                &stability.frame,
                resources.matching_roi.height(),
            )?;
            let mut overlap = OverlapDetector::detect(
                &resources.previous,
                &stability.frame.image,
                resources.matching_roi,
            );

            let needs_alignment_retry = overlap.kind == OverlapKind::None
                && !FrameComparator::compare(
                    &resources.previous,
                    &stability.frame.image,
                    resources.matching_roi,
                )
                .is_some_and(|value| {
                    FrameComparator::is_tolerantly_stable(
                        value,
                        context.config.stability.difference_threshold,
                    )
                });
            if needs_alignment_retry {
                diagnostics.note = Some(
                    "Initial alignment failed; recapturing after an additional settle period"
                        .to_string(),
                );
                emit_event(
                    &context.window,
                    "auto-capture-processing",
                    &context.session,
                    Some(diagnostics.clone()),
                    None,
                    None,
                );
                log_line(
                    &context.window,
                    &session_id(context),
                    "WARN",
                    "initial overlap match failed; retrying capture without another scroll",
                );

                // The first post-scroll frame is no longer needed. Drop it
                // before recovery sampling so the retry remains inside the
                // configured memory budget.
                drop(stability);
                let recovery_delay_ms = context
                    .config
                    .stability
                    .interval_ms
                    .saturating_mul(2)
                    .clamp(200, 500);
                interruptible_sleep(context, Duration::from_millis(recovery_delay_ms)).await?;
                ensure_stability_memory_budget(context, &resources, dimensions)?;
                stability = match wait_for_stability(
                    context,
                    dimensions,
                    resources.matching_roi,
                )
                .await
                {
                    Ok(stability) => stability,
                    Err(RunAbort::Stop) => return Err(RunAbort::Stop),
                    Err(other) => return Err(other),
                };
                check_signal(context).await?;
                ensure_processing_memory_budget(
                    context,
                    &resources,
                    &stability.frame,
                    resources.matching_roi.height(),
                )?;

                let recovered_overlap = OverlapDetector::detect(
                    &resources.previous,
                    &stability.frame.image,
                    resources.matching_roi,
                );
                let recovered_is_stationary = recovered_overlap.kind == OverlapKind::None
                    && FrameComparator::compare(
                        &resources.previous,
                        &stability.frame.image,
                        resources.matching_roi,
                    )
                    .is_some_and(|value| {
                        FrameComparator::is_tolerantly_stable(
                            value,
                            context.config.stability.difference_threshold,
                        )
                    });

                diagnostics.stability_score = stability.last_score;
                diagnostics.stability_timed_out = stability.timed_out;
                diagnostics.recoverable_error = stability.timed_out.then(|| {
                    AutoCaptureError::new(
                        AutoCaptureErrorCode::StabilityTimeout,
                        "Screen stability timed out during alignment recovery",
                    )
                });
                if recovered_overlap.kind == OverlapKind::None && !recovered_is_stationary {
                    diagnostics.overlap_score = None;
                    diagnostics.overlap_confidence = Some(0.0);
                    diagnostics.recoverable_error = Some(AutoCaptureError::new(
                        AutoCaptureErrorCode::ImageProcessingFailed,
                        "Alignment was lost; the successfully stitched portion will be saved",
                    ));
                    diagnostics.note = Some(
                        "Alignment retry failed; exporting the accepted panorama as a partial result"
                            .to_string(),
                    );
                    emit_event(
                        &context.window,
                        "auto-capture-processing",
                        &context.session,
                        Some(diagnostics.clone()),
                        None,
                        None,
                    );
                    log_line(
                        &context.window,
                        &session_id(context),
                        "WARN",
                        "alignment recovery failed; exporting accepted segments as partial output",
                    );
                    return Ok(FinalDisposition {
                        terminal_status: AutoCaptureStatus::Completed,
                        termination_reason: TerminationReason::AlignmentLost,
                        termination_code: Some(AutoCaptureErrorCode::ImageProcessingFailed),
                        complete: false,
                    });
                }

                overlap = recovered_overlap;
                diagnostics.note = Some(if recovered_is_stationary {
                    "Recovery frame showed no document movement; treating it as an end candidate"
                        .to_string()
                } else {
                    "Alignment recovered from a fresh stable frame without another scroll"
                        .to_string()
                });
                log_line(
                    &context.window,
                    &session_id(context),
                    "INFO",
                    "alignment recovered without dispatching another scroll gesture",
                );
            }

            if !fixed_bands_applied
                && context.config.fixed_region_mode == FixedRegionMode::Auto
                && overlap.kind == OverlapKind::Match
            {
                let bands = FixedRegionDetector::detect_sticky_bands(
                    &resources.previous,
                    &stability.frame.image,
                    resources.matching_roi,
                );
                let selected = FixedBounds {
                    top: if context.config.remove_sticky_header {
                        bands.top
                    } else {
                        0
                    },
                    bottom: if context.config.remove_sticky_footer {
                        bands.bottom
                    } else {
                        0
                    },
                };
                if selected.top > 0 || selected.bottom > 0 {
                    if let Some(adjusted) =
                        FixedRegionDetector::apply_fixed_bounds(resources.matching_roi, selected)
                    {
                        // Validate the proposed body ROI before mutating either
                        // the builder or the active region. Sticky-band
                        // detection is heuristic; if removing those bands
                        // destroys alignment, retain the already-proven ROI
                        // instead of terminating the capture prematurely.
                        ensure_processing_memory_budget(
                            context,
                            &resources,
                            &stability.frame,
                            adjusted.height(),
                        )?;
                        let adjusted_overlap = OverlapDetector::detect(
                            &resources.previous,
                            &stability.frame.image,
                            adjusted,
                        );
                        if adjusted_overlap.kind == OverlapKind::Match {
                            resources
                                .builder
                                .replace_first_region(&resources.previous, adjusted)
                                .map_err(RunAbort::Failure)?;
                            resources.matching_roi = adjusted;
                            matching_roi = adjusted;
                            overlap = adjusted_overlap;
                            diagnostics.note = Some(format!(
                                "Detected fixed bands top={} bottom={}; keeping each once",
                                selected.top, selected.bottom
                            ));
                        } else {
                            diagnostics.note = Some(format!(
                                "Ignored fixed-band candidate top={} bottom={} because the adjusted region did not align",
                                selected.top, selected.bottom
                            ));
                            log_line(
                                &context.window,
                                &session_id(context),
                                "WARN",
                                "fixed-band ROI failed validation; retaining the previously aligned region",
                            );
                        }
                    }
                }
                fixed_bands_applied = true;
            }

            diagnostics.overlap_score = overlap.score.is_finite().then_some(overlap.score);
            diagnostics.overlap_confidence = Some(overlap.confidence);
            set_debug_regions(
                &mut diagnostics,
                dimensions,
                resources.output_region,
                resources.matching_roi,
                (overlap.kind == OverlapKind::Match).then_some(CaptureRegion {
                    left: resources.matching_roi.left,
                    top: overlap.overlap_start,
                    right: resources.matching_roi.right,
                    bottom: overlap.overlap_end,
                }),
            );
            let minimum_new_rows = EndOfScrollDetector::minimum_new_rows(resources.matching_roi);
            // Do not synthesize pixels over suspected floating overlays. Without
            // a clean background frame, interpolation can corrupt sparse text
            // and product images that happen to remain near the same viewport
            // position. Preserving the source tail is lossless; sticky
            // headers/footers are still handled by the bounded region above.
            emit_event(
                &context.window,
                "auto-capture-processing",
                &context.session,
                Some(diagnostics.clone()),
                None,
                None,
            );

            let CapturedFrame {
                png: current_png,
                image: current_image,
            } = stability.frame;
            if current_image.dimensions() != dimensions {
                return Err(RunAbort::Failure(AutoCaptureError::with_details(
                    AutoCaptureErrorCode::DimensionChanged,
                    "Screen dimensions changed during auto capture",
                    format!(
                        "expected {:?}, got {:?}",
                        dimensions,
                        current_image.dimensions()
                    ),
                )));
            }

            if context.config.save_individual_frames {
                resources.raw_frames_bytes = resources
                    .raw_frames_bytes
                    .saturating_add(current_png.len() as u64);
                resources.individual_frames.push(current_png);
            } else {
                drop(current_png);
            }
            accept_frame(context, &current_image, diagnostics.clone())?;

            let observation = match overlap.kind {
                OverlapKind::Match if overlap.new_content_rows >= minimum_new_rows => {
                    if context.config.stitch {
                        let mut tail = current_image
                            .view(
                                matching_roi.left,
                                overlap.overlap_end,
                                matching_roi.width(),
                                matching_roi.bottom.saturating_sub(overlap.overlap_end),
                            )
                            .to_image();
                        let fixed_overlay_rects =
                            super::algorithms::FixedOverlayDetector::detect(
                                &resources.previous,
                                &current_image,
                                resources.matching_roi,
                                overlap.new_content_rows,
                            );
                        let concealed_overlays =
                            super::algorithms::FixedOverlayDetector::conceal_tail(
                                &mut tail,
                                resources.matching_roi.left,
                                overlap.overlap_end,
                                &fixed_overlay_rects,
                            );
                        if concealed_overlays > 0 {
                            log_line(
                                &context.window,
                                &session_id(context),
                                "INFO",
                                &format!(
                                    "concealed {concealed_overlays} fixed overlay(s) from stitched tail"
                                ),
                            );
                        }
                        resources
                            .builder
                            .add_segment(tail)
                            .map_err(RunAbort::Failure)?;
                    }
                    EndObservation::Continuation
                }
                OverlapKind::Match | OverlapKind::Identical => EndObservation::NoNewContent,
                OverlapKind::None => {
                    let comparison = FrameComparator::compare(
                        &resources.previous,
                        &current_image,
                        resources.matching_roi,
                    );
                    if comparison.is_some_and(|value| {
                        FrameComparator::is_tolerantly_stable(
                            value,
                            context.config.stability.difference_threshold,
                        )
                    }) {
                        EndObservation::NoNewContent
                    } else {
                        log_line(
                            &context.window,
                            &session_id(context),
                            "WARN",
                            "unaligned frame reached the final guard; exporting partial output",
                        );
                        return Ok(FinalDisposition {
                            terminal_status: AutoCaptureStatus::Completed,
                            termination_reason: TerminationReason::AlignmentLost,
                            termination_code: Some(AutoCaptureErrorCode::ImageProcessingFailed),
                            complete: false,
                        });
                    }
                }
            };

            if matches!(&observation, EndObservation::Continuation) {
                observed_scroll_movement = true;
            }
            let reached_end = end_detector.observe(observation);
            resources.previous = current_image;
            ensure_retained_memory_budget(context, &resources)?;

            if reached_end {
                if !observed_scroll_movement && used_adb_input {
                    log_line(
                        &context.window,
                        &session_id(context),
                        "ERROR",
                        "ADB input reported success but the scrollable region never moved",
                    );
                    return Err(RunAbort::Failure(AutoCaptureError::with_details(
                        AutoCaptureErrorCode::ScrollFailed,
                        "ADB scroll input did not move the detected scrollable region",
                        "The device accepted adb shell input swipe twice without observable content movement; a successful command exit is not treated as capture completion",
                    )));
                }
                return Ok(FinalDisposition {
                    terminal_status: AutoCaptureStatus::Completed,
                    termination_reason: TerminationReason::ContentEnd,
                    termination_code: None,
                    complete: true,
                });
            }

            let count = context
                .session
                .lock()
                .map(|session| session.capture_count)
                .unwrap_or(context.config.max_frames);
            if count >= context.config.max_frames {
                return Ok(FinalDisposition {
                    terminal_status: AutoCaptureStatus::Completed,
                    termination_reason: TerminationReason::SegmentLimit,
                    termination_code: Some(AutoCaptureErrorCode::CaptureLimitReached),
                    complete: false,
                });
            }
        }
    }
    .await;

    match capture_outcome {
        Ok(disposition) => {
            finalize_capture(context, output_directory, resources, disposition).await
        }
        Err(RunAbort::Stop) => {
            finalize_capture(context, output_directory, resources, stopped_disposition()).await
        }
        Err(RunAbort::Cancel) => Err(RunAbort::Cancel),
        Err(RunAbort::Failure(error)) => match finish_failed(context, error) {
            FlowSignal::Continue => Ok(()),
            FlowSignal::Stop => {
                finalize_capture(context, output_directory, resources, stopped_disposition()).await
            }
            FlowSignal::Cancel => Err(RunAbort::Cancel),
        },
    }
}

async fn determine_capture_regions(
    context: &RunContext,
    frame: &RgbaImage,
) -> RunResult<(CaptureRegion, CaptureRegion, String, Option<String>)> {
    let (width, height) = frame.dimensions();
    let mut note = None;
    let (detected_region, source) = if let Some(manual) = context.config.manual_region {
        let region = manual.clamp_to(width, height).ok_or_else(|| {
            RunAbort::Failure(AutoCaptureError::new(
                AutoCaptureErrorCode::InvalidConfig,
                "manualRegion is outside the captured screen",
            ))
        })?;
        // A manual region is an exact requested output; do not infer bars or
        // fixed bands inside it.
        return Ok((region, region, "MANUAL".to_string(), note));
    } else if context.config.detect_region {
        match dump_ui_hierarchy_xml(
            &context.config.device_id,
            context.config.custom_path.clone(),
        )
        .await
        {
            Ok(xml) => match FixedRegionDetector::largest_scrollable_region(&xml, width, height) {
                Some(region) => (region, "UIAUTOMATOR".to_string()),
                None if context.config.require_scrollable_region => {
                    return Err(RunAbort::Failure(AutoCaptureError::new(
                        AutoCaptureErrorCode::NoScrollableRegion,
                        "No visible scrollable UIAutomator region was found",
                    )))
                }
                None => {
                    note = Some(
                        "No UIAutomator scrollable region; using viewport vision fallback"
                            .to_string(),
                    );
                    (full_region(width, height), "VIEWPORT_FALLBACK".to_string())
                }
            },
            Err((code, message)) if is_device_disconnect_code(&code) => {
                return Err(RunAbort::Failure(AutoCaptureError::with_details(
                    AutoCaptureErrorCode::DeviceDisconnected,
                    "The device disconnected while detecting the scroll region",
                    message,
                )))
            }
            Err((code, message)) if context.config.require_scrollable_region => {
                return Err(RunAbort::Failure(AutoCaptureError::with_details(
                    AutoCaptureErrorCode::NoScrollableRegion,
                    "The required scrollable region could not be detected",
                    format!("{code}: {message}"),
                )))
            }
            Err((code, message)) => {
                note = Some(format!(
                    "UIAutomator region hint unavailable ({code}: {message}); using viewport fallback"
                ));
                (full_region(width, height), "VIEWPORT_FALLBACK".to_string())
            }
        }
    } else {
        (full_region(width, height), "VIEWPORT".to_string())
    };

    // The output region controls only final inclusion. False means include the
    // system bar once from a raw edge frame; true excludes it. The matching ROI
    // always excludes bars so they cannot be duplicated or influence alignment.
    let vertical_output = CaptureRegion {
        left: detected_region.left,
        top: 0,
        right: detected_region.right,
        bottom: height,
    };
    let output_region = FixedRegionDetector::apply_conservative_system_bars(
        vertical_output,
        height,
        context.config.remove_status_bar,
        context.config.remove_navigation_bar,
    );
    let mut matching_roi =
        FixedRegionDetector::apply_conservative_system_bars(detected_region, height, true, true);
    matching_roi.top = matching_roi.top.max(output_region.top);
    matching_roi.bottom = matching_roi.bottom.min(output_region.bottom);

    if context.config.fixed_region_mode == FixedRegionMode::Manual {
        matching_roi = FixedRegionDetector::apply_fixed_bounds(
            matching_roi,
            context.config.manual_fixed_bounds.unwrap_or_default(),
        )
        .ok_or_else(|| {
            RunAbort::Failure(AutoCaptureError::new(
                AutoCaptureErrorCode::InvalidConfig,
                "manualFixedBounds remove the entire capture region",
            ))
        })?;
    }
    if !output_region.is_valid() || !matching_roi.is_valid() || matching_roi.height() < 64 {
        return Err(RunAbort::Failure(AutoCaptureError::new(
            AutoCaptureErrorCode::ImageProcessingFailed,
            "The effective capture region is too small",
        )));
    }
    Ok((output_region, matching_roi, source, note))
}

fn set_debug_regions(
    diagnostics: &mut AutoCaptureDiagnostics,
    dimensions: (u32, u32),
    output_region: CaptureRegion,
    matching_roi: CaptureRegion,
    detected_overlap: Option<CaptureRegion>,
) {
    diagnostics.raw_frame_region = Some(full_region(dimensions.0, dimensions.1));
    diagnostics.scrollable_region = Some(matching_roi);
    diagnostics.fixed_top_region =
        (matching_roi.top > output_region.top).then_some(CaptureRegion {
            left: output_region.left,
            top: output_region.top,
            right: output_region.right,
            bottom: matching_roi.top,
        });
    diagnostics.fixed_bottom_region =
        (matching_roi.bottom < output_region.bottom).then_some(CaptureRegion {
            left: output_region.left,
            top: matching_roi.bottom,
            right: output_region.right,
            bottom: output_region.bottom,
        });
    diagnostics.detected_overlap_region = detected_overlap.filter(|region| region.is_valid());
}

async fn capture_checked(
    context: &RunContext,
    expected_dimensions: Option<(u32, u32)>,
) -> RunResult<CapturedFrame> {
    check_signal(context).await?;
    let bytes = capture_png_frame(
        &context.config.device_id,
        context.config.custom_path.clone(),
        CAPTURE_TIMEOUT_SECS,
    )
    .await
    .map_err(|(code, message)| {
        RunAbort::Failure(classify_backend_error(
            &code,
            &message,
            AutoCaptureErrorCode::ScreenCaptureFailed,
            "Screen capture failed",
        ))
    })?;
    check_signal(context).await?;
    if let Some((png_width, png_height)) = png_dimensions(&bytes) {
        let decode_peak =
            (bytes.len() as u64).saturating_add(rgba_allocation_bytes(png_width, png_height));
        ensure_memory_budget(context, decode_peak, "PNG decode")?;
    }
    let image = decode_png_frame(&bytes).map_err(|(code, message)| {
        RunAbort::Failure(AutoCaptureError::with_details(
            if code == "size_limit" {
                AutoCaptureErrorCode::OutputTooLarge
            } else {
                AutoCaptureErrorCode::ImageProcessingFailed
            },
            "Captured PNG could not be decoded safely",
            format!("{code}: {message}"),
        ))
    })?;
    if let Some(expected) = expected_dimensions {
        if image.dimensions() != expected {
            return Err(RunAbort::Failure(AutoCaptureError::with_details(
                AutoCaptureErrorCode::DimensionChanged,
                "Screen dimensions or orientation changed during capture",
                format!("expected {:?}, got {:?}", expected, image.dimensions()),
            )));
        }
    }
    check_signal(context).await?;
    Ok(CapturedFrame { png: bytes, image })
}

fn swipe_coordinates(settings: &ScrollSettings, region: CaptureRegion) -> (i32, i32, i32, i32) {
    let scale = |origin: u32, length: u32, ratio: f64| {
        let offset = (ratio * f64::from(length.saturating_sub(1))).round() as u32;
        origin.saturating_add(offset).min(i32::MAX as u32) as i32
    };
    (
        scale(region.left, region.width(), settings.start_x),
        scale(region.top, region.height(), settings.start_y),
        scale(region.left, region.width(), settings.end_x),
        scale(region.top, region.height(), settings.end_y),
    )
}

async fn perform_scroll(
    context: &RunContext,
    width: u32,
    height: u32,
    region: CaptureRegion,
) -> RunResult<String> {
    check_signal(context).await?;
    let settings = &context.config.scroll_settings;
    let (start_x, start_y, end_x, end_y) = swipe_coordinates(settings, region);
    let embedded_state = context.app.state::<EmbedSessionState>();
    let mut swipe_result = swipe_existing_session(
        &embedded_state,
        &context.config.device_id,
        width,
        height,
        start_x,
        start_y,
        end_x,
        end_y,
        settings.duration_ms,
    )
    .await;

    if matches!(&swipe_result, Ok(SerialSwipeOutcome::NoUsableSession)) {
        let lease_id = session_id(context);
        match ensure_auto_capture_control_session(
            context.window.clone(),
            &embedded_state,
            context.config.device_id.clone(),
            context.config.custom_path.clone(),
            lease_id.clone(),
        )
        .await
        {
            Ok(auto_started) => {
                log_line(
                    &context.window,
                    &lease_id,
                    "INFO",
                    &format!(
                        "prepared scrcpy control for auto-capture; autoStarted={auto_started}"
                    ),
                );
                check_signal(context).await?;
                let readiness_started = Instant::now();
                loop {
                    swipe_result = swipe_existing_session(
                        &embedded_state,
                        &context.config.device_id,
                        width,
                        height,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        settings.duration_ms,
                    )
                    .await;
                    match &swipe_result {
                        Ok(SerialSwipeOutcome::NoUsableSession)
                            if readiness_started.elapsed() < CONTROL_SESSION_READY_TIMEOUT =>
                        {
                            interruptible_sleep(context, CONTROL_SESSION_READY_POLL).await?;
                        }
                        Ok(SerialSwipeOutcome::NoUsableSession) => {
                            log_line(
                                &context.window,
                                &lease_id,
                                "WARN",
                                "scrcpy control session did not publish video dimensions before the readiness deadline; trying ADB input once",
                            );
                            break;
                        }
                        _ => break,
                    }
                }
            }
            Err(message) => {
                log_line(
                    &context.window,
                    &lease_id,
                    "WARN",
                    &format!(
                        "could not prepare scrcpy control session ({message}); trying ADB input once"
                    ),
                );
            }
        }
    }

    let source = match swipe_result {
        Ok(SerialSwipeOutcome::Sent) => "SCRCPY_CONTROL".to_string(),
        Ok(SerialSwipeOutcome::NoUsableSession) => {
            let args = [
                "shell".to_string(),
                "input".to_string(),
                "swipe".to_string(),
                start_x.to_string(),
                start_y.to_string(),
                end_x.to_string(),
                end_y.to_string(),
                settings.duration_ms.to_string(),
            ];
            let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
            adb::run_adb_text(
                Some(&context.config.device_id),
                &borrowed,
                context.config.custom_path.clone(),
                SCROLL_TIMEOUT_SECS,
            )
            .await
            .map_err(|error| {
                RunAbort::Failure(classify_backend_error(
                    error.code(),
                    &error.message(),
                    AutoCaptureErrorCode::ScrollFailed,
                    "ADB fallback scroll failed",
                ))
            })?;
            "ADB_INPUT".to_string()
        }
        Err(SerialSwipeError::StateUnavailable(message)) => {
            return Err(RunAbort::Failure(AutoCaptureError::with_details(
                AutoCaptureErrorCode::StreamUnavailable,
                "Embedded control state is unavailable",
                message,
            )))
        }
        Err(SerialSwipeError::InvalidGeometry(message))
        | Err(SerialSwipeError::WriteFailed(message)) => {
            // Never retry through ADB after a control-socket write: a partial
            // gesture may already have reached Android and retrying can double
            // scroll.
            return Err(RunAbort::Failure(AutoCaptureError::with_details(
                AutoCaptureErrorCode::ScrollFailed,
                "scrcpy control swipe failed",
                message,
            )));
        }
    };
    check_signal(context).await?;
    log_line(
        &context.window,
        &session_id(context),
        "DEBUG",
        &format!(
            "scroll gesture dispatched via {source}; device={} frame={}x{} start=({}, {}) end=({}, {}) durationMs={}",
            context.config.device_id,
            width,
            height,
            start_x,
            start_y,
            end_x,
            end_y,
            settings.duration_ms
        ),
    );
    Ok(source)
}

async fn wait_for_stability(
    context: &RunContext,
    dimensions: (u32, u32),
    region: CaptureRegion,
) -> RunResult<StabilityOutcome> {
    let started = Instant::now();
    let timeout = Duration::from_millis(context.config.stability.timeout_ms);
    let interval = Duration::from_millis(context.config.stability.interval_ms);
    let mut detector = ScreenStabilityDetector::new(
        context.config.stability.difference_threshold,
        context.config.stability.stable_samples,
    );
    let mut latest = capture_checked(context, Some(dimensions)).await?;
    let mut last_score = None;

    loop {
        if started.elapsed() >= timeout {
            return Ok(StabilityOutcome {
                frame: latest,
                last_score,
                timed_out: true,
            });
        }
        interruptible_sleep(context, interval).await?;
        let next = capture_checked(context, Some(dimensions)).await?;
        let comparison =
            FrameComparator::compare(&latest.image, &next.image, region).ok_or_else(|| {
                RunAbort::Failure(AutoCaptureError::new(
                    AutoCaptureErrorCode::ImageProcessingFailed,
                    "Could not compare stability frames",
                ))
            })?;
        last_score = Some(comparison.score);
        let stable = detector.observe(comparison);
        latest = next;
        if stable {
            return Ok(StabilityOutcome {
                frame: latest,
                last_score,
                timed_out: false,
            });
        }
    }
}

async fn interruptible_sleep(context: &RunContext, duration: Duration) -> RunResult<()> {
    check_signal(context).await?;
    tokio::select! {
        _ = tokio::time::sleep(duration) => {}
        _ = context.control.notify.notified() => {}
    }
    check_signal(context).await
}

async fn check_signal(context: &RunContext) -> RunResult<()> {
    match context.control.checkpoint(&context.session).await {
        FlowSignal::Continue => Ok(()),
        FlowSignal::Stop => Err(RunAbort::Stop),
        FlowSignal::Cancel => Err(RunAbort::Cancel),
    }
}

async fn finalize_capture(
    context: &RunContext,
    output_directory: PathBuf,
    resources: CaptureResources,
    mut disposition: FinalDisposition,
) -> RunResult<()> {
    if context.control.signal() == FlowSignal::Cancel {
        return Err(RunAbort::Cancel);
    }
    if context.control.signal() == FlowSignal::Stop {
        disposition = stopped_disposition();
    }
    if disposition.terminal_status == AutoCaptureStatus::Stopped {
        transition_if_possible(&context.session, AutoCaptureStatus::Stopping);
    }
    set_status(context, AutoCaptureStatus::Stitching)?;
    emit_event(
        &context.window,
        "auto-capture-processing",
        &context.session,
        Some(AutoCaptureDiagnostics {
            note: Some("Encoding and atomically exporting final PNG".to_string()),
            ..AutoCaptureDiagnostics::adb_capture()
        }),
        None,
        None,
    );

    let config = context.config.clone();
    let capture_count = if config.stitch {
        resources.builder.accepted_frames()
    } else {
        1
    };
    let session_id = session_id(context);
    let device_name = config
        .device_name
        .clone()
        .unwrap_or_else(|| config.device_id.clone());
    let complete = disposition.complete;
    let build = tokio::task::spawn_blocking(move || {
        let CaptureResources {
            builder,
            individual_frames,
            raw_frames_bytes,
            first_raw,
            previous,
            output_region,
            matching_roi,
        } = resources;
        let built = if config.stitch {
            let fixed_top = (matching_roi.top > output_region.top).then_some((
                &first_raw,
                CaptureRegion {
                    left: output_region.left,
                    top: output_region.top,
                    right: output_region.right,
                    bottom: matching_roi.top,
                },
            ));
            let fixed_bottom = (matching_roi.bottom < output_region.bottom).then_some((
                &previous,
                CaptureRegion {
                    left: output_region.left,
                    top: matching_roi.bottom,
                    right: output_region.right,
                    bottom: output_region.bottom,
                },
            ));
            let retained_raw_bytes = image_allocation_bytes(&first_raw)
                .saturating_add(image_allocation_bytes(&previous));
            builder.build_png_with_edge_regions(
                fixed_top,
                fixed_bottom,
                raw_frames_bytes.saturating_add(retained_raw_bytes),
            )?
        } else {
            drop(builder);
            drop(first_raw);
            let output = previous
                .view(
                    output_region.left,
                    output_region.top,
                    output_region.width(),
                    output_region.height(),
                )
                .to_image();
            let width = output.width();
            let height = output.height();
            let png = encode_rgba_png(output)?;
            super::stitcher::BuiltLongScreenshot { width, height, png }
        };
        export_capture(ExportCaptureRequest {
            output_directory: &output_directory,
            session_id: &session_id,
            device_name: &device_name,
            device_id: &config.device_id,
            final_png: &built.png,
            width: built.width,
            height: built.height,
            capture_count,
            complete,
            individual_frames: &individual_frames,
            save_individual_frames: config.save_individual_frames,
        })
    })
    .await
    .map_err(|error| {
        RunAbort::Failure(AutoCaptureError::with_details(
            AutoCaptureErrorCode::ImageProcessingFailed,
            "The stitching worker failed",
            error.to_string(),
        ))
    })?
    .map_err(RunAbort::Failure)?;

    finish_with_output(context, build, disposition)
}

fn commit_output_metadata(
    control: &JobControl,
    session: &Arc<Mutex<AutoCaptureSession>>,
    result: &mut AutoCaptureResult,
    disposition: FinalDisposition,
) -> RunResult<OutputCommit> {
    commit_output_metadata_inner(control, session, result, disposition, || {})
}

fn commit_output_metadata_inner<F>(
    control: &JobControl,
    session: &Arc<Mutex<AutoCaptureSession>>,
    result: &mut AutoCaptureResult,
    mut disposition: FinalDisposition,
    after_seal: F,
) -> RunResult<OutputCommit>
where
    F: FnOnce(),
{
    let mut session = session.lock().map_err(|_| {
        RunAbort::Failure(AutoCaptureError::new(
            AutoCaptureErrorCode::StreamUnavailable,
            "Auto-capture session metadata is unavailable",
        ))
    })?;

    let signal = control.seal_terminal();
    // Tests use this hook to force a command into the seal/commit boundary.
    // Production passes a no-op; the session mutex remains held throughout.
    after_seal();
    if signal == FlowSignal::Cancel {
        session.error = Some(cancellation_error());
        session
            .transition(AutoCaptureStatus::Cancelled)
            .map_err(RunAbort::Failure)?;
        session.result = None;
        session.termination = None;
        return Ok(OutputCommit::Cancelled);
    }
    if signal == FlowSignal::Stop {
        disposition = stopped_disposition();
        result.complete = false;
        result.partial = true;
    }

    let termination = AutoCaptureTermination {
        reason: disposition.termination_reason,
        complete: disposition.complete,
        code: disposition.termination_code,
        details: None,
    };
    session
        .transition(disposition.terminal_status)
        .map_err(RunAbort::Failure)?;
    session.result = Some(result.clone());
    session.termination = Some(termination);
    Ok(OutputCommit::Published(disposition.terminal_status))
}

fn finish_with_output(
    context: &RunContext,
    mut saved: SavedCapture,
    disposition: FinalDisposition,
) -> RunResult<()> {
    let commit = commit_output_metadata(
        &context.control,
        &context.session,
        &mut saved.result,
        disposition,
    );
    let outcome = match commit {
        Ok(outcome) => outcome,
        Err(error) => {
            saved.discard();
            return Err(error);
        }
    };

    let status = match outcome {
        OutputCommit::Cancelled => {
            saved.discard();
            emit_cancelled(context);
            return Ok(());
        }
        OutputCommit::Published(status) => status,
    };
    let event = if status == AutoCaptureStatus::Stopped {
        "auto-capture-stopped"
    } else {
        "auto-capture-completed"
    };
    emit_event(
        &context.window,
        event,
        &context.session,
        Some(AutoCaptureDiagnostics::adb_capture()),
        None,
        None,
    );
    log_line(
        &context.window,
        &session_id(context),
        "INFO",
        &format!("terminal status={status:?}"),
    );
    Ok(())
}

fn finish_without_output(
    context: &RunContext,
    status: AutoCaptureStatus,
    reason: TerminationReason,
) {
    let mut cancelled = false;
    if let Ok(mut session) = context.session.lock() {
        let signal = context.control.seal_terminal();
        if signal == FlowSignal::Cancel {
            session.error = Some(cancellation_error());
            let _ = session.transition(AutoCaptureStatus::Cancelled);
            session.result = None;
            session.termination = None;
            cancelled = true;
        } else if !session.status.is_terminal() {
            if session
                .status
                .can_transition_to(AutoCaptureStatus::Stopping)
            {
                let _ = session.transition(AutoCaptureStatus::Stopping);
            }
            session.termination = Some(AutoCaptureTermination {
                reason,
                complete: false,
                code: None,
                details: Some("Stopped before a usable frame was available".to_string()),
            });
            let _ = session.transition(status);
        }
    }
    if cancelled {
        emit_cancelled(context);
    } else {
        emit_event(
            &context.window,
            "auto-capture-stopped",
            &context.session,
            Some(AutoCaptureDiagnostics::adb_capture()),
            None,
            None,
        );
    }
}

fn cancellation_error() -> AutoCaptureError {
    AutoCaptureError::new(
        AutoCaptureErrorCode::Cancelled,
        "Auto capture was cancelled and all in-memory frames were discarded",
    )
}

fn emit_cancelled(context: &RunContext) {
    emit_event(
        &context.window,
        "auto-capture-error",
        &context.session,
        Some(AutoCaptureDiagnostics::adb_capture()),
        None,
        None,
    );
    log_line(
        &context.window,
        &session_id(context),
        "INFO",
        "capture cancelled; no output exported",
    );
}

fn finish_cancelled(context: &RunContext) {
    let mut committed = false;
    if let Ok(mut session) = context.session.lock() {
        context.control.seal_terminal();
        if !session.status.is_terminal() {
            session.error = Some(cancellation_error());
            let _ = session.transition(AutoCaptureStatus::Cancelled);
            session.result = None;
            session.termination = None;
            committed = true;
        }
    }
    if committed {
        emit_cancelled(context);
    }
}

/// Publish FAILED only if no stop/cancel command has already won. The control
/// claim and metadata commit occur under the session mutex, so rejected public
/// commands can only observe the committed terminal snapshot.
fn finish_failed(context: &RunContext, error: AutoCaptureError) -> FlowSignal {
    let mut published = false;
    let claim = if let Ok(mut session) = context.session.lock() {
        let claim = context.control.claim_failure();
        if claim == FailureClaim::Won && !session.status.is_terminal() {
            session.error = Some(error.clone());
            let _ = session.transition(AutoCaptureStatus::Failed);
            session.result = None;
            session.termination = None;
            published = true;
        }
        claim
    } else {
        FailureClaim::Finished
    };

    match claim {
        FailureClaim::Stop => FlowSignal::Stop,
        FailureClaim::Cancel => FlowSignal::Cancel,
        FailureClaim::Won | FailureClaim::Finished => {
            if published {
                emit_event(
                    &context.window,
                    "auto-capture-error",
                    &context.session,
                    Some(AutoCaptureDiagnostics::adb_capture()),
                    None,
                    None,
                );
                log_line(
                    &context.window,
                    &session_id(context),
                    "ERROR",
                    &format!("{:?}: {}", error.code, error.message),
                );
            }
            FlowSignal::Continue
        }
    }
}

fn accept_frame(
    context: &RunContext,
    frame: &RgbaImage,
    diagnostics: AutoCaptureDiagnostics,
) -> RunResult<()> {
    {
        let mut session = context.session.lock().map_err(|_| {
            RunAbort::Failure(AutoCaptureError::new(
                AutoCaptureErrorCode::StreamUnavailable,
                "Auto-capture session metadata is unavailable",
            ))
        })?;
        session.capture_count = session.capture_count.saturating_add(1);
        session.current_progress =
            (session.capture_count as f32 / context.config.max_frames as f32).clamp(0.0, 1.0);
        session.updated_at = now_iso();
    }
    let thumbnail = thumbnail_data_url(frame).ok();
    let frame_index = context
        .session
        .lock()
        .map(|session| session.capture_count)
        .unwrap_or(0);
    emit_event(
        &context.window,
        "auto-capture-frame",
        &context.session,
        Some(diagnostics.clone()),
        Some(frame_index),
        thumbnail,
    );
    emit_event(
        &context.window,
        "auto-capture-progress",
        &context.session,
        Some(diagnostics),
        None,
        None,
    );
    Ok(())
}

fn set_status(context: &RunContext, next: AutoCaptureStatus) -> RunResult<()> {
    let mut session = context.session.lock().map_err(|_| {
        RunAbort::Failure(AutoCaptureError::new(
            AutoCaptureErrorCode::StreamUnavailable,
            "Auto-capture session metadata is unavailable",
        ))
    })?;
    session.transition(next).map_err(RunAbort::Failure)
}

fn transition_if_possible(session: &Arc<Mutex<AutoCaptureSession>>, next: AutoCaptureStatus) {
    if let Ok(mut session) = session.lock() {
        if !session.status.is_terminal() && session.status.can_transition_to(next) {
            let _ = session.transition(next);
        }
    }
}

fn set_paused(session: &Arc<Mutex<AutoCaptureSession>>, paused: bool) {
    if let Ok(mut session) = session.lock() {
        if !session.status.is_terminal() {
            session.paused = paused;
            session.updated_at = now_iso();
        }
    }
}

fn mark_cancelled_metadata(session: &Arc<Mutex<AutoCaptureSession>>) {
    if let Ok(mut session) = session.lock() {
        if !session.status.is_terminal() {
            session.error = Some(AutoCaptureError::new(
                AutoCaptureErrorCode::Cancelled,
                "Auto capture was cancelled during application shutdown",
            ));
            let _ = session.transition(AutoCaptureStatus::Cancelled);
            session.result = None;
        }
    }
}

fn session_snapshot(
    session: &Arc<Mutex<AutoCaptureSession>>,
) -> Result<AutoCaptureSession, AutoCaptureApiError> {
    session.lock().map(|value| value.clone()).map_err(|_| {
        AutoCaptureError::new(
            AutoCaptureErrorCode::StreamUnavailable,
            "Auto-capture session metadata is unavailable",
        )
    })
}

fn session_id(context: &RunContext) -> String {
    context
        .session
        .lock()
        .map(|session| session.id.clone())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn emit_event(
    window: &Window,
    name: &str,
    session: &Arc<Mutex<AutoCaptureSession>>,
    diagnostics: Option<AutoCaptureDiagnostics>,
    frame_index: Option<u32>,
    thumbnail: Option<String>,
) {
    if let Ok(session) = session.lock() {
        let mut payload = AutoCaptureEventPayload::from_session(&session);
        payload.diagnostics = diagnostics;
        payload.frame_index = frame_index;
        payload.thumbnail_data_url = thumbnail;
        let _ = window.emit(name, payload);
    }
}

fn log_line(window: &Window, session_id: &str, level: &str, message: &str) {
    let line = format!(
        "[AUTO_CAPTURE] level={} session={} {}",
        level, session_id, message
    );
    if level == "ERROR" || level == "WARN" {
        eprintln!("{line}");
    } else {
        println!("{line}");
    }
    let _ = window.emit("scrcpy-log", line);
}

fn stopped_disposition() -> FinalDisposition {
    FinalDisposition {
        terminal_status: AutoCaptureStatus::Stopped,
        termination_reason: TerminationReason::UserStopped,
        termination_code: None,
        complete: false,
    }
}

fn full_region(width: u32, height: u32) -> CaptureRegion {
    CaptureRegion {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
    }
}

fn classify_backend_error(
    code: &str,
    message: &str,
    fallback: AutoCaptureErrorCode,
    summary: &str,
) -> AutoCaptureError {
    let classified = if is_device_disconnect_code(code) {
        AutoCaptureErrorCode::DeviceDisconnected
    } else {
        fallback
    };
    AutoCaptureError::with_details(classified, summary, format!("{code}: {message}"))
}

fn is_device_disconnect_code(code: &str) -> bool {
    matches!(
        code,
        "device_disconnected" | "device_offline" | "device_unauthorized"
    )
}

fn memory_limit_bytes(context: &RunContext) -> u64 {
    u64::from(context.config.max_memory_mb) * 1024 * 1024
}

fn rgba_allocation_bytes(width: u32, height: u32) -> u64 {
    u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(4)
}

fn image_allocation_bytes(image: &RgbaImage) -> u64 {
    rgba_allocation_bytes(image.width(), image.height())
}

fn overlap_workspace_bytes(region: CaptureRegion, dimensions: (u32, u32)) -> u64 {
    let (width, height) = dimensions;
    let is_full_frame =
        region.left == 0 && region.top == 0 && region.right == width && region.bottom == height;
    if is_full_frame {
        0
    } else {
        rgba_allocation_bytes(region.width(), region.height()).saturating_mul(2)
    }
}

fn conservative_png_reservation(width: u32, height: u32) -> u64 {
    let rgba = rgba_allocation_bytes(width, height);
    rgba.saturating_add(rgba / 50)
        .saturating_add(PNG_RESERVE_OVERHEAD_BYTES)
}

fn ensure_memory_budget(context: &RunContext, required_bytes: u64, phase: &str) -> RunResult<()> {
    let allowed_bytes = memory_limit_bytes(context);
    if required_bytes > allowed_bytes {
        return Err(RunAbort::Failure(AutoCaptureError::with_details(
            AutoCaptureErrorCode::OutputTooLarge,
            format!("Auto capture would exceed maxMemoryMb during {phase}"),
            format!("{required_bytes} bytes needed, {allowed_bytes} bytes allowed"),
        )));
    }
    Ok(())
}

fn retained_memory_bytes(resources: &CaptureResources) -> u64 {
    resources
        .builder
        .stored_bytes()
        .saturating_add(resources.raw_frames_bytes)
        .saturating_add(image_allocation_bytes(&resources.first_raw))
        .saturating_add(image_allocation_bytes(&resources.previous))
}

fn ensure_retained_memory_budget(
    context: &RunContext,
    resources: &CaptureResources,
) -> RunResult<()> {
    let retained = retained_memory_bytes(resources);
    let final_peak = if context.config.stitch {
        let edge_height = resources
            .matching_roi
            .top
            .saturating_sub(resources.output_region.top)
            .saturating_add(
                resources
                    .output_region
                    .bottom
                    .saturating_sub(resources.matching_roi.bottom),
            );
        let final_height = resources.builder.total_height().saturating_add(edge_height);
        retained.saturating_add(
            rgba_allocation_bytes(resources.output_region.width(), final_height).saturating_mul(2),
        )
    } else {
        retained.saturating_add(
            rgba_allocation_bytes(
                resources.output_region.width(),
                resources.output_region.height(),
            )
            .saturating_mul(2),
        )
    };
    ensure_memory_budget(
        context,
        retained.max(final_peak),
        "retained-frame accounting",
    )
}

fn ensure_stability_memory_budget(
    context: &RunContext,
    resources: &CaptureResources,
    dimensions: (u32, u32),
) -> RunResult<()> {
    // Stability comparison can hold latest+next decoded frames and their PNG
    // payloads concurrently, in addition to all accepted stitch state.
    let per_probe = rgba_allocation_bytes(dimensions.0, dimensions.1)
        .saturating_add(conservative_png_reservation(dimensions.0, dimensions.1));
    let required = retained_memory_bytes(resources).saturating_add(per_probe.saturating_mul(2));
    ensure_memory_budget(context, required, "stability sampling")
}

fn ensure_processing_memory_budget(
    context: &RunContext,
    resources: &CaptureResources,
    current: &CapturedFrame,
    maximum_new_rows: u32,
) -> RunResult<()> {
    let new_crop = rgba_allocation_bytes(
        resources.matching_roi.width(),
        resources.matching_roi.height(),
    );
    let new_segment = if context.config.stitch {
        rgba_allocation_bytes(resources.matching_roi.width(), maximum_new_rows)
    } else {
        0
    };
    let overlap_workspace =
        overlap_workspace_bytes(resources.matching_roi, current.image.dimensions());
    let required = retained_memory_bytes(resources)
        .saturating_add(image_allocation_bytes(&current.image))
        .saturating_add(current.png.len() as u64)
        .saturating_add(new_crop)
        .saturating_add(new_segment)
        .saturating_add(overlap_workspace)
        .saturating_add(THUMBNAIL_RESERVE_BYTES);
    ensure_memory_budget(context, required, "frame processing")
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

fn prune_sessions(sessions: &mut HashMap<String, Arc<Mutex<AutoCaptureSession>>>) {
    if sessions.len() < MAX_RETAINED_SESSIONS {
        return;
    }
    let mut terminal: Vec<(String, String)> = sessions
        .iter()
        .filter_map(|(id, session)| {
            session.lock().ok().and_then(|session| {
                session
                    .status
                    .is_terminal()
                    .then(|| (id.clone(), session.updated_at.clone()))
            })
        })
        .collect();
    terminal.sort_by(|left, right| left.1.cmp(&right.1));
    let remove_count = sessions.len().saturating_sub(MAX_RETAINED_SESSIONS - 1);
    for (id, _) in terminal.into_iter().take(remove_count) {
        sessions.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(device: &str) -> AutoCaptureConfig {
        AutoCaptureConfig {
            device_id: device.to_string(),
            ..Default::default()
        }
        .validated()
        .unwrap()
    }

    #[test]
    fn pause_resume_stop_and_cancel_are_race_safe() {
        let control = JobControl::default();
        assert!(control.pause());
        assert!(!control.pause());
        assert!(control.resume());
        assert!(!control.resume());
        assert!(control.request_stop());
        assert_eq!(control.signal(), FlowSignal::Stop);
        assert!(!control.pause());
        assert!(control.request_cancel());
        assert_eq!(control.signal(), FlowSignal::Cancel);
        assert!(!control.request_stop());
    }

    #[tokio::test]
    async fn paused_checkpoint_wakes_for_resume_and_stop() {
        let control = Arc::new(JobControl::default());
        let session = Arc::new(Mutex::new(AutoCaptureSession::new(
            "session-checkpoint".into(),
            &config("device-checkpoint"),
        )));

        assert!(control.pause());
        let waiter_control = control.clone();
        let waiter_session = session.clone();
        let waiter = tokio::spawn(async move { waiter_control.checkpoint(&waiter_session).await });
        tokio::task::yield_now().await;
        assert!(control.resume());
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .expect("paused checkpoint did not wake for resume")
                .unwrap(),
            FlowSignal::Continue
        );

        assert!(control.pause());
        let waiter_control = control.clone();
        let waiter_session = session.clone();
        let waiter = tokio::spawn(async move { waiter_control.checkpoint(&waiter_session).await });
        tokio::task::yield_now().await;
        assert!(control.request_stop());
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .expect("paused checkpoint did not wake for stop")
                .unwrap(),
            FlowSignal::Stop
        );
    }

    #[test]
    fn terminal_seal_closes_stop_and_cancel_publication_race() {
        let completed = JobControl::default();
        assert_eq!(completed.seal_terminal(), FlowSignal::Continue);
        assert!(!completed.request_stop());
        assert!(!completed.request_cancel());

        let stopped = JobControl::default();
        assert!(stopped.request_stop());
        assert_eq!(stopped.seal_terminal(), FlowSignal::Stop);
        assert!(!stopped.request_cancel());

        let cancelled = JobControl::default();
        assert!(cancelled.request_cancel());
        assert_eq!(cancelled.seal_terminal(), FlowSignal::Cancel);
        assert!(!cancelled.request_stop());
    }

    #[test]
    fn accepted_stop_wins_in_flight_failure_and_retains_partial_frame() {
        let control = JobControl::default();
        let frame = RgbaImage::from_pixel(20, 30, image::Rgba([1, 2, 3, 255]));
        let region = CaptureRegion {
            left: 0,
            top: 0,
            right: 20,
            bottom: 30,
        };
        let mut builder = LongScreenshotBuilder::new(20, 5, 1_000, 16);
        builder.add_region(&frame, region).unwrap();

        // Model an operation that was already in flight: stop wins its CAS
        // before that operation reports an error back to the capture loop.
        assert!(control.request_stop());
        assert_eq!(control.claim_failure(), FailureClaim::Stop);
        assert_eq!(control.signal(), FlowSignal::Stop);

        // Failure arbitration did not consume/drop the retained builder, so
        // the outer capture scope can still produce the required partial PNG.
        let partial = builder.build_png().unwrap();
        assert_eq!((partial.width, partial.height), (20, 30));
        assert!(!partial.png.is_empty());
    }

    #[test]
    fn rejected_terminal_command_waits_for_committed_snapshot() {
        let control = Arc::new(JobControl::default());
        let config = config("device-terminal-race");
        let mut initial = AutoCaptureSession::new("session-terminal-race".into(), &config);
        initial.transition(AutoCaptureStatus::Starting).unwrap();
        initial.transition(AutoCaptureStatus::Capturing).unwrap();
        initial.transition(AutoCaptureStatus::Stitching).unwrap();
        let session = Arc::new(Mutex::new(initial));
        let result = AutoCaptureResult {
            path: "/tmp/final.png".into(),
            filename: "final.png".into(),
            width: 20,
            height: 30,
            capture_count: 1,
            complete: true,
            partial: false,
            capture_source: "ADB_SCREENCAP_PNG".into(),
            individual_frames: Vec::new(),
        };
        let disposition = FinalDisposition {
            terminal_status: AutoCaptureStatus::Completed,
            termination_reason: TerminationReason::ContentEnd,
            termination_code: None,
            complete: true,
        };

        let (sealed_tx, sealed_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let terminal_control = control.clone();
        let terminal_session = session.clone();
        let terminal = std::thread::spawn(move || {
            let mut result = result;
            commit_output_metadata_inner(
                &terminal_control,
                &terminal_session,
                &mut result,
                disposition,
                || {
                    sealed_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                },
            )
        });

        sealed_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        let (snapshot_tx, snapshot_rx) = std::sync::mpsc::channel();
        let command_control = control.clone();
        let command_session = session.clone();
        let command = std::thread::spawn(move || {
            request_tx.send(command_control.request_stop()).unwrap();
            snapshot_tx
                .send(session_snapshot(&command_session).unwrap())
                .unwrap();
        });

        assert!(!request_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap());
        assert!(matches!(
            snapshot_rx.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Empty)
        ));
        release_tx.send(()).unwrap();

        assert_eq!(
            terminal.join().unwrap().unwrap(),
            OutputCommit::Published(AutoCaptureStatus::Completed)
        );
        let snapshot = snapshot_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        command.join().unwrap();
        assert_eq!(snapshot.status, AutoCaptureStatus::Completed);
        assert!(snapshot.result.is_some());
    }

    #[test]
    fn swipe_coordinates_are_relative_to_detected_region() {
        let settings = ScrollSettings::default();
        let region = CaptureRegion {
            left: 700,
            top: 100,
            right: 1080,
            bottom: 2200,
        };
        let (start_x, start_y, end_x, end_y) = swipe_coordinates(&settings, region);
        assert!((700..1080).contains(&(start_x as u32)));
        assert!((700..1080).contains(&(end_x as u32)));
        assert!((100..2200).contains(&(start_y as u32)));
        assert!((100..2200).contains(&(end_y as u32)));
        assert_eq!(start_x, end_x);
        assert!(start_y > end_y);
    }

    #[test]
    fn overlap_workspace_tracks_bounded_region_crops() {
        let dimensions = (1_080, 2_400);
        assert_eq!(
            overlap_workspace_bytes(full_region(1_080, 2_400), dimensions),
            0
        );

        let upper_pane = CaptureRegion {
            left: 0,
            top: 100,
            right: 1_080,
            bottom: 500,
        };
        assert_eq!(
            overlap_workspace_bytes(upper_pane, dimensions),
            rgba_allocation_bytes(1_080, 400) * 2
        );

        let narrow_pane = CaptureRegion {
            left: 120,
            right: 900,
            ..upper_pane
        };
        assert_eq!(
            overlap_workspace_bytes(narrow_pane, dimensions),
            rgba_allocation_bytes(780, 400) * 2
        );
    }

    #[test]
    fn state_rejects_duplicate_device_and_removes_by_generation() {
        let state = AutoCaptureState::default();
        let first = state.register(&config("device-1")).unwrap();
        let first_id = first.session.lock().unwrap().id.clone();
        let busy = match state.register(&config("device-1")) {
            Err(error) => error,
            Ok(_) => panic!("duplicate device registration unexpectedly succeeded"),
        };
        assert_eq!(busy.code, AutoCaptureErrorCode::Busy);
        state.finish("device-1", &first_id, first.generation + 1);
        assert!(state.register(&config("device-1")).is_err());
        state.finish("device-1", &first_id, first.generation);
        assert!(state.register(&config("device-1")).is_ok());
    }

    #[test]
    fn shutdown_cancels_and_clears_active_jobs() {
        let state = AutoCaptureState::default();
        let registered = state.register(&config("device-2")).unwrap();
        let registered_id = registered.session.lock().unwrap().id.clone();
        state.shutdown();
        assert_eq!(registered.control.signal(), FlowSignal::Cancel);
        assert_eq!(
            registered.session.lock().unwrap().status,
            AutoCaptureStatus::Cancelled
        );
        assert!(state.active_job(&registered_id).is_err());
        let after_shutdown = match state.register(&config("device-after-shutdown")) {
            Err(error) => error,
            Ok(_) => panic!("registration succeeded after shutdown"),
        };
        assert_eq!(after_shutdown.code, AutoCaptureErrorCode::Cancelled);
    }

    #[test]
    fn device_disconnect_is_classified_at_api_boundary() {
        for code in [
            "device_disconnected",
            "device_offline",
            "device_unauthorized",
        ] {
            let error = classify_backend_error(
                code,
                "underlying detail",
                AutoCaptureErrorCode::ScreenCaptureFailed,
                "capture failed",
            );
            assert_eq!(error.code, AutoCaptureErrorCode::DeviceDisconnected);
            assert!(error.details.unwrap().contains("underlying detail"));
        }
        let generic = classify_backend_error(
            "timeout",
            "slow device",
            AutoCaptureErrorCode::ScreenCaptureFailed,
            "capture failed",
        );
        assert_eq!(generic.code, AutoCaptureErrorCode::ScreenCaptureFailed);
    }

    #[test]
    fn failed_session_transition_is_terminal() {
        let config = config("device-3");
        let mut session = AutoCaptureSession::new("id".to_string(), &config);
        session.transition(AutoCaptureStatus::Starting).unwrap();
        session.transition(AutoCaptureStatus::Failed).unwrap();
        assert!(session.status.is_terminal());
        assert!(session.transition(AutoCaptureStatus::Capturing).is_err());
    }
}
