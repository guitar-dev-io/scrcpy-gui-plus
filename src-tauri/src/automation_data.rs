use calamine::{open_workbook_auto, Data as ExcelData, Reader as ExcelReader};
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const MAX_DATA_BYTES: u64 = 25 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutomationDataFormat {
    Xlsx,
    Xls,
    Csv,
    Tsv,
    Json,
    Yaml,
}

impl AutomationDataFormat {
    fn from_path(path: &Path) -> Result<Self, String> {
        match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "xlsx" => Ok(Self::Xlsx),
            "xls" => Ok(Self::Xls),
            "csv" => Ok(Self::Csv),
            "tsv" => Ok(Self::Tsv),
            "json" => Ok(Self::Json),
            "yaml" | "yml" => Ok(Self::Yaml),
            _ => Err("Supported data files: .xlsx, .xls, .csv, .tsv, .json, .yaml, and .yml".to_string()),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Xlsx => "xlsx",
            Self::Xls => "xls",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
            Self::Json => "json",
            Self::Yaml => "yaml",
        }
    }

    fn parse(self, path: &Path) -> Result<Vec<AutomationDataset>, String> {
        match self {
            Self::Xlsx | Self::Xls => parse_excel(path),
            Self::Csv | Self::Tsv => {
                let content = read_text_file(path)?;
                let delimiter = detected_delimiter(&content, self.label());
                Ok(vec![rows_to_dataset(
                    path.file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("Data"),
                    parse_delimited(&content, delimiter)?,
                )])
            }
            Self::Json => parse_json(
                &std::fs::read_to_string(path).map_err(|error| error.to_string())?,
            ),
            Self::Yaml => parse_yaml(&read_text_file(path)?),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDataset {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDataSource {
    pub path: String,
    pub format: String,
    pub datasets: Vec<AutomationDataset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationResultRow {
    pub row_id: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub source_rows: Vec<usize>,
}

fn result_values(result: &AutomationResultRow) -> [String; 5] {
    [
        result.row_id.clone(),
        result.status.clone(),
        result.error.clone().unwrap_or_default(),
        result.started_at.clone().unwrap_or_default(),
        result.ended_at.clone().unwrap_or_default(),
    ]
}

fn csv_field(value: &str, delimiter: char) -> String {
    if value.contains(delimiter)
        || value.contains('"')
        || value.contains('\n')
        || value.contains('\r')
    {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn excel_column(mut index: usize) -> String {
    let mut value = String::new();
    index += 1;
    while index > 0 {
        let digit = (index - 1) % 26;
        value.insert(0, (b'A' + digit as u8) as char);
        index = (index - 1) / 26;
    }
    value
}

fn append_xlsx_results(
    source: &Path,
    target: &Path,
    sheet_index: usize,
    results: &[AutomationResultRow],
) -> Result<(), String> {
    let file = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let output = File::create(target).map_err(|error| error.to_string())?;
    let mut writer = zip::ZipWriter::new(output);
    let sheet_name = format!("xl/worksheets/sheet{}.xml", sheet_index + 1);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            writer
                .add_directory(&name, zip::write::SimpleFileOptions::default())
                .map_err(|error| error.to_string())?;
            continue;
        }
        let mut bytes = vec![];
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if name == sheet_name {
            let mut xml = String::from_utf8(bytes).map_err(|error| error.to_string())?;
            let row_tag = regex_row_width(&xml);
            let headers = [
                "Row ID",
                "Automation Status",
                "Automation Error",
                "Started At",
                "Ended At",
            ];
            for result in std::iter::once(None).chain(results.iter().map(Some)) {
                let actual_row = result
                    .and_then(|value| value.source_rows.first().copied())
                    .map(|index| index + 2)
                    .unwrap_or(1);
                let values: Vec<String> = match result {
                    Some(value) => result_values(value).to_vec(),
                    None => headers.iter().map(|value| value.to_string()).collect(),
                };
                let cells = values
                    .iter()
                    .enumerate()
                    .map(|(offset, value)| {
                        format!(
                            "<c r=\"{}{}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                            excel_column(row_tag + offset),
                            actual_row,
                            xml_escape(value)
                        )
                    })
                    .collect::<String>();
                let marker = format!("</row>");
                let mut seen = 0usize;
                let replacement_at = xml.match_indices(&marker).find_map(|(position, _)| {
                    seen += 1;
                    (seen == actual_row).then_some(position)
                });
                if let Some(position) = replacement_at {
                    xml.insert_str(position, &cells);
                }
            }
            bytes = xml.into_bytes();
        }
        let options =
            zip::write::SimpleFileOptions::default().compression_method(entry.compression());
        writer
            .start_file(&name, options)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn regex_row_width(xml: &str) -> usize {
    let first_row_end = xml.find("</row>").unwrap_or(xml.len());
    let first_row = &xml[..first_row_end];
    first_row
        .match_indices(" r=\"")
        .filter_map(|(position, _)| {
            first_row[position + 4..]
                .chars()
                .take_while(|character| character.is_ascii_alphabetic())
                .fold(None, |acc, character| {
                    Some(
                        acc.unwrap_or(0) * 26
                            + (character.to_ascii_uppercase() as usize - 'A' as usize + 1),
                    )
                })
        })
        .max()
        .unwrap_or(0)
}

fn unique_columns(values: Vec<String>) -> Vec<String> {
    let mut counts = HashMap::<String, usize>::new();
    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let base = if value.trim().is_empty() {
                format!("Column{}", index + 1)
            } else {
                value.trim().to_string()
            };
            let count = counts.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base}_{}", *count)
            }
        })
        .collect()
}

fn rows_to_dataset(name: &str, mut rows: Vec<Vec<Value>>) -> AutomationDataset {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    for row in &mut rows {
        row.resize(width, Value::Null);
    }
    let header = if rows.is_empty() {
        vec![]
    } else {
        rows.remove(0)
    };
    let columns = unique_columns(
        header
            .into_iter()
            .map(|value| match value {
                Value::String(value) => value,
                Value::Null => String::new(),
                other => other.to_string(),
            })
            .collect(),
    );
    AutomationDataset {
        name: name.to_string(),
        columns,
        rows,
    }
}

fn parse_delimited(content: &str, delimiter: char) -> Result<Vec<Vec<Value>>, String> {
    let mut rows = vec![];
    let mut row = vec![];
    let mut field = String::new();
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            value if value == delimiter && !quoted => {
                row.push(Value::String(std::mem::take(&mut field)));
            }
            '\n' if !quoted => {
                row.push(Value::String(std::mem::take(&mut field)));
                if row
                    .iter()
                    .any(|value| value.as_str().is_some_and(|text| !text.is_empty()))
                {
                    rows.push(std::mem::take(&mut row));
                }
                if rows.len() > MAX_ROWS {
                    return Err("Data source exceeds 100,000 rows".to_string());
                }
            }
            '\r' if !quoted => {}
            value => field.push(value),
        }
    }
    if quoted {
        return Err("Delimited file contains an unclosed quoted field".to_string());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(Value::String(field));
        rows.push(row);
    }
    Ok(rows)
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).map_err(|error| error.to_string());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units).map_err(|error| error.to_string());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units).map_err(|error| error.to_string());
    }
    String::from_utf8(bytes).map_err(|_| "Text data must use UTF-8 or UTF-16 encoding".to_string())
}

