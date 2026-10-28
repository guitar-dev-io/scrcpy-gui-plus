//! LAN screen sharing.
//!
//! Starts a small HTTP server that streams a device's screen as MJPEG so anyone
//! on the same network can watch it from a browser. Frames come from the same
//! `adb exec-out screencap` path as the in-app preview, so no extra binary or
//! on-device component is needed. The URL carries a random token and capture
//! only runs while at least one viewer is connected.
//!
//! Control is opt-in. When enabled, a second link (with its own random key)
//! serves a page that sends taps, swipes and a few hardware keys back to the
//! device through `adb shell input`. The plain view link never accepts input.

use crate::embed_session::{self, control, EmbedSessionState};
use crate::screen_share_video::{Fmp4Muxer, MuxEvent};
use crate::{adb, screenshot};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
use rand::RngExt;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use std::time::Instant;
use tokio::time::{sleep, Duration};

const CAPTURE_TIMEOUT_SECS: u64 = 12;
const INPUT_TIMEOUT_SECS: u64 = 5;
const MAX_REQUEST_BYTES: usize = 4096;
const MAX_FRAME_WIDTH: u32 = 720;
const JPEG_QUALITY: u8 = 70;
const MIN_FPS: u32 = 1;
const MAX_FPS: u32 = 5;
const VIEW_FPS: u32 = 2;
const CONTROL_FPS: u32 = 4;
const MIN_SWIPE_MS: u32 = 50;
const MAX_SWIPE_MS: u32 = 2000;
const BOUNDARY: &str = "scrcpyguiframe";
/// How long the device's scrcpy session stays up after the last video viewer
/// leaves, so a page reload or reconnect does not restart it.
const VIDEO_IDLE_RELEASE_SECS: u64 = 20;
const VIDEO_INIT_TIMEOUT_SECS: u64 = 10;
/// A share stops by itself so a forgotten link does not stay usable.
const DEFAULT_EXPIRY_MINUTES: u32 = 30;
const MAX_EXPIRY_MINUTES: u32 = 480;
/// A viewer counts as "controlling" this long after its last accepted input.
const CONTROL_ACTIVE_SECS: u64 = 120;
/// Accepted control requests per second per share. A dragging finger sends
/// about 60 moves a second; this leaves room for that and little more.
const MAX_CONTROL_PER_SECOND: u32 = 400;
const MAX_VIDEO_VIEWERS: usize = 4;
const MAX_STILL_VIEWERS: usize = 8;
const SCROLL_STEPS: u32 = 8;
const SCROLL_STEP_MS: u64 = 16;
/// Lease ids for the shared embedded session. Kept far above the small
/// counters other remote features use so the two never collide.
static NEXT_LEASE: AtomicU64 = AtomicU64::new(1 << 48);

type Frame = Option<Arc<Vec<u8>>>;

/// Hardware keys a controlling viewer may press. Power and anything that
/// leaves the session (reboot, shell) are deliberately not offered.
fn key_code(name: &str) -> Option<&'static str> {
    Some(match name {
        "back" => "KEYCODE_BACK",
        "home" => "KEYCODE_HOME",
        "recents" => "KEYCODE_APP_SWITCH",
        "volume_up" => "KEYCODE_VOLUME_UP",
        "volume_down" => "KEYCODE_VOLUME_DOWN",
        _ => return None,
    })
}

/// Android key codes for the control-socket path.
fn control_keycode(name: &str) -> Option<u32> {
    Some(match name {
        "back" => control::KEYCODE_BACK,
        "home" => control::KEYCODE_HOME,
        "recents" => control::KEYCODE_APP_SWITCH,
        "volume_up" => 24,
        "volume_down" => 25,
        _ => return None,
    })
}

/// What a share needs from the running app to start the scrcpy session that
/// feeds smooth video and real touch input. Absent in unit tests.
struct Host {
    app: AppHandle,
    window: Window,
}

/// State one running share needs in every connection handler.
struct Shared {
    serial: String,
    custom_path: Option<String>,
    token: String,
    title: String,
    control_key: Option<String>,
    viewers: Arc<AtomicUsize>,
    /// Native screen size of the latest frame, used to scale taps.
    width: AtomicU32,
    height: AtomicU32,
    /// Keeps taps and swipes from overlapping so they land in order.
    input_lock: tokio::sync::Mutex<()>,
    /// One full-resolution capture at a time, so a held button cannot pile up adb calls.
    capture_lock: tokio::sync::Mutex<()>,
    host: Option<Host>,
    /// Lease id on the device's embedded scrcpy session while video viewers exist.
    lease: tokio::sync::Mutex<Option<u64>>,
    video_viewers: AtomicUsize,
    /// Size of the scrcpy video frame, which touch coordinates are relative to.
    video_width: AtomicU32,
    video_height: AtomicU32,
    /// When the share stops by itself; moved forward by extending.
    expires_at: Mutex<Instant>,
    /// Addresses that recently had control input accepted, for the app to show.
    controllers: Mutex<HashMap<IpAddr, Instant>>,
    control_rate: Mutex<RateWindow>,
}

/// Counts events in one-second windows.
struct RateWindow {
    started: Instant,
    count: u32,
}

impl RateWindow {
    fn new(now: Instant) -> Self {
        Self { started: now, count: 0 }
    }

    fn allow(&mut self, now: Instant, limit: u32) -> bool {
        if now.duration_since(self.started) >= Duration::from_secs(1) {
            self.started = now;
            self.count = 0;
        }
        self.count += 1;
        self.count <= limit
    }
}

