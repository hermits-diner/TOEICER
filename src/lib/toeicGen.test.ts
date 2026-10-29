import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateImport } from "./importFormat";
import { BLUEPRINT as B } from "./toeicSpec";

const calls: { system: string; prompt: string }[] = [];
let replies: ((system: string, prompt: string) => string)[] = [];

vi.mock("./ai", () => ({
  complete: vi.fn(async (_s: unknown, system: string, prompt: string) => {
    calls.push({ system, prompt });
    const next = replies.shift();
    if (!next) throw new Error("unexpected AI call");
    return { text: next(system, prompt), model: "fake", inputTokens: null, outputTokens: null };
  }),
}));
vi.mock("./tts", () => ({
  assignGeminiVoices: (s: Record<string, unknown>) => Object.fromEntries(Object.keys(s).map((k) => [k, "Kore"])),
  geminiSynthesize: vi.fn(async () => ({ name: `aud-${"1".repeat(32)}.mp3`, duration: 1, words: "" })),
}));
const invoke = vi.fn(async () => `img-${"2".repeat(32)}.png`);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { generateToeic, MEASURE, PARSE, balance } = await import("./toeicGen");
const settings = { ttsModel: "tts", imageModel: "img" } as never;

const q = (answer = "A", prompt = "What is the purpose?") => ({ prompt, options: ["One", "Two", "Three", "Four"], answer });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const times = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

const fixtures = {
  p12: () => ({
    photos: times(B[1].items, () => ({ scene: "A woman is typing at a desk.", statements: ["s1", "s2", "s3", "s4"], answer: "A" })),
    qr: times(B[2].items, (i) => ({ question: `Question ${i}?`, responses: ["r1", "r2", "r3"], answer: "B" })),
  }),
  p3: () => ({
    sets: times(B[3].sets, (i) => ({
      title: `Set ${i}`,
      speakers: { A: { role: "Woman", gender: "female" }, B: { role: "Man", gender: "male" } },
      turns: times(8, (k) => ({ speaker: k % 2 ? "B" : "A", text: words(14) })),
      graphic: i < B[3].graphics ? "Room 101 | 9:00" : "",
      questions: [q("A"), q("B"), q("C")],
    })),
  }),
  p4: () => ({
    sets: times(B[4].sets, (i) => ({
      title: `Talk ${i}`,
      genre: "Announcement",
      speaker: { role: "Announcer", gender: "male" },
      text: words(100),
      graphic: i < B[4].graphics ? "Gate 4 | 10:30" : "",
      questions: [q(), q(), q()],
    })),
  }),
  p56: () => ({
    part5: times(B[5].items, () => q("C", "All staff must ------- the form.")),
    part6: times(B[6].texts, (i) => ({
      title: `Memo ${i}`,
      genre: "Memo",
      text: "Dear staff, ---(1)--- the lot. ---(2)--- We are ---(3)--- grateful. ---(4)--- improvements.",
      questions: [q("A", "(1)"), q("B", "(2)"), q("C", "(3)"), q("D", "(4)")],
    })),
  }),
  p7s: () => ({ sets: B[7].singles.map((n, i) => ({ title: `Single ${i}`, texts: [{ genre: "Email", text: words(120) }], questions: times(n, () => q("D")) })) }),
  p7m: () => ({
    sets: times(B[7].doubles + B[7].triples, (i) => ({
      title: `Multi ${i}`,
      texts: times(i < B[7].doubles ? 2 : 3, () => ({ genre: "Notice", text: words(100) })),
      questions: times(B[7].perMulti, () => q("B")),
    })),
  }),
};

