// Crash / ANR watcher backend.
//
// Runs a background `adb logcat` per device, filtered down to the tags that
// report app crashes, and groups the lines of each crash into one event:
//
//   * Java crash   - AndroidRuntime "FATAL EXCEPTION" + stack trace
//   * Native crash - libc "Fatal signal" + the DEBUG tombstone lines
//   * ANR          - ActivityManager "ANR in" + reason / CPU lines
//
// Each finished group is emitted as a `crash-watcher-event` so the UI can
// notify, keep a history and build a bug report, without the Logcat page
// having to be open. Only the serial comes from the frontend and it is
// validated; every adb argument is fixed.

use crate::adb;
use crate::commands::{create_command, get_binary_path};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::time::{Duration, Instant};

/// A crash group ends when no continuation line arrives for this long.
const IDLE_FLUSH_MS: u64 = 1200;
/// Upper bound on lines kept per event (tombstones can be very long).
pub const MAX_EVENT_LINES: usize = 400;

// ---------------------------------------------------------------------------
// Pure logic: line parsing and grouping. No adb, no tauri.
// ---------------------------------------------------------------------------

/// One `logcat -v threadtime` line:
/// `MM-DD HH:MM:SS.mmm  PID  TID L TAG     : message`
#[derive(Debug, Clone, PartialEq)]
pub struct LogLine {
    pub time: String,
    pub pid: u32,
    pub level: char,
    pub tag: String,
    pub message: String,
}

