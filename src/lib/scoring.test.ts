import { describe, expect, it } from "vitest";
import { bandFor, formatBand } from "./bandTable";
import { canonicalJudgement, expandOptional, gapKey, isCorrect, normalizeText, scoreTest } from "./scoring";

describe("canonicalJudgement", () => {
  it("accepts common spellings", () => {
    expect(canonicalJudgement("T")).toBe("TRUE");
    expect(canonicalJudgement(" not  given ")).toBe("NOT GIVEN");
    expect(canonicalJudgement("NG")).toBe("NOT GIVEN");
    expect(canonicalJudgement("Yes")).toBe("YES");
    expect(canonicalJudgement("maybe")).toBeNull();
  });
});

describe("normalizeText / expandOptional", () => {
  it("strips case, quotes and surrounding punctuation", () => {
    expect(normalizeText("  Street   Trees. ")).toBe("street trees");
    expect(normalizeText("“biology”")).toBe("biology");
  });
  it("expands optional words", () => {
    expect(expandOptional("(the) river")).toEqual(["the river", "river"]);
    expect(expandOptional("(a) small (wooden) box")).toHaveLength(4);
  });
});

describe("isCorrect", () => {
  it("judges TFNG by canonical form", () => {
    expect(isCorrect("tfng", "ng", ["NOT GIVEN"])).toBe(true);
    expect(isCorrect("tfng", "TRUE", ["FALSE"])).toBe(false);
  });
  it("matches letters and numerals case-insensitively", () => {
    expect(isCorrect("mcq", "b", ["B"])).toBe(true);
    expect(isCorrect("heading", "IV", ["iv"])).toBe(true);
  });
  it("accepts alternatives and optional words for gap fills", () => {
    expect(isCorrect("fill", "Wild Bees", ["wild bee", "wild bees"])).toBe(true);
    expect(isCorrect("fill", "river", ["(the) river"])).toBe(true);
    expect(isCorrect("fill", "the river", ["(the) river"])).toBe(true);
    expect(isCorrect("fill", "rivers", ["(the) river"])).toBe(false);
  });
  it("treats blanks as wrong", () => {
    expect(isCorrect("fill", "   ", ["x"])).toBe(false);
    expect(isCorrect("mcq", undefined, ["A"])).toBe(false);
  });
});

describe("scoreTest", () => {
  it("counts correct answers", () => {
    const r = scoreTest(
      [
        { id: 1, type: "mcq", answer: ["A"] },
        { id: 2, type: "tfng", answer: ["TRUE"] },
        { id: 3, type: "fill", answer: ["biology"] },
      ],
      { 1: "A", 2: "FALSE", 3: "Biology" },
    );
    expect(r.correct).toBe(2);
    expect(r.total).toBe(3);
    expect(r.results[1].isCorrect).toBe(false);
  });
});

describe("bandFor", () => {
  it("estimates a TOEIC section score of 5–495 in steps of 5", () => {
    expect(bandFor("listening", "academic", 100, 100)).toEqual({ band: 495, scaled: 100, estimated: true });
    expect(bandFor("listening", "academic", 0, 100).band).toBe(5);
    expect(bandFor("listening", "academic", 80, 100).band).toBe(400);
    expect(bandFor("reading", "academic", 80, 100).band).toBe(385);
    expect(bandFor("reading", "academic", 3, 7).band! % 5).toBe(0);
  });
  it("converts listening a little more generously than reading", () => {
    expect(bandFor("listening", "academic", 60, 100).band!).toBeGreaterThan(bandFor("reading", "academic", 60, 100).band!);
  });
  it("marks every score as an estimate", () => {
    expect(formatBand(bandFor("reading", "academic", 50, 100))).toBe("220 (추정)");
  });
});

describe("gap answers follow IELTS conventions", () => {
  it("accepts digits or words, no currency symbol, no ordinal ending, spaced digit groups", () => {
    expect(isCorrect("fill", "7", ["seven"])).toBe(true);
    expect(isCorrect("fill", "seven", ["7"])).toBe(true);
    expect(isCorrect("fill", "16", ["£16"])).toBe(true);
    expect(isCorrect("fill", "18", ["18th"])).toBe(true);
    expect(isCorrect("fill", "07833419205", ["07833 419205"])).toBe(true);
    expect(isCorrect("fill", "twenty-one", ["21"])).toBe(true);
  });
  it("still tells different answers apart", () => {
    expect(isCorrect("fill", "17", ["£16"])).toBe(false);
    expect(isCorrect("fill", "seventeen", ["seven"])).toBe(false);
    expect(gapKey("one way street")).toBe("1 way street");
    expect(isCorrect("fill", "one way street", ["one-way street"])).toBe(false);
  });
});

describe("TOEFL item types", () => {
  it("accepts the missing letters or the whole word in Complete the Words", () => {
    expect(isCorrect("cword", "ll", ["ll", "full"])).toBe(true);
    expect(isCorrect("cword", "Full", ["ll", "full"])).toBe(true);
    expect(isCorrect("cword", "l", ["ll", "full"])).toBe(false);
  });
  it("ignores case and end punctuation but not word order in Build a Sentence", () => {
    const key = ["Did you find any companies that interested you?"];
    expect(isCorrect("build", "did you find any companies that interested you", key)).toBe(true);
    expect(isCorrect("build", "you did find any companies that interested you", key)).toBe(false);
  });
});

describe("TOEIC listening choices", () => {
  it("scores a heard-option item by its letter", () => {
    expect(isCorrect("lmcq", "b", ["B"])).toBe(true);
    expect(isCorrect("lmcq", "C", ["B"])).toBe(false);
  });
});
