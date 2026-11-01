// Device conditions backend.
//
// Lets the UI put a device into the states apps need testing under (dark
// mode, large fonts, another density, low battery, no animations, a clean
// status bar for store screenshots) and read the current values back.
//
// Same rules as `device_control`: the frontend names a condition and a value,
// both are validated here against fixed lists or numeric ranges, and every
// command is a fixed adb argument vector. Nothing from the frontend is ever
// passed through as free text to the shell.

use crate::adb::{self, AdbError};
use serde::Serialize;

const CONDITION_TIMEOUT_SECS: u64 = 15;

// ---------------------------------------------------------------------------
// Pure logic (validation, argument building, parsing). No adb, no serde, so
// it can be unit tested on its own.
// ---------------------------------------------------------------------------

/// A validated request to change one condition on a device.
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// `cmd uimode night yes|no|auto`
    NightMode(&'static str),
    /// `settings put system font_scale <scale>`; stored in hundredths.
    FontScale(u32),
    /// `wm density <dpi>`, or `wm density reset` when `None`.
    Density(Option<u32>),
    /// `dumpsys battery set level <n>`
    BatteryLevel(u32),
    /// `dumpsys battery unplug`
    BatteryUnplug,
    /// `dumpsys battery reset`
    BatteryReset,
    /// All three animation scales to 1 (on) or 0 (off).
    Animations(bool),
    /// `settings put system show_touches 1|0`
    ShowTouches(bool),
    /// `settings put system pointer_location 1|0`
    PointerLocation(bool),
    /// System UI demo mode: clean status bar (12:00, full battery & signal).
    DemoMode(bool),
    /// `svc power stayon true|false`
    StayAwake(bool),
    /// Undo everything this panel changes except night mode and stay awake,
    /// whose original value is not known.
    ResetAll,
}

pub const FONT_SCALE_MIN: u32 = 50;
pub const FONT_SCALE_MAX: u32 = 300;
pub const DENSITY_MIN: u32 = 72;
pub const DENSITY_MAX: u32 = 1000;

fn parse_on_off(value: Option<&str>) -> Result<bool, String> {
    match value.map(str::trim) {
        Some("on") => Ok(true),
        Some("off") => Ok(false),
        other => Err(format!(
            "Expected \"on\" or \"off\", got {:?}",
            other.unwrap_or("")
        )),
    }
}

/// Parse a font scale such as "1.3" into hundredths (130). At most two
/// decimals, between 0.5 and 3.0.
pub fn parse_font_scale(value: &str) -> Result<u32, String> {
    let value = value.trim();
    let invalid = || format!("Invalid font scale: {value:?}");
    let (whole, frac) = match value.split_once('.') {
        Some((w, f)) => (w, f),
        None => (value, ""),
    };
    if whole.is_empty()
        || whole.len() > 1
        || frac.len() > 2
        || !whole.chars().all(|c| c.is_ascii_digit())
        || !frac.chars().all(|c| c.is_ascii_digit())
    {
        return Err(invalid());
    }
    let whole: u32 = whole.parse().map_err(|_| invalid())?;
    let frac: u32 = if frac.is_empty() {
        0
    } else {
        let padded = format!("{frac:0<2}");
        padded.parse().map_err(|_| invalid())?
    };
    let hundredths = whole * 100 + frac;
    if !(FONT_SCALE_MIN..=FONT_SCALE_MAX).contains(&hundredths) {
        return Err(format!(
            "Font scale must be between 0.5 and 3.0, got {value}"
        ));
    }
    Ok(hundredths)
}

/// Format hundredths as the string Android stores ("1.3", "0.85", "1.0").
pub fn format_font_scale(hundredths: u32) -> String {
    let whole = hundredths / 100;
    let frac = hundredths % 100;
    if frac == 0 {
        format!("{whole}.0")
    } else if frac.is_multiple_of(10) {
        format!("{whole}.{}", frac / 10)
    } else {
        format!("{whole}.{frac:02}")
    }
}

