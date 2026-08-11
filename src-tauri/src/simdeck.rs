// SimDeck integration (iOS Simulator / Android Emulator control).
//
// SimDeck (github.com/NativeScript/SimDeck, npm package `simdeck`) is a
// native Rust service, shipped as a prebuilt platform binary and launched
// through a thin Node CLI wrapper. It is designed as ONE long-running local
// service shared across tools/projects (VS Code extension, other agent
// skills, etc.) -- `simdeck service start` starts it if needed or reuses an
// already-running instance, and always exits immediately with JSON on
// stdout. Unlike `ios.rs`'s Python streamer, we never own this process as a
// child we must reap: it detaches from whatever spawned it, so there is
// nothing to kill on app quit (killing it would break other tools/projects
// relying on the same shared daemon).
//
// API surface (confirmed by installing `simdeck` locally and reading its
// shipped, unminified `simdeck/test` client at
// `packages/simdeck-test/dist/index.js`, plus a live `/api/health` /
// `/api/simulators` probe against a real running instance -- the public
// simdeck.sh docs only describe CLI verbs, not REST paths):
//
//   `simdeck service start`            -> {ok, pairingCode, pid, projectRoot, started, url}
//   `simdeck service status`           -> {healthy, service: {accessToken, httpUrl, port, ...}, ...}
//   GET  {url}/api/health
//   GET  {url}/api/simulators          -> {simulators: [{udid|id, name, platform?, state,
//                                            isAvailable, isBooted, deviceTypeName,
//                                            runtimeName, android?: {...}, ...}]}
//   POST {url}/api/simulators/{udid}/boot       body: {androidEmulatorArgs?, androidDisableAudio?} | null
//   POST {url}/api/simulators/{udid}/shutdown   body: null
//   POST {url}/api/simulators/{udid}/erase      body: null
//   POST {url}/api/simulators/{udid}/install    body: {appPath}
//   POST {url}/api/simulators/{udid}/uninstall  body: {bundleId}
//   POST {url}/api/simulators/{udid}/action     body: {action: "launch"|"openUrl"|"tap"|
//                                                  "touch"|"swipe"|"gesture"|"type"|"key"|
//                                                  "keySequence"|"button"|"home"|"back"|
//                                                  "dismissKeyboard"|"appSwitcher"|
//                                                  "rotateLeft"|"rotateRight"|
//                                                  "toggleAppearance"|..., ...params}
//   GET  {url}/api/simulators/{udid}/screenshot.png[?bezel=true]
//
// iOS entries key on `udid` (a CoreSimulator UUID); Android emulator entries
// key on `id` (e.g. `"android:Pixel_8_API_35"`) and additionally carry
// `platform: "android-emulator"`. Both accept the same value back as the
// `{udid}` path segment.
//
// Auth: SimDeck persists a stable `accessToken` (exposed via
// `service status`) and expects it on `X-SimDeck-Token` for browser/LAN
// clients, alongside an `Origin` header matching the service URL. The
// bundled `simdeck/test` Node client (a same-machine, non-browser HTTP
// client, same trust tier as this Tauri backend) only sends `Origin` and
// still works, implying loopback callers are trusted primarily by Origin --
// we send both headers anyway since it costs nothing and is forward
// compatible if that trust boundary tightens.
//
// Live video uses WebRTC rather than a custom binary WS protocol like the
// `embed_session.rs` scrcpy path. Rust proxies the SDP offer/answer request;
// the frontend receives the media stream directly from SimDeck.

use crate::commands::{create_command, get_binary_path};
use serde::Serialize;
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::{timeout, Duration};

const CLI_TIMEOUT_SECS: u64 = 25;
const HTTP_TIMEOUT_SECS: u64 = 15;
const INSTALL_TIMEOUT_SECS: u64 = 180;