/// Equal-length comparison that does not stop at the first differing byte.
fn constant_time_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Shared {
    fn remaining(&self) -> Duration {
        self.expires_at
            .lock()
            .map(|at| at.saturating_duration_since(Instant::now()))
            .unwrap_or_default()
    }

    fn set_expiry(&self, from_now: Duration) {
        if let Ok(mut at) = self.expires_at.lock() {
            *at = Instant::now() + from_now;
        }
    }

    /// Records accepted control input from `ip`; true when this address was not
    /// already active, so the caller can announce it once.
    fn note_controller(&self, ip: IpAddr, now: Instant) -> bool {
        let Ok(mut seen) = self.controllers.lock() else { return false };
        seen.retain(|_, at| now.duration_since(*at) < Duration::from_secs(CONTROL_ACTIVE_SECS));
        seen.insert(ip, now).is_none()
    }

    fn active_controllers(&self) -> Vec<String> {
        let now = Instant::now();
        let Ok(seen) = self.controllers.lock() else { return Vec::new() };
        let mut ips: Vec<String> = seen
            .iter()
            .filter(|(_, at)| now.duration_since(**at) < Duration::from_secs(CONTROL_ACTIVE_SECS))
            .map(|(ip, _)| ip.to_string())
            .collect();
        ips.sort();
        ips
    }
}

struct ShareSession {
    url: String,
    control_url: Option<String>,
    port: u16,
    shared: Arc<Shared>,
    shutdown: Arc<watch::Sender<bool>>,
}

#[derive(Default)]
pub struct ScreenShareState {
    sessions: Mutex<HashMap<String, ShareSession>>,
}

impl ScreenShareState {
    pub fn stop_all_blocking(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.shutdown.send(true);
            }
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenShareInfo {
    pub serial: String,
    pub url: String,
    pub control_url: Option<String>,
    pub port: u16,
    pub viewers: usize,
    /// Seconds until the share stops by itself.
    pub expires_in_secs: u64,
    /// Addresses that recently controlled the device.
    pub controllers: Vec<String>,
}

fn new_token() -> String {
    format!("{:032x}", rand::rng().random::<u128>())
}

/// Returns the JPEG plus the native (pre-resize) width and height.
fn encode_jpeg(png: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let rgba = screenshot::decode_png_frame(png).map_err(|(_, message)| message)?;
    let (native_width, native_height) = (rgba.width(), rgba.height());
    let mut image = DynamicImage::ImageRgba8(rgba);
    if image.width() > MAX_FRAME_WIDTH {
        let height = (u64::from(image.height()) * u64::from(MAX_FRAME_WIDTH)
            / u64::from(image.width()))
        .max(1) as u32;
        image = image.resize_exact(MAX_FRAME_WIDTH, height, FilterType::Triangle);
    }
    let rgb = image.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|error| error.to_string())?;
    Ok((out, native_width, native_height))
}

async fn capture_loop(
    shared: Arc<Shared>,
    fps: u32,
    frames: watch::Sender<Frame>,
    mut shutdown: watch::Receiver<bool>,
) {
    let interval = Duration::from_millis(1000 / u64::from(fps));
    loop {
        if *shutdown.borrow() {
            return;
        }
        if shared.viewers.load(Ordering::Relaxed) == 0 {
            tokio::select! {
                _ = sleep(Duration::from_millis(300)) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        }
        let started = tokio::time::Instant::now();
        let captured = screenshot::capture_png_frame(
            &shared.serial,
            shared.custom_path.clone(),
            CAPTURE_TIMEOUT_SECS,
        )
        .await;
        match captured {
            Ok(png) => {
                if let Ok(Ok((jpeg, width, height))) =
                    tokio::task::spawn_blocking(move || encode_jpeg(&png)).await
                {
                    shared.width.store(width, Ordering::Relaxed);
                    shared.height.store(height, Ordering::Relaxed);
                    let _ = frames.send(Some(Arc::new(jpeg)));
                }
            }
            Err(_) => sleep(Duration::from_secs(1)).await,
        }
        let elapsed = started.elapsed();
        if elapsed < interval {
            tokio::select! {
                _ = sleep(interval - elapsed) => {}
                _ = shutdown.changed() => {}
            }
        }
    }
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

const PAGE: &str = include_str!("screen_share_page.html");

/// Keeps the `<!--tag-->…<!--/tag-->` blocks of the page template when `keep`
/// is set and drops them otherwise; the marker comments themselves always go.
fn strip_blocks(html: &str, tag: &str, keep: bool) -> String {
    let open = format!("<!--{tag}-->");
    let close = format!("<!--/{tag}-->");
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        let inner = &rest[start + open.len()..];
        let end = inner.find(&close).unwrap_or(inner.len());
        if keep {
            out.push_str(&inner[..end]);
        }
        rest = inner.get(end + close.len()..).unwrap_or("");
    }
    out.push_str(rest);
    out
}

/// The browser page for one share. The view-only page is built without any of
/// the control markup or script, so it has nothing that could send input.
fn render_page(title: &str, token: &str, control_key: Option<&str>) -> String {
    let (mode, badge) = match control_key {
        Some(_) => ("control", "Control"),
        None => ("view", "View only"),
    };
    strip_blocks(PAGE, "control", control_key.is_some())
        .replace("__TITLE__", &escape_html(title))
        .replace("__BASE__", &format!("/s/{token}"))
        .replace("__MODE__", mode)
        .replace("__BADGE__", badge)
        .replace("__KEY__", control_key.unwrap_or(""))
}

fn viewer_page(title: &str, token: &str) -> String {
    render_page(title, token, None)
}

fn control_page(title: &str, token: &str, key: &str) -> String {
    render_page(title, token, Some(key))
}

async fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    respond_with(stream, status, content_type, "", body).await
}

/// `extra_headers` is zero or more complete `Name: value\r\n` lines.
async fn respond_with(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    extra_headers: &str,
    body: &[u8],
) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
{extra_headers}Cache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body).await;
}

struct ViewerGuard(Arc<AtomicUsize>);

impl ViewerGuard {
    fn new(counter: Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        Self(counter)
    }
}

impl Drop for ViewerGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

