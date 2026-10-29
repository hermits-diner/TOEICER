import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterChoices, filterTests, genMetaLine, isFiltering, topicUses, type LibraryFilter } from "./library";
import type { GenMeta, TestSummary } from "./types";

const gen = (over: Partial<GenMeta>): GenMeta => ({ topic: "coral reefs", band: 6.5, provider: "gemini", model: "gemini-2.5-pro", options: {}, ...over });
const t = (id: number, over: Partial<TestSummary>): TestSummary => ({
  id,
  title: `T${id}`,
  kind: "reading",
  module: "academic",
  createdAt: "2026-10-08",
  questionCount: 13,
  passageCount: 1,
  entries: 0,
  attempts: 0,
  lastScore: null,
  lastBand: null,
  ai: false,
  shared: false,
  gen: null,
  ...over,
});
const rows: TestSummary[] = [
  t(1, { title: "Cambridge 18 Test 1" }),
  t(2, { ai: true, gen: gen({}) }),
  t(3, { ai: true, gen: gen({ topic: "Urban Beekeeping", band: 7, model: "claude-opus-5-5", provider: "anthropic" }) }),
  t(4, { shared: true, title: "Shared set" }),
  t(5, { ai: true, attempts: 2, gen: gen({ topic: "deep sea mining", band: 7, model: "" , provider: "claude-cli" }) }),
];
const f = (over: Partial<LibraryFilter>): LibraryFilter => ({ ...EMPTY_FILTER, ...over });

describe("filterTests", () => {
  it("returns everything for the empty filter", () => {
    expect(filterTests(rows, EMPTY_FILTER).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it("splits by origin: AI, shared, collected", () => {
    expect(filterTests(rows, f({ origin: "ai" })).map((r) => r.id)).toEqual([2, 3, 5]);
    expect(filterTests(rows, f({ origin: "shared" })).map((r) => r.id)).toEqual([4]);
    expect(filterTests(rows, f({ origin: "collected" })).map((r) => r.id)).toEqual([1]);
  });
  it("band and model apply to AI sets only and hide the rest", () => {
    expect(filterTests(rows, f({ band: 7 })).map((r) => r.id)).toEqual([3, 5]);
    expect(filterTests(rows, f({ model: "claude-opus-5-5" })).map((r) => r.id)).toEqual([3]);
    expect(filterTests(rows, f({ model: "claude-cli" })).map((r) => r.id)).toEqual([5]);
  });
  it("searches titles and topics, case-insensitively, by every word", () => {
    expect(filterTests(rows, f({ query: "BEE" })).map((r) => r.id)).toEqual([3]);
    expect(filterTests(rows, f({ query: "cambridge 18" })).map((r) => r.id)).toEqual([1]);
    expect(filterTests(rows, f({ query: "sea urban" })).map((r) => r.id)).toEqual([]);
    expect(filterTests(rows, f({ query: "  " })).length).toBe(5);
  });
  it("keeps only unattempted sets when asked", () => {
    expect(filterTests(rows, f({ origin: "ai", unattempted: true })).map((r) => r.id)).toEqual([2, 3]);
  });
});

describe("filterChoices", () => {
  it("lists the bands and models that occur, sorted, a CLI default model under its provider", () => {
    const c = filterChoices(rows);
    expect(c.bands).toEqual([6.5, 7]);
    expect(c.models).toEqual(["claude-cli", "claude-opus-5-5", "gemini-2.5-pro"]);
    expect(c.hasAi).toBe(true);
    expect(filterChoices([rows[0]]).hasAi).toBe(false);
  });
});

describe("isFiltering / genMetaLine", () => {
  it("tells an active filter from the empty one", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering(f({ query: "x" }))).toBe(true);
    expect(isFiltering(f({ band: 6.5 }))).toBe(true);
  });
  it("describes the request in one line", () => {
    expect(genMetaLine(gen({}))).toBe("coral reefs · Band 6.5 · gemini-2.5-pro");
    expect(genMetaLine(gen({ model: "", provider: "claude-cli" }))).toBe("coral reefs · Band 6.5 · claude-cli");
    expect(genMetaLine(gen({ topic: "" }))).toBe("Band 6.5 · gemini-2.5-pro");
  });
});

describe("topicUses", () => {
  const topics = [
    { topic: "Urban Beekeeping", kind: "reading" as const, count: 2 },
    { topic: "urban beekeeping", kind: "writing" as const, count: 1 },
    { topic: "coral reefs", kind: "reading" as const, count: 1 },
  ];
  it("matches the topic ignoring case and spacing and names each kind", () => {
    expect(topicUses(topics, " urban  BEEKEEPING ")).toBe("Reading 2개 · Writing 1개");
    expect(topicUses(topics, "coral reefs")).toBe("Reading 1개");
  });
  it("is empty for a new or blank topic", () => {
    expect(topicUses(topics, "deep sea mining")).toBe("");
    expect(topicUses(topics, "  ")).toBe("");
  });
});