/// Structured, user-facing SimDeck error categories (mirrors `adb::AdbError`).
#[derive(Debug, Clone, PartialEq)]
pub enum SimDeckError {
    /// The `simdeck` executable could not be located / spawned.
    NotFound,
    /// A CLI invocation or HTTP request exceeded its timeout budget.
    Timeout,
    /// Invalid / unsafe simulator UDID.
    InvalidUdid,
    /// SimDeck returned something that wasn't valid/expected JSON.
    InvalidResponse(String),
    /// SimDeck's HTTP API responded with a non-2xx status.
    Http { status: u16, body: String },
    /// Any other failure, carrying the raw message.
    Failed(String),
}

impl SimDeckError {
    /// Short stable code for the frontend to branch on if needed.
    pub fn code(&self) -> &'static str {
        match self {
            SimDeckError::NotFound => "simdeck_not_found",
            SimDeckError::Timeout => "timeout",
            SimDeckError::InvalidUdid => "invalid_udid",
            SimDeckError::InvalidResponse(_) => "invalid_response",
            SimDeckError::Http { .. } => "http_error",
            SimDeckError::Failed(_) => "failed",
        }
    }

    /// Human readable message.
    pub fn message(&self) -> String {
        match self {
            SimDeckError::NotFound => "simdeck executable not found. Install it first.".to_string(),
            SimDeckError::Timeout => "simdeck command timed out".to_string(),
            SimDeckError::InvalidUdid => "Invalid simulator UDID".to_string(),
            SimDeckError::InvalidResponse(m) => format!("Unexpected response from simdeck: {m}"),
            SimDeckError::Http { status, body } => {
                if body.trim().is_empty() {
                    format!("simdeck request failed ({status})")
                } else {
                    format!("simdeck request failed ({status}): {body}")
                }
            }
            SimDeckError::Failed(m) => m.clone(),
        }
    }
}

impl std::fmt::Display for SimDeckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

impl std::error::Error for SimDeckError {}

/// Validate a simulator UDID before it is ever used to build a URL path.
/// Accepts CoreSimulator UUIDs and SimDeck's `android:<AVD_NAME>` form.
pub fn validate_udid(udid: &str) -> Result<(), SimDeckError> {
    if udid.is_empty() || udid.len() > 160 {
        return Err(SimDeckError::InvalidUdid);
    }
    let valid = udid
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ':' | '_' | '.'));
    if valid {
        Ok(())
    } else {
        Err(SimDeckError::InvalidUdid)
    }
}

/// Cached info about the shared SimDeck service. We never spawn/own this as
/// a child process (see module doc comment), so there is nothing here to
/// tear down on app quit.
#[derive(Clone, Debug)]
struct SimDeckDaemon {
    url: String,
    pairing_code: Option<String>,
    token: Option<String>,
    remote: bool,
}

#[derive(Default)]
pub struct SimDeckState {
    daemon: Mutex<Option<SimDeckDaemon>>,
}