async fn read_request(stream: &mut TcpStream) -> Option<String> {
    let mut buf = vec![0u8; MAX_REQUEST_BYTES];
    let mut len = 0;
    let complete = tokio::time::timeout(Duration::from_secs(5), async {
        while len < buf.len() {
            let n = stream.read(&mut buf[len..]).await.unwrap_or(0);
            if n == 0 {
                return false;
            }
            len += n;
            if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                return true;
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    complete.then(|| String::from_utf8_lossy(&buf[..len]).to_string())
}

fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then_some(value)
    })
}

/// A coordinate sent as a 0..1 fraction of the shown frame, mapped to pixels.
fn pixel(query: &str, name: &str, extent: u32) -> Option<String> {
    let fraction: f64 = query_param(query, name)?.parse().ok()?;
    if !fraction.is_finite() {
        return None;
    }
    let max = f64::from(extent.saturating_sub(1));
    Some(((fraction.clamp(0.0, 1.0) * max).round() as u32).to_string())
}

fn input_args(shared: &Shared, query: &str) -> Result<Vec<String>, &'static str> {
    let width = shared.width.load(Ordering::Relaxed);
    let height = shared.height.load(Ordering::Relaxed);
    let args = |parts: &[&str]| parts.iter().map(|part| part.to_string()).collect();
    match query_param(query, "a") {
        Some("key") => {
            let code = query_param(query, "code").and_then(key_code);
            Ok(args(&["shell", "input", "keyevent", code.ok_or("unknown key")?]))
        }
        Some(action @ ("tap" | "swipe")) => {
            if width == 0 || height == 0 {
                return Err("no frame yet");
            }
            let x = pixel(query, "x", width).ok_or("bad x")?;
            let y = pixel(query, "y", height).ok_or("bad y")?;
            if action == "tap" {
                return Ok(vec!["shell".into(), "input".into(), "tap".into(), x, y]);
            }
            let x2 = pixel(query, "x2", width).ok_or("bad x2")?;
            let y2 = pixel(query, "y2", height).ok_or("bad y2")?;
            let duration = query_param(query, "d")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(200)
                .clamp(MIN_SWIPE_MS, MAX_SWIPE_MS);
            Ok(vec![
                "shell".into(),
                "input".into(),
                "swipe".into(),
                x,
                y,
                x2,
                y2,
                duration.to_string(),
            ])
        }
        _ => Err("unknown action"),
    }
}

/// `<title>-<local time>.png` with everything outside `[A-Za-z0-9_-]` replaced,
/// so the name is safe both in a header and on disk.
fn capture_filename(title: &str, stamp: &str) -> String {
    let safe: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let safe = safe.trim_matches('_');
    format!("{}-{stamp}.png", if safe.is_empty() { "screenshot" } else { safe })
}

async fn handle_capture(stream: &mut TcpStream, shared: &Shared) {
    let _one_at_a_time = shared.capture_lock.lock().await;
    match screenshot::capture_png_frame(
        &shared.serial,
        shared.custom_path.clone(),
        CAPTURE_TIMEOUT_SECS,
    )
    .await
    {
        Ok(png) => {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
            let disposition = format!(
                "Content-Disposition: attachment; filename=\"{}\"\r\n",
                capture_filename(&shared.title, &stamp)
            );
            respond_with(stream, "200 OK", "image/png", &disposition, &png).await
        }
        Err((_, message)) => {
            respond(stream, "502 Bad Gateway", "text/plain", message.as_bytes()).await
        }
    }
}

/// Control socket of the device's scrcpy session, when one is running.
fn control_socket(shared: &Shared) -> Option<Arc<tokio::sync::Mutex<TcpStream>>> {
    let host = shared.host.as_ref()?;
    host.app
        .state::<EmbedSessionState>()
        .remote_control_for_serial(&shared.serial)
        .ok()
}

/// Everything a control request must pass before it touches the device: the
/// share's control key, a request budget, and a record of who is sending it.
fn control_gate(
    shared: &Shared,
    query: &str,
    peer: IpAddr,
) -> Result<(), (&'static str, &'static [u8])> {
    let key_ok = match (&shared.control_key, query_param(query, "k")) {
        (Some(expected), Some(given)) => constant_time_eq(expected, given),
        _ => false,
    };
    if !key_ok {
        return Err(("403 Forbidden", b"control not allowed"));
    }
    let allowed = shared
        .control_rate
        .lock()
        .map(|mut window| window.allow(Instant::now(), MAX_CONTROL_PER_SECOND))
        .unwrap_or(false);
    if !allowed {
        return Err(("429 Too Many Requests", b"slow down"));
    }
    if shared.note_controller(peer, Instant::now()) {
        if let Some(host) = &shared.host {
            let _ = host.window.emit(
                "scrcpy-log",
                format!("[SHARE] {peer} is controlling {}", shared.serial),
            );
        }
    }
    Ok(())
}

fn fraction(query: &str, name: &str) -> Option<f64> {
    let value: f64 = query_param(query, name)?.parse().ok()?;
    value.is_finite().then_some(value)
}

async fn send_touch(
    handle: &Arc<tokio::sync::Mutex<TcpStream>>,
    action: u8,
    x: f64,
    y: f64,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let (px, py) = embed_session::validate_touch(
        x.clamp(0.0, 1.0) * f64::from(width.saturating_sub(1)),
        y.clamp(0.0, 1.0) * f64::from(height.saturating_sub(1)),
        width,
        height,
    )?;
    let pressure = if action == control::ACTION_UP { 0.0 } else { 1.0 };
    let message =
        control::encode_touch(action, 0, px, py, width as u16, height as u16, pressure);
    embed_session::write_control(handle, &message).await
}

