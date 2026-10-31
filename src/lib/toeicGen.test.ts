import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateImport } from "./importFormat";
import { BLUEPRINT as B } from "./toeicSpec";

const calls: { by: string; system: string; prompt: string; job?: string }[] = [];
let replies: ((system: string, prompt: string) => string)[] = [];

vi.mock("./ai", () => ({
  CANCELLED: "취소했습니다.",
  complete: vi.fn(async (s: { provider?: string }, system: string, prompt: string, opts?: { job?: string }) => {
    calls.push({ by: s.provider ?? "", system, prompt, job: opts?.job });
    const next = replies.shift();
    if (!next) throw new Error("unexpected AI call");
    return { text: next(system, prompt), model: "fake", inputTokens: null, outputTokens: null };
  }),
  providerLabel: (id: string) => id,
}));
vi.mock("./tts", () => ({
  assignGeminiVoices: (s: Record<string, unknown>) => Object.fromEntries(Object.keys(s).map((k) => [k, "Kore"])),
  geminiSynthesize: vi.fn(async () => ({ name: `aud-${"1".repeat(32)}.mp3`, duration: 1 })),
}));
const invoke = vi.fn(async () => `img-${"2".repeat(32)}.png`);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { generateToeic, MEASURE, PARSE, PROOF_SYSTEM, SOLVER_SYSTEM, WRITER_SYSTEM, balance, cues, itemName, reportLine } = await import("./toeicGen");
const { geminiSynthesize } = await import("./tts");
const settings = { provider: "claude-cli", ttsModel: "tts", imageModel: "img" } as never;
const clean = () => JSON.stringify({ faults: [] });

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