fn validate_remote_url(input: &str) -> Result<String, SimDeckError> {
    let mut url = reqwest::Url::parse(input.trim())
        .map_err(|_| SimDeckError::Failed("Invalid SimDeck URL".to_string()))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err(SimDeckError::Failed(
            "SimDeck URL must be an http(s) origin without credentials".to_string(),
        ));
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err(SimDeckError::Failed(
            "SimDeck URL must not include a path".to_string(),
        ));
    }
    if url.scheme() == "http" {
        let host = url.host_str().unwrap_or_default();
        let trusted_lan = host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .map(|ip| match ip {
                    std::net::IpAddr::V4(v4) => {
                        let octets = v4.octets();
                        let is_tailscale = octets[0] == 100 && (64..=127).contains(&octets[1]);
                        v4.is_private() || v4.is_loopback() || is_tailscale
                    }
                    std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local(),
                })
                .unwrap_or(false);
        if !trusted_lan {
            return Err(SimDeckError::Failed(
                "Plain HTTP is only allowed for localhost, private LAN, or Tailscale addresses"
                    .to_string(),
            ));
        }
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Pair with a SimDeck service running on another machine. The returned token
/// is kept only in process memory and is never exposed to or persisted by the frontend.
#[tauri::command]
pub async fn connect_remote_simdeck(
    state: State<'_, SimDeckState>,
    url: String,
    pairing_code: String,
) -> Result<Value, String> {
    let base_url = validate_remote_url(&url).map_err(|e| e.message())?;
    let code = pairing_code.trim();
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Ok(json!({ "success": false, "error": "Pairing code must contain 6 digits" }));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{base_url}/api/pair"))
        .header("Origin", base_url.clone())
        .json(&json!({ "code": code }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Ok(json!({
            "success": false,
            "error": if status.as_u16() == 401 { "Pairing code did not match" } else { "Remote SimDeck pairing failed" }
        }));
    }
    let token = body
        .get("accessToken")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| "Remote SimDeck did not return an access token".to_string())?
        .to_string();

    *state.daemon.lock().unwrap() = Some(SimDeckDaemon {
        url: base_url.clone(),
        pairing_code: None,
        token: Some(token),
        remote: true,
    });
    Ok(json!({ "success": true, "url": base_url }))
}

#[tauri::command]
pub fn use_local_simdeck(state: State<'_, SimDeckState>) -> Value {
    *state.daemon.lock().unwrap() = None;
    json!({ "success": true })
}

async fn run_simdeck_json(
    args: &[&str],
    custom_path: Option<String>,
) -> Result<Value, SimDeckError> {
    let bin = get_binary_path("simdeck", custom_path);
    let child = create_command(&bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err(SimDeckError::NotFound);
            }
            return Err(SimDeckError::Failed(e.to_string()));
        }
    };

    let output = match timeout(
        Duration::from_secs(CLI_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(SimDeckError::Failed(e.to_string())),
        Err(_) => return Err(SimDeckError::Timeout),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(SimDeckError::Failed(if stderr.is_empty() {
            format!(
                "simdeck {} exited with {:?}",
                args.join(" "),
                output.status.code()
            )
        } else {
            stderr
        }));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| SimDeckError::InvalidResponse(e.to_string()))
}

/// Probe whether the `simdeck` CLI is reachable, without starting the service.
#[tauri::command]
pub async fn check_simdeck_available(custom_path: Option<String>) -> Value {
    let bin = get_binary_path("simdeck", custom_path);
    let child = create_command(&bin)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(_) => return json!({ "available": false }),
    };

    match timeout(Duration::from_secs(10), child.wait_with_output()).await {
        Ok(Ok(o)) if o.status.success() => json!({
            "available": true,
            "version": String::from_utf8_lossy(&o.stdout).trim(),
        }),
        _ => json!({ "available": false }),
    }
}

/// Install the SimDeck CLI globally via npm, streaming progress on the
/// shared `scrcpy-log` channel (same channel `ios::install_pymobiledevice3`
/// uses for its own tool install).
#[tauri::command]
pub async fn install_simdeck(window: Window) -> Result<Value, String> {
    let _ = window.emit(
        "scrcpy-log",
        "[SimDeck] Installing simdeck via npm...".to_string(),
    );

    let child = create_command("npm")
        .args(["install", "-g", "simdeck@latest"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Could not run npm: {e}. Install Node.js/npm first.");
            let _ = window.emit("scrcpy-log", format!("[SimDeck] {msg}"));
            return Ok(json!({ "success": false, "message": msg }));
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[SimDeck] {line}"));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let win = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = win.emit("scrcpy-log", format!("[SimDeck] {line}"));
            }
        });
    }

    let status = match timeout(Duration::from_secs(INSTALL_TIMEOUT_SECS), child.wait()).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return Ok(json!({ "success": false, "message": e.to_string() })),
        Err(_) => return Ok(json!({ "success": false, "message": "npm install timed out" })),
    };

    if status.success() {
        let _ = window.emit(
            "scrcpy-log",
            "[SimDeck] Installed successfully.".to_string(),
        );
        Ok(json!({ "success": true }))
    } else {
        let msg = format!("npm install exited with {:?}", status.code());
        let _ = window.emit("scrcpy-log", format!("[SimDeck] {msg}"));
        Ok(json!({ "success": false, "message": msg }))
    }
}

