// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { answeredIn, answeredInJson, draftBadge, RESUME_LABEL, restoreDraft, savedAgo } from "./draft";
import type { TestDetail } from "./types";

const q = (id: number, number: number) => ({ id, number, prompt: `Q${number}`, options: [], answer: ["A"] });
const test: TestDetail = {
  id: 7,
  title: "Reading 1",
  kind: "reading",
  origin: "mine",
  ai: false,
  reported: [],
  passages: [
    { id: 1, ord: 0, title: "Part 7 · Single 1", bodyHtml: "<p>The office opens at nine.</p>", audio: null, groups: [{ id: 10, type: "mcq", instructions: null, options: [], image: null, questions: [q(101, 147), q(102, 148)] }] },
    { id: 2, ord: 1, title: "Part 7 · Single 2", bodyHtml: "<p>Parking is free.</p>", audio: null, groups: [{ id: 20, type: "mcq", instructions: null, options: [], image: null, questions: [q(201, 149)] }] },
  ],
};

describe("restoreDraft", () => {
  it("keeps what still fits the set and drops answers to questions that are gone", () => {
    const r = restoreDraft(test, {
      answers: { 101: "B", 999: "C", 201: "" },
      flagged: [102, 998],
      marked: { 1: '<p>The office <mark class="hl">opens</mark> at nine.</p>', 3: "<p>gone</p>" },
      passageIdx: 1,
      elapsedSec: 125,
    });
    expect(r.answers).toEqual({ 101: "B", 201: "" });
    expect(r.flagged).toEqual([102]);
    expect(r.marked).toEqual({ 1: '<p>The office <mark class="hl">opens</mark> at nine.</p>' });
    expect(r.passageIdx).toBe(1);
    expect(r.elapsedSec).toBe(125);
    expect(answeredIn(r.answers)).toBe(1);
  });

  it("drops highlights made on a passage whose text has since been edited", () => {
    const r = restoreDraft(test, { answers: {}, flagged: [], marked: { 1: '<p>The office <mark class="hl">closes</mark> at five.</p>' }, passageIdx: 0, elapsedSec: 0 });
    expect(r.marked).toEqual({});
  });

  it("brings an out-of-range passage or time back inside the set", () => {
    expect(restoreDraft(test, { answers: {}, flagged: [], marked: null, passageIdx: 5, elapsedSec: -3 })).toMatchObject({ passageIdx: 1, elapsedSec: 0 });
  });

  it("counts the answers of a stored draft, and 0 for one it cannot read", () => {
    expect(answeredInJson('{"1":"B","2":"  ","3":"A"}')).toBe(2);
    expect(answeredInJson("{not json")).toBe(0);
  });
});

describe("savedAgo", () => {
  const now = new Date("2026-10-31T02:00:00Z");
  it("says how long ago a draft was saved (the database keeps UTC)", () => {
    expect(savedAgo("2026-10-31 01:59:40", now)).toBe("방금");
    expect(savedAgo("2026-10-31 01:55:00", now)).toBe("5분 전");
    expect(savedAgo("2026-10-30 23:00:00", now)).toBe("3시간 전");
    expect(savedAgo("2026-10-28 02:00:00", now)).toBe("3일 전");
    expect(savedAgo("2026-10-01 12:00:00", now)).toBe("10월 1일");
  });
});

describe("draft labels", () => {
  it("counts the questions answered", () => {
    expect(draftBadge({ answered: 3, updatedAt: "2026-10-31 01:55:00" })).toBe("풀던 중 · 3문항");
    expect(RESUME_LABEL).toBe("이어 풀기");
  });
});
