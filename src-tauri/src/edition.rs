//! The two editions keep their data in separate folders (their identifiers differ, so both can be installed).
//! When Studio starts for the first time on a computer that already has the free edition, it takes a copy of
//! that edition's data, so the user's sets, attempts and notes are there after the upgrade. The free edition's
//! folder is left as it was.

use std::fs;
use std::path::Path;

use tauri::{AppHandle, Manager};

/// Folders that are not the user's data: the webview's own cache and a half-finished restore.
const SKIP: [&str; 3] = ["EBWebView", "restore-staging", "restore-pending"];

/// In Studio, copies the free edition's data into Studio's folders when Studio has no database yet.
/// The SQL plugin keeps the database in the config folder and the app keeps media in the data folder; on Windows
/// these are the same folder, elsewhere both are copied.
pub fn adopt_reader_data(app: &AppHandle, db: &str) -> Result<bool, String> {
    let id = &app.config().identifier;
    let Some(base) = id.strip_suffix(".studio") else { return Ok(false) };
    let reader_of = |dir: &Path| dir.parent().map(|p| p.join(format!("{base}.app")));
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let Some(reader_config) = reader_of(&config) else { return Ok(false) };
    if !adopt(&reader_config, &config, db)? {
        return Ok(false);
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if data != config {
        if let Some(reader_data) = reader_of(&data).filter(|d| d.is_dir()) {
            fs::create_dir_all(&data).map_err(|e| e.to_string())?;
            copy_dir(&reader_data, &data)?;
        }
    }
    Ok(true)
}

fn adopt(reader: &Path, studio: &Path, db: &str) -> Result<bool, String> {
    if studio.join(db).exists() || !reader.join(db).is_file() {
        return Ok(false);
    }
    fs::create_dir_all(studio).map_err(|e| e.to_string())?;
    copy_dir(reader, studio)?;
    Ok(true)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    for e in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name();
        if SKIP.iter().any(|s| name == *s) {
            continue;
        }
        let target = to.join(&name);
        let path = e.path();
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            copy_dir(&path, &target)?;
        } else if !target.exists() {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("edition-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn studio_takes_a_copy_of_the_free_editions_data_once() {
        let root = temp("adopt");
        let (reader, studio) = (root.join("com.x.app"), root.join("com.x.studio"));
        fs::create_dir_all(reader.join("media/a")).unwrap();
        fs::create_dir_all(reader.join("EBWebView")).unwrap();
        fs::write(reader.join("x.db"), b"reader").unwrap();
        fs::write(reader.join("x.db-wal"), b"wal").unwrap();
        fs::write(reader.join("media/a/1.mp3"), b"mp3").unwrap();

        assert!(adopt(&reader, &studio, "x.db").unwrap());
        assert_eq!(fs::read(studio.join("x.db")).unwrap(), b"reader");
        assert_eq!(fs::read(studio.join("x.db-wal")).unwrap(), b"wal");
        assert_eq!(fs::read(studio.join("media/a/1.mp3")).unwrap(), b"mp3");
        assert!(!studio.join("EBWebView").exists());
        assert!(reader.join("x.db").exists(), "the free edition keeps its own data");

        // Studio has its own database now; later starts leave it alone.
        fs::write(studio.join("x.db"), b"studio").unwrap();
        assert!(!adopt(&reader, &studio, "x.db").unwrap());
        assert_eq!(fs::read(studio.join("x.db")).unwrap(), b"studio");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_to_take_without_the_free_edition() {
        let root = temp("none");
        assert!(!adopt(&root.join("com.x.app"), &root.join("com.x.studio"), "x.db").unwrap());
        assert!(!root.join("com.x.studio").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