/** The fixtures' keys by item id (before the keys are spread over the letters). */
const keyOf = (id: string): string => {
  const [, k, , b] = /^([A-Z])(\d+)(?:\.(\d+))?$/.exec(id)!;
  if (k === "P") return "A";
  if (k === "Q") return "B";
  if (k === "C") return "ABC"[Number(b) - 1];
  if (k === "T") return "A";
  if (k === "S") return "C";
  if (k === "X") return "ABCD"[Number(b) - 1];
  return "?";
};
const ids = (prompt: string) => prompt.split("### ").slice(1).map((block) => block.split("\n")[0].trim());
/** A blind solver that answers every item as keyed, except where `answer` says otherwise. */
const solve =
  (answer: (id: string) => string | undefined = () => undefined, unsure: string[] = []) =>
  (_s: string, prompt: string) =>
    JSON.stringify({ answers: Object.fromEntries(ids(prompt).map((id) => [id, answer(id) ?? keyOf(id)])), unsure });

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
    const p7 = (u: "p7s" | "p7m") => solve(() => (u === "p7s" ? "D" : "B"));
    replies = (["p12", "p3", "p4", "p56", "p7s", "p7m"] as const).flatMap((u) => [() => JSON.stringify(fixtures[u]()), clean, u === "p7s" || u === "p7m" ? p7(u) : solve()]);
    const r = await generateToeic(settings, { units: ["p12", "p3", "p4", "p56", "p7s", "p7m"], target: "750", topics: "", speech: true, images: true }, () => {}, { job: "job-1" });
    // The chosen CLI writes, then proofreads and solves in fresh conversations; no other CLI is called.
    expect(new Set(calls.map((c) => c.by))).toEqual(new Set(["claude-cli"]));
    // every CLI call belongs to the job, so cancelling the job can end any of them
    expect(calls.map((c) => c.job)).toEqual(calls.map(() => "job-1"));
    expect(r.reports[0]).toMatchObject({ writer: "claude-cli", checker: "claude-cli", cross: false, total: 31, agreed: 31, flagged: [], proofed: 0 });
    expect(calls[0].prompt).toContain("at least 30% of the items");
    // Listening items are solved from their scripts.
    expect(calls[2].prompt).toContain("Photograph: A woman is typing at a desk.");

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
    expect(r.reports.every((x) => x.dropped.length === 0 && x.notes.length === 0 && x.agreed === x.total)).toBe(true);
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
    // The rewrite of P1 is proofread, then dropped again, so it stays out.
    const rewrite = () => JSON.stringify({ items: [{ id: "P1", scene: "Two men are carrying a box.", statements: ["t1", "t2", "t3", "t4"], answer: "A" }] });
    replies = [() => JSON.stringify(fixtures.p12()), clean, solver, drop, rewrite, clean, solve(() => "C"), () => JSON.stringify({ decisions: [{ id: "P1", action: "drop" }] })];
    const r = await generateToeic(settings, { units: ["p12"], target: "600", topics: "hotel", speech: false, images: false });
    const t = r.tests[0];
    expect(t.passages.filter((p) => p.title?.startsWith("Part 1"))).toHaveLength(B[1].items - 1);
    expect(t.passages[0].groups[0].instructions).toContain("[사진 대신 장면 설명]");
    expect(r.reports[0]).toMatchObject({ dropped: ["P1"], refilled: [], rekeyed: 1, agreed: B[1].items + B[2].items - 2 });
    expect(invoke).not.toHaveBeenCalled();
    expect(calls[0].prompt).toContain("# Preferred settings\nhotel");
  });

  it("writes a dropped item again and keeps the rewrite when it checks out", async () => {
    const drop = () => JSON.stringify({ decisions: [{ id: "P1", action: "drop" }] });
    const rewrite = () => JSON.stringify({ items: [{ id: "P1", scene: "Two men are carrying a box.", statements: ["t1", "t2", "t3", "t4"], answer: "B" }] });
    // the new P1 is proofread (clean) before it is solved
    replies = [() => JSON.stringify(fixtures.p12()), clean, solve((id) => (id === "P1" ? "D" : undefined)), drop, rewrite, clean, solve(() => "B")];
    const r = await generateToeic(settings, { units: ["p12"], target: "750", topics: "", speech: false, images: false }, () => {}, { job: "job-r" });
    expect(r.tests[0].passages.filter((p) => p.title?.startsWith("Part 1"))).toHaveLength(B[1].items);
    expect(r.tests[0].passages[0].groups[0].instructions).toContain("Two men are carrying a box.");
    expect(r.reports[0]).toMatchObject({ refilled: ["P1"], dropped: [] });
    expect(calls[4].prompt).toContain("### P1\nPhotograph: A woman is typing at a desk.");
    // The rewrite and its second check also go to the chosen CLI, as part of the job.
    expect(new Set(calls.map((c) => c.by))).toEqual(new Set(["claude-cli"]));
    expect(calls.every((c) => c.job === "job-r")).toBe(true);
  });

  it("sends proofreading faults back to the writer and reviews items the solver found ambiguous", async () => {
    replies = [
      () => JSON.stringify(fixtures.p3()),
      () => JSON.stringify({ faults: [{ id: "C2.1", fault: "the times go backwards" }] }),
      () => JSON.stringify({ items: [{ id: "C2.1", prompt: "When does the meeting start?", options: ["At nine", "At ten", "At noon", "At two"], answer: "A" }] }),
      clean,
      solve(undefined, ["C1.2"]),
      () => JSON.stringify({ decisions: [{ id: "C1.2", action: "keep" }] }),
    ];
    const r = await generateToeic(settings, { units: ["p3"], target: "750", topics: "", speech: false, images: false }, () => {}, { job: "job-p" });
    expect(calls.every((c) => c.job === "job-p")).toBe(true);
    expect(calls[2].prompt).toContain("### C2.1");
    expect(calls[2].prompt).toContain("- the times go backwards");
    expect(calls[5].prompt).toContain("### C1.2");
    expect(calls[5].prompt).toContain("(flagged as ambiguous)");
    expect(r.reports[0]).toMatchObject({ proofed: 1, reproofed: 0, flagged: ["C1.2"], agreed: 39, total: 39, dropped: [] });
    expect(reportLine(r.reports[0])).toBe("일치 39/39 · 애매 표시 1 · 교정 1");
  });

  it("takes a Part 6 text out whole when one of its blanks fails twice", async () => {
    // The rewrite has three options, so it fails the format and is not checked again.
    const rewrite = () => JSON.stringify({ items: [{ id: "X1.2", prompt: "x", options: ["a", "b", "c"], answer: "A" }] });
    replies = [() => JSON.stringify(fixtures.p56()), clean, solve((id) => (id === "X1.2" ? "D" : undefined)), () => JSON.stringify({ decisions: [] }), rewrite];
    const r = await generateToeic(settings, { units: ["p56"], target: "750", topics: "", speech: false, images: false });
    expect(r.tests[0].passages.filter((p) => p.title?.startsWith("Part 6"))).toHaveLength(B[6].texts - 1);
    expect(r.reports[0].dropped).toEqual(["X1.1", "X1.2", "X1.3", "X1.4"]);
    expect(itemName("X1.2")).toBe("장문 1-(2)");
    expect(calls).toHaveLength(5);
  });

  it("puts the official-site brief into the writer prompt", async () => {
    replies = [() => JSON.stringify(fixtures.p4()), clean, solve()];
    await generateToeic(settings, { units: ["p4"], target: "750", topics: "", speech: false, images: false, trend: ["", "# 최신 출제 동향 (공식 사이트 2026-10-29 확인)", "2016년 개정 구성 유지"] });
    expect(calls[0].prompt).toContain("# 최신 출제 동향 (공식 사이트 2026-10-29 확인)\n2016년 개정 구성 유지");
  });
});