/// Validate a condition id and its value from the frontend.
pub fn parse_condition(condition: &str, value: Option<&str>) -> Result<Condition, String> {
    match condition {
        "night_mode" => match value.map(str::trim) {
            Some("yes") => Ok(Condition::NightMode("yes")),
            Some("no") => Ok(Condition::NightMode("no")),
            Some("auto") => Ok(Condition::NightMode("auto")),
            other => Err(format!(
                "Night mode must be yes, no or auto, got {:?}",
                other.unwrap_or("")
            )),
        },
        "font_scale" => {
            let value = value.ok_or_else(|| "Font scale needs a value".to_string())?;
            parse_font_scale(value).map(Condition::FontScale)
        }
        "density" => {
            let value = value
                .map(str::trim)
                .ok_or_else(|| "Density needs a value".to_string())?;
            if value == "reset" {
                return Ok(Condition::Density(None));
            }
            let dpi: u32 = value
                .parse()
                .map_err(|_| format!("Invalid density: {value:?}"))?;
            if !(DENSITY_MIN..=DENSITY_MAX).contains(&dpi) {
                return Err(format!(
                    "Density must be between {DENSITY_MIN} and {DENSITY_MAX} dpi, got {dpi}"
                ));
            }
            Ok(Condition::Density(Some(dpi)))
        }
        "battery_level" => {
            let value = value
                .map(str::trim)
                .ok_or_else(|| "Battery level needs a value".to_string())?;
            let level: u32 = value
                .parse()
                .map_err(|_| format!("Invalid battery level: {value:?}"))?;
            if level > 100 {
                return Err(format!("Battery level must be 0-100, got {level}"));
            }
            Ok(Condition::BatteryLevel(level))
        }
        "battery_unplug" => Ok(Condition::BatteryUnplug),
        "battery_reset" => Ok(Condition::BatteryReset),
        "animations" => parse_on_off(value).map(Condition::Animations),
        "show_touches" => parse_on_off(value).map(Condition::ShowTouches),
        "pointer_location" => parse_on_off(value).map(Condition::PointerLocation),
        "demo_mode" => parse_on_off(value).map(Condition::DemoMode),
        "stay_awake" => parse_on_off(value).map(Condition::StayAwake),
        "reset_all" => Ok(Condition::ResetAll),
        _ => Err(format!("Unsupported condition: {condition}")),
    }
}

const ANIMATION_SETTINGS: [&str; 3] = [
    "window_animation_scale",
    "transition_animation_scale",
    "animator_duration_scale",
];

fn shell(args: &[&str]) -> Vec<String> {
    std::iter::once("shell")
        .chain(args.iter().copied())
        .map(String::from)
        .collect()
}

fn demo_broadcast(extras: &[&str]) -> Vec<String> {
    let mut args = vec!["am", "broadcast", "-a", "com.android.systemui.demo"];
    args.extend_from_slice(extras);
    shell(&args)
}

/// The adb invocations (each one an argument vector, run in order) that put
/// the device into `condition`.
pub fn condition_commands(condition: &Condition) -> Vec<Vec<String>> {
    match condition {
        Condition::NightMode(mode) => vec![shell(&["cmd", "uimode", "night", mode])],
        Condition::FontScale(hundredths) => {
            let scale = format_font_scale(*hundredths);
            vec![shell(&["settings", "put", "system", "font_scale", &scale])]
        }
        Condition::Density(Some(dpi)) => {
            vec![shell(&["wm", "density", &dpi.to_string()])]
        }
        Condition::Density(None) => vec![shell(&["wm", "density", "reset"])],
        Condition::BatteryLevel(level) => {
            vec![shell(&[
                "dumpsys",
                "battery",
                "set",
                "level",
                &level.to_string(),
            ])]
        }
        Condition::BatteryUnplug => vec![shell(&["dumpsys", "battery", "unplug"])],
        Condition::BatteryReset => vec![shell(&["dumpsys", "battery", "reset"])],
        Condition::Animations(on) => {
            let scale = if *on { "1" } else { "0" };
            ANIMATION_SETTINGS
                .iter()
                .map(|key| shell(&["settings", "put", "global", key, scale]))
                .collect()
        }
        Condition::ShowTouches(on) => vec![shell(&[
            "settings",
            "put",
            "system",
            "show_touches",
            if *on { "1" } else { "0" },
        ])],
        Condition::PointerLocation(on) => vec![shell(&[
            "settings",
            "put",
            "system",
            "pointer_location",
            if *on { "1" } else { "0" },
        ])],
        Condition::DemoMode(true) => vec![
            shell(&["settings", "put", "global", "sysui_demo_allowed", "1"]),
            demo_broadcast(&["-e", "command", "enter"]),
            demo_broadcast(&["-e", "command", "clock", "-e", "hhmm", "1200"]),
            demo_broadcast(&[
                "-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false",
            ]),
            demo_broadcast(&[
                "-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4",
            ]),
            demo_broadcast(&[
                "-e", "command", "network", "-e", "mobile", "show", "-e", "datatype", "none", "-e",
                "level", "4",
            ]),
            demo_broadcast(&["-e", "command", "notifications", "-e", "visible", "false"]),
        ],
        Condition::DemoMode(false) => vec![demo_broadcast(&["-e", "command", "exit"])],
        Condition::StayAwake(on) => vec![shell(&[
            "svc",
            "power",
            "stayon",
            if *on { "true" } else { "false" },
        ])],
        Condition::ResetAll => {
            let mut commands = Vec::new();
            commands.extend(condition_commands(&Condition::FontScale(100)));
            commands.extend(condition_commands(&Condition::Density(None)));
            commands.extend(condition_commands(&Condition::BatteryReset));
            commands.extend(condition_commands(&Condition::Animations(true)));
            commands.extend(condition_commands(&Condition::ShowTouches(false)));
            commands.extend(condition_commands(&Condition::PointerLocation(false)));
            commands.extend(condition_commands(&Condition::DemoMode(false)));
            commands
        }
    }
}

