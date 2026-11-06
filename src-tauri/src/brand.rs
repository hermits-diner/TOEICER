//! What makes this app moduTOEIC rather than its siblings built on the same code. The modules shared by all of them
//! (listed in core.json) take their app-specific names from here; src/lib/brand.ts is the webview's counterpart.

/// The name in backup manifests and messages.
pub const APP_NAME: &str = "moduTOEIC";
/// The database file in the app data folder.
pub const DB_FILE: &str = "toeic.db";
/// The default backup folder, under Documents.
pub const BACKUP_FOLDER: &str = "moduTOEIC 백업";
/// What that folder was called before the app had this name; it is renamed once, so the backups stay together.
pub const OLD_BACKUP_FOLDER: &str = "TOEICER 백업";
/// Prefix of the app's temporary folders and probe files.
pub const PREFIX: &str = "toeicer";
