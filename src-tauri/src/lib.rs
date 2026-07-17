mod adb;
mod app_manager;
mod bug_report;
mod commands;
mod custom_command;
mod deep_link;
mod device_control;
mod device_status;
mod embed_mirror;
mod embed_session;
mod file_manager;
mod ios;
mod logcat;
mod macro_player;
mod screenshot;
mod system;
mod test_session;
mod ui_inspector;
use bug_report::BugReportState;
use device_control::RecordingState;
use embed_mirror::EmbedMirrorState;
use embed_session::EmbedSessionState;
use ios::IosState;
use logcat::LogcatState;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
use tokio::process::Child;

#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;

pub struct ScrcpyState {
    pub processes: Mutex<HashMap<String, Child>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Fix for white screen on Linux (Wayland/NVIDIA)
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }

        // Workaround for AppImage blank UI on Fedora/Wayland
        // Preload the host's libwayland-client.so.0 to prevent conflicts with bundled version
        // Checking whether it is an AppImage or not by checking APPDIR environment variable
        if std::env::var("APPDIR").is_ok() && std::env::var("WAYLAND_DISPLAY").is_ok() {
            let preload = std::env::var("LD_PRELOAD").unwrap_or_default();
            if !preload.contains("libwayland-client.so.0") {
                // checking host native libwayland-client.so.0 is loaded or not by checking LD_PRELOAD environment variable
                let paths = [
                    "/usr/lib64/libwayland-client.so.0",
                    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
                    "/usr/lib/libwayland-client.so.0",
                ];
                for path in paths {
                    // if host native libwayland-client.so.0 is found it will be loaded instead of bundled version
                    if std::path::Path::new(path).exists() {
                        let mut new_preload = preload;
                        if !new_preload.is_empty() {
                            new_preload.push(':');
                        }
                        new_preload.push_str(path);
                        std::env::set_var("LD_PRELOAD", &new_preload);

                        let current_exe = std::env::current_exe().unwrap_or_else(|_| {
                            std::path::PathBuf::from(std::env::args().next().unwrap())
                        });
                        let mut cmd = std::process::Command::new(current_exe);
                        cmd.args(std::env::args().skip(1));
                        let _ = cmd.exec();
                        break;
                    }
                }
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(ScrcpyState {
                processes: Mutex::new(HashMap::new()),
            });

            app.manage(RecordingState {
                recordings: Mutex::new(HashMap::new()),
            });

            app.manage(BugReportState::default());

            app.manage(LogcatState::default());

            app.manage(IosState::default());

            app.manage(EmbedMirrorState::default());

            app.manage(EmbedSessionState::default());

            // Show splashscreen instantly
            if let Some(splash_window) = app.get_webview_window("splashscreen") {
                splash_window.show().unwrap();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::check_scrcpy,
            commands::get_devices,
            commands::adb_connect,
            commands::get_mdns_devices,
            commands::adb_pair,
            commands::adb_shell,
            commands::push_file,
            commands::install_apk,
            commands::kill_adb,
            commands::run_scrcpy,
            commands::stop_scrcpy,
            commands::download_scrcpy,
            commands::list_scrcpy_options,
            commands::get_render_drivers,
            commands::get_videos_dir,
            commands::save_report,
            commands::get_scrcpy_bin_dir,
            commands::run_terminal_command,
            commands::check_scrcpy_update,
            commands::generate_pairing_qr,
            commands::poll_qr_pairing,
            screenshot::capture_screenshot,
            screenshot::capture_preview_frame,
            screenshot::get_default_screenshot_dir,
            screenshot::delete_screenshot_file,
            system::open_path,
            system::reveal_in_folder,
            system::copy_image_to_clipboard,
            device_control::device_action,
            device_control::start_recording,
            device_control::stop_recording,
            app_manager::list_packages,
            app_manager::get_package_info,
            app_manager::app_action,
            logcat::start_logcat,
            logcat::stop_logcat,
            logcat::clear_logcat,
            deep_link::launch_deep_link,
            deep_link::generate_qr_svg,
            test_session::set_show_touches,
            test_session::get_device_info,
            device_status::get_device_status,
            ui_inspector::dump_ui_hierarchy,
            ui_inspector::capture_screen_base64,
            macro_player::run_macro_action,
            macro_player::macro_record_screen,
            custom_command::run_custom_command,
            file_manager::fm_list_dir,
            file_manager::fm_pull,
            file_manager::fm_push,
            file_manager::fm_delete,
            file_manager::fm_mkdir,
            file_manager::fm_preview_file,
            bug_report::create_bug_report,
            bug_report::cancel_bug_report,
            ios::check_ios_support,
            ios::get_ios_devices,
            ios::install_pymobiledevice3,
            ios::start_ios_mirror,
            ios::stop_ios_mirror,
            embed_mirror::start_embedded_mirror,
            embed_mirror::stop_embedded_mirror,
            embed_session::start_embedded_session,
            embed_session::stop_embedded_session,
            embed_session::get_embedded_session_state,
            embed_session::send_embedded_touch,
            embed_session::send_embedded_key,
            embed_session::send_embedded_text,
            embed_session::send_embedded_action,
            embed_session::capture_embedded_screenshot,
            close_splashscreen,
            get_app_version
        ])
        .on_window_event(|window, event| {
            // Reliably tear down embedded sessions (kill scrcpy-server children)
            // when a window closes or the app exits, so no device processes or
            // adb forwards are left dangling.
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                let app = window.app_handle();
                let state = app.state::<EmbedSessionState>();
                state.kill_all_blocking();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn close_splashscreen(window: tauri::Window) {
    // Get the main window
    if let Some(main_window) = window.get_webview_window("main") {
        // Show the main window
        main_window.show().unwrap();
    }
    // Close the splashscreen window
    if let Some(splash_window) = window.get_webview_window("splashscreen") {
        splash_window.close().unwrap();
    }
}
