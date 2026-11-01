// Network tools backend: adb port forwarding / reversing and the device's
// global HTTP proxy.
//
// * `adb reverse tcp:8081 tcp:8081` lets the phone reach a dev server on the
//   desktop (React Native Metro, Vite, a local API).
// * `adb forward` reaches a port on the phone from the desktop.
// * `settings put global http_proxy host:port` routes the phone's traffic
//   through Charles / mitmproxy / Proxyman.
//
// Only TCP port numbers and a validated host reach adb; every call is a fixed
// argument vector. Forwards that scrcpy itself created (localabstract:scrcpy_*)
// are listed but never removed from here.

use crate::adb::{self, AdbError};
use crate::device_conditions::shell_output_error;
use serde::Serialize;

const NETWORK_TIMEOUT_SECS: u64 = 15;

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Desktop port -> device port (`adb forward`).
    Forward,
    /// Device port -> desktop port (`adb reverse`).
    Reverse,
}

impl Direction {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "forward" => Ok(Direction::Forward),
            "reverse" => Ok(Direction::Reverse),
            other => Err(format!("Unknown direction: {other:?}")),
        }
    }

    fn command(self) -> &'static str {
        match self {
            Direction::Forward => "forward",
            Direction::Reverse => "reverse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRule {
    pub direction: Direction,
    /// The listening side: a desktop spec for forward, a device spec for reverse.
    pub local: String,
    /// Where connections go.
    pub remote: String,
    /// Created by another tool (scrcpy) or not a plain TCP rule; read-only here.
    pub managed: bool,
}

pub fn validate_port(port: u32) -> Result<u16, String> {
    if (1..=65535).contains(&port) {
        Ok(port as u16)
    } else {
        Err(format!("Port must be 1-65535, got {port}"))
    }
}

fn tcp_port(spec: &str) -> Option<u16> {
    spec.strip_prefix("tcp:")?.parse().ok()
}

fn is_plain_tcp(local: &str, remote: &str) -> bool {
    tcp_port(local).is_some() && tcp_port(remote).is_some()
}

/// `adb forward --list` prints every device's rules: "SERIAL tcp:1 tcp:2".
pub fn parse_forward_list(output: &str, serial: &str) -> Vec<PortRule> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let (owner, local, remote) = (parts.next()?, parts.next()?, parts.next()?);
            (owner == serial).then(|| PortRule {
                direction: Direction::Forward,
                local: local.to_string(),
                remote: remote.to_string(),
                managed: !is_plain_tcp(local, remote),
            })
        })
        .collect()
}

/// `adb -s SERIAL reverse --list` prints "<transport> tcp:8081 tcp:8081".
pub fn parse_reverse_list(output: &str) -> Vec<PortRule> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let (_transport, local, remote) = (parts.next()?, parts.next()?, parts.next()?);
            Some(PortRule {
                direction: Direction::Reverse,
                local: local.to_string(),
                remote: remote.to_string(),
                managed: !is_plain_tcp(local, remote),
            })
        })
        .collect()
}

pub fn add_rule_args(direction: Direction, local: u16, remote: u16) -> Vec<String> {
    vec![
        direction.command().to_string(),
        format!("tcp:{local}"),
        format!("tcp:{remote}"),
    ]
}

pub fn remove_rule_args(direction: Direction, local: u16) -> Vec<String> {
    vec![
        direction.command().to_string(),
        "--remove".to_string(),
        format!("tcp:{local}"),
    ]
}

/// A proxy host: IPv4 address or DNS name (letters, digits, '-', '.').
pub fn validate_proxy_host(host: &str) -> Result<(), String> {
    let valid = !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && !host.contains("..")
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid proxy host: {host:?}"))
    }
}

/// `settings get global http_proxy`: "host:port", or unset ("null", "",
/// ":0" which is how the proxy is cleared without a reboot).
pub fn parse_proxy_setting(output: &str) -> Option<(String, u16)> {
    let value = output.trim();
    if value.is_empty() || value == "null" {
        return None;
    }
    let (host, port) = value.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    if host.is_empty() || port == 0 {
        return None;
    }
    Some((host.to_string(), port))
}

pub fn set_proxy_args(host: &str, port: u16) -> Vec<String> {
    vec![
        "shell".into(),
        "settings".into(),
        "put".into(),
        "global".into(),
        "http_proxy".into(),
        format!("{host}:{port}"),
    ]
}