fn detected_delimiter(content: &str, extension: &str) -> char {
    if extension == "tsv" {
        return '\t';
    }
    let header = content.lines().next().unwrap_or_default();
    [',', ';', '\t']
        .into_iter()
        .max_by_key(|delimiter| header.matches(*delimiter).count())
        .unwrap_or(',')
}

fn parse_json(content: &str) -> Result<Vec<AutomationDataset>, String> {
    let root: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    parse_structured_value(root, "JSON")
}

fn parse_yaml(content: &str) -> Result<Vec<AutomationDataset>, String> {
    let yaml: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(content).map_err(|error| error.to_string())?;
    let root = serde_json::to_value(yaml).map_err(|error| error.to_string())?;
    parse_structured_value(root, "YAML")
}

fn parse_structured_value(root: Value, default_name: &str) -> Result<Vec<AutomationDataset>, String> {
    let groups: Vec<(String, Vec<Value>)> = match root {
        Value::Array(rows) => vec![(default_name.to_string(), rows)],
        Value::Object(map) => map
            .into_iter()
            .filter_map(|(name, value)| value.as_array().cloned().map(|rows| (name, rows)))
            .collect(),
        _ => {
            return Err(
                format!("{default_name} must be an array of records or an object containing arrays"),
            )
        }
    };
    if groups.is_empty() {
        return Err(format!("{default_name} contains no record arrays"));
    }
    groups
        .into_iter()
        .map(|(name, records)| {
            if records.len() > MAX_ROWS {
                return Err("Data source exceeds 100,000 rows".to_string());
            }
            let mut columns = vec![];
            for record in &records {
                let object = record
                    .as_object()
                    .ok_or_else(|| format!("{default_name} records must be objects"))?;
                for key in object.keys() {
                    if !columns.contains(key) {
                        columns.push(key.clone());
                    }
                }
            }
            let rows = records
                .into_iter()
                .map(|record| {
                    let object = record.as_object().cloned().unwrap_or_default();
                    columns
                        .iter()
                        .map(
                            |column| match object.get(column).cloned().unwrap_or(Value::Null) {
                                value @ (Value::Null
                                | Value::Bool(_)
                                | Value::Number(_)
                                | Value::String(_)) => value,
                                nested => Value::String(nested.to_string()),
                            },
                        )
                        .collect()
                })
                .collect();
            Ok(AutomationDataset {
                name,
                columns,
                rows,
            })
        })
        .collect()
}

