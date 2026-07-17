// OS-specific helpers for opening files, revealing them in the file manager
// and copying an image to the clipboard. All platform branches are isolated
// here so the rest of the codebase stays portable.

use std::path::Path;
use std::process::Stdio;
use tokio::process::Command as TokioCommand;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn spawn_detached(program: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = TokioCommand::new(program);
    cmd.args(args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open a file or directory with the OS default handler.
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer` handles both files and folders.
        spawn_detached("explorer", &[&path])
    }
    #[cfg(target_os = "macos")]
    {
        spawn_detached("open", &[&path])
    }
    #[cfg(target_os = "linux")]
    {
        spawn_detached("xdg-open", &[&path])
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// Reveal a file inside its containing folder (selecting it where supported),
/// or simply open the folder itself when a directory path is given.
#[tauri::command]
pub async fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            spawn_detached("explorer", &[&path])
        } else {
            let select = format!("/select,{}", path);
            spawn_detached("explorer", &[&select])
        }
    }
    #[cfg(target_os = "macos")]
    {
        if p.is_dir() {
            spawn_detached("open", &[&path])
        } else {
            spawn_detached("open", &["-R", &path])
        }
    }
    #[cfg(target_os = "linux")]
    {
        // xdg-open cannot select a file, so open the containing directory.
        let target = if p.is_dir() {
            path.clone()
        } else {
            p.parent()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or(path.clone())
        };
        spawn_detached("xdg-open", &[&target])
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// Copy an image file to the system clipboard. Implemented per-platform via
/// native tooling to avoid pulling in a heavy clipboard dependency.
#[tauri::command]
pub async fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Image does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "set the clipboard to (read (POSIX file \"{}\") as «class PNGf»)",
            path.replace('"', "\\\"")
        );
        let mut cmd = TokioCommand::new("osascript");
        cmd.arg("-e").arg(&script);
        let output = cmd.output().await.map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Prefer wl-copy on Wayland, fall back to xclip on X11.
        let wl = TokioCommand::new("sh")
            .arg("-c")
            .arg(format!(
                "wl-copy --type image/png < \"{}\"",
                path.replace('"', "\\\"")
            ))
            .output()
            .await;
        if let Ok(o) = wl {
            if o.status.success() {
                return Ok(());
            }
        }
        let xclip = TokioCommand::new("xclip")
            .args(["-selection", "clipboard", "-t", "image/png", "-i", &path])
            .output()
            .await
            .map_err(|e| {
                format!(
                    "Could not copy image (install wl-clipboard or xclip): {}",
                    e
                )
            })?;
        if xclip.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&xclip.stderr).trim().to_string())
        }
    }
    #[cfg(target_os = "windows")]
    {
        let ps = format!(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
             $img=[System.Drawing.Image]::FromFile('{}'); \
             [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()",
            path.replace('\'', "''")
        );
        let mut cmd = TokioCommand::new("powershell");
        cmd.args(["-NoProfile", "-STA", "-Command", &ps]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd.output().await.map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}
