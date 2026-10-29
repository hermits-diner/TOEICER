import { describe, expect, it } from "vitest";
import { validateImport } from "./importFormat";
import { toeicSampleTests } from "./toeicSamples";

describe("built-in TOEIC samples", () => {
  const tests = toeicSampleTests();
  it("pass the import validator", () => {
    for (const t of tests) expect(validateImport(t).errors, t.title).toEqual([]);
  });
  it("number questions consecutively and give Part 2 three heard options", () => {
    for (const t of tests) {
      const ns = t.passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.number)));
      expect(ns, t.title).toEqual(ns.map((_, i) => i + 1));
    }
    const part2 = tests[0].passages[0].groups[0];
    expect(part2.type).toBe("lmcq");
    expect(part2.questions.every((q) => q.options?.length === 3)).toBe(true);
  });
});
