import Database from "@tauri-apps/plugin-sql";

/** The database file; its schema is created by the migrations in src-tauri/migrations. */
export const DB_URL = "sqlite:toeic.db";

let handle: Promise<Database> | null = null;

/** Single shared connection. Migrations run on first load (see src-tauri/src/lib.rs). */
export function getDb(): Promise<Database> {
  handle ??= Database.load(DB_URL);
  return handle;
}

/** Id of a source row by its kind (see 001_schema.sql). */
export async function sourceId(adapter: "sample" | "ai" | "mine" | "shared" | "market"): Promise<number | null> {
  const db = await getDb();
  const [r] = await db.select<{ id: number }[]>("SELECT id FROM source WHERE adapter = $1", [adapter]);
  return r?.id ?? null;
}
