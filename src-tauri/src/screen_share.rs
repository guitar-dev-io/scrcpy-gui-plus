//! LAN view-only screen sharing.
//!
//! Starts a small HTTP server that streams a device's screen as MJPEG so anyone
//! on the same network can watch it from a browser. Frames come from the same
//! `adb exec-out screencap` path as the in-app preview, so no extra binary or
//! on-device component is needed. The URL carries a random token and capture
//! only runs while at least one viewer is connected.

use crate::{adb, screenshot};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
use rand::RngExt;
use serde::Serialize;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::time::{sleep, Duration};

const CAPTURE_TIMEOUT_SECS: u64 = 12;
const MAX_REQUEST_BYTES: usize = 4096;
const MAX_FRAME_WIDTH: u32 = 720;
const JPEG_QUALITY: u8 = 70;
const MIN_FPS: u32 = 1;
const MAX_FPS: u32 = 5;
const BOUNDARY: &str = "scrcpyguiframe";

type Frame = Option<Arc<Vec<u8>>>;

struct ShareSession {
    url: String,
    port: u16,
    viewers: Arc<AtomicUsize>,
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
    pub port: u16,
    pub viewers: usize,
}

fn new_token() -> String {
    format!("{:032x}", rand::rng().random::<u128>())
}

fn encode_jpeg(png: &[u8]) -> Result<Vec<u8>, String> {
    let rgba = screenshot::decode_png_frame(png).map_err(|(_, message)| message)?;
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
    Ok(out)
}

async fn capture_loop(
    serial: String,
    custom_path: Option<String>,
    fps: u32,
    viewers: Arc<AtomicUsize>,
    frames: watch::Sender<Frame>,
    mut shutdown: watch::Receiver<bool>,
) {
    let interval = Duration::from_millis(1000 / u64::from(fps));
    loop {
        if *shutdown.borrow() {
            return;
        }
        if viewers.load(Ordering::Relaxed) == 0 {
            tokio::select! {
                _ = sleep(Duration::from_millis(300)) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        }
        let started = tokio::time::Instant::now();
        let captured =
            screenshot::capture_png_frame(&serial, custom_path.clone(), CAPTURE_TIMEOUT_SECS).await;
        match captured {
            Ok(png) => {
                if let Ok(Ok(jpeg)) = tokio::task::spawn_blocking(move || encode_jpeg(&png)).await {
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

fn viewer_page(title: &str, token: &str) -> String {
    let title = title
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>{title}</title><style>\
html,body{{margin:0;height:100%;background:#05070b;color:#9aa3b2;font:14px system-ui,sans-serif}}\
body{{display:flex;align-items:center;justify-content:center}}\
img{{max-width:100vw;max-height:100vh;object-fit:contain}}\
</style></head><body><img alt=\"{title}\" src=\"/s/{token}/stream\"></body></html>"
    )
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

async fn handle_connection(
    mut stream: TcpStream,
    token: Arc<String>,
    title: Arc<String>,
    viewers: Arc<AtomicUsize>,
    frames: watch::Receiver<Frame>,
    mut shutdown: watch::Receiver<bool>,
) {
    let Some(request) = read_request(&mut stream).await else {
        return;
    };
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let path = path.split('?').next().unwrap_or("");
    let base = format!("/s/{token}");

    if method != "GET" {
        return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"").await;
    }
    if path == base || path == format!("{base}/") {
        let page = viewer_page(&title, &token);
        return respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes()).await;
    }
    if path == format!("{base}/frame.jpg") {
        let _guard = ViewerGuard::new(viewers);
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

    let _guard = ViewerGuard::new(viewers);
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
        port: session.port,
        viewers: session.viewers.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub async fn screen_share_start(
    state: State<'_, ScreenShareState>,
    serial: String,
    custom_path: Option<String>,
    fps: Option<u32>,
    title: Option<String>,
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

    let fps = fps.unwrap_or(2).clamp(MIN_FPS, MAX_FPS);
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|error| format!("Could not open a sharing port: {error}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = Arc::new(new_token());
    let title = Arc::new(title.unwrap_or_else(|| serial.clone()));
    let url = format!("http://{}:{port}/s/{token}", pick_host());

    let viewers = Arc::new(AtomicUsize::new(0));
    let (frame_tx, frame_rx) = watch::channel::<Frame>(None);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    tokio::spawn(capture_loop(
        serial.clone(),
        custom_path,
        fps,
        viewers.clone(),
        frame_tx,
        shutdown_rx.clone(),
    ));

    let accept_viewers = viewers.clone();
    let mut accept_shutdown = shutdown_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = accept_shutdown.changed() => return,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    tokio::spawn(handle_connection(
                        stream,
                        token.clone(),
                        title.clone(),
                        accept_viewers.clone(),
                        frame_rx.clone(),
                        shutdown_rx.clone(),
                    ));
                }
            }
        }
    });

    let session = ShareSession {
        url,
        port,
        viewers,
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