describe("proofreading", () => {
  const faults = (...f: [string, string][]) => () => JSON.stringify({ faults: f.map(([id, fault]) => ({ id, fault })) });
  const items = (...it: object[]) => () => JSON.stringify({ items: it });
  /** The ids a prompt shows, in order. */
  const blocks = (prompt: string) => [...prompt.matchAll(/^### (\S+)/gm)].map((m) => m[1]);
  const only = (unit: "p12" | "p3" | "p4") => ({ units: [unit], target: "750" as const, topics: "", speech: false, images: false });
  const systems = () => calls.map((c) => c.system);
  const qr2 = (question: string) => ({ id: "Q2", question, responses: ["r1", "r2", "r3"], answer: "B" });
  /** Conversation `id` written again with new lines (the fixture's sixth set has no graphic). */
  const conversation = (id: string, line: string) => ({ ...fixtures.p3().sets[5], id, turns: times(8, (k) => ({ speaker: k % 2 ? "B" : "A", text: `${line} ${k} ${words(12)}` })) });
  const part = (t: { passages: { title?: string }[] }, prefix: string) => t.passages.filter((p) => p.title?.startsWith(prefix));
  const part2Count = (t: { passages: { title?: string; groups: { questions: unknown[] }[] }[] }) =>
    part(t, "Part 2").reduce((n, p) => n + (p as { groups: { questions: unknown[] }[] }).groups[0].questions.length, 0);

  it("rewrites only the faulted question, puts it back in its place and proofreads only the rewrite", async () => {
    const newC21 = { id: "C2.1", prompt: "When does the meeting start?", options: ["At nine", "At ten", "At noon", "At two"], answer: "A" };
    replies = [() => JSON.stringify(fixtures.p3()), faults(["C2.1", "options A and C say the same thing"]), items(newC21), clean, solve()];

    const r = await generateToeic(settings, only("p3"), () => {}, { job: "job-p1" });

    expect(systems()).toEqual([WRITER_SYSTEM, PROOF_SYSTEM, WRITER_SYSTEM, PROOF_SYSTEM, SOLVER_SYSTEM]);
    // the first proofreading shows each conversation once, with its questions under it
    expect(blocks(calls[1].prompt).slice(0, 5)).toEqual(["C1", "C1.1", "C1.2", "C1.3", "C2"]);
    // the writer gets that one question (its script only as context) and its fault, nothing else
    expect(blocks(calls[2].prompt)).toEqual(["C2.1"]);
    expect(calls[2].prompt).toContain("- options A and C say the same thing");
    expect(calls[2].prompt).toContain("(do not change)");
    // the second proofreading covers the rewritten question only
    expect(blocks(calls[3].prompt)).toEqual(["C2.1"]);
    expect(calls[3].prompt).toContain("When does the meeting start?");
    // the rewrite is in place; every other question is as first written
    const conversations = part(r.tests[0], "Part 3") as { groups: { questions: { prompt?: string }[] }[] }[];
    expect(conversations[1].groups[0].questions.map((q) => q.prompt)).toEqual(["When does the meeting start?", "What is the purpose?", "What is the purpose?"]);
    expect(conversations.filter((_, i) => i !== 1).every((c) => c.groups[0].questions.every((q) => q.prompt === "What is the purpose?"))).toBe(true);
    expect(r.reports[0]).toMatchObject({ proofed: 1, reproofed: 0, dropped: [], refilled: [], total: 39, agreed: 39 });
    expect(calls.every((c) => c.by === "claude-cli" && c.job === "job-p1")).toBe(true);
  });

  it("rewrites a conversation with its questions as one unit when the fault is in the script", async () => {
    const c3 = { ...fixtures.p3().sets[2], id: "C3", turns: times(8, (k) => ({ speaker: k % 2 ? "B" : "A", text: `Fixed line ${k} ${words(12)}` })) };
    replies = [() => JSON.stringify(fixtures.p3()), faults(["C3", "the woman's name changes"], ["C3.2", "the answer is stated twice"]), items(c3), clean, solve()];

    const r = await generateToeic(settings, only("p3"), () => {}, { job: "job-p5" });

    expect(blocks(calls[2].prompt)).toEqual(["C3"]);
    expect(calls[2].prompt).toContain("- the woman's name changes");
    expect(calls[2].prompt).toContain("C3.2: the answer is stated twice");
    expect(blocks(calls[3].prompt)).toEqual(["C3", "C3.1", "C3.2", "C3.3"]);
    expect((part(r.tests[0], "Part 3")[2] as { body?: string }).body).toContain("Fixed line 0");
    expect(r.reports[0]).toMatchObject({ proofed: 2, reproofed: 0, dropped: [] });
    expect(calls).toHaveLength(5);
  });

  it("drops an item still faulted after its rewrite, writes it again and proofreads the new one before solving it", async () => {
    replies = [
      () => JSON.stringify(fixtures.p12()),
      faults(["Q2", "no response answers the question"]),
      items(qr2("Question 1 again?")),
      faults(["Q2", "still no response answers it"]),
      solve(),
      items(qr2("Where is the seminar?")),
      clean,
      solve(),
    ];

    const r = await generateToeic(settings, only("p12"), () => {}, { job: "job-p2" });

    expect(systems()).toEqual([WRITER_SYSTEM, PROOF_SYSTEM, WRITER_SYSTEM, PROOF_SYSTEM, SOLVER_SYSTEM, WRITER_SYSTEM, PROOF_SYSTEM, SOLVER_SYSTEM]);
    expect(blocks(calls[3].prompt)).toEqual(["Q2"]);
    // the dropped item is not solved; it is written again with the fault that sank it
    expect(blocks(calls[4].prompt)).not.toContain("Q2");
    expect(blocks(calls[5].prompt)).toEqual(["Q2"]);
    expect(calls[5].prompt).toContain("still no response answers it");
    // the replacement is proofread before the blind solve
    expect(blocks(calls[6].prompt)).toEqual(["Q2"]);
    expect(calls[6].prompt).toContain("Where is the seminar?");
    expect(blocks(calls[7].prompt)).toEqual(["Q2"]);
    expect(r.reports[0]).toMatchObject({ proofed: 1, reproofed: 1, refilled: ["Q2"], dropped: [], total: 30, agreed: 30 });
    expect(part2Count(r.tests[0])).toBe(25);
    expect(part(r.tests[0], "Part 2").some((p) => (p as { body?: string }).body?.includes("Where is the seminar?"))).toBe(true);
    expect(calls.every((c) => c.by === "claude-cli" && c.job === "job-p2")).toBe(true);
  });

  it("keeps a replacement out when its proofreading finds a fault", async () => {
    replies = [
      () => JSON.stringify(fixtures.p12()),
      faults(["Q2", "no response answers the question"]),
      items(qr2("Question 1 again?")),
      faults(["Q2", "still no response answers it"]),
      solve(),
      items(qr2("Where is the seminar?")),
      faults(["Q2", "a preposition is missing"]),
    ];

    const r = await generateToeic(settings, only("p12"));

    expect(calls).toHaveLength(7);
    expect(r.reports[0]).toMatchObject({ refilled: [], dropped: ["Q2"] });
    expect(part2Count(r.tests[0])).toBe(24);
  });

  it("rewrites and proofreads again every unit when the first proofreading gives a fault no item", async () => {
    const raw = fixtures.p4();
    replies = [() => JSON.stringify(raw), faults(["", "American and British spelling are mixed"]), items(...raw.sets.map((s, i) => ({ id: `T${i + 1}`, ...s }))), clean, solve()];

    const r = await generateToeic(settings, only("p4"), () => {}, { job: "job-p4" });

    const talks = times(10, (i) => `T${i + 1}`);
    expect(blocks(calls[2].prompt)).toEqual(talks);
    expect(calls[2].prompt).toContain("- American and British spelling are mixed");
    expect(blocks(calls[3].prompt)).toEqual(talks.flatMap((t) => [t, `${t}.1`, `${t}.2`, `${t}.3`]));
    expect(r.reports[0]).toMatchObject({ proofed: 1, reproofed: 0, dropped: [], total: 30, agreed: 30 });
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.job === "job-p4")).toBe(true);
  });

  it("keeps a replacement out when its proofreading gives a fault an id it does not show", async () => {
    replies = [
      () => JSON.stringify(fixtures.p12()),
      faults(["Q2", "no response answers the question"]),
      items(qr2("Question 1 again?")),
      faults(["Q2", "still no response answers it"]),
      solve(),
      items(qr2("Where is the seminar?")),
      // the only item shown is the replacement, so the fault is its fault
      faults(["Q7", "a preposition is missing"]),
      solve(),
    ];

    const r = await generateToeic(settings, only("p12"));

    expect(calls).toHaveLength(7);
    expect(r.reports[0]).toMatchObject({ refilled: [], dropped: ["Q2"] });
  });

  it("drops a rewritten item when the second proofreading gives its fault no known id", async () => {
    replies = [
      () => JSON.stringify(fixtures.p12()),
      faults(["Q2", "no response answers the question"]),
      items(qr2("Question 1 again?")),
      faults(["", "still no response answers it"]),
      solve(),
      items(qr2("Where is the seminar?")),
      clean,
      solve(),
    ];

    const r = await generateToeic(settings, only("p12"));

    expect(blocks(calls[4].prompt)).not.toContain("Q2");
    expect(calls[5].prompt).toContain("still no response answers it");
    expect(r.reports[0]).toMatchObject({ reproofed: 1, refilled: ["Q2"], dropped: [] });
  });

  it("writes a whole new conversation when the script is still faulted after its rewrite, and proofreads it before solving it", async () => {
    replies = [
      () => JSON.stringify(fixtures.p3()),
      faults(["C6", "the man contradicts himself"]),
      items(conversation("C6", "Second try")),
      faults(["C6", "he still contradicts himself"]),
      solve(),
      items(conversation("C6", "Brand new")),
      clean,
      solve(),
    ];

    const r = await generateToeic(settings, only("p3"), () => {}, { job: "job-p6" });

    expect(systems()).toEqual([WRITER_SYSTEM, PROOF_SYSTEM, WRITER_SYSTEM, PROOF_SYSTEM, SOLVER_SYSTEM, WRITER_SYSTEM, PROOF_SYSTEM, SOLVER_SYSTEM]);
    expect(blocks(calls[4].prompt).some((id) => id.startsWith("C6."))).toBe(false);
    expect(blocks(calls[5].prompt)).toEqual(["C6"]);
    expect(calls[5].prompt).toContain("he still contradicts himself");
    expect(blocks(calls[6].prompt)).toEqual(["C6", "C6.1", "C6.2", "C6.3"]);
    expect(blocks(calls[7].prompt)).toEqual(["C6.1", "C6.2", "C6.3"]);
    const conversations = part(r.tests[0], "Part 3") as { body?: string }[];
    expect(conversations).toHaveLength(13);
    expect(conversations[5].body).toContain("Brand new 0");
    expect(r.reports[0]).toMatchObject({ proofed: 1, reproofed: 1, refilled: ["C6"], dropped: [], total: 36, agreed: 36 });
    expect(calls.every((c) => c.job === "job-p6")).toBe(true);
  });

  it("leaves a conversation out, by name, when it cannot be written again", async () => {
    replies = [
      () => JSON.stringify(fixtures.p3()),
      faults(["C6", "the man contradicts himself"]),
      items(conversation("C6", "Second try")),
      faults(["C6", "he still contradicts himself"]),
      solve(),
      items(),
    ];

    const r = await generateToeic(settings, only("p3"));

    expect(calls).toHaveLength(6);
    expect(part(r.tests[0], "Part 3")).toHaveLength(12);
    expect(r.reports[0]).toMatchObject({ refilled: [], dropped: ["C6"] });
    expect(reportLine(r.reports[0])).toContain("제외 대화 6");
    expect(reportLine(r.reports[0])).toContain("다시 교정 지적 1");
  });
});

