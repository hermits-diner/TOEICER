import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterChoices, filterTests, genMetaLine, isFiltering, type LibraryFilter } from "./library";
import type { GenMeta, TestSummary } from "./types";

const gen = (over: Partial<GenMeta>): GenMeta => ({ topic: "호텔", band: 750, provider: "claude-cli", model: "opus", options: {}, ...over });
const t = (id: number, over: Partial<TestSummary>): TestSummary => ({
  id,
  title: `T${id}`,
  kind: "reading",
  createdAt: "2026-10-29",
  questionCount: 100,
  attempts: 0,
  lastScore: null,
  lastBand: null,
  origin: "mine",
  gen: null,
  ...over,
});
const rows: TestSummary[] = [
  t(1, { title: "학원 프린트 3회 RC" }),
  t(2, { origin: "ai", gen: gen({}) }),
  t(3, { origin: "ai", gen: gen({ topic: "사무실 이전", band: 900, model: "" , provider: "codex-cli" }) }),
  t(4, { origin: "market", title: "마켓 TOEIC 5회 LC" }),
  t(5, { origin: "sample", attempts: 2, title: "샘플", kind: "listening" }),
];
const f = (over: Partial<LibraryFilter>): LibraryFilter => ({ ...EMPTY_FILTER, ...over });

describe("filterTests", () => {
  it("returns everything for the empty filter and splits by origin", () => {
    expect(filterTests(rows, EMPTY_FILTER).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(filterTests(rows, f({ origin: "ai" })).map((r) => r.id)).toEqual([2, 3]);
    expect(filterTests(rows, f({ origin: "market" })).map((r) => r.id)).toEqual([4]);
    expect(filterTests(rows, f({ origin: "mine" })).map((r) => r.id)).toEqual([1]);
    expect(filterTests(rows, f({ kind: "listening" })).map((r) => r.id)).toEqual([5]);
  });
  it("target and model apply to AI sets only, a CLI default model under its provider", () => {
    expect(filterTests(rows, f({ band: 900 })).map((r) => r.id)).toEqual([3]);
    expect(filterTests(rows, f({ model: "codex-cli" })).map((r) => r.id)).toEqual([3]);
  });
  it("searches titles and topics by every word, and keeps unattempted sets when asked", () => {
    expect(filterTests(rows, f({ query: "이전" })).map((r) => r.id)).toEqual([3]);
    expect(filterTests(rows, f({ query: "마켓 5회" })).map((r) => r.id)).toEqual([4]);
    expect(filterTests(rows, f({ unattempted: true })).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("filterChoices / isFiltering / genMetaLine", () => {
  it("offers what occurs", () => {
    expect(filterChoices(rows)).toEqual({ origins: ["sample", "ai", "mine", "market"], bands: [750, 900], models: ["codex-cli", "opus"] });
  });
  it("tells a filter from none and describes an AI set", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering(f({ query: "x" }))).toBe(true);
    expect(isFiltering(f({ kind: "reading" }))).toBe(true);
    expect(genMetaLine(gen({}))).toBe("호텔 · 목표 750점 · opus");
  });
});
