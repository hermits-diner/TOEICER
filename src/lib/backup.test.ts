import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ version: 1 as number | null, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => h.invoke(...a) }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string) => (sql.includes("_sqlx_migrations") ? [{ v: h.version }] : [{ n: 3 }]),
      close: async () => {},
    }),
  },
}));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./appSettings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
const { MAX_MIGRATION, prepareRestore } = await import("./backup");

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "restore_prepare" ? "C:/staging/toeic.db" : undefined));
});

describe("prepareRestore", () => {
  it("knows every migration this build ships", () => {
    const files = Object.keys(import.meta.glob("../../src-tauri/migrations/*.sql"));
    const highest = Math.max(...files.map((f) => Number(/(\d+)_[^/]*\.sql$/.exec(f)![1])));
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(MAX_MIGRATION).toBe(highest);
  });

  it("opens a backup made before the draft table existed; the next start adds it", async () => {
    h.version = 1;
    await expect(prepareRestore("C:/b.zip")).resolves.toEqual({ tests: 3, attempts: 3 });
    expect(h.invoke).not.toHaveBeenCalledWith("restore_cancel");
  });

  it("opens a backup from this version", async () => {
    h.version = 2;
    await expect(prepareRestore("C:/b.zip")).resolves.toEqual({ tests: 3, attempts: 3 });
  });

  it("refuses a backup from a newer build and clears what it unpacked", async () => {
    h.version = 3;
    await expect(prepareRestore("C:/b.zip")).rejects.toThrow(/더 새로운 버전/);
    expect(h.invoke).toHaveBeenCalledWith("restore_cancel");
  });
});