/// Real touch input through scrcpy's control socket: `a=down|move|up` follow a
/// finger, `a=scroll` plays a short drag from a point by a fraction of the screen.
async fn handle_touch(stream: &mut TcpStream, shared: &Shared, query: &str, peer: IpAddr) {
    if let Err((status, reason)) = control_gate(shared, query, peer) {
        return respond(stream, status, "text/plain", reason).await;
    }
    let Some(handle) = control_socket(shared) else {
        return respond(stream, "409 Conflict", "text/plain", b"no live video session").await;
    };
    let width = shared.video_width.load(Ordering::Relaxed);
    let height = shared.video_height.load(Ordering::Relaxed);
    if width == 0 || height == 0 {
        return respond(stream, "409 Conflict", "text/plain", b"no video frame yet").await;
    }
    let (Some(x), Some(y)) = (fraction(query, "x"), fraction(query, "y")) else {
        return respond(stream, "400 Bad Request", "text/plain", b"bad coordinates").await;
    };
    let result = match query_param(query, "a") {
        Some(name @ ("down" | "move" | "up")) => {
            let action = control::touch_action_code(name).unwrap_or(control::ACTION_MOVE);
            send_touch(&handle, action, x, y, width, height).await
        }
        Some("scroll") => {
            let (Some(dx), Some(dy)) = (fraction(query, "dx"), fraction(query, "dy")) else {
                return respond(stream, "400 Bad Request", "text/plain", b"bad scroll").await;
            };
            let _ordered = shared.input_lock.lock().await;
            scroll_drag(&handle, (x, y), (dx, dy), width, height).await
        }
        _ => return respond(stream, "400 Bad Request", "text/plain", b"unknown action").await,
    };
    match result {
        Ok(()) => respond(stream, "204 No Content", "text/plain", b"").await,
        Err(error) => respond(stream, "502 Bad Gateway", "text/plain", error.as_bytes()).await,
    }
}

/// A finger drag from `from` by `delta`, ending inside the screen.
async fn scroll_drag(
    handle: &Arc<tokio::sync::Mutex<TcpStream>>,
    from: (f64, f64),
    delta: (f64, f64),
    width: u32,
    height: u32,
) -> Result<(), String> {
    let to = ((from.0 + delta.0).clamp(0.0, 1.0), (from.1 + delta.1).clamp(0.0, 1.0));
    send_touch(handle, control::ACTION_DOWN, from.0, from.1, width, height).await?;
    for step in 1..=SCROLL_STEPS {
        sleep(Duration::from_millis(SCROLL_STEP_MS)).await;
        let t = f64::from(step) / f64::from(SCROLL_STEPS);
        let at = (from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t);
        send_touch(handle, control::ACTION_MOVE, at.0, at.1, width, height).await?;
    }
    send_touch(handle, control::ACTION_UP, to.0, to.1, width, height).await
}

async fn handle_input(stream: &mut TcpStream, shared: &Shared, query: &str, peer: IpAddr) {
    if let Err((status, reason)) = control_gate(shared, query, peer) {
        return respond(stream, status, "text/plain", reason).await;
    }
    // With a live scrcpy session a key press goes through its control socket,
    // which is much faster than spawning `adb shell input`.
    if query_param(query, "a") == Some("key") {
        let code = query_param(query, "code").and_then(control_keycode);
        if let (Some(code), Some(handle)) = (code, control_socket(shared)) {
            let down = control::encode_keycode(control::KEY_ACTION_DOWN, code, 0, 0);
            let up = control::encode_keycode(control::KEY_ACTION_UP, code, 0, 0);
            let sent = embed_session::write_control(&handle, &down).await.is_ok()
                && embed_session::write_control(&handle, &up).await.is_ok();
            if sent {
                return respond(stream, "204 No Content", "text/plain", b"").await;
            }
        }
    }
    let args = match input_args(shared, query) {
        Ok(args) => args,
        Err(reason) => return respond(stream, "400 Bad Request", "text/plain", reason.as_bytes()).await,
    };
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let _ordered = shared.input_lock.lock().await;
    match adb::run_adb_bytes(
        Some(&shared.serial),
        &refs,
        shared.custom_path.clone(),
        INPUT_TIMEOUT_SECS,
    )
    .await
    {
        Ok(_) => respond(stream, "204 No Content", "text/plain", b"").await,
        Err(error) => {
            respond(stream, "502 Bad Gateway", "text/plain", error.message().as_bytes()).await
        }
    }
}

/// Ends the device session lease once nobody has watched the video for a while.
async fn release_idle_lease(shared: &Shared) {
    let Some(host) = &shared.host else { return };
    let mut lease = shared.lease.lock().await;
    if shared.video_viewers.load(Ordering::Relaxed) > 0 {
        return;
    }
    if let Some(generation) = lease.take() {
        embed_session::release_remote_session_lease(&host.app, &host.window, generation).await;
    }
}

/// Starts (or joins) the device's scrcpy session and subscribes to its H.264
/// stream. The viewer count is raised under the lease lock so an idle release
/// can never race a viewer that is just arriving.
async fn open_video(shared: &Arc<Shared>) -> Result<VideoSubscription, String> {
    let host = shared
        .host
        .as_ref()
        .ok_or_else(|| "Smooth video is not available here".to_string())?;
    let mut lease = shared.lease.lock().await;
    if shared.video_viewers.load(Ordering::Relaxed) >= MAX_VIDEO_VIEWERS {
        return Err("Too many people are watching this share".to_string());
    }
    let state = host.app.state::<EmbedSessionState>();
    if lease.is_none() {
        let generation = NEXT_LEASE.fetch_add(1, Ordering::Relaxed);
        embed_session::ensure_remote_embedded_session(
            host.window.clone(),
            &state,
            shared.serial.clone(),
            shared.custom_path.clone(),
            generation,
        )
        .await?;
        *lease = Some(generation);
    }
    let subscriber = new_token();
    let (session_id, packets) = state.remote_video_subscribe_roomy(&shared.serial, subscriber.clone())?;
    shared.video_viewers.fetch_add(1, Ordering::Relaxed);
    Ok(VideoSubscription {
        shared: shared.clone(),
        session_id,
        subscriber,
        packets: Some(packets),
    })
}

