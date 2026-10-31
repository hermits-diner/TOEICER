mod ai;
mod backup;
mod cli;
mod edition;
mod media;
mod mp3;
mod package;
mod web;

use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:toeic.db";
/// Set files the app opens by double-click; ".toeicset" is the earlier name.
const SET_EXTS: [&str; 2] = ["toic", "toeicset"];

fn migrations() -> Vec<Migration> {
    // sqlx refuses a database whose recorded checksum differs from these exact bytes, and a git checkout on
    // Windows turns LF into CRLF: pin CRLF (what installed databases recorded) so the checkout can't decide.
    // A migration that has shipped is never edited; a schema change is a new file with the next version.
    let crlf = |sql: &str| -> &'static str { Box::leak(sql.replace("\r\n", "\n").replace('\n', "\r\n").into_boxed_str()) };
    vec![
        Migration {
            version: 1,
            description: "schema",
            sql: crlf(include_str!("../migrations/001_schema.sql")),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "practice_draft",
            sql: crlf(include_str!("../migrations/002_practice_draft.sql")),
            kind: MigrationKind::Up,
        },
    ]
}

/// Set files named on the command line (a double-click in Explorer passes the file's path).
fn set_files(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| {
            std::path::Path::new(a)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| SET_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
        })
        .collect()
}

/// Set files the app was started with, handed to the page once it asks.
struct Opened(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(state: tauri::State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (another double-clicked set file) hands its files to the open window instead.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files = set_files(args);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if !files.is_empty() {
                let _ = app.emit("open-set-files", files);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations(DB_URL, migrations()).build())
        .manage(ai::AiState::new())
        .manage(web::WebState::new())
        .manage(Opened(Mutex::new(set_files(std::env::args()))))
        .invoke_handler(tauri::generate_handler![
            ai::ai_cli_status,
            ai::ai_complete,
            ai::ai_delete_key,
            ai::ai_image,
            ai::ai_key_status,
            ai::ai_list_models,
            ai::ai_set_key,
            ai::ai_tts,
            backup::backup_check_dir,
            backup::backup_list_auto,
            backup::backup_location,
            backup::backup_onedrive_dir,
            backup::backup_prune_auto,
            backup::backup_snapshot_path,
            backup::backup_write_zip,
            backup::restore_cancel,
            backup::restore_commit,
            backup::restore_prepare,
            cli::ai_cancel_job,
            cli::ai_end_job,
            media::archive_sample_audio,
            media::archive_sample_image,
            media::read_audio,
            media::read_image,
            mp3::save_audio_as,
            web::extract_pdf_bytes,
            web::fetch_page,
            package::package_read,
            package::package_write,
            package::write_text,
            take_opened_files
        ])
        .setup(|app| {
            // Studio's first start on a computer with the free edition: bring the user's data across.
            if let Err(e) = edition::adopt_reader_data(app.handle(), DB_URL.trim_start_matches("sqlite:")) {
                eprintln!("could not copy the free edition's data: {e}");
            }
            // Swap in a restored database before the webview gets a chance to open the current one.
            if let Err(e) = backup::apply_pending_restore(app.handle()) {
                eprintln!("restore failed: {e}");
            }
            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    // Windows 11 Mica; falls back silently on older builds.
                    let _ = window_vibrancy::apply_mica(&window, None);
                }
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            // The process exits right after this without dropping running tasks; end the generation CLIs first.
            if let tauri::RunEvent::Exit = event {
                cli::end_all_jobs();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_keep_the_checksums_installed_databases_recorded() {
        use sha2::{Digest, Sha384};
        let sums: Vec<(i64, String)> = migrations()
            .iter()
            .map(|m| (m.version, Sha384::digest(m.sql.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()))
            .collect();
        // Never change these: a database that recorded another checksum refuses to open. Add a migration instead.
        let pinned = [
            (1, "6a351c3d9d40fe669e75a0345b16e6dd3ca6d0efb32030c8647bda8f460dcf8bac013be17e96ea8e15d2b52ba4d3ebab"),
            (2, "3941775c3aa9434b5db96783ad79b98b65c69dbfa6267edcc183e432594d3d7d0e2aa920bf2a9ca87161b58805850499"),
        ];
        assert_eq!(sums, pinned.map(|(v, s)| (v, s.to_string())).to_vec());
    }

    #[test]
    fn picks_set_files_from_the_command_line() {
        let args = ["app.exe", "C:\\a\\TOEIC 1회 LC.toic", "--flag", "old.TOEICSET", "notes.txt"].map(String::from);
        assert_eq!(set_files(args), vec!["C:\\a\\TOEIC 1회 LC.toic".to_string(), "old.TOEICSET".to_string()]);
    }
}