/// Whether one failing step should stop the rest. Reset keeps going so one
/// unsupported setting does not leave the others changed.
pub fn continue_on_error(condition: &Condition) -> bool {
    matches!(condition, Condition::ResetAll)
}

fn value_after_colon<'a>(text: &'a str, label: &str) -> Option<&'a str> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(label) {
            Some(value.trim())
        } else {
            None
        }
    })
}

/// `cmd uimode night` prints "Night mode: yes".
pub fn parse_night_mode(output: &str) -> Option<String> {
    let value = value_after_colon(output, "Night mode")?;
    let value = value.split_whitespace().next()?.to_ascii_lowercase();
    (!value.is_empty()).then_some(value)
}

/// A `settings get` result: "null" (never set) becomes `None`.
pub fn parse_setting(output: &str) -> Option<String> {
    let value = output.trim();
    if value.is_empty() || value == "null" {
        None
    } else {
        Some(value.to_string())
    }
}

/// `settings get system font_scale` as hundredths; unset means 1.0.
pub fn parse_font_scale_setting(output: &str) -> Option<u32> {
    match parse_setting(output) {
        None => Some(100),
        Some(value) => value
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && *v > 0.0)
            .map(|v| (v * 100.0).round() as u32),
    }
}

/// `wm density` prints "Physical density: 440" and, when overridden,
/// "Override density: 420".
pub fn parse_density(output: &str) -> (Option<u32>, Option<u32>) {
    let read = |label| value_after_colon(output, label).and_then(|v| v.parse::<u32>().ok());
    (read("Physical density"), read("Override density"))
}

/// A boolean `settings get` value ("1"/"0"); unset counts as off.
pub fn parse_flag_setting(output: &str) -> bool {
    parse_setting(output)
        .map(|v| v != "0" && v != "0.0")
        .unwrap_or(false)
}

/// Animation scales: off only when every scale is explicitly 0.
pub fn parse_animations_enabled(outputs: &[String]) -> bool {
    !outputs.iter().all(|output| {
        parse_setting(output)
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v == 0.0)
            .unwrap_or(false)
    })
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BatterySnapshot {
    pub level: Option<u32>,
    pub ac_powered: bool,
    pub usb_powered: bool,
    pub wireless_powered: bool,
    /// The battery service is reporting values set with `dumpsys battery set`.
    pub overridden: bool,
}

