import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { getSetting, setSetting } from "./appSettings";
import { getDb } from "./db";
import { BRAND } from "./brand";

/**
 * Highest migration this build knows (src-tauri/src/lib.rs). A backup from a newer build cannot be opened here; an
 * older one can, and the SQL plugin brings it up to date when the app restarts into it.
 */
export const MAX_MIGRATION = 2;

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  modified: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d = new Date()) => `${day(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** The backup folder the user chose (OneDrive, USB, …), or null for the default Documents/<app> 백업. */
const chosenDir = () => getSetting("backup_dir");

export interface BackupLocation {
  path: string;
  custom: boolean;
  /** The chosen folder cannot be written to right now (e.g. the USB drive is unplugged); the default is used. */
  fallback: boolean;
  defaultPath: string;
}

export const backupLocation = async () => invoke<BackupLocation>("backup_location", { dir: await chosenDir() });
export const oneDriveDir = () => invoke<string | null>("backup_onedrive_dir");

/** Saves a new backup folder (null restores the default) and backs up into it straight away. */
export async function setBackupDir(dir: string | null): Promise<void> {
  if (dir) await invoke("backup_check_dir", { path: dir });
  await setSetting("backup_dir", dir);
  await autoBackupIfDue(true);
}

/** A consistent copy of the live database, written by SQLite itself while the app keeps running. */
async function snapshot(name: string): Promise<string> {
  const path = await invoke<string>("backup_snapshot_path", { name, dir: await chosenDir() });
  const db = await getDb();
  await db.execute("VACUUM INTO $1", [path]);
  return path;
}

export const listAutoBackups = async () => invoke<BackupInfo[]>("backup_list_auto", { dir: await chosenDir() });

/**
 * Once a day (or whenever `force` is set): copy the database to auto-YYYY-MM-DD.db in the backup folder and keep
 * the newest seven.
 */
export async function autoBackupIfDue(force = false): Promise<boolean> {
  const dir = await chosenDir();
  const name = `auto-${day()}.db`;
  const existing = await listAutoBackups();
  if (!force && existing.some((b) => b.name === name)) return false;
  await snapshot(name);
  await invoke("backup_prune_auto", { dir });
  return true;
}

export const defaultBackupName = () => `${BRAND.appName}-백업-${day()}.zip`;

/** Writes everything into one zip at `dest`. */
export async function createBackupFile(dest: string): Promise<BackupInfo> {
  const snap = await snapshot(`manual-${stamp()}.db`);
  return invoke<BackupInfo>("backup_write_zip", { snapshot: snap, dest });
}

export interface RestorePreview {
  tests: number;
  attempts: number;
}

/** A migration as sqlx records it: its version and the SHA-384 of its SQL, in hex. */
export interface MigrationSum {
  version: number;
  checksum: string;
}

export const FOREIGN_BACKUP = "다른 앱(또는 다른 버전)의 백업이라 복원할 수 없습니다.";

/**
 * Whether every migration a database recorded is one of this build's, with the same checksum. sqlx refuses to open a
 * database whose recorded checksum differs, so restoring one (another app's backup with the same table names, or a
 * build whose migration changed) would leave every screen failing after the restart. Fewer migrations are fine: the
 * next start runs the missing ones. None at all is not a database this app made (it records migration 1 on creation).
 */
export function matchesMigrations(applied: MigrationSum[], expected: MigrationSum[]): boolean {
  const pinned = new Map(expected.map((m) => [m.version, m.checksum.toLowerCase()]));
  return applied.length > 0 && applied.every((m) => pinned.get(m.version) === m.checksum.toLowerCase());
}

/** Unpacks a backup to the staging folder and reads it, without touching the live data. */
export async function prepareRestore(source: string): Promise<RestorePreview> {
  const staged = await invoke<string>("restore_prepare", { source });
  let db: Database | null = null;
  try {
    db = await Database.load(`sqlite:${staged}`);
    const applied = await db.select<MigrationSum[]>("SELECT version, lower(hex(checksum)) AS checksum FROM _sqlx_migrations ORDER BY version");
    if (applied.some((m) => m.version > MAX_MIGRATION)) throw new Error("더 새로운 버전의 앱에서 만든 백업입니다. 앱을 먼저 업데이트해 주십시오.");
    if (!matchesMigrations(applied, await invoke<MigrationSum[]>("migration_checksums"))) throw new Error(FOREIGN_BACKUP);
    const count = async (sql: string) => (await db!.select<{ n: number }[]>(sql))[0]?.n ?? 0;
    const tests = await count("SELECT COUNT(*) AS n FROM test");
    const attempts = await count("SELECT COUNT(*) AS n FROM attempt");
    return { tests, attempts };
  } catch (e) {
    await db?.close().catch(() => {});
    db = null;
    await invoke("restore_cancel");
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("no such table: _sqlx_migrations")) throw new Error(FOREIGN_BACKUP);
    throw new Error(msg.includes("no such table") ? `${BRAND.appName} 앱의 백업이 아닙니다.` : msg);
  } finally {
    await db?.close().catch(() => {});
  }
}

export const cancelRestore = () => invoke<void>("restore_cancel");

/** Saves the current data as backups/before-restore-….db, then restarts into the staged backup. */
export async function commitRestore(): Promise<void> {
  await snapshot(`before-restore-${stamp()}.db`);
  await invoke("restore_commit");
}
