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

use crate::{adb, screenshot};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
use rand::RngExt;
use serde::Serialize;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
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
}

struct ShareSession {
    url: String,
    control_url: Option<String>,
    port: u16,
    shared: Arc<Shared>,
    shutdown: watch::Sender<bool>,
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
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
Cache-Control: no-store\r\nConnection: close\r\n\r\n",
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

async fn handle_input(stream: &mut TcpStream, shared: &Shared, query: &str) {
    let authorized = match (&shared.control_key, query_param(query, "k")) {
        (Some(expected), Some(given)) => expected == given,
        _ => false,
    };
    if !authorized {
        return respond(stream, "403 Forbidden", "text/plain", b"control not allowed").await;
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

async fn handle_connection(
    mut stream: TcpStream,
    shared: Arc<Shared>,
    frames: watch::Receiver<Frame>,
    mut shutdown: watch::Receiver<bool>,
) {
    let Some(request) = read_request(&mut stream).await else {
        return;
    };
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let base = format!("/s/{}", shared.token);

    if method == "POST" && path == format!("{base}/input") {
        return handle_input(&mut stream, &shared, query).await;
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
        viewers: session.shared.viewers.load(Ordering::Relaxed),
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
    });
    let (frame_tx, frame_rx) = watch::channel::<Frame>(None);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

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
pub fn screen_share_stop(state: State<'_, ScreenShareState>, serial: String) {
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(session) = sessions.remove(serial.trim()) {
            let _ = session.shutdown.send(true);
        }
    }
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
    }
}