pub fn parse_threadtime(line: &str) -> Option<LogLine> {
    let mut rest = line.trim_start();
    let mut fields = Vec::with_capacity(5);
    for _ in 0..5 {
        let end = rest.find(char::is_whitespace)?;
        fields.push(&rest[..end]);
        rest = rest[end..].trim_start();
    }
    let (date, time, pid, _tid, level) = (fields[0], fields[1], fields[2], fields[3], fields[4]);
    if date.len() != 5 || !date.contains('-') || !time.contains(':') {
        return None;
    }
    let pid: u32 = pid.parse().ok()?;
    let mut level_chars = level.chars();
    let level = level_chars.next()?;
    if level_chars.next().is_some() || !"VDIWEFA".contains(level) {
        return None;
    }
    let (tag, message) = match rest.find(": ") {
        Some(idx) => (rest[..idx].trim(), &rest[idx + 2..]),
        // "TAG:" with an empty message.
        None => (rest.trim_end_matches(':').trim(), ""),
    };
    Some(LogLine {
        time: format!("{date} {time}"),
        pid,
        level,
        tag: tag.to_string(),
        message: message.to_string(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashKind {
    Crash,
    NativeCrash,
    Anr,
}

/// A grouped crash, as sent to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashEvent {
    pub kind: CrashKind,
    /// Logcat time of the first line ("MM-DD HH:MM:SS.mmm").
    pub time: String,
    pub pid: u32,
    /// Process name as Android reports it (may carry a ":service" suffix).
    pub process: Option<String>,
    /// Package name derived from the process, when it looks like one.
    pub package: Option<String>,
    /// One-line description: the exception, the ANR reason or the signal.
    pub summary: String,
    /// Message text of every line in the group, in order.
    pub lines: Vec<String>,
    /// True when lines were dropped because of `MAX_EVENT_LINES`.
    pub truncated: bool,
}

fn crash_start(line: &LogLine) -> Option<CrashKind> {
    match line.tag.as_str() {
        "AndroidRuntime" if line.message.starts_with("FATAL EXCEPTION") => Some(CrashKind::Crash),
        "ActivityManager" if line.message.starts_with("ANR in ") => Some(CrashKind::Anr),
        "libc" if line.message.contains("Fatal signal") => Some(CrashKind::NativeCrash),
        _ => None,
    }
}

struct Pending {
    kind: CrashKind,
    time: String,
    pid: u32,
    lines: Vec<String>,
    truncated: bool,
}

impl Pending {
    fn continues_with(&self, line: &LogLine) -> bool {
        match self.kind {
            CrashKind::Crash => line.tag == "AndroidRuntime" && line.pid == self.pid,
            CrashKind::Anr => line.tag == "ActivityManager" && line.pid == self.pid,
            // The tombstone is written by crash_dump, a different process.
            CrashKind::NativeCrash => {
                line.tag == "DEBUG" || (line.tag == "libc" && line.pid == self.pid)
            }
        }
    }

    fn push(&mut self, message: String) {
        if self.lines.len() < MAX_EVENT_LINES {
            self.lines.push(message);
        } else {
            self.truncated = true;
        }
    }
}

/// Groups parsed lines into crash events. Feed it every line; call
/// `flush` when the stream goes quiet or ends.
#[derive(Default)]
pub struct CrashAssembler {
    pending: Option<Pending>,
    last_raw: Option<String>,
}

impl CrashAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Process one raw logcat line; returns an event when this line closed one.
    pub fn push_line(&mut self, raw: &str) -> Option<CrashEvent> {
        // Reading several buffers can repeat a line; skip exact repeats.
        if self.last_raw.as_deref() == Some(raw) {
            return None;
        }
        self.last_raw = Some(raw.to_string());

        let line = parse_threadtime(raw)?;
        let start = crash_start(&line);

        if let Some(pending) = self.pending.as_mut() {
            if start.is_none() && pending.continues_with(&line) {
                pending.push(line.message);
                return None;
            }
        }

        let finished = self.flush();
        if let Some(kind) = start {
            self.pending = Some(Pending {
                kind,
                time: line.time,
                pid: line.pid,
                lines: vec![line.message],
                truncated: false,
            });
        }
        finished
    }

    /// Close the current group, if any.
    pub fn flush(&mut self) -> Option<CrashEvent> {
        self.pending.take().map(build_event)
    }
}

/// "com.example.app:remote" -> "com.example.app"; None for things like
/// "/system/bin/surfaceflinger" or "system_server".
pub fn package_from_process(process: &str) -> Option<String> {
    let base = process.split(':').next().unwrap_or("").trim();
    let segments: Vec<&str> = base.split('.').collect();
    let valid = segments.len() >= 2
        && segments.iter().all(|seg| {
            let mut chars = seg.chars();
            matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
    valid.then(|| base.to_string())
}

fn java_process(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|line| {
        let rest = line.trim().strip_prefix("Process: ")?;
        Some(rest.split(',').next()?.trim().to_string())
    })
}

fn java_summary(lines: &[String]) -> Option<String> {
    lines
        .iter()
        .map(|line| line.trim())
        .find(|line| {
            !line.is_empty()
                && !line.starts_with("FATAL EXCEPTION")
                && !line.starts_with("Process: ")
                && !line.starts_with("PID: ")
                && !line.starts_with("at ")
        })
        .map(str::to_string)
}

fn anr_process(lines: &[String]) -> Option<String> {
    let rest = lines.first()?.strip_prefix("ANR in ")?;
    rest.split_whitespace().next().map(str::to_string)
}

fn anr_summary(lines: &[String]) -> Option<String> {
    lines
        .iter()
        .find_map(|line| line.trim().strip_prefix("Reason: ").map(str::to_string))
}

/// The process from a libc line ("..., pid 1234 (com.example.app)") or a
/// tombstone header ("... >>> com.example.app <<<").
fn native_process(lines: &[String]) -> Option<String> {
    for line in lines {
        if let Some(idx) = line.rfind(", pid ") {
            let tail = &line[idx..];
            if let (Some(open), Some(close)) = (tail.find('('), tail.rfind(')')) {
                if open < close {
                    return Some(tail[open + 1..close].to_string());
                }
            }
        }
        if let (Some(open), Some(close)) = (line.find(">>> "), line.find(" <<<")) {
            if open + 4 < close {
                return Some(line[open + 4..close].trim().to_string());
            }
        }
    }
    None
}

fn native_summary(lines: &[String]) -> Option<String> {
    let line = lines.iter().find(|line| line.contains("Fatal signal"))?;
    let start = line.find("Fatal signal").unwrap_or(0);
    let text = &line[start..];
    let text = text.split(" in tid ").next().unwrap_or(text);
    Some(text.trim_end_matches(',').trim().to_string())
}

fn build_event(pending: Pending) -> CrashEvent {
    let (process, summary) = match pending.kind {
        CrashKind::Crash => (java_process(&pending.lines), java_summary(&pending.lines)),
        CrashKind::Anr => (anr_process(&pending.lines), anr_summary(&pending.lines)),
        CrashKind::NativeCrash => (
            native_process(&pending.lines),
            native_summary(&pending.lines),
        ),
    };
    let fallback = match pending.kind {
        CrashKind::Crash => "App crashed",
        CrashKind::Anr => "App not responding",
        CrashKind::NativeCrash => "Native crash",
    };
    CrashEvent {
        kind: pending.kind,
        time: pending.time,
        pid: pending.pid,
        package: process.as_deref().and_then(package_from_process),
        process,
        summary: summary.unwrap_or_else(|| fallback.to_string()),
        lines: pending.lines,
        truncated: pending.truncated,
    }
}

/// adb arguments for the watcher stream: start at the newest line (so old
/// crashes are not replayed), read the buffers crashes are written to, and
/// silence every tag that cannot start or continue a crash group.
pub fn watcher_args(serial: &str) -> Vec<String> {
    [
        "-s",
        serial,
        "logcat",
        "-v",
        "threadtime",
        "-T",
        "1",
        "-b",
        "crash",
        "-b",
        "system",
        "-b",
        "main",
        "AndroidRuntime:E",
        "ActivityManager:E",
        "DEBUG:F",
        "libc:F",
        "*:S",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

struct WatcherHandle {
    generation: u64,
    child: Child,
}

/// Running watchers keyed by device serial.
#[derive(Default)]
pub struct CrashWatcherState {
    watchers: Mutex<HashMap<String, WatcherHandle>>,
    next_generation: AtomicU64,
}

impl CrashWatcherState {
    pub fn kill_all_blocking(&self) {
        if let Ok(mut watchers) = self.watchers.lock() {
            for (_, handle) in watchers.iter_mut() {
                let _ = handle.child.start_kill();
            }
            watchers.clear();
        }
    }

    fn take(&self, serial: &str) -> Option<WatcherHandle> {
        self.watchers.lock().ok()?.remove(serial)
    }

    /// Remove the entry only if it still belongs to `generation`, so a stream
    /// that ends after being replaced does not drop its replacement.
    fn remove_if_current(&self, serial: &str, generation: u64) {
        if let Ok(mut watchers) = self.watchers.lock() {
            if watchers.get(serial).map(|h| h.generation) == Some(generation) {
                watchers.remove(serial);
            }
        }
    }
}

fn emit_status(window: &Window, serial: &str, running: bool, error: Option<String>) {
    let _ = window.emit(
        "crash-watcher-status",
        json!({ "serial": serial, "running": running, "error": error }),
    );
}

/// Start watching a device for crashes. Replaces a watcher already running
/// for the serial. Emits `crash-watcher-event` `{ serial, event }` per crash
/// and `crash-watcher-status` `{ serial, running, error }`.
#[tauri::command]
pub async fn start_crash_watcher(
    window: Window,
    state: State<'_, CrashWatcherState>,
    serial: String,
    custom_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return Ok(json!({ "success": false, "error": e.message(), "errorCode": e.code() }));
    }

    if let Some(mut old) = state.take(&serial) {
        let _ = old.child.kill().await;
    }

    let adb_path = get_binary_path("adb", custom_path);
    let mut child = match create_command(&adb_path)
        .args(watcher_args(&serial))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            let (code, message) = if e.kind() == std::io::ErrorKind::NotFound {
                ("adb_not_found", "ADB executable not found".to_string())
            } else {
                ("spawn_failed", e.to_string())
            };
            return Ok(json!({ "success": false, "error": message, "errorCode": code }));
        }
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture logcat stdout".to_string())?;
    let stderr = child.stderr.take();

    let generation = state.next_generation.fetch_add(1, Ordering::SeqCst);
    state
        .watchers
        .lock()
        .map_err(|_| "Crash watcher state is unavailable".to_string())?
        .insert(serial.clone(), WatcherHandle { generation, child });

    // Keep the last stderr line: it explains an early exit ("device offline").
    let last_error = std::sync::Arc::new(Mutex::new(None::<String>));
    if let Some(stderr) = stderr {
        let last_error = last_error.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    if let Ok(mut slot) = last_error.lock() {
                        *slot = Some(line.trim().to_string());
                    }
                }
            }
        });
    }

    let window_task = window.clone();
    let serial_task = serial.clone();
    tokio::spawn(async move {
        let emit_event = |event: CrashEvent| {
            let _ = window_task.emit(
                "crash-watcher-event",
                json!({ "serial": serial_task, "event": event }),
            );
        };
        let mut assembler = CrashAssembler::new();
        let mut lines = BufReader::new(stdout).lines();
        let mut last_line_at = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(300));
        loop {
            tokio::select! {
                next = lines.next_line() => match next {
                    Ok(Some(raw)) => {
                        last_line_at = Instant::now();
                        if let Some(event) = assembler.push_line(&raw) {
                            emit_event(event);
                        }
                    }
                    Ok(None) | Err(_) => break,
                },
                _ = tick.tick() => {
                    if assembler.has_pending()
                        && last_line_at.elapsed() >= Duration::from_millis(IDLE_FLUSH_MS)
                    {
                        if let Some(event) = assembler.flush() {
                            emit_event(event);
                        }
                    }
                }
            }
        }
        if let Some(event) = assembler.flush() {
            emit_event(event);
        }

        // Stream ended: device gone, adb restarted, or stopped by the user.
        let state = window_task.state::<CrashWatcherState>();
        let still_current = state
            .watchers
            .lock()
            .map(|w| w.get(&serial_task).map(|h| h.generation) == Some(generation))
            .unwrap_or(false);
        state.remove_if_current(&serial_task, generation);
        // A stop or replacement already reported its own status.
        if still_current {
            let error = last_error.lock().ok().and_then(|slot| slot.clone());
            emit_status(&window_task, &serial_task, false, error);
        }
    });

    emit_status(&window, &serial, true, None);
    Ok(json!({ "success": true }))
}

