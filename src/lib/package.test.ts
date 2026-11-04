import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.0.0") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(async () => "C:\\sets\\TOEIC 1회 LC.toic") }));
const saved: { origin: string; title: string }[] = [];
const market: unknown[] = [];
vi.mock("./repo", () => ({
  findSavedTest: vi.fn(async () => null),
  saveImportedTest: vi.fn(async (t: { title: string }, origin: string) => {
    saved.push({ origin, title: t.title });
    return saved.length;
  }),
  saveMarketRecord: vi.fn(async (_id: number, r: unknown) => void market.push(r)),
  loadTest: vi.fn(async (id: number) => ({ id, origin: id === 9 ? "market" : "ai" })),
  loadTestSource: vi.fn(async (id: number) => JSON.stringify(id === 2 || id === 3 ? rcPaper : paper)),
  loadGenMeta: vi.fn(async () => ({ options: { verification: [{ unit: "lang", line: "일치 6/6" }], trendCheckedAt: "2026-10-29T00:00:00Z" } })),
}));
const { buildManifest, exportExam, exportTest, importOpened, readPackage } = await import("./package");

const KEYS = ["A", "B", "C", "D"];
const AUD = "aud-0123456789abcdef0123456789abcdef.mp3";
const IMG = "img-0123456789abcdef0123456789abcdef.png";
const paper = {
  title: "TOEIC 1회 LC",
  kind: "listening",
  passages: [
    {
      title: "Part 1 · Photograph 1",
      audio: AUD,
      body: "Narrator: (A) …",
      groups: [{ type: "lmcq", image: IMG, questions: [{ number: 1, options: KEYS.map((key, i) => ({ key, text: `w${i}` })), answer: ["B"] }] }],
    },
  ],
};

const rcPaper = {
  title: "TOEIC 1회 RC",
  kind: "reading",
  passages: [{ title: "Part 5 · Incomplete Sentences", groups: [{ type: "mcq", questions: [{ number: 101, options: KEYS.map((key, i) => ({ key, text: `r${i}` })), answer: ["A"] }] }] }],
};

beforeEach(() => {
  invoke.mockReset();
  saved.length = 0;
  market.length = 0;
});

describe("set files", () => {
  it("writes the origin and the verification record into the manifest", async () => {
    invoke.mockResolvedValue(100);
    expect(await exportTest(1)).toBe("C:\\sets\\TOEIC 1회 LC.toic");
    const req = invoke.mock.calls[0][1].req;
    expect(req.manifest).toMatchObject({ format: 3, origin: "ai", kind: "listening", questions: 1, trendCheckedAt: "2026-10-29T00:00:00Z" });
    expect(req.media).toEqual([AUD, IMG]);
    expect(req.manifest.verification).toEqual([{ unit: "lang", line: "일치 6/6" }]);
    expect(req.tests).toHaveLength(1);
    expect(JSON.parse(req.tests[0]).title).toBe("TOEIC 1회 LC");
  });
  it("exportExam writes one listening and one reading test with an exam manifest", async () => {
    invoke.mockResolvedValue(100);
    expect(await exportExam(1, 2, "TOEIC 모의고사 11월")).toBe("C:\\sets\\TOEIC 1회 LC.toic");
    const req = invoke.mock.calls[0][1].req;
    expect(req.tests).toHaveLength(2);
    expect(req.tests.map((t: string) => JSON.parse(t).kind)).toEqual(["listening", "reading"]);
    expect(req.manifest).toMatchObject({ format: 3, app: "TOEICER", origin: "ai", title: "TOEIC 모의고사 11월", exam: { title: "TOEIC 모의고사 11월" }, questions: 2 });
    expect(req.manifest.tests).toEqual([
      { skill: "listening", ord: 0, title: "TOEIC 1회 LC", questions: 1 },
      { skill: "reading", ord: 1, title: "TOEIC 1회 RC", questions: 1 },
    ]);
    expect(req.manifest.verification).toHaveLength(2);
    expect(req.media).toEqual([AUD, IMG]);
  });
  it("exportExam refuses two reading sets or a market set", async () => {
    await expect(exportExam(2, 3, "x")).rejects.toThrow("Listening 세트 하나와 Reading 세트 하나");
    await expect(exportExam(9, 2, "x")).rejects.toThrow("마켓에서 산 세트");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("never writes out a bought set", async () => {
    await expect(exportTest(9)).rejects.toThrow("마켓에서 산 세트");
  });
  it("saves a bought file as a market set with its record, anything else as shared", async () => {
    invoke.mockResolvedValue({ manifest: { format: 3, origin: "ai", market: { itemId: "m-1", buyer: "kim" } }, tests: [JSON.stringify(paper)] });
    await importOpened(await readPackage("a.toic"));
    invoke.mockResolvedValue({ manifest: { format: 2 }, tests: [JSON.stringify(paper)] });
    const old = await readPackage("old.toeicset");
    expect(old.manifest.origin).toBe("shared");
    await importOpened(old);
    expect(saved.map((s) => s.origin)).toEqual(["market", "shared"]);
    expect(market).toEqual([{ itemId: "m-1", buyer: "kim" }]);
  });
  it("refuses a file whose sets are not TOEIC-shaped", async () => {
    const bad = { ...paper, passages: [{ title: "Section 1", body: "x", groups: [{ type: "mcq", questions: [{ number: 1, options: [{ key: "A", text: "a" }], answer: ["A"] }] }] }] };
    invoke.mockResolvedValue({ manifest: { format: 3 }, tests: [JSON.stringify(bad)] });
    await expect(readPackage("bad.toic")).rejects.toThrow("Part 1");
  });
  it("describes the set", async () => {
    const m = await buildManifest(paper as never, "mine");
    expect([m.format, m.title, m.kind, m.questions, m.origin, m.appVersion]).toEqual([3, "TOEIC 1회 LC", "listening", 1, "mine", "0.0.0"]);
  });
});