/// One viewer's subscription; dropping it detaches from the stream and starts
/// the idle countdown when it was the last one.
struct VideoSubscription {
    shared: Arc<Shared>,
    session_id: String,
    subscriber: String,
    packets: Option<Receiver<Vec<u8>>>,
}

impl Drop for VideoSubscription {
    fn drop(&mut self) {
        if let Some(host) = &self.shared.host {
            host.app
                .state::<EmbedSessionState>()
                .remote_video_detach(&self.session_id, &self.subscriber);
        }
        if self.shared.video_viewers.fetch_sub(1, Ordering::Relaxed) == 1 {
            let shared = self.shared.clone();
            tokio::spawn(async move {
                sleep(Duration::from_secs(VIDEO_IDLE_RELEASE_SECS)).await;
                release_idle_lease(&shared).await;
            });
        }
    }
}

/// Writes one length-prefixed unit: `[len:u32 BE][bytes]`.
async fn write_unit(stream: &mut TcpStream, bytes: &[u8]) -> bool {
    let mut unit = Vec::with_capacity(4 + bytes.len());
    unit.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    unit.extend_from_slice(bytes);
    stream.write_all(&unit).await.is_ok()
}

fn remember_video_size(shared: &Shared, message: &[u8]) {
    if message.first() == Some(&2) && message.len() >= 9 {
        shared
            .video_width
            .store(u32::from_be_bytes(message[1..5].try_into().unwrap()), Ordering::Relaxed);
        shared
            .video_height
            .store(u32::from_be_bytes(message[5..9].try_into().unwrap()), Ordering::Relaxed);
    }
}

/// Streams the device's H.264 as length-prefixed fragmented-MP4 units. The
/// response carries the `X-Codec` string; the first unit is the init segment.
async fn handle_video(
    stream: &mut TcpStream,
    shared: &Arc<Shared>,
    shutdown: &mut watch::Receiver<bool>,
) {
    let mut subscription = match open_video(shared).await {
        Ok(subscription) => subscription,
        Err(error) => {
            return respond(stream, "503 Service Unavailable", "text/plain", error.as_bytes()).await
        }
    };
    let Some(packets) = subscription.packets.take() else { return };
    let (sender, mut messages) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
    // The hub hands out a blocking receiver; bridge it without blocking the runtime.
    tokio::task::spawn_blocking(move || {
        while let Ok(message) = packets.recv() {
            if sender.blocking_send(message).is_err() {
                break;
            }
        }
    });

    let mut muxer = Fmp4Muxer::new();
    let init = tokio::time::timeout(Duration::from_secs(VIDEO_INIT_TIMEOUT_SECS), async {
        while let Some(message) = messages.recv().await {
            remember_video_size(shared, &message);
            for event in muxer.push(&message) {
                if let MuxEvent::Init { codec, bytes } = event {
                    return Some((codec, bytes));
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    let Some((codec, init)) = init else {
        return respond(stream, "503 Service Unavailable", "text/plain", b"no video from the device").await;
    };

    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nX-Codec: {codec}\r\n\
Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(head.as_bytes()).await.is_err() || !write_unit(stream, &init).await {
        return;
    }
    let mut inbound = [0u8; 64];
    loop {
        tokio::select! {
            message = messages.recv() => {
                let Some(message) = message else { return };
                remember_video_size(shared, &message);
                for event in muxer.push(&message) {
                    match event {
                        MuxEvent::Fragment(bytes) => {
                            if !write_unit(stream, &bytes).await {
                                return;
                            }
                        }
                        // A new codec configuration needs a new init segment:
                        // end the stream so the page reconnects.
                        MuxEvent::Reconfigured => return,
                        MuxEvent::Init { .. } => {}
                    }
                }
            }
            _ = shutdown.changed() => return,
            _ = stream.read(&mut inbound) => return,
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    shared: Arc<Shared>,
    frames: watch::Receiver<Frame>,
    mut shutdown: watch::Receiver<bool>,
) {
    let peer = stream
        .peer_addr()
        .map(|address| address.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let Some(request) = read_request(&mut stream).await else {
        return;
    };
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let base = format!("/s/{}", shared.token);

    if method == "POST" && path == format!("{base}/input") {
        return handle_input(&mut stream, &shared, query, peer).await;
    }
    if method == "POST" && path == format!("{base}/touch") {
        return handle_touch(&mut stream, &shared, query, peer).await;
    }
    if method != "GET" {
        return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"").await;
    }
    if path == base || path == format!("{base}/") {
        let page = viewer_page(&shared.title, &shared.token);
        return respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes()).await;
    }
    if let Some(key) = &shared.control_key {
        if path == format!("{base}/c/{key}") {
            let page = control_page(&shared.title, &shared.token, key);
            return respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes())
                .await;
        }
    }
    if path == format!("{base}/video") {
        return handle_video(&mut stream, &shared, &mut shutdown).await;
    }
    if path == format!("{base}/capture.png") {
        return handle_capture(&mut stream, &shared).await;
    }
    let is_still_stream = path == format!("{base}/stream") || path == format!("{base}/frame.jpg");
    if is_still_stream && shared.viewers.load(Ordering::Relaxed) >= MAX_STILL_VIEWERS {
        return respond(&mut stream, "503 Service Unavailable", "text/plain", b"too many viewers").await;
    }
    if path == format!("{base}/frame.jpg") {
        let _guard = ViewerGuard::new(shared.viewers.clone());
        let mut rx = frames;
        let ready = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Some(frame) = rx.borrow().clone() {
                    return Some(frame);
                }
                if rx.changed().await.is_err() {
                    return None;
                }
            }
        })
        .await
        .ok()
        .flatten();
        return match ready {
            Some(frame) => respond(&mut stream, "200 OK", "image/jpeg", &frame).await,
            None => respond(&mut stream, "503 Service Unavailable", "text/plain", b"no frame").await,
        };
    }
    if path != format!("{base}/stream") {
        return respond(&mut stream, "404 Not Found", "text/plain", b"not found").await;
    }

    let _guard = ViewerGuard::new(shared.viewers.clone());
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary={BOUNDARY}\r\n\
Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    let mut rx = frames;
    loop {
        let frame = rx.borrow_and_update().clone();
        if let Some(frame) = frame {
            let part = format!(
                "--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                frame.len()
            );
            if stream.write_all(part.as_bytes()).await.is_err()
                || stream.write_all(&frame).await.is_err()
                || stream.write_all(b"\r\n").await.is_err()
            {
                return;
            }
        }
        let mut inbound = [0u8; 64];
        tokio::select! {
            changed = rx.changed() => if changed.is_err() { return },
            _ = shutdown.changed() => return,
            // The viewer sends nothing after its request, so a read that
            // returns means the browser closed the connection.
            _ = stream.read(&mut inbound) => return,
        }
    }
}

fn pick_host() -> Ipv4Addr {
    crate::companion::lan_host_candidates()
        .into_iter()
        .next()
        .unwrap_or(Ipv4Addr::LOCALHOST)
}

fn info_for(serial: &str, session: &ShareSession) -> ScreenShareInfo {
    ScreenShareInfo {
        serial: serial.to_string(),
        url: session.url.clone(),
        control_url: session.control_url.clone(),
        port: session.port,
        viewers: session.shared.viewers.load(Ordering::Relaxed)
            + session.shared.video_viewers.load(Ordering::Relaxed),
        expires_in_secs: session.shared.remaining().as_secs(),
        controllers: session.shared.active_controllers(),
    }
}

/// Share lifetime from a requested number of minutes, within sane bounds.
fn expiry(minutes: Option<u32>) -> Duration {
    Duration::from_secs(u64::from(minutes.unwrap_or(DEFAULT_EXPIRY_MINUTES).clamp(1, MAX_EXPIRY_MINUTES)) * 60)
}

/// Stops one share and gives the device session back. Used by the Stop button
/// and by expiry.
async fn end_share(state: &ScreenShareState, serial: &str) {
    let session = state
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(serial));
    if let Some(session) = session {
        let _ = session.shutdown.send(true);
        session.shared.video_viewers.store(0, Ordering::Relaxed);
        release_idle_lease(&session.shared).await;
    }
}

/// Ends the share when its deadline passes, unless it was extended meanwhile.
async fn expiry_task(
    shared: Arc<Shared>,
    shutdown_tx: Arc<watch::Sender<bool>>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        let wait = shared.remaining();
        tokio::select! {
            _ = sleep(wait) => {
                if !shared.remaining().is_zero() {
                    continue;
                }
                match &shared.host {
                    Some(host) => {
                        end_share(&host.app.state::<ScreenShareState>(), &shared.serial).await;
                        let _ = host.window.emit(
                            "screen-share-ended",
                            json!({ "serial": shared.serial, "reason": "expired" }),
                        );
                        let _ = host.window.emit(
                            "scrcpy-log",
                            format!("[SHARE] sharing {} stopped: it expired", shared.serial),
                        );
                    }
                    None => {
                        let _ = shutdown_tx.send(true);
                    }
                }
                return;
            }
            _ = shutdown.changed() => return,
        }
    }
}

