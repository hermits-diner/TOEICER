//! Backup and restore. The webview takes a consistent database snapshot with `VACUUM INTO`
//! (through the SQL plugin, which owns the live connection); this module packs snapshots with
//! the `raw` archive into a zip, keeps the daily automatic copies, and swaps a restored
//! database in at the next start, before anything opens it.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const DB: &str = "toeic.db";
const AUTO_KEEP: usize = 7;
const STAGING: &str = "restore-staging";
const PENDING: &str = "restore-pending";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The default backup folder, Documents/TOEICER 백업. It is outside the app data folder because the uninstaller's
/// "애플리케이션 데이터 삭제하기" removes that folder entirely, and the backups must survive it.
fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().document_dir().map_err(|e| e.to_string())?.join("TOEICER 백업");
    fs::create_dir_all(&d).map_err(|e| format!("백업 폴더를 만들 수 없습니다: {e}"))?;
    // Move copies made by earlier versions, which kept them inside the app data folder.
    let old = data_dir(app)?.join("backups");
    if let Ok(entries) = fs::read_dir(&old) {
        for e in entries.flatten() {
            let target = d.join(e.file_name());
            if !target.exists() {
                let _ = fs::rename(e.path(), &target).or_else(|_| fs::copy(e.path(), &target).map(|_| ()));
            }
        }
        let _ = fs::remove_dir(&old);
    }
    Ok(d)
}

/// Whether files can be written to `dir` (an unplugged USB drive or a signed-out cloud folder cannot).
fn writable(dir: &Path) -> bool {
    let probe = dir.join(".toeicer-write-test");
    let ok = dir.is_dir() && fs::write(&probe, b"ok").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// The folder the user chose (a cloud-synced folder or a USB drive) when it is usable, otherwise the default.
/// The flag is true when a chosen folder could not be used and the default stands in for it.
fn resolve(chosen: Option<&str>, default: impl FnOnce() -> Result<PathBuf, String>) -> Result<(PathBuf, bool), String> {
    match chosen.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) if writable(Path::new(c)) => Ok((PathBuf::from(c), false)),
        Some(_) => Ok((default()?, true)),
        None => Ok((default()?, false)),
    }
}

fn backups_dir(app: &AppHandle, chosen: Option<&str>) -> Result<PathBuf, String> {
    Ok(resolve(chosen, || default_dir(app))?.0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupLocation {
    path: String,
    /// A folder chosen by the user is in use.
    custom: bool,
    /// A folder was chosen but cannot be written to right now, so the default is used instead.
    fallback: bool,
    default_path: String,
}

#[tauri::command]
pub fn backup_location(app: AppHandle, dir: Option<String>) -> Result<BackupLocation, String> {
    let (path, fallback) = resolve(dir.as_deref(), || default_dir(&app))?;
    let default_path = default_dir(&app)?;
    Ok(BackupLocation {
        custom: !fallback && path != default_path,
        path: path.to_string_lossy().into_owned(),
        fallback,
        default_path: default_path.to_string_lossy().into_owned(),
    })
}

/// Checks a folder the user picked (creating it if needed) before it is saved as the backup location.
#[tauri::command]
pub fn backup_check_dir(path: String) -> Result<(), String> {
    let _ = fs::create_dir_all(&path);
    if writable(Path::new(&path)) {
        Ok(())
    } else {
        Err("이 폴더에는 파일을 저장할 수 없습니다. 다른 폴더를 골라 주십시오.".into())
    }
}

/// The local OneDrive folder, when OneDrive is set up, so it can be offered as a backup location.
#[tauri::command]
pub fn backup_onedrive_dir() -> Option<String> {
    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(|v| std::env::var(v).ok())
        .find(|p| Path::new(p).is_dir())
}

fn is_sqlite(path: &Path) -> bool {
    let mut head = [0u8; 16];
    fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut head))
        .is_ok()
        && &head == b"SQLite format 3\0"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    name: String,
    path: String,
    bytes: u64,
    /// Seconds since the Unix epoch.
    modified: u64,
}

fn info(path: &Path) -> Option<BackupInfo> {
    let meta = fs::metadata(path).ok()?;
    Some(BackupInfo {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        bytes: meta.len(),
        modified: meta
            .modified()
            .ok()?
            .duration_since(SystemTime::UNIX_EPOCH)
            .ok()?
            .as_secs(),
    })
}

/// Where the webview should write a `VACUUM INTO` snapshot. The file must not exist yet.
#[tauri::command]
pub fn backup_snapshot_path(app: AppHandle, name: String, dir: Option<String>) -> Result<String, String> {
    if name.contains(['/', '\\']) || !name.ends_with(".db") {
        return Err("잘못된 백업 이름입니다.".into());
    }
    let path = backups_dir(&app, dir.as_deref())?.join(name);
    let _ = fs::remove_file(&path);
    Ok(path.to_string_lossy().into_owned())
}

