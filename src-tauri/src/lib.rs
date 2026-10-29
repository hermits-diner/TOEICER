mod ai;
mod backup;
mod cli;
mod crawler;
mod mp3;
mod package;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:toeicer.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "group_options",
            sql: include_str!("../migrations/002_group_options.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "crawl_pipeline",
            sql: include_str!("../migrations/003_crawl_pipeline.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .manage(crawler::CrawlerState::new())
        .manage(ai::AiState::new())
        .invoke_handler(tauri::generate_handler![
            ai::ai_audio,
            ai::ai_cli_status,
            ai::ai_complete,
            backup::backup_check_dir,
            backup::backup_list_auto,
            backup::backup_location,
            backup::backup_onedrive_dir,
            backup::backup_prune_auto,
            backup::backup_snapshot_path,
            backup::backup_sync_recordings,
            backup::backup_write_zip,
            backup::restore_cancel,
            backup::restore_commit,
            backup::restore_prepare,
            ai::ai_delete_key,
            ai::ai_key_status,
            ai::ai_list_models,
            ai::ai_set_key,
            ai::ai_tts,
            crawler::crawl_fetch,
            crawler::crawl_robots,
            crawler::extract_pdf_bytes,
            crawler::read_raw,
            crawler::crawl_image,
            crawler::read_image,
            crawler::crawl_audio,
            crawler::read_audio,
            crawler::save_recording,
            crawler::save_image,
            ai::ai_image,
            mp3::audio_to_mp3,
            mp3::save_audio_as,
            package::package_read,
            package::package_write,
            package::write_text
        ])
        .setup(|app| {
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
        .run(|_, _| {});
}