describe("cancelling a generation", () => {
  const only = (unit: "p12" | "p3" | "p4", media = false) => ({ units: [unit], target: "750" as const, topics: "", speech: media, images: media });
  const aborting = (control: AbortController, reply: () => string) => () => (control.abort(), reply());
  const failing = (control: AbortController) => () => {
    control.abort();
    throw new Error("취소했습니다.");
  };

  it("stops before the next call once the job is cancelled, and rejects with the cancellation", async () => {
    const control = new AbortController();
    // the user cancels while the first call runs; that call still comes back
    replies = [aborting(control, () => JSON.stringify(fixtures.p4())), clean];
    await expect(generateToeic(settings, only("p4"), () => {}, { job: "job-2", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(calls).toHaveLength(1);
    expect(calls[0].job).toBe("job-2");
  });

  it("does not swallow the cancellation inside a format rewrite whose failure is otherwise ignored", async () => {
    const control = new AbortController();
    const short = () => JSON.stringify({ sets: fixtures.p4().sets.slice(0, 9) });
    replies = [short, failing(control), clean];
    await expect(generateToeic(settings, only("p4"), () => {}, { job: "job-3", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(calls).toHaveLength(2);
  });

  it("does not swallow the cancellation inside the proofreading rewrite", async () => {
    const control = new AbortController();
    replies = [() => JSON.stringify(fixtures.p3()), () => JSON.stringify({ faults: [{ id: "C2.1", fault: "the times go backwards" }] }), failing(control), solve()];
    await expect(generateToeic(settings, only("p3"), () => {}, { job: "job-5", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(calls).toHaveLength(3);
  });

  it("does not swallow the cancellation inside the refill", async () => {
    const control = new AbortController();
    const drop = () => JSON.stringify({ decisions: [{ id: "P1", action: "drop" }] });
    replies = [() => JSON.stringify(fixtures.p12()), clean, solve((id) => (id === "P1" ? "D" : undefined)), drop, failing(control), solve()];
    await expect(generateToeic(settings, only("p12"), () => {}, { job: "job-6", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(calls).toHaveLength(5);
  });

  it("makes no photograph or speech after the job is cancelled", async () => {
    const control = new AbortController();
    const before = vi.mocked(geminiSynthesize).mock.calls.length;
    replies = [() => JSON.stringify(fixtures.p12()), clean, aborting(control, () => solve()("", "")), solve()];
    await expect(generateToeic(settings, only("p12", true), () => {}, { job: "job-4", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(invoke).not.toHaveBeenCalled();
    expect(vi.mocked(geminiSynthesize).mock.calls.length).toBe(before);
  });

  it("stops between photographs once the job is cancelled", async () => {
    const control = new AbortController();
    const before = vi.mocked(geminiSynthesize).mock.calls.length;
    invoke.mockImplementationOnce(async () => (control.abort(), `img-${"2".repeat(32)}.png`));
    replies = [() => JSON.stringify(fixtures.p12()), clean, solve()];
    await expect(generateToeic(settings, only("p12", true), () => {}, { job: "job-7", signal: control.signal })).rejects.toThrow("취소했습니다.");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(geminiSynthesize).mock.calls.length).toBe(before);
  });
});

describe("cues", () => {
  it("flags a key that gives itself away by length or an all-of-the-above choice", () => {
    expect(cues("single 1 Q1", ["A plan", "A cost", "The long-term benefits of shared regional transit", "A vote"], "C")).toEqual([
      "single 1 Q1: the key is much longer than every distractor; balance the option lengths",
    ]);
    expect(cues("part5 Q1", ["comply", "compete", "compare", "none of the above"], "A")).toEqual(['part5 Q1: no "all/none of the above" options']);
    expect(cues("part5 Q1", ["comply", "compete", "compare", "conflict"], "A")).toEqual([]);
  });
  it("sends a draft with a give-away back for a rewrite", () => {
    const p56 = fixtures.p56();
    p56.part5[0].options = ["at the desk", "in a box", "for the annual review", "to the office"];
    expect(MEASURE.p56(PARSE.p56(p56))).toContain("part5 Q1: the key is much longer than every distractor; balance the option lengths");
  });
});
