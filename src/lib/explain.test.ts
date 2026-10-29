import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { explainPrompt, parseExplanation } = await import("./explain");

const ctx = {
  kind: "reading" as const,
  passageTitle: "Part 7 · Single 1 (Email)",
  passageText: "The office will move to the fifth floor on May 3.",
  type: "mcq" as const,
  instructions: null,
  options: ["The office is moving.", "A new manager was hired.", "The building will close.", "Parking fees will rise."].map((text, i) => ({ key: "ABCD"[i], text })),
  number: 147,
  prompt: "What is the purpose of the email?",
  answer: ["A"],
};

describe("explainPrompt", () => {
  it("includes the key facts and the passage", () => {
    const p = explainPrompt(ctx, "C");
    expect(p).toContain("TOEIC Reading · Part 7 · printed choices");
    expect(p).toContain("Question 147: What is the purpose of the email?");
    expect(p).toContain("Correct answer: A");
    expect(p).toContain("Learner's answer: C");
    expect(p).toContain("Options:\nA. The office is moving.");
    expect(p).toContain('<passage title="Part 7 · Single 1 (Email)">');
  });
  it("marks blanks and missing passages", () => {
    const p = explainPrompt({ ...ctx, kind: "listening", type: "lmcq", passageTitle: null, passageText: "" }, "  ");
    expect(p).toContain("TOEIC Listening · choices heard, not printed");
    expect(p).toContain("Learner's answer: (blank)");
    expect(p).toContain("No text or script");
  });
});

describe("parseExplanation", () => {
  it("reads the reply and drops incomplete pairs", () => {
    const e = parseExplanation(
      'Sure:\n{"evidence":"Hives in Paris produced more honey","paraphrases":[{"question":"less","passage":"more"},{"question":"x"}],"explanation":"지문과 반대입니다.","whyNot":"정보가 있습니다.","tip":"반대 표현을 찾으십시오."}',
    );
    expect(e.paraphrases).toEqual([{ question: "less", passage: "more" }]);
    expect(e.explanation).toBe("지문과 반대입니다.");
  });
  it("rejects empty or broken replies", () => {
    expect(() => parseExplanation('{"explanation":""}')).toThrow(/비어/);
    expect(() => parseExplanation("nope")).toThrow(/읽지 못했/);
  });
});
