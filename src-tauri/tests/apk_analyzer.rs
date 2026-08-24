mod adb {
    #[derive(Debug)]
    pub struct AdbError;

    impl AdbError {
        pub fn code(&self) -> &'static str {
            "test_error"
        }
        pub fn message(&self) -> String {
            "ADB is unavailable in analyzer unit tests".to_string()
        }
    }

    pub fn validate_serial(serial: &str) -> Result<(), AdbError> {
        (!serial.is_empty()).then_some(()).ok_or(AdbError)
    }

    pub fn validate_package_name(package: &str) -> Result<(), AdbError> {
        package.contains('.').then_some(()).ok_or(AdbError)
    }

    pub async fn run_adb_text(
        _serial: Option<&str>,
        _args: &[&str],
        _custom_path: Option<String>,
        _timeout_secs: u64,
    ) -> Result<String, AdbError> {
        Err(AdbError)
    }
}

mod apk_toolkit {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum ApkArtifactKind {
        Base,
        Split,
    }

    pub struct ApkArtifact {
        pub remote_path: String,
        pub kind: ApkArtifactKind,
        pub size_bytes: Option<u64>,
    }

    pub struct ApkDiscoveryResult {
        pub success: bool,
        pub artifacts: Vec<ApkArtifact>,
        pub error: Option<String>,
        pub error_code: Option<String>,
    }

    pub async fn discover(
        _serial: &str,
        _package: &str,
        _custom_path: Option<String>,
    ) -> ApkDiscoveryResult {
        ApkDiscoveryResult {
            success: false,
            artifacts: Vec::new(),
            error: Some("Unavailable in analyzer unit tests".to_string()),
            error_code: Some("test_error".to_string()),
        }
    }
}

#[path = "../src/apk_analyzer.rs"]
mod apk_analyzer;