/// ":0" clears the proxy immediately; deleting the key needs a reboot on
/// many builds.
pub fn clear_proxy_args() -> Vec<String> {
    ["shell", "settings", "put", "global", "http_proxy", ":0"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyState {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkState {
    pub success: bool,
    pub rules: Vec<PortRule>,
    pub proxy: Option<ProxyState>,
    /// The device would not report its proxy setting.
    pub proxy_unknown: bool,
    /// Desktop IPv4 addresses a phone on the same network can reach, best first.
    pub host_candidates: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkActionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn action_ok(output: String) -> NetworkActionResult {
    let output = output.trim().to_string();
    NetworkActionResult {
        success: true,
        output: (!output.is_empty()).then_some(output),
        error: None,
        error_code: None,
    }
}

fn action_err(code: &str, message: String) -> NetworkActionResult {
    NetworkActionResult {
        success: false,
        output: None,
        error: Some(message),
        error_code: Some(code.to_string()),
    }
}

fn adb_err(e: &AdbError) -> NetworkActionResult {
    action_err(e.code(), e.message())
}

async fn run(serial: &str, args: &[String], custom_path: Option<String>) -> NetworkActionResult {
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    match adb::run_adb_text(Some(serial), &argv, custom_path, NETWORK_TIMEOUT_SECS).await {
        Ok(output) => match shell_output_error(&output) {
            Some(message) => action_err("command_failed", message),
            None => action_ok(output),
        },
        Err(e) => adb_err(&e),
    }
}

/// Current forward / reverse rules for a device, its HTTP proxy and the
/// desktop addresses to suggest as a proxy host.
#[tauri::command]
pub async fn get_network_state(serial: String, custom_path: Option<String>) -> NetworkState {
    let serial = serial.trim().to_string();
    let host_candidates = crate::companion::lan_host_candidates()
        .into_iter()
        .map(|ip| ip.to_string())
        .collect::<Vec<_>>();
    if let Err(e) = adb::validate_serial(&serial) {
        return NetworkState {
            success: false,
            rules: vec![],
            proxy: None,
            proxy_unknown: true,
            host_candidates,
            error: Some(e.message()),
            error_code: Some(e.code().to_string()),
        };
    }

    // `forward --list` is global (no -s): it lists every device's rules.
    let (forwards, reverses, proxy) = tokio::join!(
        adb::run_adb_text(
            None,
            &["forward", "--list"],
            custom_path.clone(),
            NETWORK_TIMEOUT_SECS
        ),
        adb::run_adb_text(
            Some(&serial),
            &["reverse", "--list"],
            custom_path.clone(),
            NETWORK_TIMEOUT_SECS
        ),
        adb::run_adb_text(
            Some(&serial),
            &["shell", "settings", "get", "global", "http_proxy"],
            custom_path.clone(),
            NETWORK_TIMEOUT_SECS
        ),
    );

    // The reverse list needs the device; if that failed, so does the page.
    let reverses = match reverses {
        Ok(output) => output,
        Err(e) => {
            return NetworkState {
                success: false,
                rules: vec![],
                proxy: None,
                proxy_unknown: true,
                host_candidates,
                error: Some(e.message()),
                error_code: Some(e.code().to_string()),
            }
        }
    };

    let mut rules = parse_reverse_list(&reverses);
    if let Ok(output) = forwards {
        let mut forward_rules = parse_forward_list(&output, &serial);
        forward_rules.append(&mut rules);
        rules = forward_rules;
    }

    let (proxy, proxy_unknown) = match proxy {
        Ok(output) if shell_output_error(&output).is_none() => (
            parse_proxy_setting(&output).map(|(host, port)| ProxyState { host, port }),
            false,
        ),
        _ => (None, true),
    };

    NetworkState {
        success: true,
        rules,
        proxy,
        proxy_unknown,
        host_candidates,
        error: None,
        error_code: None,
    }
}

/// Add a TCP forward or reverse rule.
#[tauri::command]
pub async fn add_port_rule(
    serial: String,
    direction: String,
    local_port: u32,
    remote_port: u32,
    custom_path: Option<String>,
) -> NetworkActionResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return adb_err(&e);
    }
    let parsed = Direction::parse(&direction)
        .and_then(|d| Ok((d, validate_port(local_port)?, validate_port(remote_port)?)));
    let (direction, local, remote) = match parsed {
        Ok(values) => values,
        Err(message) => return action_err("invalid_rule", message),
    };
    run(
        &serial,
        &add_rule_args(direction, local, remote),
        custom_path,
    )
    .await
}

/// Remove a TCP forward or reverse rule by its listening port.
#[tauri::command]
pub async fn remove_port_rule(
    serial: String,
    direction: String,
    local_port: u32,
    custom_path: Option<String>,
) -> NetworkActionResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return adb_err(&e);
    }
    let parsed = Direction::parse(&direction).and_then(|d| Ok((d, validate_port(local_port)?)));
    let (direction, local) = match parsed {
        Ok(values) => values,
        Err(message) => return action_err("invalid_rule", message),
    };
    run(&serial, &remove_rule_args(direction, local), custom_path).await
}

