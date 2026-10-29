//! Set files (.toic): a zip holding manifest.json, test.json (the import form of one Listening or Reading set) and
//! media/<archive name> for its recordings and Part 1 photographs. Media keep the archive's content-hash names, so a
//! set imported on another PC lands under the same names and the same file is never stored twice. On import, every
//! media file's hash is checked against its name, so a file cannot plant different bytes under an existing name.
//! Files from earlier versions (.toeicset, format 1 or 2) still open; their tests/N.json are read in order.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::media::{hashed_name, parse_media_name, raw_dir};

/// Bumped when the layout changes in a way older apps cannot read.
pub const FORMAT: u64 = 3;
const MAX_TEXT: usize = 8 * 1024 * 1024;
const MAX_MEDIA: usize = 100 * 1024 * 1024;
const MAX_ENTRIES: usize = 300;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    dest: String,
    manifest: Value,
    /// The test, already serialized by the app.
    test: String,
    /// Archive names of the recordings and pictures the test refers to.
    media: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    manifest: Value,
    /// The tests in file order: one in this format, possibly several in a format-2 file.
    tests: Vec<String>,
    /// Media now present in the archive.
    media: Vec<String>,
}

/// Writes the set file; returns its size in bytes.
pub(crate) fn write_package(raw: &Path, dest: &Path, manifest: &Value, test: &str, media: &[String]) -> Result<u64, String> {
    let w = |e: zip::result::ZipError| format!("세트 파일을 쓰지 못했습니다: {e}");
    let io = |e: std::io::Error| format!("세트 파일을 쓰지 못했습니다: {e}");
    for name in media {
        if parse_media_name(name).is_none() {
            return Err(format!("보관된 파일 이름이 아닙니다: {name}"));
        }
        if !raw.join(name).is_file() {
            return Err(format!("보관함에 없는 파일입니다: {name}"));
        }
    }
    let tmp = dest.with_extension("part");
    let file = fs::File::create(&tmp).map_err(io)?;
    let mut zip = zip::ZipWriter::new(file);
    let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    // Recordings and pictures are already compressed; storing them is as small and much faster.
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("manifest.json", deflate).map_err(w)?;
    zip.write_all(serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(io)?;
    zip.start_file("test.json", deflate).map_err(w)?;
    zip.write_all(test.as_bytes()).map_err(io)?;
    for name in media {
        zip.start_file(format!("media/{name}"), stored).map_err(w)?;
        zip.write_all(&fs::read(raw.join(name)).map_err(io)?).map_err(io)?;
    }
    zip.finish().map_err(w)?;
    fs::rename(&tmp, dest).map_err(io)?;
    Ok(fs::metadata(dest).map(|m| m.len()).unwrap_or(0))
}

/// Reads a set file and puts its media into the archive. Files a newer format may add are ignored.
pub(crate) fn read_package(raw: &Path, path: &Path) -> Result<ReadResult, String> {
    let bad = |e: zip::result::ZipError| format!("세트 파일을 읽지 못했습니다: {e}");
    let file = fs::File::open(path).map_err(|e| format!("세트 파일을 열 수 없습니다: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "TOEICER 세트 파일이 아닙니다.".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("세트 파일 안에 파일이 너무 많습니다.".into());
    }
    let mut manifest = None;
    let mut tests: Vec<(u32, String)> = Vec::new();
    let mut media = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(bad)?;
        let name = entry.name().to_string();
        let limit = if name.starts_with("media/") { MAX_MEDIA } else { MAX_TEXT };
        if entry.size() as usize > limit {
            return Err(format!("세트 파일 안의 {name}이(가) 너무 큽니다."));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        match name.as_str() {
            "manifest.json" => {
                let v: Value = serde_json::from_slice(&bytes).map_err(|_| "manifest.json이 올바르지 않습니다.".to_string())?;
                if !matches!(v.get("format").and_then(Value::as_u64), Some(1..=FORMAT)) {
                    return Err("이 앱이 모르는 세트 파일 형식입니다. 앱을 업데이트해 주십시오.".into());
                }
                manifest = Some(v);
            }
            "test.json" => {
                tests.push((0, String::from_utf8(bytes).map_err(|_| "test.json이 올바르지 않습니다.".to_string())?));
            }
            n if n.starts_with("tests/") && n.ends_with(".json") => {
                let num: u32 = n["tests/".len()..n.len() - ".json".len()].parse().map_err(|_| format!("세트 파일 안의 이름이 올바르지 않습니다: {n}"))?;
                tests.push((num, String::from_utf8(bytes).map_err(|_| format!("{n}이(가) 올바르지 않습니다."))?));
            }
            n if n.starts_with("media/") => {
                let file_name = &n["media/".len()..];
                let (prefix, _, ext) = parse_media_name(file_name).ok_or_else(|| format!("세트 파일 안의 이름이 올바르지 않습니다: {n}"))?;
                if hashed_name(prefix, &bytes, ext) != file_name {
                    return Err(format!("세트 파일 안의 {file_name}이(가) 손상되었거나 바뀌었습니다."));
                }
                let target = raw.join(file_name);
                if !target.exists() {
                    fs::write(&target, &bytes).map_err(|e| format!("파일을 보관하지 못했습니다: {e}"))?;
                }
                media.push(file_name.to_string());
            }
            _ => {}
        }
    }
    Ok(ReadResult {
        manifest: manifest.ok_or("세트 파일에 manifest.json이 없습니다.")?,
        tests: {
            if tests.is_empty() {
                return Err("세트 파일에 시험 내용이 없습니다.".into());
            }
            tests.sort_by_key(|t| t.0);
            tests.into_iter().map(|t| t.1).collect()
        },
        media,
    })
}

/// Writes a CSV export where the user chose in the save dialog; UTF-8 with a byte-order mark so Excel reads Korean.
/// Only an absolute `.csv` path is accepted, so the command cannot be turned into a general file writer.
#[tauri::command]
pub async fn write_text(dest: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(&dest);
    if !path.is_absolute() || path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("csv")) != Some(true) {
        return Err("CSV 파일의 전체 경로만 쓸 수 있습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(text.as_bytes());
        fs::write(&path, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn package_write(app: AppHandle, req: WriteRequest) -> Result<u64, String> {
    let raw = raw_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_package(&raw, Path::new(&req.dest), &req.manifest, &req.test, &req.media))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn package_read(app: AppHandle, path: String) -> Result<ReadResult, String> {
    let raw = raw_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_package(&raw, Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_refuses_tampered_media() {
        let dir = std::env::temp_dir().join(format!("toeicer-pkg-{}", std::process::id()));
        let raw = dir.join("raw");
        fs::create_dir_all(&raw).unwrap();
        let png = b"\x89PNG\r\n\x1a\nnot really a picture".to_vec();
        let name = hashed_name("img", &png, "png");
        fs::write(raw.join(&name), &png).unwrap();

        let dest = dir.join("t.toic");
        let test = r#"{"title":"T"}"#;
        let size = write_package(&raw, &dest, &serde_json::json!({ "format": 3, "title": "T" }), test, &[name.clone()]).unwrap();
        assert!(size > 0 && dest.is_file() && !dir.join("t.part").exists());

        let raw2 = dir.join("raw2");
        fs::create_dir_all(&raw2).unwrap();
        let r = read_package(&raw2, &dest).unwrap();
        assert_eq!((r.media.as_slice(), r.tests.as_slice()), ([name.clone()].as_slice(), [test.to_string()].as_slice()));
        assert_eq!(fs::read(raw2.join(&name)).unwrap(), png);

        let bad = dir.join("bad.toic");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&bad).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("manifest.json", o).unwrap();
            z.write_all(br#"{"format":1}"#).unwrap();
            z.start_file("test.json", o).unwrap();
            z.write_all(b"{}").unwrap();
            z.start_file(format!("media/{name}"), o).unwrap();
            z.write_all(b"different bytes under the same name").unwrap();
            z.finish().unwrap();
        }
        assert!(read_package(&raw2, &bad).unwrap_err().contains("손상"));
        assert!(write_package(&raw, &dir.join("x.toic"), &serde_json::json!({}), "{}", &["../secret.png".to_string()]).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_older_files_and_refuses_unknown_formats() {
        let dir = std::env::temp_dir().join(format!("toeicer-pkg-old-{}", std::process::id()));
        let raw = dir.join("raw");
        fs::create_dir_all(&raw).unwrap();
        let old = dir.join("old.toeicset");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&old).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("manifest.json", o).unwrap();
            z.write_all(br#"{"format":2}"#).unwrap();
            z.start_file("tests/2.json", o).unwrap();
            z.write_all(b"{\"n\":2}").unwrap();
            z.start_file("tests/1.json", o).unwrap();
            z.write_all(b"{\"n\":1}").unwrap();
            z.finish().unwrap();
        }
        assert_eq!(read_package(&raw, &old).unwrap().tests, vec!["{\"n\":1}".to_string(), "{\"n\":2}".to_string()]);
        let future = dir.join("future.toic");
        write_package(&raw, &future, &serde_json::json!({ "format": 9 }), "{}", &[]).unwrap();
        assert!(read_package(&raw, &future).unwrap_err().contains("업데이트"));
        let not_zip = dir.join("plain.toic");
        fs::write(&not_zip, b"not a zip").unwrap();
        assert!(read_package(&raw, &not_zip).unwrap_err().contains("세트 파일이 아닙니다"));
        fs::remove_dir_all(&dir).ok();
    }
}