pub fn parse_battery(output: &str) -> BatterySnapshot {
    let flag = |label| {
        value_after_colon(output, label)
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    };
    BatterySnapshot {
        level: value_after_colon(output, "level").and_then(|v| v.parse().ok()),
        ac_powered: flag("AC powered"),
        usb_powered: flag("USB powered"),
        wireless_powered: flag("Wireless powered"),
        overridden: output.contains("UPDATES STOPPED"),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionResult {
    pub success: bool,
    pub condition: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    pub level: Option<u32>,
    pub ac_powered: bool,
    pub usb_powered: bool,
    pub wireless_powered: bool,
    pub overridden: bool,
}

/// Current values. A field is `None` when the device did not answer that
/// query (older Android, OEM restrictions); the UI shows it as unknown.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConditions {
    pub night_mode: Option<String>,
    /// Font scale as Android stores it, e.g. "1.3".
    pub font_scale: Option<String>,
    pub physical_density: Option<u32>,
    pub override_density: Option<u32>,
    pub battery: Option<BatteryState>,
    pub animations_enabled: Option<bool>,
    pub show_touches: Option<bool>,
    pub pointer_location: Option<bool>,
    pub stay_awake: Option<bool>,
}

fn failure(condition: &str, code: &str, message: String) -> ConditionResult {
    ConditionResult {
        success: false,
        condition: condition.to_string(),
        output: None,
        error: Some(message),
        error_code: Some(code.to_string()),
    }
}

fn adb_failure(condition: &str, e: &AdbError) -> ConditionResult {
    failure(condition, e.code(), e.message())
}

/// Shell commands such as `cmd uimode` exit 0 but print an error when the
/// device refuses them; catch the common forms so the UI does not report a
/// change that did not happen.
fn shell_output_error(output: &str) -> Option<String> {
    let trimmed = output.trim();
    let lower = trimmed.to_ascii_lowercase();
    let refused = lower.starts_with("error")
        || lower.starts_with("exception")
        || lower.contains("securityexception")
        || lower.contains("permission denial")
        || lower.contains("unknown command");
    refused.then(|| trimmed.lines().next().unwrap_or(trimmed).to_string())
}

/// Apply one condition to a device.
#[tauri::command]
pub async fn set_device_condition(
    serial: String,
    condition: String,
    value: Option<String>,
    custom_path: Option<String>,
) -> ConditionResult {
    let serial = serial.trim().to_string();
    if let Err(e) = adb::validate_serial(&serial) {
        return adb_failure(&condition, &e);
    }
    let parsed = match parse_condition(&condition, value.as_deref()) {
        Ok(parsed) => parsed,
        Err(message) => return failure(&condition, "invalid_condition", message),
    };

    let keep_going = continue_on_error(&parsed);
    let mut errors = Vec::new();
    let mut last_output = String::new();
    for args in condition_commands(&parsed) {
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        let step_error = match adb::run_adb_text(
            Some(&serial),
            &argv,
            custom_path.clone(),
            CONDITION_TIMEOUT_SECS,
        )
        .await
        {
            Ok(output) => {
                let error = shell_output_error(&output);
                last_output = output.trim().to_string();
                error
            }
            Err(e) => Some(e.message()),
        };
        if let Some(message) = step_error {
            if !keep_going {
                return failure(&condition, "command_failed", message);
            }
            errors.push(message);
        }
    }

    if errors.is_empty() {
        ConditionResult {
            success: true,
            condition,
            output: (!last_output.is_empty()).then_some(last_output),
            error: None,
            error_code: None,
        }
    } else {
        failure(&condition, "partial_failure", errors.join("; "))
    }
}

async fn query(serial: &str, args: &[&str], custom_path: &Option<String>) -> Option<String> {
    adb::run_adb_text(
        Some(serial),
        args,
        custom_path.clone(),
        CONDITION_TIMEOUT_SECS,
    )
    .await
    .ok()
    .filter(|output| shell_output_error(output).is_none())
}

/// Read the device's current values for every condition the panel controls.
#[tauri::command]
pub async fn get_device_conditions(
    serial: String,
    custom_path: Option<String>,
) -> Result<DeviceConditions, String> {
    let serial = serial.trim().to_string();
    adb::validate_serial(&serial).map_err(|e| e.message())?;
    let cp = custom_path;

    let (night, font, density, battery, anim_window, anim_transition, anim_animator) = tokio::join!(
        query(&serial, &["shell", "cmd", "uimode", "night"], &cp),
        query(
            &serial,
            &["shell", "settings", "get", "system", "font_scale"],
            &cp
        ),
        query(&serial, &["shell", "wm", "density"], &cp),
        query(&serial, &["shell", "dumpsys", "battery"], &cp),
        query(
            &serial,
            &["shell", "settings", "get", "global", ANIMATION_SETTINGS[0]],
            &cp
        ),
        query(
            &serial,
            &["shell", "settings", "get", "global", ANIMATION_SETTINGS[1]],
            &cp
        ),
        query(
            &serial,
            &["shell", "settings", "get", "global", ANIMATION_SETTINGS[2]],
            &cp
        ),
    );
    let (touches, pointer, stay_on) = tokio::join!(
        query(
            &serial,
            &["shell", "settings", "get", "system", "show_touches"],
            &cp
        ),
        query(
            &serial,
            &["shell", "settings", "get", "system", "pointer_location"],
            &cp
        ),
        query(
            &serial,
            &[
                "shell",
                "settings",
                "get",
                "global",
                "stay_on_while_plugged_in"
            ],
            &cp
        ),
    );

    // Nothing answered: the device is gone, so report an error instead of a
    // panel full of unknowns.
    if night.is_none() && font.is_none() && density.is_none() && battery.is_none() {
        return Err(format!("Could not read conditions from {serial}"));
    }

    let (physical_density, override_density) = density
        .as_deref()
        .map(parse_density)
        .unwrap_or((None, None));
    let animations_enabled = match (anim_window, anim_transition, anim_animator) {
        (Some(a), Some(b), Some(c)) => Some(parse_animations_enabled(&[a, b, c])),
        _ => None,
    };

    Ok(DeviceConditions {
        night_mode: night.as_deref().and_then(parse_night_mode),
        font_scale: font
            .as_deref()
            .and_then(parse_font_scale_setting)
            .map(format_font_scale),
        physical_density,
        override_density,
        battery: battery.as_deref().map(parse_battery).map(|b| BatteryState {
            level: b.level,
            ac_powered: b.ac_powered,
            usb_powered: b.usb_powered,
            wireless_powered: b.wireless_powered,
            overridden: b.overridden,
        }),
        animations_enabled,
        show_touches: touches.as_deref().map(parse_flag_setting),
        pointer_location: pointer.as_deref().map(parse_flag_setting),
        stay_awake: stay_on.as_deref().map(parse_flag_setting),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_of(condition: &Condition) -> Vec<Vec<String>> {
        condition_commands(condition)
    }

    #[test]
    fn parses_font_scales() {
        assert_eq!(parse_font_scale("1.3"), Ok(130));
        assert_eq!(parse_font_scale("0.85"), Ok(85));
        assert_eq!(parse_font_scale("2"), Ok(200));
        assert_eq!(parse_font_scale(" 1.0 "), Ok(100));
        for bad in [
            "", "abc", "1.333", "-1", "0.4", "3.5", "1;reboot", "10", ".5",
        ] {
            assert!(parse_font_scale(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn formats_font_scales_like_android() {
        assert_eq!(format_font_scale(100), "1.0");
        assert_eq!(format_font_scale(130), "1.3");
        assert_eq!(format_font_scale(85), "0.85");
        assert_eq!(format_font_scale(200), "2.0");
    }

    #[test]
    fn validates_conditions_and_values() {
        assert_eq!(
            parse_condition("night_mode", Some("yes")),
            Ok(Condition::NightMode("yes"))
        );
        assert!(parse_condition("night_mode", Some("dark")).is_err());
        assert!(parse_condition("night_mode", None).is_err());
        assert_eq!(
            parse_condition("density", Some("reset")),
            Ok(Condition::Density(None))
        );
        assert_eq!(
            parse_condition("density", Some("420")),
            Ok(Condition::Density(Some(420)))
        );
        assert!(parse_condition("density", Some("10")).is_err());
        assert!(parse_condition("density", Some("420; reboot")).is_err());
        assert_eq!(
            parse_condition("battery_level", Some("5")),
            Ok(Condition::BatteryLevel(5))
        );
        assert!(parse_condition("battery_level", Some("101")).is_err());
        assert!(parse_condition("battery_level", Some("-1")).is_err());
        assert_eq!(
            parse_condition("animations", Some("off")),
            Ok(Condition::Animations(false))
        );
        assert!(parse_condition("animations", Some("1")).is_err());
        assert_eq!(parse_condition("reset_all", None), Ok(Condition::ResetAll));
        assert!(parse_condition("shell", Some("rm -rf /")).is_err());
        assert!(parse_condition("", None).is_err());
    }

    #[test]
    fn builds_fixed_adb_arguments() {
        assert_eq!(
            args_of(&Condition::NightMode("yes")),
            vec![vec!["shell", "cmd", "uimode", "night", "yes"]]
        );
        assert_eq!(
            args_of(&Condition::FontScale(130)),
            vec![vec![
                "shell",
                "settings",
                "put",
                "system",
                "font_scale",
                "1.3"
            ]]
        );
        assert_eq!(
            args_of(&Condition::Density(None)),
            vec![vec!["shell", "wm", "density", "reset"]]
        );
        assert_eq!(
            args_of(&Condition::BatteryLevel(5)),
            vec![vec!["shell", "dumpsys", "battery", "set", "level", "5"]]
        );
        assert_eq!(args_of(&Condition::Animations(false)).len(), 3);
        assert!(args_of(&Condition::Animations(false))
            .iter()
            .all(|a| a.last().map(String::as_str) == Some("0")));
        assert_eq!(
            args_of(&Condition::DemoMode(false)),
            vec![vec![
                "shell",
                "am",
                "broadcast",
                "-a",
                "com.android.systemui.demo",
                "-e",
                "command",
                "exit"
            ]]
        );
    }

    #[test]
    fn no_argument_contains_shell_metacharacters() {
        let all = [
            Condition::NightMode("auto"),
            Condition::FontScale(85),
            Condition::Density(Some(320)),
            Condition::BatteryLevel(100),
            Condition::BatteryUnplug,
            Condition::Animations(true),
            Condition::ShowTouches(true),
            Condition::PointerLocation(true),
            Condition::DemoMode(true),
            Condition::StayAwake(true),
            Condition::ResetAll,
        ];
        for condition in all {
            for args in condition_commands(&condition) {
                assert_eq!(args[0], "shell");
                for arg in args {
                    assert!(
                        !arg.contains([';', '|', '&', '$', '`', ' ', '>', '<', '\n']),
                        "{arg:?} in {condition:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn reset_all_restores_defaults_and_keeps_going() {
        let commands = condition_commands(&Condition::ResetAll);
        let joined: Vec<String> = commands.iter().map(|c| c.join(" ")).collect();
        assert!(joined.contains(&"shell settings put system font_scale 1.0".to_string()));
        assert!(joined.contains(&"shell wm density reset".to_string()));
        assert!(joined.contains(&"shell dumpsys battery reset".to_string()));
        assert!(!joined.iter().any(|c| c.contains("uimode")));
        assert!(!joined.iter().any(|c| c.contains("stayon")));
        assert!(continue_on_error(&Condition::ResetAll));
        assert!(!continue_on_error(&Condition::DemoMode(true)));
    }

    #[test]
    fn parses_device_output() {
        assert_eq!(parse_night_mode("Night mode: yes\n"), Some("yes".into()));
        assert_eq!(
            parse_night_mode("Night mode: custom (bedtime)"),
            Some("custom".into())
        );
        assert_eq!(parse_night_mode("garbage"), None);

        assert_eq!(parse_font_scale_setting("null\n"), Some(100));
        assert_eq!(parse_font_scale_setting("1.15\n"), Some(115));
        assert_eq!(parse_font_scale_setting("abc"), None);

        assert_eq!(
            parse_density("Physical density: 440\nOverride density: 420\n"),
            (Some(440), Some(420))
        );
        assert_eq!(parse_density("Physical density: 480\n"), (Some(480), None));

        assert!(parse_flag_setting("1\n"));
        assert!(!parse_flag_setting("0"));
        assert!(!parse_flag_setting("null"));

        let zeros = vec!["0.0".to_string(), "0".to_string(), "0.0".to_string()];
        assert!(!parse_animations_enabled(&zeros));
        let mixed = vec!["0.0".to_string(), "null".to_string(), "0.0".to_string()];
        assert!(parse_animations_enabled(&mixed));
    }

    #[test]
    fn parses_battery_dump() {
        let dump = "Current Battery Service state:\n  (UPDATES STOPPED -- use 'reset' to restart)\n  AC powered: false\n  USB powered: true\n  Wireless powered: false\n  Max charging current: 500000\n  status: 2\n  level: 5\n  scale: 100\n";
        let battery = parse_battery(dump);
        assert_eq!(battery.level, Some(5));
        assert!(!battery.ac_powered);
        assert!(battery.usb_powered);
        assert!(battery.overridden);

        let plain =
            parse_battery("Current Battery Service state:\n  AC powered: true\n  level: 88\n");
        assert_eq!(plain.level, Some(88));
        assert!(plain.ac_powered);
        assert!(!plain.overridden);
    }

    #[test]
    fn detects_refused_shell_output() {
        assert!(shell_output_error("").is_none());
        assert!(shell_output_error("Night mode: yes").is_none());
        assert!(shell_output_error(
            "Broadcasting: Intent { act=x }\nBroadcast completed: result=0"
        )
        .is_none());
        assert!(shell_output_error("Error: unknown command 'night'").is_some());
        assert!(shell_output_error(
            "Exception occurred while executing 'put':\njava.lang.SecurityException"
        )
        .is_some());
        assert!(
            shell_output_error("java.lang.SecurityException: Permission Denial: ...").is_some()
        );
    }
}