#[tauri::command]
pub async fn screen_share_start(
    state: State<'_, ScreenShareState>,
    serial: String,
    custom_path: Option<String>,
    fps: Option<u32>,
    title: Option<String>,
    allow_control: Option<bool>,
    expires_minutes: Option<u32>,
    window: Window,
) -> Result<ScreenShareInfo, String> {
    let serial = serial.trim().to_string();
    adb::validate_serial(&serial).map_err(|error| error.message())?;
    if let Some(existing) = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&serial)
    {
        return Ok(info_for(&serial, existing));
    }

    let allow_control = allow_control.unwrap_or(false);
    let default_fps = if allow_control { CONTROL_FPS } else { VIEW_FPS };
    let fps = fps.unwrap_or(default_fps).clamp(MIN_FPS, MAX_FPS);
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|error| format!("Could not open a sharing port: {error}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let token = new_token();
    let control_key = allow_control.then(new_token);
    let origin = format!("http://{}:{port}/s/{token}", pick_host());
    let control_url = control_key.as_ref().map(|key| format!("{origin}/c/{key}"));

    let shared = Arc::new(Shared {
        title: title.unwrap_or_else(|| serial.clone()),
        serial: serial.clone(),
        custom_path,
        token,
        control_key,
        viewers: Arc::new(AtomicUsize::new(0)),
        width: AtomicU32::new(0),
        height: AtomicU32::new(0),
        input_lock: tokio::sync::Mutex::new(()),
        capture_lock: tokio::sync::Mutex::new(()),
        host: Some(Host {
            app: window.app_handle().clone(),
            window,
        }),
        lease: tokio::sync::Mutex::new(None),
        video_viewers: AtomicUsize::new(0),
        video_width: AtomicU32::new(0),
        video_height: AtomicU32::new(0),
        expires_at: Mutex::new(Instant::now() + expiry(expires_minutes)),
        controllers: Mutex::new(HashMap::new()),
        control_rate: Mutex::new(RateWindow::new(Instant::now())),
    });
    let (frame_tx, frame_rx) = watch::channel::<Frame>(None);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let shutdown_tx = Arc::new(shutdown_tx);
    tokio::spawn(expiry_task(shared.clone(), shutdown_tx.clone(), shutdown_rx.clone()));

    tokio::spawn(capture_loop(
        shared.clone(),
        fps,
        frame_tx,
        shutdown_rx.clone(),
    ));

    let accept_shared = shared.clone();
    let mut accept_shutdown = shutdown_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = accept_shutdown.changed() => return,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    // Frames are small and latency matters more than packing: without
                    // this, Nagle's algorithm can hold a frame back for tens of ms.
                    let _ = stream.set_nodelay(true);
                    tokio::spawn(handle_connection(
                        stream,
                        accept_shared.clone(),
                        frame_rx.clone(),
                        shutdown_rx.clone(),
                    ));
                }
            }
        }
    });

    let session = ShareSession {
        url: origin,
        control_url,
        port,
        shared,
        shutdown: shutdown_tx,
    };
    let info = info_for(&serial, &session);
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(serial, session);
    Ok(info)
}