/// Daily copies, newest first.
#[tauri::command]
pub fn backup_list_auto(app: AppHandle, dir: Option<String>) -> Result<Vec<BackupInfo>, String> {
    let mut list: Vec<BackupInfo> = fs::read_dir(backups_dir(&app, dir.as_deref())?)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("auto-"))
                && p.extension().is_some_and(|x| x == "db")
        })
        .filter_map(|p| info(&p))
        .collect();
    list.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(list)
}

/// Keeps the newest automatic copies and deletes the rest.
#[tauri::command]
pub fn backup_prune_auto(app: AppHandle, dir: Option<String>) -> Result<usize, String> {
    let list = backup_list_auto(app, dir)?;
    let mut removed = 0;
    for old in list.iter().skip(AUTO_KEEP) {
        if fs::remove_file(&old.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Packs a snapshot and the media archive (listening recordings, Part 1 photographs) into `dest`, then deletes the snapshot.
#[tauri::command]
pub async fn backup_write_zip(
    app: AppHandle,
    snapshot: String,
    dest: String,
) -> Result<BackupInfo, String> {
    let snapshot = PathBuf::from(snapshot);
    let raw = data_dir(&app)?.join("raw");
    let dest_path = PathBuf::from(&dest);
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || write_zip(&snapshot, &raw, &dest_path, &version))
        .await
        .map_err(|e| e.to_string())?
}

fn write_zip(
    snapshot: &Path,
    raw: &Path,
    dest_path: &Path,
    version: &str,
) -> Result<BackupInfo, String> {
    if !is_sqlite(snapshot) {
        return Err("데이터베이스 사본을 만들지 못했습니다.".into());
    }
    let tmp = dest_path.with_extension("zip.part");
    let file = fs::File::create(&tmp).map_err(|e| format!("백업 파일을 만들 수 없습니다: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let deflate = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    // Recordings and pictures are already compressed; storing them is as small and much faster.
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let w = |e: zip::result::ZipError| format!("백업 파일을 쓰지 못했습니다: {e}");
    let io = |e: std::io::Error| format!("백업 파일을 쓰지 못했습니다: {e}");

    zip.start_file("manifest.json", deflate).map_err(w)?;
    zip.write_all(format!(r#"{{"app":"TOEICER","version":"{version}","format":1}}"#).as_bytes())
        .map_err(io)?;
    zip.start_file(DB, deflate).map_err(w)?;
    zip.write_all(&fs::read(snapshot).map_err(io)?)
        .map_err(io)?;
    if let Ok(entries) = fs::read_dir(raw) {
        for e in entries.flatten().filter(|e| e.path().is_file()) {
            let name = e.file_name().to_string_lossy().into_owned();
            let compressible =
                name.ends_with(".html") || name.ends_with(".txt") || name.ends_with(".json");
            zip.start_file(
                format!("raw/{name}"),
                if compressible { deflate } else { stored },
            )
            .map_err(w)?;
            zip.write_all(&fs::read(e.path()).map_err(io)?)
                .map_err(io)?;
        }
    }
    zip.finish().map_err(w)?;
    fs::rename(&tmp, dest_path).map_err(io)?;
    let _ = fs::remove_file(snapshot);
    info(dest_path).ok_or_else(|| "백업 파일을 확인하지 못했습니다.".into())
}

/// Unpacks a backup (zip, or a bare .db) into the staging folder and returns the staged database path,
/// which the webview opens read-only to check before committing.
#[tauri::command]
pub async fn restore_prepare(app: AppHandle, source: String) -> Result<String, String> {
    let staging = data_dir(&app)?.join(STAGING);
    tauri::async_runtime::spawn_blocking(move || prepare(&PathBuf::from(source), &staging))
        .await
        .map_err(|e| e.to_string())?
}

fn prepare(src: &Path, staging: &Path) -> Result<String, String> {
    let _ = fs::remove_dir_all(staging);
    fs::create_dir_all(staging.join("raw")).map_err(|e| e.to_string())?;
    let db = staging.join(DB);
    if is_sqlite(src) {
        fs::copy(src, &db).map_err(|e| format!("백업 파일을 복사하지 못했습니다: {e}"))?;
    } else {
        let file = fs::File::open(src).map_err(|e| format!("백업 파일을 열 수 없습니다: {e}"))?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|_| "TOEICER 백업 파일(.zip 또는 .db)이 아닙니다.".to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            // enclosed_name rejects absolute paths and `..` components.
            let Some(rel) = entry.enclosed_name() else {
                continue;
            };
            let target = match rel.to_string_lossy().replace('\\', "/").as_str() {
                n if n == DB => db.clone(),
                n if n.starts_with("raw/") && !n[4..].contains('/') && n.len() > 4 => {
                    staging.join("raw").join(&n[4..])
                }
                _ => continue,
            };
            let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("백업 파일을 풀지 못했습니다: {e}"))?;
        }
    }
    if !is_sqlite(&db) {
        let _ = fs::remove_dir_all(staging);
        return Err("백업 안에 학습 데이터가 없습니다.".into());
    }
    Ok(db.to_string_lossy().into_owned())
}

/// Drops the staged restore (after a failed check or a cancel).
#[tauri::command]
pub fn restore_cancel(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let _ = fs::remove_file(dir.join(PENDING));
    let _ = fs::remove_dir_all(dir.join(STAGING));
    Ok(())
}

/// Marks the staged backup for swapping in and restarts. The webview has already saved a
/// `before-restore` snapshot of the current data.
#[tauri::command]
pub fn restore_commit(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    if !is_sqlite(&dir.join(STAGING).join(DB)) {
        return Err("준비된 복원 데이터가 없습니다.".into());
    }
    fs::write(dir.join(PENDING), b"1").map_err(|e| e.to_string())?;
    app.restart();
}

/// Runs in `setup`, before the webview can open the database.
pub fn apply_pending_restore(app: &AppHandle) -> Result<bool, String> {
    apply_pending(&data_dir(app)?)
}

fn apply_pending(dir: &Path) -> Result<bool, String> {
    if !dir.join(PENDING).exists() {
        return Ok(false);
    }
    let staging = dir.join(STAGING);
    let staged = staging.join(DB);
    if is_sqlite(&staged) {
        for f in [DB, "toeic.db-wal", "toeic.db-shm"] {
            let _ = fs::remove_file(dir.join(f));
        }
        fs::rename(&staged, dir.join(DB)).map_err(|e| e.to_string())?;
        // Archive files are named by content hash, so adding the missing ones is a safe merge.
        let raw = dir.join("raw");
        fs::create_dir_all(&raw).map_err(|e| e.to_string())?;
        if let Ok(entries) = fs::read_dir(staging.join("raw")) {
            for e in entries.flatten() {
                let target = raw.join(e.file_name());
                if !target.exists() {
                    let _ = fs::rename(e.path(), target);
                }
            }
        }
    }
    let _ = fs::remove_dir_all(&staging);
    fs::remove_file(dir.join(PENDING)).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("toeicer-backup-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn fake_db(path: &Path, tag: &str) {
        fs::write(
            path,
            [b"SQLite format 3\0".as_slice(), tag.as_bytes()].concat(),
        )
        .unwrap();
    }

    #[test]
    fn backup_restore_round_trip() {
        let live = tmp("live");
        fs::create_dir_all(live.join("raw")).unwrap();
        fake_db(&live.join(DB), "current");
        fs::write(live.join("raw").join("aaa.mp3"), b"audio").unwrap();

        // Back up: snapshot + raw into a zip; the snapshot is removed afterwards.
        let snap = live.join("snap.db");
        fake_db(&snap, "snapshot");
        let zip_path = live.join("backup.zip");
        let info = write_zip(&snap, &live.join("raw"), &zip_path, "0.8.0").unwrap();
        assert!(info.bytes > 0);
        assert!(!snap.exists());

        // Restore into a different data folder that has other files.
        let other = tmp("other");
        fs::create_dir_all(other.join("raw")).unwrap();
        fake_db(&other.join(DB), "old");
        fs::write(other.join("toeic.db-wal"), b"wal").unwrap();
        fs::write(other.join("raw").join("bbb.png"), b"pic").unwrap();
        let staged = prepare(&zip_path, &other.join(STAGING)).unwrap();
        assert!(staged.ends_with(DB));
        fs::write(other.join(PENDING), b"1").unwrap();
        assert!(apply_pending(&other).unwrap());

        assert!(fs::read(other.join(DB)).unwrap().ends_with(b"snapshot"));
        assert!(!other.join("toeic.db-wal").exists());
        assert_eq!(
            fs::read(other.join("raw").join("aaa.mp3")).unwrap(),
            b"audio"
        );
        assert_eq!(fs::read(other.join("raw").join("bbb.png")).unwrap(), b"pic");
        assert!(!other.join(STAGING).exists() && !other.join(PENDING).exists());
        assert!(!apply_pending(&other).unwrap());
    }

    #[test]
    fn falls_back_to_the_default_folder() {
        let d = tmp("resolve");
        let default = || Ok(PathBuf::from("DEFAULT"));
        assert_eq!(resolve(None, default).unwrap(), (PathBuf::from("DEFAULT"), false));
        assert_eq!(resolve(Some("  "), default).unwrap(), (PathBuf::from("DEFAULT"), false));
        assert_eq!(resolve(Some(d.to_str().unwrap()), default).unwrap(), (d.clone(), false));
        let gone = d.join("unplugged");
        assert_eq!(resolve(Some(gone.to_str().unwrap()), default).unwrap(), (PathBuf::from("DEFAULT"), true));
    }

    #[test]
    fn rejects_non_backups_and_path_tricks() {
        let d = tmp("bad");
        let txt = d.join("notes.zip");
        fs::write(&txt, b"hello").unwrap();
        assert!(prepare(&txt, &d.join(STAGING)).is_err());

        // A zip whose only database entry tries to escape the staging folder.
        let evil = d.join("evil.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
        z.start_file("../toeic.db", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(b"SQLite format 3\0x").unwrap();
        z.finish().unwrap();
        assert!(prepare(&evil, &d.join(STAGING)).is_err());
        assert!(!d.join(DB).exists());
    }
}