/** A solver that answers every item with its key, read back from the fix-free prompt. */
const agree = (_s: string, prompt: string) => {
  const answers: Record<string, string> = {};
  for (const block of prompt.split("### ").slice(1)) answers[block.split("\n")[0].trim()] = "?";
  return JSON.stringify({ answers });
};
const keepAll = (_s: string, prompt: string) =>
  JSON.stringify({ decisions: [...prompt.matchAll(/### (\S+)/g)].map((m) => ({ id: m[1], action: "keep", answer: "" })) });

beforeEach(() => {
  calls.length = 0;
  replies = [];
  invoke.mockClear();
});

describe("format measurements", () => {
  it("passes drafts that match the real test", () => {
    for (const unit of Object.keys(fixtures) as (keyof typeof fixtures)[]) {
      const draft = (PARSE[unit] as (r: unknown) => never)(fixtures[unit]());
      expect((MEASURE[unit] as (d: never) => string[])(draft), unit).toEqual([]);
    }
  });
  it("catches a Part 2 item with four responses and a Part 6 text missing a blank", () => {
    const p12 = fixtures.p12();
    p12.qr[0].responses.push("r4");
    expect(MEASURE.p12(PARSE.p12(p12)).some((p) => p.startsWith("qr 1:") && p.includes("4개"))).toBe(true);
    const p56 = fixtures.p56();
    p56.part6[0].text = p56.part6[0].text.replace("---(3)---", "");
    expect(MEASURE.p56(PARSE.p56(p56))).toContain("part6 text 1: blank ---(3)--- missing");
  });
  it("spreads keys over three letters for Part 2 and four elsewhere", () => {
    expect(balance(times(3, () => ({ options: ["x", "y", "z"], answer: "A" }))).map((x) => x.answer)).toEqual(["A", "B", "C"]);
  });
});

describe("generateToeic", () => {
  it("builds a 200-question test, Listening 1–100 with photos and speech, Reading 101–200", async () => {
    replies = (["p12", "p3", "p4", "p56", "p7s", "p7m"] as const).flatMap((u) => [() => JSON.stringify(fixtures[u]()), agree, keepAll]);
    const r = await generateToeic(settings, { units: ["p12", "p3", "p4", "p56", "p7s", "p7m"], target: "750", topics: "", speech: true, images: true });

    const [listening, reading] = r.tests;
    for (const t of r.tests) expect(validateImport(t).errors, t.title).toEqual([]);
    const nums = (t: typeof listening) => t.passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((x) => x.number)));
    expect(nums(listening)).toEqual(times(100, (i) => i + 1));
    expect(nums(reading)).toEqual(times(100, (i) => i + 101));
    expect(listening.passages.every((p) => p.audio)).toBe(true);
    expect(listening.passages.slice(0, 6).every((p) => p.groups[0].image?.startsWith("img-"))).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(6);
    // Part 6 blanks carry the question numbers on the page.
    const part6 = reading.passages.find((p) => p.title?.startsWith("Part 6"))!;
    expect(part6.body).toContain("---(131)---");
    expect(r.reports.every((x) => x.dropped === 0 && x.notes.length === 0)).toBe(true);
  });

  it("describes the scene in words when there are no photographs, and drops what the editor rejects", async () => {
    const drop = () => JSON.stringify({ decisions: [{ id: "P1", action: "drop" }, { id: "Q2", action: "rekey", answer: "C" }] });
    // The solver matches the (balanced) keys except on P1 and Q2.
    const solver = (_s: string, prompt: string) => {
      const answers: Record<string, string> = {};
      for (const block of prompt.split("### ").slice(1)) {
        const id = block.split("\n")[0].trim();
        answers[id] = id === "P1" || id === "Q2" ? "D" : id.startsWith("P") ? "A" : "B";
      }
      return JSON.stringify({ answers });
    };
    replies = [() => JSON.stringify(fixtures.p12()), solver, drop];
    const r = await generateToeic(settings, { units: ["p12"], target: "600", topics: "hotel", speech: false, images: false });
    const t = r.tests[0];
    expect(t.passages.filter((p) => p.title?.startsWith("Part 1"))).toHaveLength(B[1].items - 1);
    expect(t.passages[0].groups[0].instructions).toContain("[사진 대신 장면 설명]");
    expect(r.reports[0]).toMatchObject({ dropped: 1, rekeyed: 1 });
    expect(invoke).not.toHaveBeenCalled();
    expect(calls[0].prompt).toContain("# Preferred settings\nhotel");
  });
});