#[tauri::command]
pub async fn screen_share_stop(
    state: State<'_, ScreenShareState>,
    serial: String,
) -> Result<(), String> {
    end_share(&state, serial.trim()).await;
    Ok(())
}

/// Pushes the share's deadline `minutes` from now.
#[tauri::command]
pub fn screen_share_extend(
    state: State<'_, ScreenShareState>,
    serial: String,
    minutes: Option<u32>,
) -> Result<ScreenShareInfo, String> {
    let serial = serial.trim();
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(serial)
        .ok_or_else(|| "This device is not being shared".to_string())?;
    session.shared.set_expiry(expiry(minutes));
    Ok(info_for(serial, session))
}

#[tauri::command]
pub fn screen_share_status(
    state: State<'_, ScreenShareState>,
    serial: String,
) -> Option<ScreenShareInfo> {
    let serial = serial.trim();
    state
        .sessions
        .lock()
        .ok()?
        .get(serial)
        .map(|session| info_for(serial, session))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared(control_key: Option<&str>, width: u32, height: u32) -> Shared {
        Shared {
            serial: "TESTSERIAL".into(),
            custom_path: None,
            token: "tok".into(),
            title: "Dev".into(),
            control_key: control_key.map(str::to_string),
            viewers: Arc::new(AtomicUsize::new(0)),
            width: AtomicU32::new(width),
            height: AtomicU32::new(height),
            input_lock: tokio::sync::Mutex::new(()),
            capture_lock: tokio::sync::Mutex::new(()),
            host: None,
            lease: tokio::sync::Mutex::new(None),
            video_viewers: AtomicUsize::new(0),
            video_width: AtomicU32::new(0),
            video_height: AtomicU32::new(0),
            expires_at: Mutex::new(Instant::now() + Duration::from_secs(3600)),
            controllers: Mutex::new(HashMap::new()),
            control_rate: Mutex::new(RateWindow::new(Instant::now())),
        }
    }

    #[test]
    fn tap_scales_fraction_to_native_pixels() {
        let args = input_args(&shared(None, 1200, 2640), "a=tap&x=0.5&y=0.25").unwrap();
        assert_eq!(args, ["shell", "input", "tap", "600", "660"]);
    }

    #[test]
    fn swipe_clamps_coordinates_and_duration() {
        let args =
            input_args(&shared(None, 1000, 2000), "a=swipe&x=-3&y=0.5&x2=9&y2=0.5&d=99999").unwrap();
        assert_eq!(args, ["shell", "input", "swipe", "0", "1000", "999", "1000", "2000"]);
    }

    #[test]
    fn rejects_unknown_actions_keys_and_bad_numbers() {
        let s = shared(None, 1000, 2000);
        assert!(input_args(&s, "a=shell").is_err());
        assert!(input_args(&s, "a=key&code=power").is_err());
        assert!(input_args(&s, "a=tap&x=abc&y=0.5").is_err());
        assert!(input_args(&s, "a=tap&x=NaN&y=0.5").is_err());
        assert!(input_args(&s, "a=tap&y=0.5").is_err());
    }

    #[test]
    fn taps_wait_for_the_first_frame() {
        assert_eq!(input_args(&shared(None, 0, 0), "a=tap&x=0.5&y=0.5"), Err("no frame yet"));
    }

    #[test]
    fn capture_filenames_are_header_and_disk_safe() {
        assert_eq!(capture_filename("ELS-NX9", "20260101-101010"), "ELS-NX9-20260101-101010.png");
        assert_eq!(capture_filename("My \"Phone\"\r\nX: y", "t"), "My__Phone___X__y-t.png");
        assert_eq!(capture_filename("  ", "t"), "screenshot-t.png");
    }

    #[test]
    fn allowed_keys_map_to_keycodes() {
        let args = input_args(&shared(None, 1, 1), "a=key&code=home").unwrap();
        assert_eq!(args, ["shell", "input", "keyevent", "KEYCODE_HOME"]);
    }

    async fn request(port: u16, raw: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(raw.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(3), stream.read_to_end(&mut out)).await;
        String::from_utf8_lossy(&out).to_string()
    }

    /// Serves one session on its own listener and returns the port.
    async fn serve(shared: Shared) -> u16 {
        let shared = Arc::new(shared);
        let (frame_tx, frames) = watch::channel::<Frame>(None);
        let (shutdown_tx, shutdown) = watch::channel(false);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _keep_open = (frame_tx, shutdown_tx);
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(handle_connection(
                    stream,
                    shared.clone(),
                    frames.clone(),
                    shutdown.clone(),
                ));
            }
        });
        port
    }

    fn post(q: &str) -> String {
        format!("POST /s/tok/input?{q} HTTP/1.1\r\nHost: x\r\n\r\n")
    }

    #[tokio::test]
    async fn view_only_share_refuses_input_and_has_no_control_page() {
        let port = serve(shared(None, 1000, 2000)).await;
        let reply = request(port, &post("k=guess&a=tap&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 403"), "{reply}");
        let reply = request(port, "GET /s/tok/c/guess HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 404"), "{reply}");
        // the view page carries no control markup or input script at all
        let page = request(port, "GET /s/tok HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("View only"), "{page}");
        assert!(!page.contains("data-k") && !page.contains("/input") && !page.contains("__"));
        // capture is a view feature, so the view-only page offers it too
        assert!(page.contains("/capture.png") && page.contains("id=\"cap\""));
        assert!(!page.contains("wheel"));
    }

    #[tokio::test]
    async fn control_share_checks_the_key_and_validates_input() {
        let port = serve(shared(Some("secretkey"), 1000, 2000)).await;
        let reply = request(port, &post("k=wrong&a=tap&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 403"), "{reply}");
        let reply = request(port, &post("a=tap&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 403"), "missing key: {reply}");
        // right key, invalid action: rejected before anything reaches adb
        let reply = request(port, &post("k=secretkey&a=shell")).await;
        assert!(reply.starts_with("HTTP/1.1 400"), "{reply}");
        let reply = request(port, "GET /s/tok/c/secretkey HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 200") && reply.contains("data-k=\"home\""), "{reply}");
        assert!(reply.contains("secretkey") && !reply.contains("__") && !reply.contains("<!--"));
        // Trimming the buffer by time cuts the key frame the picture depends on and
        // freezes the video until the next one (about every 10 s), so it must stay out.
        assert!(!reply.contains("sb.remove"), "page must not trim the media buffer itself");
        assert!(reply.contains("This share has ended"), "viewers are told when the share is over");
        // the placeholder size must not pin the frame once there is a picture, or a
        // rotated (landscape) device is drawn inside a tall portrait frame
        assert!(reply.contains(".live .screen{min-width:0;min-height:0}"));
    }

    const PEER: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20));

    #[test]
    fn keys_compare_without_short_circuiting() {
        assert!(constant_time_eq("abc123", "abc123"));
        assert!(!constant_time_eq("abc123", "abc124"));
        assert!(!constant_time_eq("abc123", "abc12"));
        assert!(!constant_time_eq("", "a"));
    }

    #[test]
    fn rate_window_allows_a_budget_per_second() {
        let t0 = Instant::now();
        let mut window = RateWindow::new(t0);
        assert!((0..3).all(|_| window.allow(t0, 3)));
        assert!(!window.allow(t0, 3), "fourth request in the same second is refused");
        assert!(window.allow(t0 + Duration::from_secs(1), 3), "a new second starts a new budget");
    }

    #[test]
    fn gate_checks_the_key_before_spending_budget_and_then_rate_limits() {
        let sh = shared(Some("secretkey"), 1, 1);
        for _ in 0..1000 {
            assert_eq!(control_gate(&sh, "k=wrong", PEER).unwrap_err().0, "403 Forbidden");
        }
        for n in 0..MAX_CONTROL_PER_SECOND {
            assert!(control_gate(&sh, "k=secretkey", PEER).is_ok(), "request {n} within budget");
        }
        assert_eq!(control_gate(&sh, "k=secretkey", PEER).unwrap_err().0, "429 Too Many Requests");
        assert_eq!(control_gate(&shared(None, 1, 1), "k=secretkey", PEER).unwrap_err().0, "403 Forbidden");
    }

    #[test]
    fn controllers_are_announced_once_and_listed() {
        let sh = shared(Some("k"), 1, 1);
        let t0 = Instant::now();
        assert!(sh.note_controller(PEER, t0), "first input from an address is new");
        assert!(!sh.note_controller(PEER, t0 + Duration::from_secs(10)));
        assert_eq!(sh.active_controllers(), ["192.168.1.20"]);
        let later = t0 + Duration::from_secs(10 + CONTROL_ACTIVE_SECS + 1);
        assert!(sh.note_controller(PEER, later), "an address that went quiet is announced again");
    }

    #[tokio::test]
    async fn share_stops_itself_on_expiry_and_extending_postpones_it() {
        let sh = Arc::new(shared(Some("k"), 1, 1));
        sh.set_expiry(Duration::from_millis(80));
        let (tx, rx) = watch::channel(false);
        tokio::spawn(expiry_task(sh.clone(), Arc::new(tx), rx.clone()));
        sleep(Duration::from_millis(40)).await;
        sh.set_expiry(Duration::from_millis(200));
        sleep(Duration::from_millis(120)).await;
        assert!(!*rx.borrow(), "the original deadline passed but the share was extended");
        sleep(Duration::from_millis(220)).await;
        assert!(*rx.borrow(), "the extended deadline passed");
    }

    #[test]
    fn requested_lifetime_is_bounded() {
        assert_eq!(expiry(None), Duration::from_secs(30 * 60));
        assert_eq!(expiry(Some(0)), Duration::from_secs(60));
        assert_eq!(expiry(Some(u32::MAX)), Duration::from_secs(u64::from(MAX_EXPIRY_MINUTES) * 60));
    }

    fn post_to(path: &str, q: &str) -> String {
        format!("POST /s/tok/{path}?{q} HTTP/1.1\r\nHost: x\r\n\r\n")
    }

    #[tokio::test]
    async fn touch_needs_the_key_and_a_live_video_session() {
        let port = serve(shared(Some("secretkey"), 1000, 2000)).await;
        let reply = request(port, &post_to("touch", "k=wrong&a=down&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 403"), "{reply}");
        // right key, but there is no scrcpy session to send it to
        let reply = request(port, &post_to("touch", "k=secretkey&a=down&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 409"), "{reply}");
        let view_only = serve(shared(None, 1000, 2000)).await;
        let reply = request(view_only, &post_to("touch", "k=x&a=down&x=0.5&y=0.5")).await;
        assert!(reply.starts_with("HTTP/1.1 403"), "view-only share must refuse touch: {reply}");
    }

    #[tokio::test]
    async fn video_is_unavailable_without_the_app() {
        let port = serve(shared(None, 0, 0)).await;
        let reply = request(port, "GET /s/tok/video HTTP/1.1\r\nHost: x\r\n\r\n").await;
        assert!(reply.starts_with("HTTP/1.1 503"), "{reply}");
    }
}
