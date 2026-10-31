import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the project has no @types/node; node:sqlite ships with Node 24
import { DatabaseSync } from "node:sqlite";
import schema from "../../src-tauri/migrations/001_schema.sql?raw";
import draftSchema from "../../src-tauri/migrations/002_practice_draft.sql?raw";
import { DraftUnreadable } from "./draft";
import type { ImportTest } from "./types";

interface FakeDb {
  select: (sql: string, bind?: unknown[]) => Promise<unknown[]>;
  execute: (sql: string, bind?: unknown[]) => Promise<{ rowsAffected: number; lastInsertId: number }>;
}

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("./db", () => ({
  getDb: async () => h.db,
  sourceId: async (adapter: string) =>
    ((await h.db.select("SELECT id FROM source WHERE adapter = $1", [adapter])) as { id: number }[])[0]?.id ?? null,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { deleteDraft, deleteTest, listTests, loadDraft, loadTest, removeOutdatedSamples, saveDraft, saveImportedTest } = await import("./repo");
const { DRAFT_SAVE_WAIT_MS, deleteDraftOnceSaved, draftWritesIdle, queueDraftWrite } = await import("./draftQueue");

/** The app's real schema (both migrations) in memory, behind the plugin's select/execute with `$n` parameters. */
function openDb(): FakeDb {
  const conn = new DatabaseSync(":memory:");
  conn.exec(schema);
  conn.exec(draftSchema);
  const prep = (sql: string) => conn.prepare(sql.replace(/\$(\d+)/g, "?$1"));
  const vals = (bind: unknown[] = []) => bind.map((v) => (v === undefined ? null : v));
  return {
    select: async (sql, bind) => prep(sql).all(...vals(bind)),
    execute: async (sql, bind) => {
      const r = prep(sql).run(...vals(bind));
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
  };
}

const options = ["A", "B", "C", "D"].map((key) => ({ key, text: `Option ${key}` }));
const set = (title: string): ImportTest => ({
  title,
  kind: "reading",
  passages: [
    {
      title: "Part 7 · Single 1",
      body: "The office opens at nine.",
      groups: [{ type: "mcq", questions: [147, 148, 149].map((n) => ({ number: n, prompt: `Q${n}`, options, answer: ["B"] })) }],
    },
  ],
});
const count = async (sql: string) => ((await h.db.select(sql)) as { n: number }[])[0].n;

beforeEach(() => {
  h.db = openDb();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("practice drafts", () => {
  it("saves, reads back, overwrites and deletes an unfinished attempt", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    expect(await loadDraft(id)).toBeNull();

    const marked = { 1: '<p>The office <mark class="hl">opens</mark> at nine.</p>' };
    await saveDraft(id, { answers: { 1: "B", 2: "" }, flagged: [3], marked, passageIdx: 1, elapsedSec: 95 });
    const d = await loadDraft(id);
    expect(d).toMatchObject({ answers: { 1: "B", 2: "" }, flagged: [3], marked, passageIdx: 1, elapsedSec: 95 });
    expect(d!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    await saveDraft(id, { answers: { 1: "C" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 120 });
    expect(await loadDraft(id)).toMatchObject({ answers: { 1: "C" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 120 });
    expect(await count("SELECT COUNT(*) AS n FROM practice_draft")).toBe(1);

    await deleteDraft(id);
    expect(await loadDraft(id)).toBeNull();
  });

  it("says a stored draft it cannot read is unreadable, so the screen may remove it", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    await h.db.execute("INSERT INTO practice_draft (test_id, answers_json) VALUES ($1, $2)", [id, "{not json"]);
    const e = await loadDraft(id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DraftUnreadable);
    expect(String(e)).toMatch(/임시저장/);
  });

  it("passes a database error on as it is, so a draft that may be fine is never removed for it", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    await saveDraft(id, { answers: { 1: "B" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 5 });
    const select = h.db.select;
    h.db.select = async () => {
      throw new Error("database is locked");
    };
    const e = await loadDraft(id).catch((x: unknown) => x);
    h.db.select = select;
    expect(e).not.toBeInstanceOf(DraftUnreadable);
    expect(String(e)).toContain("database is locked");
    expect(await loadDraft(id)).toMatchObject({ answers: { 1: "B" } });
  });

  it("lists each set's draft (answers given, when saved) in the same single query", async () => {
    const withDraft = await saveImportedTest(set("A"), "mine");
    const without = await saveImportedTest(set("B"), "mine");
    await saveDraft(withDraft, { answers: { 1: "B", 2: "  ", 3: "A", 4: "" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 10 });
    await h.db.execute("UPDATE practice_draft SET updated_at = '2026-10-31 01:55:00'");

    const select = vi.spyOn(h.db, "select");
    const rows = await listTests();
    expect(select).toHaveBeenCalledTimes(1);
    expect(rows.find((t) => t.id === withDraft)!.draft).toEqual({ answered: 2, updatedAt: "2026-10-31 01:55:00" });
    expect(rows.find((t) => t.id === without)!.draft).toBeNull();
  });

  it("goes with its set when the set is deleted", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    expect((await loadTest(id)).passages).toHaveLength(1);
    await saveDraft(id, { answers: { 1: "B" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 5 });
    await deleteTest(id);
    expect(await count("SELECT COUNT(*) AS n FROM practice_draft")).toBe(0);
  });

  it("keeps an outdated built-in set the learner is part-way through", async () => {
    const started = await saveImportedTest(set("old sample 1"), "sample");
    const untouched = await saveImportedTest(set("old sample 2"), "sample");
    await saveDraft(started, { answers: { 1: "B" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 5 });
    expect(await removeOutdatedSamples([])).toBe(1);
    const left = (await listTests()).map((t) => t.id);
    expect(left).toContain(started);
    expect(left).not.toContain(untouched);
  });
});

describe("draft write queue", () => {
  const input = { answers: { 1: "B" }, flagged: [], marked: null, passageIdx: 0, elapsedSec: 5 };

  it("lets a list read after draftWritesIdle see a draft written on leaving the set", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    let release!: () => void;
    void queueDraftWrite(() => new Promise<void>((r) => (release = r))); // a slower write still running
    void queueDraftWrite(() => saveDraft(id, input)); // the flush on leaving
    const tooEarly = listTests();
    const afterIdle = draftWritesIdle().then(() => listTests());
    await vi.waitFor(() => expect(release).toBeDefined());
    release();
    expect((await tooEarly).find((t) => t.id === id)!.draft).toBeNull();
    expect((await afterIdle).find((t) => t.id === id)!.draft).toMatchObject({ answered: 1 });
  });

  it("deletes a submitted set's draft once its attempt is saved, before the list reads it", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    await saveDraft(id, input);
    let saved!: (attemptId: number) => void;
    void deleteDraftOnceSaved(id, new Promise<number>((r) => (saved = r)));
    const afterIdle = draftWritesIdle().then(() => listTests());
    saved(1);
    expect((await afterIdle).find((t) => t.id === id)!.draft).toBeNull();
  });

  it("keeps the draft when the attempt could not be saved", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    await saveDraft(id, input);
    await deleteDraftOnceSaved(id, Promise.reject(new Error("disk full")));
    expect(await loadDraft(id)).toMatchObject({ answers: { 1: "B" } });
  });

  it("stops waiting for an attempt save that hangs: the draft stays, it says so, and later writes go on", async () => {
    const id = await saveImportedTest(set("A"), "mine");
    await saveDraft(id, input);
    vi.useFakeTimers();
    const deleting = deleteDraftOnceSaved(id, new Promise<number>(() => {}));
    const outcome = deleting.then(
      () => "deleted",
      (e: unknown) => String(e),
    );
    const later = queueDraftWrite(() => saveDraft(id, { ...input, answers: { 1: "C" } }));
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_WAIT_MS - 1);
    let done = false;
    void later.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatch(/임시저장을 남겨 두었습니다/);
    await later;
    vi.useRealTimers();
    expect(await loadDraft(id)).toMatchObject({ answers: { 1: "C" } });
  });

  it("does not hold a list back for ever behind a write that hangs", async () => {
    let release!: () => void;
    void queueDraftWrite(() => new Promise<void>((r) => (release = r)));
    await expect(draftWritesIdle(50)).resolves.toBeUndefined();
    release(); // let the shared queue go for whatever runs next
  });
});