fn excel_cell_value(cell: &ExcelData) -> Value {
    match cell {
        ExcelData::Empty => Value::Null,
        ExcelData::String(value) => Value::String(value.clone()),
        ExcelData::Float(value) => serde_json::Number::from_f64(*value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ExcelData::Int(value) => Value::Number((*value).into()),
        ExcelData::Bool(value) => Value::Bool(*value),
        other => Value::String(other.to_string()),
    }
}

fn parse_excel(path: &Path) -> Result<Vec<AutomationDataset>, String> {
    let mut workbook = open_workbook_auto(path).map_err(|error| error.to_string())?;
    workbook
        .worksheets()
        .into_iter()
        .map(|(name, range)| {
            let rows = range
                .rows()
                .take(MAX_ROWS + 1)
                .map(|row| row.iter().map(excel_cell_value).collect::<Vec<_>>())
                .collect::<Vec<_>>();
            if rows.len() > MAX_ROWS {
                return Err("Data source exceeds 100,000 rows".to_string());
            }
            Ok(rows_to_dataset(&name, rows))
        })
        .collect()
}

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut file = archive.by_name(name).map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    Ok(text)
}

fn xml_text_values(xml: &str, element: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut values = vec![];
    let mut inside = false;
    let mut current = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) if event.local_name().as_ref() == element => {
                inside = true;
                current.clear();
            }
            Ok(Event::End(event)) if event.local_name().as_ref() == element => {
                inside = false;
                values.push(current.clone());
            }
            Ok(Event::Text(text)) if inside => current.push_str(&text.xml10_content()),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    values
}

fn cell_column(reference: &str) -> usize {
    reference
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .fold(0usize, |value, character| {
            value * 26 + (character.to_ascii_uppercase() as usize - 'A' as usize + 1)
        })
        .saturating_sub(1)
}

