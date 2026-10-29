import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
const { groupSections } = await import("./mock");

const row = (id: number, title: string, kind: "reading" | "listening" = "reading", questions = 13) => ({ id, title, kind, questions });

describe("groupSections", () => {
  it("builds complete sets in section order", () => {
    const sets = groupSections([
      row(3, "IELTS Academic Reading Test 1. Section 3", "reading", 14),
      row(1, "IELTS Academic Reading Test 1. Section 1"),
      row(2, "IELTS Academic Reading Test 1. Section 2"),
    ]);
    expect(sets).toEqual([{ kind: "reading", name: "IELTS Academic Reading Test 1", testIds: [1, 2, 3], questionCount: 40 }]);
  });

  it("needs four parts for listening and skips incomplete sets", () => {
    const listening = [1, 2, 3, 4].map((n) => row(10 + n, `Listening Sample 5. Section ${n}`, "listening", 10));
    const sets = groupSections([...listening, row(30, "Listening Sample 9. Section 1", "listening"), row(40, "Reading Test 2 Passage 1")]);
    expect(sets).toHaveLength(1);
    expect(sets[0].testIds).toEqual([11, 12, 13, 14]);
  });

  it("sorts sets naturally and ignores titles without a section number", () => {
    const mk = (t: number, base: number) => [1, 2, 3].map((n) => row(base + n, `Test ${t} Part ${n}`));
    const sets = groupSections([...mk(10, 100), ...mk(2, 200), row(9, "Bees on the Rooftops")]);
    expect(sets.map((s) => s.name)).toEqual(["Test 2", "Test 10"]);
  });
});