/// Set (`host` + `port`) or clear (no host) the device's global HTTP proxy.
#[tauri::command]
pub async fn set_device_proxy(
    serial: String,
    host: Option<String>,
    port: Option<u32>,
    custom_path: Option<String>,
) -> NetworkActionResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return adb_err(&e);
    }
    let host = host.map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    let args = match host {
        None => clear_proxy_args(),
        Some(host) => {
            if let Err(message) = validate_proxy_host(&host) {
                return action_err("invalid_proxy", message);
            }
            let port = match port.ok_or_else(|| "Proxy port is required".to_string()) {
                Ok(port) => port,
                Err(message) => return action_err("invalid_proxy", message),
            };
            match validate_port(port) {
                Ok(port) => set_proxy_args(&host, port),
                Err(message) => return action_err("invalid_proxy", message),
            }
        }
    };
    run(&serial, &args, custom_path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_forward_list_for_one_device() {
        let output = "\
R58M12345 tcp:27183 localabstract:scrcpy_1a2b3c4d
R58M12345 tcp:9222 tcp:9222
emulator-5554 tcp:5000 tcp:5000
";
        let rules = parse_forward_list(output, "R58M12345");
        assert_eq!(rules.len(), 2);
        assert!(rules[0].managed, "scrcpy socket is read-only");
        assert_eq!(rules[1].local, "tcp:9222");
        assert!(!rules[1].managed);
        assert!(rules.iter().all(|r| r.direction == Direction::Forward));
        assert!(parse_forward_list("", "x").is_empty());
    }

    #[test]
    fn parses_reverse_list() {
        let rules = parse_reverse_list("UsbFfs tcp:8081 tcp:8081\nhost-19 tcp:3000 tcp:5173\n");
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[1].local, "tcp:3000");
        assert_eq!(rules[1].remote, "tcp:5173");
        assert!(rules
            .iter()
            .all(|r| r.direction == Direction::Reverse && !r.managed));
        assert!(parse_reverse_list("\n").is_empty());
    }

    #[test]
    fn validates_ports_and_directions() {
        assert_eq!(validate_port(8081), Ok(8081));
        assert!(validate_port(0).is_err());
        assert!(validate_port(70000).is_err());
        assert_eq!(Direction::parse("reverse"), Ok(Direction::Reverse));
        assert!(Direction::parse("both").is_err());
    }

    #[test]
    fn builds_fixed_rule_arguments() {
        assert_eq!(
            add_rule_args(Direction::Reverse, 8081, 8081),
            vec!["reverse", "tcp:8081", "tcp:8081"]
        );
        assert_eq!(
            remove_rule_args(Direction::Forward, 9222),
            vec!["forward", "--remove", "tcp:9222"]
        );
    }

    #[test]
    fn validates_proxy_hosts() {
        for ok in ["192.168.1.20", "proxy.local", "my-mac"] {
            assert!(validate_proxy_host(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "host;reboot",
            "a b",
            "-x",
            "x.",
            "a..b",
            "http://x",
            "x:8888",
        ] {
            assert!(validate_proxy_host(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn parses_proxy_setting() {
        assert_eq!(
            parse_proxy_setting("192.168.1.20:8888\n"),
            Some(("192.168.1.20".to_string(), 8888))
        );
        assert_eq!(parse_proxy_setting("null"), None);
        assert_eq!(parse_proxy_setting(":0"), None);
        assert_eq!(parse_proxy_setting(""), None);
        assert_eq!(parse_proxy_setting("garbage"), None);
    }

    #[test]
    fn builds_proxy_arguments() {
        assert_eq!(
            set_proxy_args("192.168.1.20", 8888)
                .last()
                .map(String::as_str),
            Some("192.168.1.20:8888")
        );
        assert_eq!(clear_proxy_args().last().map(String::as_str), Some(":0"));
    }
}
