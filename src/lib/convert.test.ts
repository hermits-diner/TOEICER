import { describe, expect, it, vi } from "vitest";

const replies: string[] = [];
const prompts: string[] = [];
vi.mock("./ai", () => ({
  complete: vi.fn(async (_s: unknown, _sys: string, prompt: string) => {
    prompts.push(prompt);
    return { text: replies.shift() ?? "{}" };
  }),
}));
const { convertMaterial, convertPrompt } = await import("./convert");

const q = (n: number, options: string[], answer: number, stem = "") => ({ n, stem, options, answer });

describe("convertMaterial", () => {
  it("sorts the material into a Listening and a Reading set, solves the keys it lacks and says which", async () => {
    replies.push(
      JSON.stringify({
        title: "학원 프린트 3회",
        sets: [
          { part: 2, passage: "Speaker: When is the report due?\n\nResponder: (A) By Friday. (B) On the desk. (C) Yes.", questions: [q(7, ["By Friday.", "On the desk.", "Yes."], 1)] },
          { part: 2, passage: "Speaker: Who is leading the session?", questions: [q(8, ["Ms. Kim.", "Two hours.", "Room 3."], 0)] },
          {
            part: 3,
            passage: "Woman: The printer is broken.\nMan: I'll call the technician.",
            graphic: "Floor 2 | Printer room",
            questions: [q(32, ["A printer", "A desk", "A phone", "A car"], 1, "What is the problem?")],
          },
          { part: 5, passage: "", questions: [q(101, ["approve", "approval", "approving", "approved"], 2, "The manager gave final ------- to the plan.")] },
          { part: 5, passage: "", questions: [q(102, ["at", "on", "in", "by"], 4, "Submit the form ------- Friday.")] },
          { part: 9, passage: "x", questions: [q(1, ["a"], 1)] },
        ],
      }),
      JSON.stringify({ answers: { "8": 1 } }),
    );
    const r = await convertMaterial({} as never, "Part 2 …");
    expect(r.errors).toEqual([]);
    expect(r.solved).toEqual([8]);
    expect(r.tests.map((t) => [t.kind, t.title])).toEqual([
      ["listening", "학원 프린트 3회 · Listening"],
      ["reading", "학원 프린트 3회 · Reading"],
    ]);
    const [lc, rc] = r.tests;
    expect(lc.passages.map((p) => p.title)).toEqual(["Part 2 · 7–8", "Part 3 · Conversation 1"]);
    expect(lc.passages[0].groups[0]).toMatchObject({ type: "lmcq", questions: [{ answer: ["A"], prompt: "Number 7" }, { answer: ["A"] }] });
    expect(lc.passages[0].groups[0].questions[0].options?.map((o) => o.key)).toEqual(["A", "B", "C"]);
    expect(lc.passages[1].groups[0].instructions).toBe("Graphic\nFloor 2 | Printer room");
    expect(rc.passages.map((p) => p.title)).toEqual(["Part 5 · Incomplete Sentences"]);
    expect(rc.passages[0].groups[0].questions.map((x) => x.answer[0])).toEqual(["B", "D"]);
    expect(prompts[1]).toContain("### 8 (Part 2, listening script)");
  });
  it("tells the AI to copy, not rewrite, and to skip listening without a script", () => {
    const p = convertPrompt("x");
    expect(p).toContain("<material>\nx\n</material>");
    expect(p).toContain("listening items whose script is not in the material");
  });
});
