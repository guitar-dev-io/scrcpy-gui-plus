use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

const MAX_DATA_BYTES: u64 = 25 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;

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

fn parse_json(content: &str) -> Result<Vec<AutomationDataset>, String> {
    let root: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    let groups: Vec<(String, Vec<Value>)> = match root {
        Value::Array(rows) => vec![("JSON".to_string(), rows)],
        Value::Object(map) => map
            .into_iter()
            .filter_map(|(name, value)| value.as_array().cloned().map(|rows| (name, rows)))
            .collect(),
        _ => {
            return Err(
                "JSON must be an array of records or an object containing arrays".to_string(),
            )
        }
    };
    if groups.is_empty() {
        return Err("JSON contains no record arrays".to_string());
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
                    .ok_or_else(|| "JSON records must be objects".to_string())?;
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

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut file = archive.by_name(name).map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    Ok(text)
}

fn xml_text_values(xml: &str, element: &[u8]) -> Vec<String> {
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
            Ok(Event::Text(text)) if inside => current.push_str(&text.decode().unwrap_or_default()),
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
            Ok(Event::Start(event)) if event.local_name().as_ref() == b"row" => row = vec![],
            Ok(Event::Start(event)) if event.local_name().as_ref() == b"c" => {
                cell_ref.clear();
                cell_type.clear();
                cell_value.clear();
                for attribute in event.attributes().flatten() {
                    if attribute.key.local_name().as_ref() == b"r" {
                        cell_ref = attribute
                            .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                            .unwrap_or_default()
                            .to_string();
                    }
                    if attribute.key.local_name().as_ref() == b"t" {
                        cell_type = attribute
                            .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                            .unwrap_or_default()
                            .to_string();
                    }
                }
            }
            Ok(Event::Start(event)) if matches!(event.local_name().as_ref(), b"v" | b"t") => {
                in_value = true
            }
            Ok(Event::End(event)) if matches!(event.local_name().as_ref(), b"v" | b"t") => {
                in_value = false
            }
            Ok(Event::Text(text)) if in_value => {
                cell_value.push_str(&text.decode().unwrap_or_default())
            }
            Ok(Event::End(event)) if event.local_name().as_ref() == b"c" => {
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
            Ok(Event::End(event)) if event.local_name().as_ref() == b"row" => {
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
        .map(|xml| xml_text_values(&xml, b"si"))
        .unwrap_or_default();
    let workbook = read_zip_text(&mut archive, "xl/workbook.xml")?;
    let names = {
        let mut reader = Reader::from_str(&workbook);
        let mut result = vec![];
        loop {
            match reader.read_event() {
                Ok(Event::Empty(event)) if event.local_name().as_ref() == b"sheet" => {
                    for attribute in event.attributes().flatten() {
                        if attribute.key.local_name().as_ref() == b"name" {
                            result.push(
                                attribute
                                    .decoded_and_normalized_value(
                                        XmlVersion::Implicit1_0,
                                        reader.decoder(),
                                    )
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
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let datasets = match extension.as_str() {
        "xlsx" => parse_xlsx(&target)?,
        "csv" | "tsv" => {
            let content = std::fs::read_to_string(&target).map_err(|error| error.to_string())?;
            vec![rows_to_dataset(
                target
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Data"),
                parse_delimited(&content, if extension == "tsv" { '\t' } else { ',' })?,
            )]
        }
        "json" => {
            parse_json(&std::fs::read_to_string(&target).map_err(|error| error.to_string())?)?
        }
        _ => return Err("Supported data files: .xlsx, .csv, .tsv, and .json".to_string()),
    };
    Ok(AutomationDataSource {
        path: target.to_string_lossy().to_string(),
        format: extension,
        datasets,
    })
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
}
