import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { explainPrompt, parseExplanation } = await import("./explain");

const ctx = {
  kind: "reading" as const,
  passageTitle: "Bees on the Rooftops",
  passageText: "Hives in Paris produced more honey than rural ones.",
  type: "tfng" as const,
  instructions: "Choose TRUE, FALSE or NOT GIVEN.",
  options: [],
  number: 8,
  prompt: "City hives produced less honey than rural ones.",
  answer: ["FALSE"],
};

describe("explainPrompt", () => {
  it("includes the key facts and the passage", () => {
    const p = explainPrompt(ctx, "NOT GIVEN");
    expect(p).toContain("Question 8: City hives produced less honey");
    expect(p).toContain("Correct answer: FALSE");
    expect(p).toContain("Learner's answer: NOT GIVEN");
    expect(p).toContain('<passage title="Bees on the Rooftops">');
  });
  it("marks blanks and missing passages", () => {
    const p = explainPrompt({ ...ctx, passageText: "", options: [{ key: "A", text: "x" }] }, "  ");
    expect(p).toContain("Learner's answer: (blank)");
    expect(p).toContain("No passage or transcript text");
    expect(p).toContain("Options:\nA. x");
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
