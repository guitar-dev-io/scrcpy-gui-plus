#[path = "../src/adb.rs"]
mod adb;
#[path = "../src/apk_analyzer.rs"]
mod apk_analyzer;
#[path = "../src/apk_backup.rs"]
mod apk_backup;
#[path = "../src/apk_toolkit.rs"]
mod apk_toolkit;
mod commands {
    use std::path::PathBuf;
    use tokio::process::Command;

    pub fn get_binary_path(name: &str, _custom_path: Option<String>) -> PathBuf {
        PathBuf::from(name)
    }

    pub fn create_command(path: &PathBuf) -> Command {
        Command::new(path)
    }
}
