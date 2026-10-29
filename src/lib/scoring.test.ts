import { describe, expect, it } from "vitest";
import { bandFor, formatBand } from "./bandTable";
import { isCorrect, scoreTest } from "./scoring";

describe("isCorrect", () => {
  it("takes the keyed letter only, in either case, and a blank is wrong", () => {
    expect(isCorrect("B", ["B"])).toBe(true);
    expect(isCorrect("b", ["B"])).toBe(true);
    expect(isCorrect("C", ["B"])).toBe(false);
    expect(isCorrect("  ", ["B"])).toBe(false);
    expect(isCorrect(undefined, ["A"])).toBe(false);
  });
});

describe("scoreTest", () => {
  it("counts correct answers", () => {
    const r = scoreTest(
      [
        { id: 1, answer: ["A"] },
        { id: 2, answer: ["C"] },
        { id: 3, answer: ["D"] },
      ],
      { 1: "A", 2: "B", 3: "d" },
    );
    expect(r.correct).toBe(2);
    expect(r.total).toBe(3);
    expect(r.results[1].isCorrect).toBe(false);
  });
});

describe("bandFor", () => {
  it("estimates a TOEIC section score of 5–495 in steps of 5", () => {
    expect(bandFor("listening", 100, 100)).toEqual({ band: 495, scaled: 100, estimated: true });
    expect(bandFor("listening", 0, 100).band).toBe(5);
    expect(bandFor("listening", 80, 100).band).toBe(400);
    expect(bandFor("reading", 80, 100).band).toBe(385);
    expect(bandFor("reading", 3, 7).band! % 5).toBe(0);
  });
  it("converts listening a little more generously than reading", () => {
    expect(bandFor("listening", 60, 100).band!).toBeGreaterThan(bandFor("reading", 60, 100).band!);
  });
  it("marks every score as an estimate", () => {
    expect(formatBand(bandFor("reading", 50, 100))).toBe("220 (추정)");
  });
});
