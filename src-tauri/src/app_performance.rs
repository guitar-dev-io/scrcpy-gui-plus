// Per-app performance sampling: CPU, memory and frame rendering of one
// package, read with standard shell tools (no root, no app changes).
//
// * CPU    - `/proc/<pid>/stat` (utime + stime) against the `cpu` line of
//            `/proc/stat`. Both are cumulative tick counters; the frontend
//            turns two samples into a percentage.
// * Memory - `dumpsys meminfo <pkg>` App Summary (PSS, Java/native heap,
//            graphics).
// * Frames - `dumpsys gfxinfo <pkg>`: cumulative rendered / janky frame
//            counts and frame-time percentiles since the last reset.
//
// Only the serial and a validated package name reach adb, as fixed argument
// vectors.

use crate::adb;
use crate::device_conditions::shell_output_error;
use serde::Serialize;

const SAMPLE_TIMEOUT_SECS: u64 = 10;

// ---------------------------------------------------------------------------
// Pure logic: parsers
// ---------------------------------------------------------------------------

/// `pidof` prints space separated pids; take the first (main process).
pub fn parse_pidof(output: &str) -> Option<u32> {
    output.split_whitespace().find_map(|pid| pid.parse().ok())
}

/// utime + stime from `/proc/<pid>/stat`. The process name (field 2) may
/// contain spaces and parentheses, so split after its last ')'.
pub fn parse_process_ticks(stat: &str) -> Option<u64> {
    let rest = &stat[stat.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // rest[0] is field 3 (state); utime is field 14, stime field 15.
    let utime: u64 = fields.get(11)?.parse().ok()?;
    let stime: u64 = fields.get(12)?.parse().ok()?;
    Some(utime + stime)
}

/// Total ticks from the aggregate `cpu` line of `/proc/stat`, and the number
/// of `cpuN` lines (online cores).
pub fn parse_proc_stat(stat: &str) -> Option<(u64, u32)> {
    let mut total = None;
    let mut cores = 0;
    for line in stat.lines() {
        let mut parts = line.split_whitespace();
        match parts.next() {
            Some("cpu") => {
                total = Some(parts.filter_map(|v| v.parse::<u64>().ok()).sum());
            }
            Some(name) if name.starts_with("cpu") && name[3..].parse::<u32>().is_ok() => {
                cores += 1;
            }
            _ => {}
        }
    }
    total.map(|t| (t, cores))
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    pub total_pss_kb: Option<u64>,
    pub java_heap_kb: Option<u64>,
    pub native_heap_kb: Option<u64>,
    pub graphics_kb: Option<u64>,
}

fn first_number_after(line: &str, label: &str) -> Option<u64> {
    let rest = &line[line.find(label)? + label.len()..];
    rest.split_whitespace().next()?.parse().ok()
}

/// The App Summary block of `dumpsys meminfo <pkg>`, with the "TOTAL" row of
/// the main table as a fallback for the PSS total on older builds.
pub fn parse_meminfo(output: &str) -> MemorySample {
    let mut sample = MemorySample::default();
    let mut table_total = None;
    for line in output.lines() {
        let trimmed = line.trim_start();
        if sample.java_heap_kb.is_none() && trimmed.starts_with("Java Heap:") {
            sample.java_heap_kb = first_number_after(trimmed, "Java Heap:");
        } else if sample.native_heap_kb.is_none() && trimmed.starts_with("Native Heap:") {
            sample.native_heap_kb = first_number_after(trimmed, "Native Heap:");
        } else if sample.graphics_kb.is_none() && trimmed.starts_with("Graphics:") {
            sample.graphics_kb = first_number_after(trimmed, "Graphics:");
        }
        if sample.total_pss_kb.is_none() {
            if trimmed.starts_with("TOTAL PSS:") {
                sample.total_pss_kb = first_number_after(trimmed, "TOTAL PSS:");
            } else if trimmed.starts_with("TOTAL:") {
                sample.total_pss_kb = first_number_after(trimmed, "TOTAL:");
            } else if table_total.is_none() && trimmed.starts_with("TOTAL ") {
                table_total = trimmed
                    .split_whitespace()
                    .nth(1)
                    .and_then(|v| v.parse().ok());
            }
        }
    }
    sample.total_pss_kb = sample.total_pss_kb.or(table_total);
    sample
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSample {
    /// Cumulative since the last reset.
    pub total_frames: Option<u64>,
    pub janky_frames: Option<u64>,
    pub p50_ms: Option<f64>,
    pub p90_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

fn ms_after(line: &str, label: &str) -> Option<f64> {
    let rest = line.trim_start().strip_prefix(label)?;
    rest.trim().trim_end_matches("ms").trim().parse().ok()
}

/// The summary at the top of `dumpsys gfxinfo <pkg>` (first block only; the
/// per-window "Profile data" that follows repeats some labels).
pub fn parse_gfxinfo(output: &str) -> FrameSample {
    let mut sample = FrameSample::default();
    for line in output.lines() {
        let trimmed = line.trim_start();
        if sample.total_frames.is_none() && trimmed.starts_with("Total frames rendered:") {
            sample.total_frames = first_number_after(trimmed, "Total frames rendered:");
        } else if sample.janky_frames.is_none() && trimmed.starts_with("Janky frames:") {
            sample.janky_frames = first_number_after(trimmed, "Janky frames:");
        } else if sample.p50_ms.is_none() && trimmed.starts_with("50th percentile:") {
            sample.p50_ms = ms_after(trimmed, "50th percentile:");
        } else if sample.p90_ms.is_none() && trimmed.starts_with("90th percentile:") {
            sample.p90_ms = ms_after(trimmed, "90th percentile:");
        } else if sample.p95_ms.is_none() && trimmed.starts_with("95th percentile:") {
            sample.p95_ms = ms_after(trimmed, "95th percentile:");
        } else if sample.p99_ms.is_none() && trimmed.starts_with("99th percentile:") {
            sample.p99_ms = ms_after(trimmed, "99th percentile:");
        }
    }
    sample
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPerformanceSample {
    pub success: bool,
    pub package: String,
    /// Desktop time of the sample, ms since the epoch.
    pub timestamp_ms: i64,
    /// False when the package has no running process.
    pub running: bool,
    pub pid: Option<u32>,
    pub process_ticks: Option<u64>,
    pub total_ticks: Option<u64>,
    pub cpu_cores: Option<u32>,
    pub memory: MemorySample,
    pub frames: FrameSample,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl AppPerformanceSample {
    fn empty(package: String) -> Self {
        AppPerformanceSample {
            success: false,
            package,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            running: false,
            pid: None,
            process_ticks: None,
            total_ticks: None,
            cpu_cores: None,
            memory: MemorySample::default(),
            frames: FrameSample::default(),
            error: None,
            error_code: None,
        }
    }
}

async fn shell(serial: &str, args: &[&str], custom_path: &Option<String>) -> Option<String> {
    adb::run_adb_text(Some(serial), args, custom_path.clone(), SAMPLE_TIMEOUT_SECS)
        .await
        .ok()
        .filter(|out| shell_output_error(out).is_none())
}

/// Take one performance sample of a package.
#[tauri::command]
pub async fn sample_app_performance(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> AppPerformanceSample {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    let mut sample = AppPerformanceSample::empty(package.clone());
    if let Err(e) = adb::validate_serial(&serial).and_then(|_| adb::validate_package_name(&package))
    {
        sample.error = Some(e.message());
        sample.error_code = Some(e.code().to_string());
        return sample;
    }
    let cp = custom_path;

    // Bound first: the futures borrow these until `join!` finishes.
    let pidof_args = ["shell", "pidof", package.as_str()];
    let meminfo_args = ["shell", "dumpsys", "meminfo", package.as_str()];
    let gfxinfo_args = ["shell", "dumpsys", "gfxinfo", package.as_str()];
    let (pidof, meminfo, gfxinfo, proc_stat) = tokio::join!(
        shell(&serial, &pidof_args, &cp),
        shell(&serial, &meminfo_args, &cp),
        shell(&serial, &gfxinfo_args, &cp),
        shell(&serial, &["shell", "cat", "/proc/stat"], &cp),
    );

    // Nothing answered: the device is gone.
    if pidof.is_none() && meminfo.is_none() && gfxinfo.is_none() && proc_stat.is_none() {
        sample.error = Some(format!("Could not read performance data from {serial}"));
        sample.error_code = Some("device_unavailable".to_string());
        return sample;
    }

    sample.success = true;
    sample.pid = pidof.as_deref().and_then(parse_pidof);
    sample.running = sample.pid.is_some();
    if let Some((total, cores)) = proc_stat.as_deref().and_then(parse_proc_stat) {
        sample.total_ticks = Some(total);
        sample.cpu_cores = Some(cores);
    }
    if let Some(pid) = sample.pid {
        let path = format!("/proc/{pid}/stat");
        sample.process_ticks = shell(&serial, &["shell", "cat", &path], &cp)
            .await
            .as_deref()
            .and_then(parse_process_ticks);
    }
    if sample.running {
        sample.memory = meminfo.as_deref().map(parse_meminfo).unwrap_or_default();
        sample.frames = gfxinfo.as_deref().map(parse_gfxinfo).unwrap_or_default();
    }
    sample
}

/// Reset the package's frame statistics so percentiles cover only what
/// happens from now on.
#[tauri::command]
pub async fn reset_app_frame_stats(
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> Result<(), String> {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    adb::validate_serial(&serial)
        .and_then(|_| adb::validate_package_name(&package))
        .map_err(|e| e.message())?;
    adb::run_adb_text(
        Some(&serial),
        &["shell", "dumpsys", "gfxinfo", &package, "reset"],
        custom_path,
        SAMPLE_TIMEOUT_SECS,
    )
    .await
    .map(|_| ())
    .map_err(|e| e.message())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pids_and_process_ticks() {
        assert_eq!(parse_pidof("4321 4400\n"), Some(4321));
        assert_eq!(parse_pidof(""), None);
        let stat = "4321 (com.example.shop) S 600 600 0 0 -1 1077952832 52000 0 3 0 1500 320 0 0 10 -10 40 0 2345 15000000000 50000 18446744073709551615";
        assert_eq!(parse_process_ticks(stat), Some(1820));
        // Name with spaces and parentheses.
        let tricky = "77 (Render (Thread) x) R 1 1 0 0 -1 0 0 0 0 0 7 3 0 0";
        assert_eq!(parse_process_ticks(tricky), Some(10));
        assert_eq!(parse_process_ticks("garbage"), None);
    }

    #[test]
    fn parses_proc_stat() {
        let stat = "cpu  100 20 30 400 5 0 6 0 0 0\ncpu0 50 10 15 200 2 0 3 0 0 0\ncpu1 50 10 15 200 3 0 3 0 0 0\nintr 12345\nctxt 999\n";
        assert_eq!(parse_proc_stat(stat), Some((561, 2)));
        assert_eq!(parse_proc_stat("intr 1\n"), None);
    }

    #[test]
    fn parses_modern_meminfo() {
        let dump = "\
Applications Memory Usage (in Kilobytes):
Uptime: 123 Realtime: 456

** MEMINFO in pid 4321 [com.example.shop] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    20000    19900        0       10    21000    32000    25000     7000
        TOTAL   150123   120000    10000      500   200000    60000    45000    15000

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:    12345                          30000
         Native Heap:    19900                          21000
                Code:     8000                          40000
            Graphics:     30000                          30000
           TOTAL PSS:   150123            TOTAL RSS:   200000       TOTAL SWAP PSS:      500
";
        assert_eq!(
            parse_meminfo(dump),
            MemorySample {
                total_pss_kb: Some(150123),
                java_heap_kb: Some(12345),
                native_heap_kb: Some(19900),
                graphics_kb: Some(30000),
            }
        );
    }

    #[test]
    fn parses_older_meminfo_formats() {
        let old = " App Summary\n           Java Heap:     5000\n              TOTAL:    90000      TOTAL SWAP PSS:  10\n";
        assert_eq!(parse_meminfo(old).total_pss_kb, Some(90000));
        let table_only = "        TOTAL    77777    60000\n";
        assert_eq!(parse_meminfo(table_only).total_pss_kb, Some(77777));
        assert_eq!(
            parse_meminfo("No process found for: com.x.y"),
            MemorySample::default()
        );
    }

    #[test]
    fn parses_gfxinfo_summary() {
        let dump = "\
Applications Graphics Acceleration Info:
Uptime: 1 Realtime: 2

** Graphics info for pid 4321 [com.example.shop] **

Stats since: 123456789ns
Total frames rendered: 1200
Janky frames: 90 (7.50%)
Janky frames (legacy): 120 (10.00%)
50th percentile: 8ms
90th percentile: 14ms
95th percentile: 21ms
99th percentile: 48ms
Number Missed Vsync: 10

Profile data in ms:
Total frames rendered: 5
";
        assert_eq!(
            parse_gfxinfo(dump),
            FrameSample {
                total_frames: Some(1200),
                janky_frames: Some(90),
                p50_ms: Some(8.0),
                p90_ms: Some(14.0),
                p95_ms: Some(21.0),
                p99_ms: Some(48.0),
            }
        );
        assert_eq!(parse_gfxinfo(""), FrameSample::default());
    }
}
