//! sqlx records a SHA-384 of each migration's SQL and will not open a database whose record differs from the build's
//! ("migration was previously applied but has been modified"). lib.rs pins the SQL to CRLF, as a Windows checkout and
//! the release builds have it, but a build made from a copied or downloaded folder had LF, and the databases it made
//! recorded the LF checksums: every later build refused them, and the app opened with nothing in it. Before a database
//! is opened (at start, and when a backup is staged for restore), a recorded checksum that is this build's migration
//! with the other line endings is rewritten to this build's. Any other difference is left for sqlx and the restore
//! check to refuse.

use std::path::Path;
use std::sync::OnceLock;

use sha2::{Digest, Sha384};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use tauri_plugin_sql::Migration;

/// Per migration: its version, the checksum this build records, and the one the other line endings give.
struct Sums {
    version: i64,
    ours: Vec<u8>,
    other: Vec<u8>,
}

static PINNED: OnceLock<Vec<Sums>> = OnceLock::new();

fn sums_of(migrations: &[Migration]) -> Vec<Sums> {
    migrations
        .iter()
        .map(|m| {
            let lf = m.sql.replace("\r\n", "\n");
            let crlf = lf.replace('\n', "\r\n");
            let other = if m.sql.contains("\r\n") { lf } else { crlf };
            Sums { version: m.version, ours: Sha384::digest(m.sql.as_bytes()).to_vec(), other: Sha384::digest(other.as_bytes()).to_vec() }
        })
        .collect()
}

/// Records this build's migrations; lib.rs calls it once, before any database is repaired.
pub fn pin(migrations: &[Migration]) {
    let _ = PINNED.set(sums_of(migrations));
}

/// Rewrites the checksums `db` recorded with the other line endings; returns how many. A missing file or a database
/// without migrations (not made by this app) is left alone.
pub async fn repair(db: &Path) -> Result<u64, String> {
    repair_with(db, PINNED.get().map(Vec::as_slice).unwrap_or_default()).await
}

async fn repair_with(db: &Path, sums: &[Sums]) -> Result<u64, String> {
    if !db.is_file() || sums.is_empty() {
        return Ok(0);
    }
    let opts = SqliteConnectOptions::new().filename(db).create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&opts).await.map_err(|e| e.to_string())?;
    let has_table: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut fixed = 0;
    if has_table > 0 {
        for s in sums {
            fixed += sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ? AND checksum = ?")
                .bind(&s.ours)
                .bind(s.version)
                .bind(&s.other)
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?
                .rows_affected();
        }
    }
    conn.close().await.map_err(|e| e.to_string())?;
    Ok(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_sql::MigrationKind;

    const SQL: &str = "CREATE TABLE a (x INTEGER);\r\nCREATE TABLE b (y TEXT);\r\n";

    fn migrations() -> Vec<Migration> {
        vec![
            Migration { version: 1, description: "one", sql: SQL, kind: MigrationKind::Up },
            Migration { version: 2, description: "two", sql: "CREATE TABLE c (z INTEGER);\r\n", kind: MigrationKind::Up },
        ]
    }

    fn sha(s: &str) -> Vec<u8> {
        Sha384::digest(s.as_bytes()).to_vec()
    }

    /// A database with `_sqlx_migrations` holding these (version, checksum) rows, made in a fresh temporary folder.
    async fn db_with(name: &str, rows: &[(i64, Vec<u8>)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-checksums-{name}-{}", crate::brand::PREFIX, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let opts = SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&opts).await.unwrap();
        sqlx::query("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)")
            .execute(&mut conn)
            .await
            .unwrap();
        for (v, ck) in rows {
            sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, 'm', 1, ?, 0)")
                .bind(v)
                .bind(ck)
                .execute(&mut conn)
                .await
                .unwrap();
        }
        conn.close().await.unwrap();
        path
    }

    async fn recorded(path: &Path) -> Vec<(i64, Vec<u8>)> {
        let opts = SqliteConnectOptions::new().filename(path);
        let mut conn = SqliteConnection::connect_with(&opts).await.unwrap();
        let rows = sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&mut conn).await.unwrap();
        conn.close().await.unwrap();
        rows
    }

    #[test]
    fn an_lf_checksum_becomes_this_builds_and_others_stay() {
        tauri::async_runtime::block_on(async {
            let lf = SQL.replace("\r\n", "\n");
            let path = db_with("lf", &[(1, sha(&lf)), (2, vec![7; 48])]).await;
            assert_eq!(repair_with(&path, &sums_of(&migrations())).await.unwrap(), 1);
            // Migration 2's record is neither form of this build's SQL, so sqlx still refuses it.
            assert_eq!(recorded(&path).await, vec![(1, sha(SQL)), (2, vec![7; 48])]);
            // Already this build's: nothing to do.
            assert_eq!(repair_with(&path, &sums_of(&migrations())).await.unwrap(), 0);
        });
    }

    #[test]
    fn a_build_pinned_to_lf_takes_crlf_records_too() {
        tauri::async_runtime::block_on(async {
            let lf = SQL.replace("\r\n", "\n");
            let ours = vec![Migration { version: 1, description: "one", sql: Box::leak(lf.clone().into_boxed_str()), kind: MigrationKind::Up }];
            let path = db_with("crlf", &[(1, sha(SQL))]).await;
            assert_eq!(repair_with(&path, &sums_of(&ours)).await.unwrap(), 1);
            assert_eq!(recorded(&path).await, vec![(1, sha(&lf))]);
        });
    }

    #[test]
    fn a_missing_file_or_a_database_without_migrations_is_left_alone() {
        tauri::async_runtime::block_on(async {
            let sums = sums_of(&migrations());
            let missing = std::env::temp_dir().join(format!("{}-checksums-none-{}.db", crate::brand::PREFIX, std::process::id()));
            assert_eq!(repair_with(&missing, &sums).await.unwrap(), 0);
            assert!(!missing.exists());
            let path = db_with("bare", &[]).await;
            let opts = SqliteConnectOptions::new().filename(&path);
            let mut conn = SqliteConnection::connect_with(&opts).await.unwrap();
            sqlx::query("DROP TABLE _sqlx_migrations").execute(&mut conn).await.unwrap();
            conn.close().await.unwrap();
            assert_eq!(repair_with(&path, &sums).await.unwrap(), 0);
        });
    }
}
