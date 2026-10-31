import { beforeEach, describe, expect, it, vi } from "vitest";

/** What this build's migrations() records (src-tauri/src/lib.rs pins the same values). */
const PINS = [
  { version: 1, checksum: "6a351c3d9d40fe669e75a0345b16e6dd3ca6d0efb32030c8647bda8f460dcf8bac013be17e96ea8e15d2b52ba4d3ebab" },
  { version: 2, checksum: "3941775c3aa9434b5db96783ad79b98b65c69dbfa6267edcc183e432594d3d7d0e2aa920bf2a9ca87161b58805850499" },
];
// applied === null: the staged database has no _sqlx_migrations table at all.
const h = vi.hoisted(() => ({ applied: [] as { version: number; checksum: string }[] | null, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => h.invoke(...a) }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      // SQLite's hex() is upper case, as the staged database answers.
      select: async (sql: string) => {
        if (!sql.includes("_sqlx_migrations")) return [{ n: 3 }];
        if (h.applied === null) throw new Error("error returned from database: (code: 1) no such table: _sqlx_migrations");
        return h.applied.map((m) => ({ version: m.version, checksum: m.checksum.toUpperCase() }));
      },
      close: async () => {},
    }),
  },
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./appSettings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
const { FOREIGN_BACKUP, MAX_MIGRATION, prepareRestore } = await import("./backup");

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "restore_prepare" ? "C:/staging/toeic.db" : cmd === "migration_checksums" ? PINS : undefined));
});

describe("prepareRestore", () => {
  it("knows every migration this build ships", () => {
    const files = Object.keys(import.meta.glob("../../src-tauri/migrations/*.sql"));
    const highest = Math.max(...files.map((f) => Number(/(\d+)_[^/]*\.sql$/.exec(f)![1])));
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(MAX_MIGRATION).toBe(highest);
    // The app asks lib.rs (migration_checksums) at run time; these test values are its pins.
    const lib = Object.values(import.meta.glob("../../src-tauri/src/lib.rs", { query: "?raw", import: "default", eager: true }))[0] as string;
    for (const p of PINS) expect(lib).toContain(`(${p.version}, "${p.checksum}")`);
    expect(PINS.map((p) => p.version)).toEqual(Array.from({ length: highest }, (_, i) => i + 1));
  });

  it("opens a backup made before the draft table existed; the next start adds it", async () => {
    h.applied = [PINS[0]];
    await expect(prepareRestore("C:/b.zip")).resolves.toEqual({ tests: 3, attempts: 3 });
    expect(h.invoke).not.toHaveBeenCalledWith("restore_cancel");
  });

  it("opens a backup from this version, its checksums checked against this build's", async () => {
    h.applied = [...PINS];
    await expect(prepareRestore("C:/b.zip")).resolves.toEqual({ tests: 3, attempts: 3 });
    expect(h.invoke).toHaveBeenCalledWith("migration_checksums");
  });

  it("refuses another app's backup whose migration 1 recorded another checksum, and clears what it unpacked", async () => {
    // e.g. a sibling app's auto-….db: the same table names, a different schema, so sqlx would refuse it on restart.
    h.applied = [{ version: 1, checksum: "0".repeat(96) }, PINS[1]];
    await expect(prepareRestore("C:/b.zip")).rejects.toThrow(FOREIGN_BACKUP);
    expect(FOREIGN_BACKUP).toContain("다른 앱(또는 다른 버전)의 백업이라 복원할 수 없습니다");
    expect(h.invoke).toHaveBeenCalledWith("restore_cancel");
  });

  it("refuses a database without a _sqlx_migrations table, and clears what it unpacked", async () => {
    h.applied = null;
    await expect(prepareRestore("C:/b.zip")).rejects.toThrow(FOREIGN_BACKUP);
    expect(h.invoke).toHaveBeenCalledWith("restore_cancel");
  });

  it("refuses a database whose _sqlx_migrations table is empty", async () => {
    h.applied = [];
    await expect(prepareRestore("C:/b.zip")).rejects.toThrow(FOREIGN_BACKUP);
    expect(h.invoke).toHaveBeenCalledWith("restore_cancel");
  });

  it("refuses a backup from a newer build and clears what it unpacked", async () => {
    h.applied = [...PINS, { version: 3, checksum: "1".repeat(96) }];
    await expect(prepareRestore("C:/b.zip")).rejects.toThrow(/더 새로운 버전/);
    expect(h.invoke).toHaveBeenCalledWith("restore_cancel");
  });
});