/// Start-or-reuse the shared SimDeck service and cache its URL/token. Cheap
/// to call repeatedly (cached after the first success).
async fn ensure_daemon(
    state: &SimDeckState,
    custom_path: Option<String>,
) -> Result<SimDeckDaemon, SimDeckError> {
    if let Some(cached) = state.daemon.lock().unwrap().clone() {
        return Ok(cached);
    }

    let start = run_simdeck_json(&["service", "start"], custom_path.clone()).await?;
    let url = start
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SimDeckError::InvalidResponse("missing url".to_string()))?
        .to_string();
    let pairing_code = start
        .get("pairingCode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Best effort: some SimDeck versions may not require the token for
    // loopback requests carrying a matching Origin header (see module doc
    // comment), so a failure here should not fail the whole daemon check.
    let token = run_simdeck_json(&["service", "status"], custom_path)
        .await
        .ok()
        .and_then(|v| v.get("service").cloned())
        .and_then(|s| {
            s.get("accessToken")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

    let daemon = SimDeckDaemon {
        url,
        pairing_code,
        token,
        remote: false,
    };
    *state.daemon.lock().unwrap() = Some(daemon.clone());
    Ok(daemon)
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .expect("failed to build SimDeck HTTP client")
}

async fn simdeck_request(
    daemon: &SimDeckDaemon,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, SimDeckError> {
    let bytes = simdeck_request_raw(daemon, method, path, body).await?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|e| SimDeckError::InvalidResponse(e.to_string()))
}

async fn simdeck_request_raw(
    daemon: &SimDeckDaemon,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Vec<u8>, SimDeckError> {
    let client = build_client();
    let url = format!("{}{}", daemon.url.trim_end_matches('/'), path);
    let mut req = client
        .request(method, &url)
        .header("Origin", daemon.url.clone());
    if let Some(token) = &daemon.token {
        req = req.header("X-SimDeck-Token", token.clone());
    }
    if let Some(b) = body {
        req = req.json(&b);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| SimDeckError::Failed(e.to_string()))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| SimDeckError::Failed(e.to_string()))?;

    if !status.is_success() {
        return Err(SimDeckError::Http {
            status: status.as_u16(),
            body: String::from_utf8_lossy(&bytes).trim().to_string(),
        });
    }

    Ok(bytes.to_vec())
}

/// Report whether the shared SimDeck service is reachable. Also surfaces the
/// WebRTC ICE server list from `/api/health` (best effort) so the frontend's
/// `RTCPeerConnection` can be configured without a second round trip.
#[tauri::command]
pub async fn get_simdeck_status(
    state: State<'_, SimDeckState>,
    custom_path: Option<String>,
) -> Result<Value, String> {
    match ensure_daemon(&state, custom_path).await {
        Ok(d) => {
            let ice_servers = simdeck_request(&d, reqwest::Method::GET, "/api/health", None)
                .await
                .ok()
                .and_then(|health| health.get("webRtc").cloned())
                .and_then(|web_rtc| web_rtc.get("iceServers").cloned())
                .unwrap_or_else(|| Value::Array(Vec::new()));
            Ok(json!({
                "running": true,
                "url": d.url,
                "pairingCode": d.pairing_code,
                "iceServers": ice_servers,
                "isRemote": d.remote,
            }))
        }
        Err(e) => Ok(json!({
            "running": false,
            "errorCode": e.code(),
            "error": e.message(),
        })),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorDevice {
    pub udid: String,
    pub name: String,
    /// "ios" | "android"
    pub platform: String,
    pub state: String,
    pub is_available: bool,
    pub is_booted: bool,
    pub device_type_name: String,
    pub runtime_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_width: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation_quarter_turns: Option<i64>,
}

fn parse_simulator(raw: &Value) -> Option<SimulatorDevice> {
    let udid = raw
        .get("id")
        .or_else(|| raw.get("udid"))
        .and_then(|v| v.as_str())?
        .to_string();
    let platform = raw
        .get("platform")
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.contains("android") {
                "android"
            } else {
                "ios"
            }
        })
        .unwrap_or("ios")
        .to_string();

    Some(SimulatorDevice {
        udid,
        name: raw
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Simulator")
            .to_string(),
        platform,
        state: raw
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        is_available: raw
            .get("isAvailable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        is_booted: raw
            .get("isBooted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        device_type_name: raw
            .get("deviceTypeName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        runtime_name: raw
            .get("runtimeName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        display_width: raw
            .get("privateDisplay")
            .and_then(|v| v.get("displayWidth"))
            .and_then(|v| v.as_u64()),
        display_height: raw
            .get("privateDisplay")
            .and_then(|v| v.get("displayHeight"))
            .and_then(|v| v.as_u64()),
        display_status: raw
            .get("privateDisplay")
            .and_then(|v| v.get("displayStatus"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        rotation_quarter_turns: raw
            .get("privateDisplay")
            .and_then(|v| v.get("rotationQuarterTurns"))
            .and_then(|v| v.as_i64()),
    })
}

#[tauri::command]
pub async fn list_simulators(
    state: State<'_, SimDeckState>,
    custom_path: Option<String>,
) -> Result<Vec<SimulatorDevice>, String> {
    let daemon = ensure_daemon(&state, custom_path)
        .await
        .map_err(|e| e.message())?;
    let body = simdeck_request(&daemon, reqwest::Method::GET, "/api/simulators", None)
        .await
        .map_err(|e| e.message())?;
    let list = body
        .get("simulators")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(list.iter().filter_map(parse_simulator).collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimActionResult {
    pub success: bool,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl SimActionResult {
    fn ok(action: &str, output: Option<Value>) -> Self {
        SimActionResult {
            success: true,
            action: action.to_string(),
            output,
            error: None,
            error_code: None,
        }
    }

    fn err(action: &str, e: &SimDeckError) -> Self {
        SimActionResult {
            success: false,
            action: action.to_string(),
            output: None,
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        }
    }
}

/// Actions forwarded verbatim to SimDeck's unified `POST .../action`
/// endpoint as `{"action": <name>, ...params}`. Kept as an explicit allowlist
/// (never an arbitrary passthrough) for the same reason
/// `device_control.rs::action_args` is an allowlist.
const INTERACTIVE_ACTIONS: &[&str] = &[
    "launch",
    "openUrl",
    "tap",
    "touch",
    "swipe",
    "gesture",
    "type",
    "key",
    "keySequence",
    "button",
    "home",
    "back",
    "dismissKeyboard",
    "appSwitcher",
    "rotateLeft",
    "rotateRight",
    "toggleAppearance",
];

/// Execute a single validated simulator action. `boot`/`shutdown`/`erase`/
/// `install`/`uninstall` map to their own REST routes; everything in
/// `INTERACTIVE_ACTIONS` goes through the unified `/action` endpoint.
#[tauri::command]
pub async fn simulator_action(
    state: State<'_, SimDeckState>,
    udid: String,
    action: String,
    params: Option<Value>,
    custom_path: Option<String>,
) -> Result<SimActionResult, String> {
    if let Err(e) = validate_udid(&udid) {
        return Ok(SimActionResult::err(&action, &e));
    }

    let daemon = match ensure_daemon(&state, custom_path).await {
        Ok(d) => d,
        Err(e) => return Ok(SimActionResult::err(&action, &e)),
    };

    let path = format!("/api/simulators/{udid}");
    let result = match action.as_str() {
        "boot" => {
            simdeck_request(
                &daemon,
                reqwest::Method::POST,
                &format!("{path}/boot"),
                Some(params.unwrap_or(Value::Null)),
            )
            .await
        }
        "shutdown" => {
            simdeck_request(
                &daemon,
                reqwest::Method::POST,
                &format!("{path}/shutdown"),
                Some(Value::Null),
            )
            .await
        }
        "erase" => {
            simdeck_request(
                &daemon,
                reqwest::Method::POST,
                &format!("{path}/erase"),
                Some(Value::Null),
            )
            .await
        }
        "install" => match params
            .as_ref()
            .and_then(|p| p.get("appPath"))
            .and_then(|v| v.as_str())
        {
            Some(app_path) => {
                simdeck_request(
                    &daemon,
                    reqwest::Method::POST,
                    &format!("{path}/install"),
                    Some(json!({ "appPath": app_path })),
                )
                .await
            }
            None => Err(SimDeckError::Failed(
                "install requires params.appPath".to_string(),
            )),
        },
        "uninstall" => match params
            .as_ref()
            .and_then(|p| p.get("bundleId"))
            .and_then(|v| v.as_str())
        {
            Some(bundle_id) => {
                simdeck_request(
                    &daemon,
                    reqwest::Method::POST,
                    &format!("{path}/uninstall"),
                    Some(json!({ "bundleId": bundle_id })),
                )
                .await
            }
            None => Err(SimDeckError::Failed(
                "uninstall requires params.bundleId".to_string(),
            )),
        },
        _ if INTERACTIVE_ACTIONS.contains(&action.as_str()) => {
            let mut body = params.unwrap_or_else(|| json!({}));
            if let Value::Object(ref mut map) = body {
                map.insert("action".to_string(), Value::String(action.clone()));
            }
            simdeck_request(
                &daemon,
                reqwest::Method::POST,
                &format!("{path}/action"),
                Some(body),
            )
            .await
        }
        _ => Err(SimDeckError::Failed(format!(
            "Unsupported simulator action: {action}"
        ))),
    };

    match result {
        Ok(output) => Ok(SimActionResult::ok(
            &action,
            if output.is_null() { None } else { Some(output) },
        )),
        Err(e) => Ok(SimActionResult::err(&action, &e)),
    }
}

/// Capture a screenshot from the given simulator and persist it as a PNG,
/// reusing the same output-directory convention as `screenshot.rs`.
#[tauri::command]
pub async fn simulator_screenshot(
    app_handle: AppHandle,
    state: State<'_, SimDeckState>,
    udid: String,
    bezel: Option<bool>,
    custom_path: Option<String>,
) -> Result<Value, String> {
    if let Err(e) = validate_udid(&udid) {
        return Ok(json!({ "success": false, "error": e.message(), "errorCode": e.code() }));
    }

    let daemon = match ensure_daemon(&state, custom_path).await {
        Ok(d) => d,
        Err(e) => {
            return Ok(json!({ "success": false, "error": e.message(), "errorCode": e.code() }))
        }
    };

    let path = if bezel.unwrap_or(false) {
        format!("/api/simulators/{udid}/screenshot.png?bezel=true")
    } else {
        format!("/api/simulators/{udid}/screenshot.png")
    };
    let bytes = match simdeck_request_raw(&daemon, reqwest::Method::GET, &path, None).await {
        Ok(b) => b,
        Err(e) => {
            return Ok(json!({ "success": false, "error": e.message(), "errorCode": e.code() }))
        }
    };

    let base = app_handle
        .path()
        .picture_dir()
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|e| e.to_string())?;
    let dir = crate::screenshot::resolve_screenshot_dir(None, &base)?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let filename = crate::screenshot::build_screenshot_filename("Simulator", &udid, &timestamp);
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "path": path.to_string_lossy().to_string(),
        "filename": filename,
    }))
}

/// Proxy the WebRTC SDP offer/answer handshake for a live simulator view.
///
/// The actual media (video) never touches Rust: the frontend's own
/// `RTCPeerConnection` negotiates and receives it directly from SimDeck (the
/// webview is a real browser engine, same as SimDeck's own web client). This
/// command only forwards the one HTTP round trip in that handshake --
/// `POST /api/simulators/{udid}/webrtc/offer` -- so the app's existing
/// invariant (Rust mediates all outbound network calls) still holds. See the
/// module doc comment for how this endpoint's shape was confirmed.
#[tauri::command]
pub async fn simulator_webrtc_offer(
    state: State<'_, SimDeckState>,
    udid: String,
    sdp: String,
    client_id: String,
    custom_path: Option<String>,
) -> Result<Value, String> {
    validate_udid(&udid).map_err(|e| e.message())?;
    let daemon = ensure_daemon(&state, custom_path)
        .await
        .map_err(|e| e.message())?;

    simdeck_request(
        &daemon,
        reqwest::Method::POST,
        &format!("/api/simulators/{udid}/webrtc/offer"),
        Some(json!({
            "clientId": client_id,
            "sdp": sdp,
            "type": "offer",
        })),
    )
    .await
    .map_err(|e| e.message())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_udid_accepts_ios_and_android_forms() {
        assert!(validate_udid("F18D3CF9-C691-4687-AD2F-0B8081D06963").is_ok());
        assert!(validate_udid("android:Pixel_8_API_35").is_ok());
    }

    #[test]
    fn validate_udid_rejects_injection() {
        assert_eq!(validate_udid(""), Err(SimDeckError::InvalidUdid));
        assert_eq!(
            validate_udid("dev; rm -rf /"),
            Err(SimDeckError::InvalidUdid)
        );
        assert_eq!(validate_udid("$(whoami)"), Err(SimDeckError::InvalidUdid));
    }

    #[test]
    fn validate_remote_url_accepts_secure_and_private_origins() {
        assert_eq!(
            validate_remote_url("https://simdeck.example.com/?ignored=yes#fragment").unwrap(),
            "https://simdeck.example.com"
        );
        assert_eq!(
            validate_remote_url("http://127.0.0.1:4310/").unwrap(),
            "http://127.0.0.1:4310"
        );
        assert_eq!(
            validate_remote_url("http://192.168.1.20:4310").unwrap(),
            "http://192.168.1.20:4310"
        );
    }

    #[test]
    fn validate_remote_url_rejects_unsafe_origins() {
        assert!(validate_remote_url("http://example.com:4310").is_err());
        assert!(validate_remote_url("https://user:secret@example.com").is_err());
        assert!(validate_remote_url("https://example.com/api").is_err());
        assert!(validate_remote_url("file:///tmp/simdeck").is_err());
    }

    #[test]
    fn parse_simulator_reads_ios_entry() {
        let raw = json!({
            "udid": "F18D3CF9-C691-4687-AD2F-0B8081D06963",
            "name": "iPhone 17 Pro",
            "state": "Booted",
            "isAvailable": true,
            "isBooted": true,
            "deviceTypeName": "iPhone 17 Pro",
            "runtimeName": "iOS 26.5",
        });
        let device = parse_simulator(&raw).expect("should parse");
        assert_eq!(device.platform, "ios");
        assert_eq!(device.udid, "F18D3CF9-C691-4687-AD2F-0B8081D06963");
        assert!(device.is_booted);
    }

    #[test]
    fn parse_simulator_reads_android_entry() {
        let raw = json!({
            "id": "android:Pixel_8_API_35",
            "platform": "android-emulator",
            "name": "Pixel_8_API_35",
            "state": "Shutdown",
            "isAvailable": true,
            "isBooted": false,
            "deviceTypeName": "Android Emulator",
            "runtimeName": "Android",
        });
        let device = parse_simulator(&raw).expect("should parse");
        assert_eq!(device.platform, "android");
        assert_eq!(device.udid, "android:Pixel_8_API_35");
        assert!(!device.is_booted);
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(SimDeckError::NotFound.code(), "simdeck_not_found");
        assert_eq!(SimDeckError::Timeout.code(), "timeout");
        assert_eq!(SimDeckError::InvalidUdid.code(), "invalid_udid");
    }
}
