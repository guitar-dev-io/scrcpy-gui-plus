//! Local, dependency-light APK inspection.
//!
//! The analyzer reads the APK as a ZIP and parses the subset of Android binary
//! XML needed for package metadata and component declarations. It deliberately
//! does not invoke jadx, apktool, aapt, or a connected Android device.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use openssl::{hash::MessageDigest, pkcs7::Pkcs7, x509::X509NameRef};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use zip::ZipArchive;

use crate::{
    adb,
    apk_toolkit::{self, ApkArtifactKind},
};
use tauri::Manager;

const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_CERTIFICATE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ICON_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SIGNING_BLOCK_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ARCHIVE_FILES: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApkArtifactStatus {
    Available,
    Missing,
    Unsupported,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkManifestInfo {
    pub status: ApkArtifactStatus,
    pub package_name: Option<String>,
    pub app_label: Option<String>,
    pub version_name: Option<String>,
    pub version_code: Option<String>,
    pub min_sdk: Option<String>,
    pub target_sdk: Option<String>,
    pub icon_reference: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkComponentInfo {
    pub kind: String,
    pub name: String,
    pub exported: Option<bool>,
    pub enabled: Option<bool>,
    pub launcher: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkNativeLibrary {
    pub abi: String,
    pub name: String,
    pub archive_path: String,
    pub size_bytes: u64,
    pub compressed_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkArchiveFile {
    pub path: String,
    pub size_bytes: u64,
    pub compressed_size_bytes: u64,
    pub compression: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkCertificateInfo {
    pub subject: String,
    pub issuer: String,
    pub serial_number: String,
    pub not_before: String,
    pub not_after: String,
    pub sha256_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApkSigningSchemes {
    pub jar_v1: bool,
    pub apk_v2: bool,
    pub apk_v3: bool,
    pub apk_v31: bool,
    pub source_stamp: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkSigningInfo {
    pub status: ApkArtifactStatus,
    pub schemes: ApkSigningSchemes,
    pub signature_entries: Vec<String>,
    pub certificates: Vec<ApkCertificateInfo>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkLauncherIcon {
    pub status: ApkArtifactStatus,
    pub archive_path: Option<String>,
    pub media_type: Option<String>,
    pub data_base64: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkAnalysisResult {
    pub path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub sha256: String,
    pub manifest: ApkManifestInfo,
    pub permissions: Vec<String>,
    pub components: Vec<ApkComponentInfo>,
    pub native_abis: Vec<String>,
    pub native_libraries: Vec<ApkNativeLibrary>,
    pub files: Vec<ApkArchiveFile>,
    pub signing: ApkSigningInfo,
    pub launcher_icon: ApkLauncherIcon,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageIconResult {
    pub status: ApkArtifactStatus,
    pub device_serial: String,
    pub package_name: String,
    pub data_url: Option<String>,
    pub media_type: Option<String>,
    pub archive_path: Option<String>,
    pub source_apk_path: Option<String>,
    pub cache_hit: bool,
    pub cache_signal: Option<String>,
    pub reason: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedManifest {
    package_name: Option<String>,
    app_label: Option<String>,
    version_name: Option<String>,
    version_code: Option<String>,
    min_sdk: Option<String>,
    target_sdk: Option<String>,
    icon_reference: Option<String>,
    permissions: BTreeSet<String>,
    components: Vec<ApkComponentInfo>,
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

fn sha256_reader(mut reader: impl Read) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_upper(&hasher.finalize()))
}

fn checked_slice(data: &[u8], start: usize, length: usize) -> Result<&[u8], String> {
    data.get(start..start.saturating_add(length))
        .ok_or_else(|| "Truncated Android binary XML".to_string())
}

fn u16le(data: &[u8], offset: usize) -> Result<u16, String> {
    Ok(u16::from_le_bytes(
        checked_slice(data, offset, 2)?.try_into().unwrap(),
    ))
}

fn u32le(data: &[u8], offset: usize) -> Result<u32, String> {
    Ok(u32::from_le_bytes(
        checked_slice(data, offset, 4)?.try_into().unwrap(),
    ))
}

fn u64le(data: &[u8], offset: usize) -> Result<u64, String> {
    Ok(u64::from_le_bytes(
        checked_slice(data, offset, 8)?.try_into().unwrap(),
    ))
}

fn decode_length8(data: &[u8], cursor: &mut usize) -> Result<usize, String> {
    let first = *checked_slice(data, *cursor, 1)?.first().unwrap();
    *cursor += 1;
    if first & 0x80 == 0 {
        Ok(first as usize)
    } else {
        let second = *checked_slice(data, *cursor, 1)?.first().unwrap();
        *cursor += 1;
        Ok((((first & 0x7f) as usize) << 8) | second as usize)
    }
}

fn decode_length16(data: &[u8], cursor: &mut usize) -> Result<usize, String> {
    let first = u16le(data, *cursor)?;
    *cursor += 2;
    if first & 0x8000 == 0 {
        Ok(first as usize)
    } else {
        let second = u16le(data, *cursor)?;
        *cursor += 2;
        Ok((((first & 0x7fff) as usize) << 16) | second as usize)
    }
}

fn parse_string_pool(data: &[u8], offset: usize) -> Result<Vec<String>, String> {
    let header_size = u16le(data, offset + 2)? as usize;
    let chunk_size = u32le(data, offset + 4)? as usize;
    let string_count = u32le(data, offset + 8)? as usize;
    let flags = u32le(data, offset + 16)?;
    let strings_start = u32le(data, offset + 20)? as usize;
    let utf8 = flags & 0x100 != 0;
    let chunk = checked_slice(data, offset, chunk_size)?;
    let mut strings = Vec::with_capacity(string_count);
    for index in 0..string_count {
        let relative = u32le(chunk, header_size + index * 4)? as usize;
        let mut cursor = strings_start + relative;
        if utf8 {
            let _utf16_length = decode_length8(chunk, &mut cursor)?;
            let byte_length = decode_length8(chunk, &mut cursor)?;
            let bytes = checked_slice(chunk, cursor, byte_length)?;
            strings.push(String::from_utf8_lossy(bytes).into_owned());
        } else {
            let units = decode_length16(chunk, &mut cursor)?;
            let bytes = checked_slice(chunk, cursor, units.saturating_mul(2))?;
            let utf16: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            strings.push(String::from_utf16_lossy(&utf16));
        }
    }
    Ok(strings)
}

fn pool_string(pool: &[String], index: u32) -> Option<String> {
    if index == u32::MAX {
        None
    } else {
        pool.get(index as usize).cloned()
    }
}

fn typed_value(pool: &[String], raw: u32, value_type: u8, data: u32) -> Option<String> {
    if let Some(raw) = pool_string(pool, raw) {
        return Some(raw);
    }
    match value_type {
        0x03 => pool_string(pool, data),
        0x01 => Some(format!("@0x{data:08x}")),
        0x02 => Some(format!("?0x{data:08x}")),
        0x10 => Some(data.to_string()),
        0x11 => Some(format!("0x{data:x}")),
        0x12 => Some(if data == 0 { "false" } else { "true" }.to_string()),
        _ => None,
    }
}

fn bool_attribute(attributes: &BTreeMap<String, String>, name: &str) -> Option<bool> {
    attributes.get(name).and_then(|value| match value.as_str() {
        "true" | "1" | "0xffffffff" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    })
}

fn qualify_component(package: Option<&str>, name: String) -> String {
    if name.starts_with('.') {
        format!("{}{}", package.unwrap_or_default(), name)
    } else if !name.contains('.') {
        package
            .filter(|value| !value.is_empty())
            .map(|value| format!("{value}.{name}"))
            .unwrap_or(name)
    } else {
        name
    }
}

fn consume_element(
    parsed: &mut ParsedManifest,
    tag: &str,
    attributes: &BTreeMap<String, String>,
    current_component: &mut Option<usize>,
    intent_flags: &mut Option<(bool, bool)>,
) {
    let attr = |name: &str| attributes.get(name).cloned();
    match tag {
        "manifest" => {
            parsed.package_name = attr("package");
            parsed.version_name = attr("versionName");
            parsed.version_code = attr("versionCode");
        }
        "application" => {
            parsed.app_label = attr("label");
            parsed.icon_reference = attr("icon");
        }
        "uses-sdk" => {
            parsed.min_sdk = attr("minSdkVersion");
            parsed.target_sdk = attr("targetSdkVersion");
        }
        "uses-permission" | "uses-permission-sdk-23" | "uses-permission-sdk-m" => {
            if let Some(permission) = attr("name") {
                parsed.permissions.insert(permission);
            }
        }
        "activity" | "activity-alias" | "service" | "receiver" | "provider" => {
            if let Some(name) = attr("name") {
                parsed.components.push(ApkComponentInfo {
                    kind: tag.to_string(),
                    name: qualify_component(parsed.package_name.as_deref(), name),
                    exported: bool_attribute(attributes, "exported"),
                    enabled: bool_attribute(attributes, "enabled"),
                    launcher: false,
                });
                *current_component = Some(parsed.components.len() - 1);
            }
        }
        "intent-filter" if current_component.is_some() => *intent_flags = Some((false, false)),
        "action" => {
            if attr("name").as_deref() == Some("android.intent.action.MAIN") {
                if let Some((main, _)) = intent_flags.as_mut() {
                    *main = true;
                }
            }
        }
        "category" => {
            if attr("name").as_deref() == Some("android.intent.category.LAUNCHER") {
                if let Some((_, launcher)) = intent_flags.as_mut() {
                    *launcher = true;
                }
            }
        }
        _ => {}
    }
}

fn close_element(
    parsed: &mut ParsedManifest,
    tag: &str,
    current_component: &mut Option<usize>,
    intent_flags: &mut Option<(bool, bool)>,
) {
    if tag == "intent-filter" {
        if let (Some(index), Some((true, true))) = (*current_component, intent_flags.take()) {
            if let Some(component) = parsed.components.get_mut(index) {
                component.launcher = true;
            }
        } else {
            *intent_flags = None;
        }
    }
    if matches!(
        tag,
        "activity" | "activity-alias" | "service" | "receiver" | "provider"
    ) {
        *current_component = None;
        *intent_flags = None;
    }
}

fn parse_binary_manifest(data: &[u8]) -> Result<ParsedManifest, String> {
    if u16le(data, 0)? != 0x0003 {
        return Err("AndroidManifest.xml is not binary Android XML".to_string());
    }
    let declared_size = u32le(data, 4)? as usize;
    if declared_size > data.len() {
        return Err("Truncated Android binary XML".to_string());
    }
    let mut offset = u16le(data, 2)? as usize;
    let mut pool = Vec::new();
    let mut parsed = ParsedManifest::default();
    let mut current_component = None;
    let mut intent_flags = None;
    while offset + 8 <= declared_size {
        let chunk_type = u16le(data, offset)?;
        let header_size = u16le(data, offset + 2)? as usize;
        let chunk_size = u32le(data, offset + 4)? as usize;
        if chunk_size < header_size || chunk_size < 8 || offset + chunk_size > declared_size {
            return Err("Invalid Android binary XML chunk".to_string());
        }
        match chunk_type {
            0x0001 => pool = parse_string_pool(data, offset)?,
            0x0102 => {
                let tag = pool_string(&pool, u32le(data, offset + 20)?)
                    .ok_or_else(|| "Start element has an invalid name".to_string())?;
                let attribute_start = u16le(data, offset + 24)? as usize;
                let attribute_size = u16le(data, offset + 26)? as usize;
                let attribute_count = u16le(data, offset + 28)? as usize;
                if attribute_size < 20 {
                    return Err("Invalid Android XML attribute size".to_string());
                }
                let mut attributes = BTreeMap::new();
                let attributes_offset = offset + 16 + attribute_start;
                for index in 0..attribute_count {
                    let attribute = attributes_offset + index * attribute_size;
                    checked_slice(data, attribute, 20)?;
                    let name = pool_string(&pool, u32le(data, attribute + 4)?)
                        .ok_or_else(|| "Attribute has an invalid name".to_string())?;
                    let raw = u32le(data, attribute + 8)?;
                    let value_type = data[attribute + 15];
                    let value_data = u32le(data, attribute + 16)?;
                    if let Some(value) = typed_value(&pool, raw, value_type, value_data) {
                        attributes.insert(name, value);
                    }
                }
                consume_element(
                    &mut parsed,
                    &tag,
                    &attributes,
                    &mut current_component,
                    &mut intent_flags,
                );
            }
            0x0103 => {
                if let Some(tag) = pool_string(&pool, u32le(data, offset + 20)?) {
                    close_element(&mut parsed, &tag, &mut current_component, &mut intent_flags);
                }
            }
            _ => {}
        }
        offset += chunk_size;
    }
    Ok(parsed)
}

fn parse_plain_attributes(input: &str) -> BTreeMap<String, String> {
    let mut attributes = BTreeMap::new();
    let bytes = input.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let key_start = cursor;
        while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() && bytes[cursor] != b'='
        {
            cursor += 1;
        }
        let raw_key = &input[key_start..cursor];
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'=')
        {
            cursor += 1;
        }
        if cursor >= bytes.len() || !matches!(bytes[cursor], b'\'' | b'"') {
            while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            continue;
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if !raw_key.is_empty() {
            let key = raw_key.rsplit(':').next().unwrap_or(raw_key);
            attributes.insert(key.to_string(), input[value_start..cursor].to_string());
        }
        cursor = cursor.saturating_add(1);
    }
    attributes
}

fn parse_plain_manifest(data: &[u8]) -> Result<ParsedManifest, String> {
    let text = std::str::from_utf8(data).map_err(|_| "Manifest is not UTF-8 XML".to_string())?;
    let mut parsed = ParsedManifest::default();
    let mut current_component = None;
    let mut intent_flags = None;
    let mut cursor = 0;
    while let Some(open) = text[cursor..].find('<') {
        let start = cursor + open;
        let Some(relative_end) = text[start..].find('>') else {
            break;
        };
        let end = start + relative_end;
        let mut body = text[start + 1..end].trim();
        if body.starts_with('?') || body.starts_with('!') {
            cursor = end + 1;
            continue;
        }
        let closing = body.starts_with('/');
        body = body.trim_start_matches('/').trim_end_matches('/').trim();
        let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
        let tag = &body[..name_end];
        if closing {
            close_element(&mut parsed, tag, &mut current_component, &mut intent_flags);
        } else {
            let attributes = parse_plain_attributes(&body[name_end..]);
            consume_element(
                &mut parsed,
                tag,
                &attributes,
                &mut current_component,
                &mut intent_flags,
            );
            if text[start + 1..end].trim_end().ends_with('/') {
                close_element(&mut parsed, tag, &mut current_component, &mut intent_flags);
            }
        }
        cursor = end + 1;
    }
    Ok(parsed)
}

fn parse_manifest(data: &[u8]) -> Result<ParsedManifest, String> {
    if data.starts_with(b"<?xml") || data.first() == Some(&b'<') {
        parse_plain_manifest(data)
    } else {
        parse_binary_manifest(data)
    }
}

fn icon_priority(path: &str) -> Option<(u8, u8)> {
    let lower = path.to_ascii_lowercase();
    if !lower.starts_with("res/") || lower.ends_with(".xml") {
        return None;
    }
    let supported = [".png", ".webp", ".jpg", ".jpeg"]
        .iter()
        .position(|extension| lower.ends_with(extension))? as u8;
    let filename = lower.rsplit('/').next()?;
    let name_score = if filename.starts_with("ic_launcher") {
        0
    } else if filename.contains("launcher") || filename.starts_with("app_icon") {
        1
    } else {
        return None;
    };
    let density_score = ["xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi"]
        .iter()
        .position(|density| lower.contains(density))
        .unwrap_or(6) as u8;
    Some((name_score, density_score.saturating_mul(4) + supported))
}

fn icon_media_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn name_string(name: &X509NameRef) -> String {
    name.entries()
        .map(|entry| {
            let key = entry.object().nid().short_name().unwrap_or("OID");
            let value = entry
                .data()
                .to_string()
                .unwrap_or_else(|_| hex_upper(entry.data().as_slice()));
            format!("{key}={value}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn parse_pkcs7_certificates(bytes: &[u8]) -> Result<Vec<ApkCertificateInfo>, String> {
    let pkcs7 = Pkcs7::from_der(bytes).map_err(|error| error.to_string())?;
    let certificates = pkcs7
        .signed()
        .and_then(|signed| signed.certificates())
        .ok_or_else(|| "PKCS#7 signature contains no certificates".to_string())?;
    certificates
        .iter()
        .map(|certificate| {
            let serial_number = certificate
                .serial_number()
                .to_bn()
                .and_then(|number| number.to_hex_str())
                .map(|value| value.to_string())
                .map_err(|error| error.to_string())?;
            let fingerprint = certificate
                .digest(MessageDigest::sha256())
                .map(|value| hex_upper(value.as_ref()))
                .map_err(|error| error.to_string())?;
            Ok(ApkCertificateInfo {
                subject: name_string(certificate.subject_name()),
                issuer: name_string(certificate.issuer_name()),
                serial_number,
                not_before: certificate.not_before().to_string(),
                not_after: certificate.not_after().to_string(),
                sha256_fingerprint: fingerprint,
            })
        })
        .collect()
}

fn read_signing_schemes(path: &Path) -> Result<ApkSigningSchemes, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    let tail_length = length.min(65_557) as usize;
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|error| error.to_string())?;
    let mut tail = vec![0_u8; tail_length];
    file.read_exact(&mut tail)
        .map_err(|error| error.to_string())?;
    let eocd = tail
        .windows(4)
        .rposition(|window| window == [0x50, 0x4b, 0x05, 0x06])
        .ok_or_else(|| "ZIP end-of-central-directory record is missing".to_string())?;
    let central_offset = u32le(&tail, eocd + 16)? as u64;
    if central_offset < 24 {
        return Ok(ApkSigningSchemes::default());
    }
    file.seek(SeekFrom::Start(central_offset - 24))
        .map_err(|error| error.to_string())?;
    let mut footer = [0_u8; 24];
    file.read_exact(&mut footer)
        .map_err(|error| error.to_string())?;
    if &footer[8..] != b"APK Sig Block 42" {
        return Ok(ApkSigningSchemes::default());
    }
    let size = u64le(&footer, 0)?;
    if size < 24 || size > MAX_SIGNING_BLOCK_BYTES || size + 8 > central_offset {
        return Err("APK Signing Block has an invalid size".to_string());
    }
    let start = central_offset - size - 8;
    let entries_length = (size - 24) as usize;
    file.seek(SeekFrom::Start(start + 8))
        .map_err(|error| error.to_string())?;
    let mut entries = vec![0_u8; entries_length];
    file.read_exact(&mut entries)
        .map_err(|error| error.to_string())?;
    let mut schemes = ApkSigningSchemes::default();
    let mut cursor = 0;
    while cursor + 8 <= entries.len() {
        let entry_length = u64le(&entries, cursor)? as usize;
        cursor += 8;
        if entry_length < 4 || cursor + entry_length > entries.len() {
            return Err("APK Signing Block entry is invalid".to_string());
        }
        let id = u32le(&entries, cursor)?;
        match id {
            0x7109_871a => schemes.apk_v2 = true,
            0xf053_68c0 => schemes.apk_v3 = true,
            0x1b93_ad61 => schemes.apk_v31 = true,
            0x6dff_800d => schemes.source_stamp = true,
            _ => {}
        }
        cursor += entry_length;
    }
    Ok(schemes)
}

fn validate_apk_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("APK path does not point to a local file".to_string());
    }
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("apk"))
    {
        return Err("Only .apk files are supported".to_string());
    }
    Ok(path)
}

fn validate_remote_apk_path(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= 4096
        && path.ends_with(".apk")
        && !path.contains('\0')
        && !path.contains('\n')
        && !path.contains('\r')
        && !path.split('/').any(|segment| segment == "..")
}

fn package_cache_identity(serial: &str, package: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(serial.as_bytes());
    hasher.update([0]);
    hasher.update(package.as_bytes());
    hex_upper(&hasher.finalize())
}

fn package_cache_file_name(remote_path: &str, signal: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(remote_path.as_bytes());
    hasher.update([0]);
    hasher.update(signal.as_bytes());
    format!("{}.apk", hex_upper(&hasher.finalize()))
}

fn package_icon_failure(
    serial: &str,
    package: &str,
    status: ApkArtifactStatus,
    code: &str,
    reason: impl Into<String>,
) -> PackageIconResult {
    PackageIconResult {
        status,
        device_serial: serial.to_string(),
        package_name: package.to_string(),
        data_url: None,
        media_type: None,
        archive_path: None,
        source_apk_path: None,
        cache_hit: false,
        cache_signal: None,
        reason: Some(reason.into()),
        error_code: Some(code.to_string()),
    }
}

pub fn analyze_apk_file(path: impl AsRef<Path>) -> Result<ApkAnalysisResult, String> {
    let path = path.as_ref();
    if !path.is_file() {
        return Err("APK path does not point to a local file".to_string());
    }
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    let sha256 = sha256_reader(File::open(path).map_err(|error| error.to_string())?)?;
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("Invalid APK/ZIP: {error}"))?;
    let mut manifest_bytes = None;
    let mut permissions = Vec::new();
    let mut components = Vec::new();
    let mut native_abis = BTreeSet::new();
    let mut native_libraries = Vec::new();
    let mut files = Vec::new();
    let mut inventory_truncated = false;
    let mut signature_entries = Vec::new();
    let mut certificates = Vec::new();
    let mut warnings = Vec::new();
    let mut icon_candidate: Option<((u8, u8), String, Vec<u8>)> = None;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        if files.len() < MAX_ARCHIVE_FILES {
            files.push(ApkArchiveFile {
                path: name.clone(),
                size_bytes: entry.size(),
                compressed_size_bytes: entry.compressed_size(),
                compression: format!("{:?}", entry.compression()),
            });
        } else if !inventory_truncated {
            warnings.push(format!(
                "Archive inventory was truncated at {MAX_ARCHIVE_FILES} files"
            ));
            inventory_truncated = true;
        }
        if name == "AndroidManifest.xml" {
            if entry.size() > MAX_MANIFEST_BYTES {
                warnings.push("AndroidManifest.xml exceeds the safe analysis limit".to_string());
            } else {
                let mut bytes = Vec::with_capacity(entry.size() as usize);
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                manifest_bytes = Some(bytes);
            }
            continue;
        }
        let segments: Vec<&str> = name.split('/').collect();
        if segments.len() >= 3 && segments[0] == "lib" && name.ends_with(".so") {
            let abi = segments[1].to_string();
            native_abis.insert(abi.clone());
            native_libraries.push(ApkNativeLibrary {
                abi,
                name: segments.last().unwrap_or(&"").to_string(),
                archive_path: name.clone(),
                size_bytes: entry.size(),
                compressed_size_bytes: entry.compressed_size(),
            });
        }
        let upper = name.to_ascii_uppercase();
        if upper.starts_with("META-INF/")
            && (upper.ends_with(".RSA") || upper.ends_with(".DSA") || upper.ends_with(".EC"))
        {
            signature_entries.push(name.clone());
            if entry.size() <= MAX_CERTIFICATE_BYTES {
                let mut bytes = Vec::with_capacity(entry.size() as usize);
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                match parse_pkcs7_certificates(&bytes) {
                    Ok(mut parsed) => certificates.append(&mut parsed),
                    Err(error) => warnings.push(format!("Could not parse {name}: {error}")),
                }
            } else {
                warnings.push(format!(
                    "Signature entry {name} exceeds the safe analysis limit"
                ));
            }
        }
        if let Some(priority) = icon_priority(&name) {
            let replace = icon_candidate
                .as_ref()
                .is_none_or(|(current, _, _)| priority < *current);
            if replace && entry.size() <= MAX_ICON_BYTES {
                let mut bytes = Vec::with_capacity(entry.size() as usize);
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                icon_candidate = Some((priority, name, bytes));
            }
        }
    }
    native_libraries.sort_by(|left, right| left.archive_path.cmp(&right.archive_path));
    signature_entries.sort();

    let manifest = match manifest_bytes {
        Some(bytes) => match parse_manifest(&bytes) {
            Ok(parsed) => {
                permissions = parsed.permissions.into_iter().collect();
                components = parsed.components;
                ApkManifestInfo {
                    status: ApkArtifactStatus::Available,
                    package_name: parsed.package_name,
                    app_label: parsed.app_label,
                    version_name: parsed.version_name,
                    version_code: parsed.version_code,
                    min_sdk: parsed.min_sdk,
                    target_sdk: parsed.target_sdk,
                    icon_reference: parsed.icon_reference,
                    reason: None,
                }
            }
            Err(error) => ApkManifestInfo {
                status: ApkArtifactStatus::Unsupported,
                package_name: None,
                app_label: None,
                version_name: None,
                version_code: None,
                min_sdk: None,
                target_sdk: None,
                icon_reference: None,
                reason: Some(error),
            },
        },
        None => ApkManifestInfo {
            status: ApkArtifactStatus::Missing,
            package_name: None,
            app_label: None,
            version_name: None,
            version_code: None,
            min_sdk: None,
            target_sdk: None,
            icon_reference: None,
            reason: Some("AndroidManifest.xml is missing".to_string()),
        },
    };

    let (mut schemes, signing_error) = match read_signing_schemes(path) {
        Ok(schemes) => (schemes, None),
        Err(error) => {
            warnings.push(format!("Could not inspect APK Signing Block: {error}"));
            (ApkSigningSchemes::default(), Some(error))
        }
    };
    schemes.jar_v1 = !signature_entries.is_empty();
    let signed = schemes.jar_v1 || schemes.apk_v2 || schemes.apk_v3 || schemes.apk_v31;
    let signing = ApkSigningInfo {
        status: if signing_error.is_some() {
            ApkArtifactStatus::Error
        } else if signed {
            ApkArtifactStatus::Available
        } else {
            ApkArtifactStatus::Missing
        },
        schemes,
        signature_entries,
        certificates,
        reason: if let Some(error) = signing_error {
            Some(format!("APK Signing Block inspection failed: {error}"))
        } else if signed {
            None
        } else {
            Some("No v1/v2/v3 APK signature was detected".to_string())
        },
    };
    let launcher_icon = if let Some((_, archive_path, bytes)) = icon_candidate {
        ApkLauncherIcon {
            status: ApkArtifactStatus::Available,
            media_type: Some(icon_media_type(&archive_path).to_string()),
            archive_path: Some(archive_path),
            data_base64: Some(BASE64.encode(bytes)),
            reason: None,
        }
    } else {
        ApkLauncherIcon {
            status: ApkArtifactStatus::Missing,
            archive_path: None,
            media_type: None,
            data_base64: None,
            reason: Some(
                "No supported bitmap launcher icon could be resolved; adaptive XML icons require resource-table resolution"
                    .to_string(),
            ),
        }
    };

    Ok(ApkAnalysisResult {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("app.apk")
            .to_string(),
        file_size_bytes: metadata.len(),
        sha256,
        manifest,
        permissions,
        components,
        native_abis: native_abis.into_iter().collect(),
        native_libraries,
        files,
        signing,
        launcher_icon,
        warnings,
    })
}

/// Tauri-ready command. Registration is intentionally left to the application root.
#[tauri::command]
pub async fn analyze_local_apk(path: String) -> Result<ApkAnalysisResult, String> {
    let path = validate_apk_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || analyze_apk_file(path))
        .await
        .map_err(|error| format!("APK analyzer worker failed: {error}"))?
}

/// Extract only the launcher-icon payload for a lightweight preview call.
#[tauri::command]
pub async fn extract_apk_launcher_icon(path: String) -> Result<ApkLauncherIcon, String> {
    Ok(analyze_local_apk(path).await?.launcher_icon)
}

/// Resolve and lazily cache an installed package's base APK before extracting
/// its launcher icon. `AppHandle` is injected by Tauri; frontend callers pass
/// only `serial`, `package`, and optional `customPath`.
#[tauri::command]
pub async fn get_package_icon(
    app_handle: tauri::AppHandle,
    serial: String,
    package: String,
    custom_path: Option<String>,
) -> PackageIconResult {
    let serial = serial.trim().to_string();
    let package = package.trim().to_string();
    if let Err(error) = adb::validate_serial(&serial) {
        return package_icon_failure(
            &serial,
            &package,
            ApkArtifactStatus::Error,
            error.code(),
            error.message(),
        );
    }
    if let Err(error) = adb::validate_package_name(&package) {
        return package_icon_failure(
            &serial,
            &package,
            ApkArtifactStatus::Error,
            error.code(),
            error.message(),
        );
    }
    let discovery = apk_toolkit::discover(&serial, &package, custom_path.clone()).await;
    if !discovery.success {
        return package_icon_failure(
            &serial,
            &package,
            ApkArtifactStatus::Error,
            discovery
                .error_code
                .as_deref()
                .unwrap_or("apk_discovery_failed"),
            discovery
                .error
                .unwrap_or_else(|| "Installed APK discovery failed".to_string()),
        );
    }
    let (remote_path, discovered_size) = match discovery
        .artifacts
        .iter()
        .find(|artifact| artifact.kind == ApkArtifactKind::Base)
        .map(|artifact| (artifact.remote_path.clone(), artifact.size_bytes))
    {
        Some((path, size)) if validate_remote_apk_path(&path) => (path, size),
        Some(_) => {
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Error,
                "unsafe_base_apk_path",
                "Installed APK discovery returned an unsafe base path",
            )
        }
        None => {
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Missing,
                "base_apk_missing",
                "Installed APK discovery did not return a base APK",
            )
        }
    };
    let signal = match adb::run_adb_text(
        Some(&serial),
        &["shell", "stat", "-c", "%s:%Y", &remote_path],
        custom_path.clone(),
        10,
    )
    .await
    {
        Ok(signal) if !signal.trim().is_empty() => signal.trim().to_string(),
        _ => format!(
            "{}:{}",
            remote_path,
            discovered_size
                .map(|size| size.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ),
    };
    let cache_root = match app_handle.path().app_cache_dir() {
        Ok(path) => path
            .join("apk-icons")
            .join(package_cache_identity(&serial, &package)),
        Err(error) => {
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Error,
                "cache_unavailable",
                error.to_string(),
            )
        }
    };
    if let Err(error) = std::fs::create_dir_all(&cache_root) {
        return package_icon_failure(
            &serial,
            &package,
            ApkArtifactStatus::Error,
            "cache_unavailable",
            error.to_string(),
        );
    }
    let cache_path = cache_root.join(package_cache_file_name(&remote_path, &signal));
    let cache_hit = cache_path.is_file();
    if !cache_hit {
        let temporary = cache_root.join(format!(
            ".{}.{}.part",
            std::process::id(),
            package_cache_file_name(&remote_path, &signal)
        ));
        let temporary_string = temporary.to_string_lossy().into_owned();
        if let Err(error) = adb::run_adb_text(
            Some(&serial),
            &["pull", &remote_path, &temporary_string],
            custom_path,
            180,
        )
        .await
        {
            let _ = std::fs::remove_file(&temporary);
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Error,
                error.code(),
                error.message(),
            );
        }
        if let Err(error) = std::fs::rename(&temporary, &cache_path) {
            let _ = std::fs::remove_file(&temporary);
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Error,
                "cache_write_failed",
                error.to_string(),
            );
        }
        if let Ok(entries) = std::fs::read_dir(&cache_root) {
            for entry in entries.flatten() {
                let old_path = entry.path();
                if old_path != cache_path && old_path.extension().is_some_and(|ext| ext == "apk") {
                    let _ = std::fs::remove_file(old_path);
                }
            }
        }
    }
    let icon = match analyze_apk_file(&cache_path) {
        Ok(result) => result.launcher_icon,
        Err(error) => {
            return package_icon_failure(
                &serial,
                &package,
                ApkArtifactStatus::Error,
                "apk_analysis_failed",
                error,
            )
        }
    };
    let data_url = match (&icon.media_type, &icon.data_base64) {
        (Some(media_type), Some(data)) => Some(format!("data:{media_type};base64,{data}")),
        _ => None,
    };
    PackageIconResult {
        status: icon.status,
        device_serial: serial,
        package_name: package,
        data_url,
        media_type: icon.media_type,
        archive_path: icon.archive_path,
        source_apk_path: Some(remote_path),
        cache_hit,
        cache_signal: Some(signal),
        reason: icon.reason,
        error_code: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };
    use zip::write::SimpleFileOptions;

    fn temp_apk(name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("apk-analyzer-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(name);
        let file = File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (entry_name, bytes) in entries {
            writer
                .start_file(*entry_name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn analyzes_plain_manifest_permissions_components_native_libs_and_icon() {
        let manifest = br#"<?xml version="1.0" encoding="utf-8"?>
          <manifest xmlns:android="http://schemas.android.com/apk/res/android"
            package="com.example.demo" android:versionName="1.2.3" android:versionCode="42">
            <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />
            <uses-permission android:name="android.permission.CAMERA" />
            <application android:label="Demo" android:icon="@mipmap/ic_launcher">
              <activity android:name=".MainActivity" android:exported="true">
                <intent-filter>
                  <action android:name="android.intent.action.MAIN" />
                  <category android:name="android.intent.category.LAUNCHER" />
                </intent-filter>
              </activity>
              <service android:name="SyncService" android:enabled="false" />
            </application>
          </manifest>"#;
        let icon = b"not-a-real-png-but-an-extractable-asset";
        let path = temp_apk(
            "demo.apk",
            &[
                ("AndroidManifest.xml", manifest),
                ("lib/arm64-v8a/libdemo.so", b"elf"),
                ("res/mipmap-xxhdpi/ic_launcher.png", icon),
            ],
        );
        let result = analyze_apk_file(&path).unwrap();
        assert_eq!(result.manifest.status, ApkArtifactStatus::Available);
        assert_eq!(
            result.manifest.package_name.as_deref(),
            Some("com.example.demo")
        );
        assert_eq!(result.manifest.version_name.as_deref(), Some("1.2.3"));
        assert_eq!(result.manifest.min_sdk.as_deref(), Some("24"));
        assert_eq!(result.permissions, ["android.permission.CAMERA"]);
        assert_eq!(result.native_abis, ["arm64-v8a"]);
        assert_eq!(result.files.len(), 3);
        assert_eq!(result.files[0].path, "AndroidManifest.xml");
        assert!(result
            .files
            .iter()
            .any(|file| file.path == "lib/arm64-v8a/libdemo.so" && file.size_bytes == 3));
        assert_eq!(result.components[0].name, "com.example.demo.MainActivity");
        assert!(result.components[0].launcher);
        assert_eq!(result.components[1].name, "com.example.demo.SyncService");
        assert_eq!(result.components[1].enabled, Some(false));
        assert_eq!(result.launcher_icon.status, ApkArtifactStatus::Available);
        assert_eq!(
            BASE64
                .decode(result.launcher_icon.data_base64.unwrap())
                .unwrap(),
            icon
        );
        assert_eq!(result.sha256.len(), 64);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn reports_missing_optional_artifacts_without_failing_the_file_analysis() {
        let path = temp_apk("minimal.apk", &[("classes.dex", b"dex")]);
        let result = analyze_apk_file(&path).unwrap();
        assert_eq!(result.manifest.status, ApkArtifactStatus::Missing);
        assert_eq!(result.signing.status, ApkArtifactStatus::Missing);
        assert_eq!(result.launcher_icon.status, ApkArtifactStatus::Missing);
        assert!(result.permissions.is_empty());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_non_apk_command_paths_and_invalid_archives() {
        let path = temp_apk("wrong.zip", &[("x", b"x")]);
        assert!(validate_apk_path(path.to_str().unwrap()).is_err());
        let invalid = path.with_file_name("broken.apk");
        fs::write(&invalid, b"not a zip").unwrap();
        assert!(analyze_apk_file(&invalid)
            .unwrap_err()
            .contains("Invalid APK/ZIP"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn parses_utf8_string_pool_and_typed_manifest_values() {
        fn push_u16(target: &mut Vec<u8>, value: u16) {
            target.extend(value.to_le_bytes());
        }
        fn push_u32(target: &mut Vec<u8>, value: u32) {
            target.extend(value.to_le_bytes());
        }
        let strings = ["manifest", "package", "com.binary.app", "versionCode"];
        let mut encoded = Vec::new();
        let mut offsets = Vec::new();
        for value in strings {
            offsets.push(encoded.len() as u32);
            encoded.push(value.len() as u8);
            encoded.push(value.len() as u8);
            encoded.extend(value.as_bytes());
            encoded.push(0);
        }
        while encoded.len() % 4 != 0 {
            encoded.push(0);
        }
        let header_size = 28_u16;
        let strings_start = header_size as u32 + (offsets.len() * 4) as u32;
        let chunk_size = strings_start + encoded.len() as u32;
        let mut pool = Vec::new();
        push_u16(&mut pool, 0x0001);
        push_u16(&mut pool, header_size);
        push_u32(&mut pool, chunk_size);
        push_u32(&mut pool, offsets.len() as u32);
        push_u32(&mut pool, 0);
        push_u32(&mut pool, 0x100);
        push_u32(&mut pool, strings_start);
        push_u32(&mut pool, 0);
        for offset in offsets {
            push_u32(&mut pool, offset);
        }
        pool.extend(encoded);
        assert_eq!(parse_string_pool(&pool, 0).unwrap()[2], "com.binary.app");
        assert_eq!(
            typed_value(&["value".into()], u32::MAX, 0x10, 42).as_deref(),
            Some("42")
        );
        assert_eq!(
            typed_value(&["value".into()], u32::MAX, 0x12, 1).as_deref(),
            Some("true")
        );
    }

    #[test]
    fn parses_binary_manifest_metadata_and_permissions() {
        fn u16v(target: &mut Vec<u8>, value: u16) {
            target.extend(value.to_le_bytes());
        }
        fn u32v(target: &mut Vec<u8>, value: u32) {
            target.extend(value.to_le_bytes());
        }
        fn string_pool(strings: &[&str]) -> Vec<u8> {
            let mut encoded = Vec::new();
            let mut offsets = Vec::new();
            for value in strings {
                offsets.push(encoded.len() as u32);
                encoded.push(value.len() as u8);
                encoded.push(value.len() as u8);
                encoded.extend(value.as_bytes());
                encoded.push(0);
            }
            while encoded.len() % 4 != 0 {
                encoded.push(0);
            }
            let header = 28_u16;
            let strings_start = header as u32 + offsets.len() as u32 * 4;
            let mut chunk = Vec::new();
            u16v(&mut chunk, 0x0001);
            u16v(&mut chunk, header);
            u32v(&mut chunk, strings_start + encoded.len() as u32);
            u32v(&mut chunk, offsets.len() as u32);
            u32v(&mut chunk, 0);
            u32v(&mut chunk, 0x100);
            u32v(&mut chunk, strings_start);
            u32v(&mut chunk, 0);
            for offset in offsets {
                u32v(&mut chunk, offset);
            }
            chunk.extend(encoded);
            chunk
        }
        fn start(tag: u32, attrs: &[(u32, u32, u8, u32)]) -> Vec<u8> {
            let mut chunk = Vec::new();
            u16v(&mut chunk, 0x0102);
            u16v(&mut chunk, 16);
            u32v(&mut chunk, (36 + attrs.len() * 20) as u32);
            u32v(&mut chunk, 1);
            u32v(&mut chunk, u32::MAX);
            u32v(&mut chunk, u32::MAX);
            u32v(&mut chunk, tag);
            u16v(&mut chunk, 20);
            u16v(&mut chunk, 20);
            u16v(&mut chunk, attrs.len() as u16);
            u16v(&mut chunk, 0);
            u16v(&mut chunk, 0);
            u16v(&mut chunk, 0);
            for (name, raw, value_type, data) in attrs {
                u32v(&mut chunk, u32::MAX);
                u32v(&mut chunk, *name);
                u32v(&mut chunk, *raw);
                u16v(&mut chunk, 8);
                chunk.push(0);
                chunk.push(*value_type);
                u32v(&mut chunk, *data);
            }
            chunk
        }
        fn end(tag: u32) -> Vec<u8> {
            let mut chunk = Vec::new();
            u16v(&mut chunk, 0x0103);
            u16v(&mut chunk, 16);
            u32v(&mut chunk, 24);
            u32v(&mut chunk, 1);
            u32v(&mut chunk, u32::MAX);
            u32v(&mut chunk, u32::MAX);
            u32v(&mut chunk, tag);
            chunk
        }

        let strings = [
            "manifest",
            "package",
            "com.binary.app",
            "versionCode",
            "uses-sdk",
            "minSdkVersion",
            "targetSdkVersion",
            "uses-permission",
            "name",
            "android.permission.INTERNET",
        ];
        let mut body = string_pool(&strings);
        body.extend(start(0, &[(1, 2, 0x03, 2), (3, u32::MAX, 0x10, 42)]));
        body.extend(start(
            4,
            &[(5, u32::MAX, 0x10, 24), (6, u32::MAX, 0x10, 35)],
        ));
        body.extend(end(4));
        body.extend(start(7, &[(8, 9, 0x03, 9)]));
        body.extend(end(7));
        body.extend(end(0));
        let mut xml = Vec::new();
        u16v(&mut xml, 0x0003);
        u16v(&mut xml, 8);
        u32v(&mut xml, (8 + body.len()) as u32);
        xml.extend(body);

        let parsed = parse_binary_manifest(&xml).unwrap();
        assert_eq!(parsed.package_name.as_deref(), Some("com.binary.app"));
        assert_eq!(parsed.version_code.as_deref(), Some("42"));
        assert_eq!(parsed.min_sdk.as_deref(), Some("24"));
        assert_eq!(parsed.target_sdk.as_deref(), Some("35"));
        assert!(parsed.permissions.contains("android.permission.INTERNET"));
    }

    #[test]
    fn prioritizes_high_density_launcher_bitmap_and_qualifies_component_names() {
        assert!(
            icon_priority("res/mipmap-xxxhdpi/ic_launcher.webp")
                < icon_priority("res/mipmap-mdpi/ic_launcher.png")
        );
        assert_eq!(
            qualify_component(Some("com.test"), ".Main".into()),
            "com.test.Main"
        );
        assert_eq!(
            qualify_component(Some("com.test"), "Worker".into()),
            "com.test.Worker"
        );
        assert_eq!(
            qualify_component(Some("com.test"), "other.Full".into()),
            "other.Full"
        );
    }

    #[test]
    fn detects_apk_v2_and_v3_signing_block_ids() {
        let path = temp_apk("signed.apk", &[("classes.dex", b"dex")]);
        let mut bytes = fs::read(&path).unwrap();
        let eocd = bytes
            .windows(4)
            .rposition(|window| window == [0x50, 0x4b, 0x05, 0x06])
            .unwrap();
        let central = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
        let mut pairs = Vec::new();
        for id in [0x7109_871a_u32, 0xf053_68c0_u32] {
            pairs.extend(4_u64.to_le_bytes());
            pairs.extend(id.to_le_bytes());
        }
        let block_size = pairs.len() as u64 + 24;
        let mut block = Vec::new();
        block.extend(block_size.to_le_bytes());
        block.extend(pairs);
        block.extend(block_size.to_le_bytes());
        block.extend(b"APK Sig Block 42");
        bytes.splice(central..central, block.iter().copied());
        let shifted_eocd = eocd + block.len();
        let shifted_central = (central + block.len()) as u32;
        bytes[shifted_eocd + 16..shifted_eocd + 20].copy_from_slice(&shifted_central.to_le_bytes());
        fs::write(&path, bytes).unwrap();

        let schemes = read_signing_schemes(&path).unwrap();
        assert!(schemes.apk_v2);
        assert!(schemes.apk_v3);
        assert!(!schemes.apk_v31);
        let result = analyze_apk_file(&path).unwrap();
        assert_eq!(result.signing.status, ApkArtifactStatus::Available);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn analyzes_companion_binary_apk_fixture_when_available() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../android-companion/app/build/outputs/apk/debug/app-debug.apk");
        if !path.is_file() {
            return;
        }
        let result = analyze_apk_file(path).unwrap();
        assert_eq!(result.manifest.status, ApkArtifactStatus::Available);
        assert!(result.manifest.package_name.is_some());
        assert!(result.manifest.target_sdk.is_some());
        assert!(!result.sha256.is_empty());
    }

    #[test]
    fn validates_remote_paths_defensively_after_shared_discovery() {
        assert!(validate_remote_apk_path(
            "/data/app/~~token/com.example/base.apk"
        ));
        assert!(!validate_remote_apk_path("../../escape.apk"));
        assert!(!validate_remote_apk_path("/data/app/../escape.apk"));
        assert!(!validate_remote_apk_path("/data/app/base.apk\nmalicious"));
    }

    #[test]
    fn cache_keys_are_safe_stable_and_invalidate_with_remote_signal() {
        let identity = package_cache_identity("192.168.0.2:5555", "com.example.app");
        assert_eq!(identity.len(), 64);
        assert!(identity
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        let first = package_cache_file_name("/data/app/example/base.apk", "1234:100");
        let same = package_cache_file_name("/data/app/example/base.apk", "1234:100");
        let updated = package_cache_file_name("/data/app/example/base.apk", "1234:101");
        assert_eq!(first, same);
        assert_ne!(first, updated);
        assert!(first.ends_with(".apk"));
        assert!(!first.contains('/') && !first.contains(".."));
    }
}