fn parse_sheet(xml: &str, shared: &[String]) -> Vec<Vec<Value>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut rows = vec![];
    let mut row = vec![];
    let mut cell_ref = String::new();
    let mut cell_type = String::new();
    let mut cell_value = String::new();
    let mut in_value = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) if event.local_name().as_ref() == "row" => row = vec![],
            Ok(Event::Start(event)) if event.local_name().as_ref() == "c" => {
                cell_ref.clear();
                cell_type.clear();
                cell_value.clear();
                for attribute in event.attributes().flatten() {
                    if attribute.key.local_name().as_ref() == "r" {
                        cell_ref = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .unwrap_or_default()
                            .to_string();
                    }
                    if attribute.key.local_name().as_ref() == "t" {
                        cell_type = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .unwrap_or_default()
                            .to_string();
                    }
                }
            }
            Ok(Event::Start(event)) if matches!(event.local_name().as_ref(), "v" | "t") => {
                in_value = true
            }
            Ok(Event::End(event)) if matches!(event.local_name().as_ref(), "v" | "t") => {
                in_value = false
            }
            Ok(Event::Text(text)) if in_value => {
                cell_value.push_str(&text.xml10_content())
            }
            Ok(Event::End(event)) if event.local_name().as_ref() == "c" => {
                let column = cell_column(&cell_ref);
                row.resize(column + 1, Value::Null);
                row[column] = match cell_type.as_str() {
                    "s" => cell_value
                        .parse::<usize>()
                        .ok()
                        .and_then(|index| shared.get(index))
                        .cloned()
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                    "b" => Value::Bool(cell_value == "1"),
                    "inlineStr" | "str" => Value::String(cell_value.clone()),
                    _ => cell_value
                        .parse::<f64>()
                        .ok()
                        .and_then(serde_json::Number::from_f64)
                        .map(Value::Number)
                        .unwrap_or_else(|| Value::String(cell_value.clone())),
                };
            }
            Ok(Event::End(event)) if event.local_name().as_ref() == "row" => {
                rows.push(std::mem::take(&mut row));
                if rows.len() >= MAX_ROWS {
                    break;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    rows
}

fn parse_xlsx(path: &Path) -> Result<Vec<AutomationDataset>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let shared = read_zip_text(&mut archive, "xl/sharedStrings.xml")
        .map(|xml| xml_text_values(&xml, "si"))
        .unwrap_or_default();
    let workbook = read_zip_text(&mut archive, "xl/workbook.xml")?;
    let names = {
        let mut reader = Reader::from_str(&workbook);
        let mut result = vec![];
        loop {
            match reader.read_event() {
                Ok(Event::Empty(event)) if event.local_name().as_ref() == "sheet" => {
                    for attribute in event.attributes().flatten() {
                        if attribute.key.local_name().as_ref() == "name" {
                            result.push(
                                attribute
                                    .normalized_value(XmlVersion::Implicit1_0)
                                    .unwrap_or_default()
                                    .to_string(),
                            );
                        }
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
        result
    };
    names
        .into_iter()
        .enumerate()
        .map(|(index, name)| {
            let xml = read_zip_text(
                &mut archive,
                &format!("xl/worksheets/sheet{}.xml", index + 1),
            )?;
            Ok(rows_to_dataset(&name, parse_sheet(&xml, &shared)))
        })
        .collect()
}

#[tauri::command]
pub async fn read_automation_data_source(path: String) -> Result<AutomationDataSource, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() || !target.is_file() {
        return Err("Data source file does not exist".to_string());
    }
    let metadata = std::fs::metadata(&target).map_err(|error| error.to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_DATA_BYTES {
        return Err("Data source must be between 1 byte and 25 MB".to_string());
    }
    let format = AutomationDataFormat::from_path(&target)?;
    let datasets = format.parse(&target)?;
    Ok(AutomationDataSource {
        path: target.to_string_lossy().to_string(),
        format: format.label().to_string(),
        datasets,
    })
}

fn unique_path(preferred: PathBuf) -> PathBuf {
    if !preferred.exists() {
        return preferred;
    }
    let parent = preferred.parent().unwrap_or_else(|| Path::new("."));
    let stem = preferred
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("automation");
    let extension = preferred
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    (2..10_000)
        .map(|index| {
            parent.join(if extension.is_empty() {
                format!("{stem}-{index}")
            } else {
                format!("{stem}-{index}.{extension}")
            })
        })
        .find(|path| !path.exists())
        .unwrap_or(preferred)
}

fn result_target(source: &Path, update_source: bool) -> Result<(PathBuf, Option<PathBuf>), String> {
    if update_source {
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("data");
        let backup = unique_path(source.with_extension(format!("backup.{extension}")));
        std::fs::copy(source, &backup).map_err(|error| error.to_string())?;
        let temporary = source.with_extension(format!("automation-tmp.{extension}"));
        Ok((temporary, Some(backup)))
    } else {
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("automation");
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("json");
        Ok((
            unique_path(source.with_file_name(format!("{stem}.results.{extension}"))),
            None,
        ))
    }
}

#[tauri::command]
pub async fn write_automation_data_results(
    path: String,
    dataset_index: usize,
    results: Vec<AutomationResultRow>,
    update_source: bool,
) -> Result<String, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_absolute() || !source.is_file() {
        return Err("Data source file does not exist".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (target, backup) = result_target(&source, update_source)?;
    match extension.as_str() {
        "xlsx" => append_xlsx_results(&source, &target, dataset_index, &results)?,
        "csv" | "tsv" => {
            let content = read_text_file(&source)?;
            let delimiter = detected_delimiter(&content, &extension);
            let mut rows = parse_delimited(&content, delimiter)?;
            if rows.is_empty() {
                return Err("Data source has no header row".to_string());
            }
            for value in [
                "Row ID",
                "Automation Status",
                "Automation Error",
                "Started At",
                "Ended At",
            ] {
                rows[0].push(Value::String(value.to_string()));
            }
            for result in &results {
                if let Some(row) = result
                    .source_rows
                    .first()
                    .and_then(|index| rows.get_mut(index + 1))
                {
                    row.extend(result_values(result).into_iter().map(Value::String));
                }
            }
            let rendered = rows
                .into_iter()
                .map(|row| {
                    row.into_iter()
                        .map(|value| {
                            csv_field(value.as_str().unwrap_or(&value.to_string()), delimiter)
                        })
                        .collect::<Vec<_>>()
                        .join(&delimiter.to_string())
                })
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(&target, format!("{rendered}\n")).map_err(|error| error.to_string())?;
        }
        "json" => {
            let mut root: Value = serde_json::from_str(
                &std::fs::read_to_string(&source).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let records = match &mut root {
                Value::Array(records) => records,
                Value::Object(map) => map
                    .values_mut()
                    .filter_map(Value::as_array_mut)
                    .nth(dataset_index)
                    .ok_or_else(|| "Dataset was not found".to_string())?,
                _ => return Err("JSON must contain record arrays".to_string()),
            };
            for result in &results {
                if let Some(object) = result
                    .source_rows
                    .first()
                    .and_then(|index| records.get_mut(*index))
                    .and_then(Value::as_object_mut)
                {
                    let values = result_values(result);
                    for (key, value) in [
                        "_rowId",
                        "_automationStatus",
                        "_automationError",
                        "_startedAt",
                        "_endedAt",
                    ]
                    .into_iter()
                    .zip(values)
                    {
                        object.insert(key.to_string(), Value::String(value));
                    }
                }
            }
            std::fs::write(
                &target,
                serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        }
        _ => return Err("Supported data files: .xlsx, .csv, .tsv, and .json".to_string()),
    }
    if update_source {
        std::fs::rename(&target, &source).map_err(|error| error.to_string())?;
        Ok(format!(
            "{} (backup: {})",
            source.to_string_lossy(),
            backup.unwrap().to_string_lossy()
        ))
    } else {
        Ok(target.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn save_automation_batch_report(path: String, content: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err("Report path must be absolute".to_string());
    }
    match target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "json" | "csv" => std::fs::write(&target, content).map_err(|error| error.to_string())?,
        _ => return Err("Batch report must use .json or .csv".to_string()),
    }
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zip::write::SimpleFileOptions;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn parses_quoted_csv_and_duplicate_headers() {
        let rows = parse_delimited("Code,Name,Name\n001,\"Hello, world\",A\n", ',').unwrap();
        let data = rows_to_dataset("CSV", rows);
        assert_eq!(data.columns, vec!["Code", "Name", "Name_2"]);
        assert_eq!(data.rows[0][1], "Hello, world");
    }

    #[test]
    fn parses_json_arrays_and_nested_named_datasets() {
        let data = parse_json(
            r#"{"branches":[{"id":"001","active":true}],"users":[{"email":"a@b.com"}]}"#,
        )
        .unwrap();
        assert_eq!(data.len(), 2);
        assert!(data.iter().any(|dataset| dataset.name == "branches"));
        assert!(data.iter().any(|dataset| dataset.name == "users"));
    }

    #[test]
    fn parses_xlsx_sheets_shared_strings_numbers_and_booleans() {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "automation-data-{}-{sequence}.xlsx",
            std::process::id()
        ));
        let file = File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        writer.start_file("xl/workbook.xml", options).unwrap();
        writer
            .write_all(
                br#"<workbook><sheets><sheet name="Branches" sheetId="1"/></sheets></workbook>"#,
            )
            .unwrap();
        writer.start_file("xl/sharedStrings.xml", options).unwrap();
        writer.write_all(r#"<sst><si><t>Code</t></si><si><t>Name</t></si><si><t>WX0007</t></si><si><t>หมู่บ้านบัวทอง</t></si></sst>"#.as_bytes()).unwrap();
        writer
            .start_file("xl/worksheets/sheet1.xml", options)
            .unwrap();
        writer.write_all(br#"<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Active</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="b"><v>1</v></c></row></sheetData></worksheet>"#).unwrap();
        writer.finish().unwrap();

        let datasets = parse_xlsx(&path).unwrap();
        let _ = std::fs::remove_file(path);
        assert_eq!(datasets.len(), 1);
        assert_eq!(datasets[0].name, "Branches");
        assert_eq!(datasets[0].columns, vec!["Code", "Name", "Active"]);
        assert_eq!(
            datasets[0].rows[0],
            vec![
                Value::String("WX0007".to_string()),
                Value::String("หมู่บ้านบัวทอง".to_string()),
                Value::Bool(true)
            ]
        );
    }

    #[test]
    fn detects_semicolon_csv_and_utf16_text() {
        assert_eq!(detected_delimiter("Code;Name\n1;A", "csv"), ';');
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "automation-data-{}-{sequence}.csv",
            std::process::id()
        ));
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "Code;Name\n001;A\n".encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(read_text_file(&path).unwrap(), "Code;Name\n001;A\n");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn appends_xlsx_results_without_rewriting_existing_formula_cells() {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let source = std::env::temp_dir().join(format!(
            "automation-result-source-{}-{sequence}.xlsx",
            std::process::id()
        ));
        let target = std::env::temp_dir().join(format!(
            "automation-result-target-{}-{sequence}.xlsx",
            std::process::id()
        ));
        let file = File::create(&source).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("xl/worksheets/sheet1.xml", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(br#"<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Value</t></is></c><c r="B1" t="inlineStr"><is><t>Total</t></is></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2"><f>A2*2</f><v>4</v></c></row></sheetData></worksheet>"#).unwrap();
        writer.finish().unwrap();
        append_xlsx_results(
            &source,
            &target,
            0,
            &[AutomationResultRow {
                row_id: "1".to_string(),
                status: "passed".to_string(),
                error: None,
                started_at: None,
                ended_at: None,
                source_rows: vec![0],
            }],
        )
        .unwrap();
        let mut archive = ZipArchive::new(File::open(&target).unwrap()).unwrap();
        let xml = read_zip_text(&mut archive, "xl/worksheets/sheet1.xml").unwrap();
        assert!(xml.contains("<f>A2*2</f>"));
        assert!(xml.contains("Automation Status"));
        assert!(xml.contains("passed"));
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(target);
    }
}