/// Stop watching a device.
#[tauri::command]
pub async fn stop_crash_watcher(
    window: Window,
    state: State<'_, CrashWatcherState>,
    serial: String,
) -> Result<serde_json::Value, String> {
    let serial = serial.trim().to_string();
    if let Some(mut handle) = state.take(&serial) {
        let _ = handle.child.kill().await;
    }
    emit_status(&window, &serial, false, None);
    Ok(json!({ "success": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[&str]) -> Vec<CrashEvent> {
        let mut assembler = CrashAssembler::new();
        let mut events: Vec<CrashEvent> = lines
            .iter()
            .filter_map(|line| assembler.push_line(line))
            .collect();
        events.extend(assembler.flush());
        events
    }

    const JAVA: &[&str] = &[
        "11-01 10:15:42.123  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main",
        "11-01 10:15:42.123  4321  4321 E AndroidRuntime: Process: com.example.shop, PID: 4321",
        "11-01 10:15:42.123  4321  4321 E AndroidRuntime: java.lang.NullPointerException: Attempt to invoke virtual method 'int java.lang.String.length()' on a null object reference",
        "11-01 10:15:42.123  4321  4321 E AndroidRuntime: \tat com.example.shop.CartActivity.onCreate(CartActivity.kt:42)",
        "11-01 10:15:42.123  4321  4321 E AndroidRuntime: \tat android.app.Activity.performCreate(Activity.java:8000)",
    ];

    #[test]
    fn parses_threadtime_lines() {
        let line = parse_threadtime(JAVA[0]).unwrap();
        assert_eq!(line.time, "11-01 10:15:42.123");
        assert_eq!(line.pid, 4321);
        assert_eq!(line.level, 'E');
        assert_eq!(line.tag, "AndroidRuntime");
        assert_eq!(line.message, "FATAL EXCEPTION: main");

        let spaced = parse_threadtime(
            "11-01 10:15:42.123  1000  1100 E ActivityManager  : ANR in com.example.shop",
        )
        .unwrap();
        assert_eq!(spaced.tag, "ActivityManager");
        assert_eq!(spaced.message, "ANR in com.example.shop");

        assert!(parse_threadtime("--------- beginning of crash").is_none());
        assert!(parse_threadtime("").is_none());
        assert!(parse_threadtime("garbage line with words in it").is_none());
    }

    #[test]
    fn groups_a_java_crash() {
        let events = feed(JAVA);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.kind, CrashKind::Crash);
        assert_eq!(event.pid, 4321);
        assert_eq!(event.time, "11-01 10:15:42.123");
        assert_eq!(event.process.as_deref(), Some("com.example.shop"));
        assert_eq!(event.package.as_deref(), Some("com.example.shop"));
        assert!(event
            .summary
            .starts_with("java.lang.NullPointerException: Attempt to invoke"));
        assert_eq!(event.lines.len(), 5);
        assert!(!event.truncated);
    }

    #[test]
    fn groups_an_anr() {
        let events = feed(&[
            "11-01 10:20:00.000  1000  1150 E ActivityManager: ANR in com.example.shop:sync (com.example.shop/.SyncService)",
            "11-01 10:20:00.000  1000  1150 E ActivityManager: PID: 5555",
            "11-01 10:20:00.000  1000  1150 E ActivityManager: Reason: executing service com.example.shop/.SyncService",
            "11-01 10:20:00.000  1000  1150 E ActivityManager: Load: 3.1 / 2.9 / 2.5",
        ]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, CrashKind::Anr);
        assert_eq!(events[0].process.as_deref(), Some("com.example.shop:sync"));
        assert_eq!(events[0].package.as_deref(), Some("com.example.shop"));
        assert_eq!(
            events[0].summary,
            "executing service com.example.shop/.SyncService"
        );
    }

    #[test]
    fn groups_a_native_crash_with_its_tombstone() {
        let events = feed(&[
            "11-01 10:30:00.000  7777  7790 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 7790 (RenderThread), pid 7777 (com.example.game)",
            "11-01 10:30:00.200  8000  8000 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***",
            "11-01 10:30:00.200  8000  8000 F DEBUG   : pid: 7777, tid: 7790, name: RenderThread  >>> com.example.game <<<",
            "11-01 10:30:00.200  8000  8000 F DEBUG   :       #00 pc 0000000000012345  /data/app/lib/arm64/libgame.so",
        ]);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.kind, CrashKind::NativeCrash);
        assert_eq!(event.package.as_deref(), Some("com.example.game"));
        assert_eq!(
            event.summary,
            "Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0"
        );
        assert_eq!(event.lines.len(), 4);
    }

    #[test]
    fn a_new_crash_or_other_process_closes_the_group() {
        let mut lines: Vec<&str> = JAVA.to_vec();
        lines.push("11-01 10:15:43.000  9999  9999 E AndroidRuntime: FATAL EXCEPTION: worker");
        lines.push(
            "11-01 10:15:43.000  9999  9999 E AndroidRuntime: Process: com.other.app, PID: 9999",
        );
        // Same tag, other pid: not part of the second crash.
        lines.push("11-01 10:15:44.000  1234  1234 E AndroidRuntime: unrelated");
        let events = feed(&lines);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].package.as_deref(), Some("com.example.shop"));
        assert_eq!(events[1].package.as_deref(), Some("com.other.app"));
        assert_eq!(events[1].lines.len(), 2);
    }

    #[test]
    fn ignores_lines_outside_a_crash_and_repeats() {
        assert!(feed(&[
            "11-01 10:00:00.000  1000  1000 E ActivityManager: Some other error",
            "11-01 10:00:00.000  4321  4321 E AndroidRuntime: \tat orphan.Frame(Frame.java:1)",
        ])
        .is_empty());

        let mut doubled = Vec::new();
        for line in JAVA {
            doubled.push(*line);
            doubled.push(*line);
        }
        let events = feed(&doubled);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].lines.len(), 5);
    }

    #[test]
    fn caps_very_long_groups() {
        let mut assembler = CrashAssembler::new();
        assembler.push_line(JAVA[0]);
        for i in 0..(MAX_EVENT_LINES + 50) {
            let line = format!(
                "11-01 10:15:42.123  4321  4321 E AndroidRuntime: \tat frame{i}(F.java:{i})"
            );
            assembler.push_line(&line);
        }
        let event = assembler.flush().unwrap();
        assert_eq!(event.lines.len(), MAX_EVENT_LINES);
        assert!(event.truncated);
    }

    #[test]
    fn derives_packages_from_process_names() {
        assert_eq!(
            package_from_process("com.example.app"),
            Some("com.example.app".into())
        );
        assert_eq!(
            package_from_process("com.example.app:remote"),
            Some("com.example.app".into())
        );
        assert_eq!(package_from_process("system_server"), None);
        assert_eq!(package_from_process("/system/bin/surfaceflinger"), None);
        assert_eq!(package_from_process("com..bad"), None);
        assert_eq!(package_from_process("com.1bad"), None);
    }

    #[test]
    fn watcher_args_are_fixed_and_start_at_now() {
        let args = watcher_args("emulator-5554");
        assert_eq!(&args[..3], &["-s", "emulator-5554", "logcat"]);
        let joined = args.join(" ");
        assert!(joined.contains("-T 1"));
        assert!(joined.contains("-b crash"));
        assert!(joined.ends_with("*:S"));
    }
}
