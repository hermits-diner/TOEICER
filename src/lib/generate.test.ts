import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const g = await import("./generate");

const opts = { skill: "reading" as const, module: "academic" as const, topic: "bees", band: 6.5, types: ["tfng", "fill"] as ("tfng" | "fill")[], writingTasks: [], parts: [] as number[] };

const draft = {
  title: "City Bees",
  passages: [
    {
      title: "City Bees",
      paragraphs: [
        { label: "A", text: "Urban hives produced more honey than rural ones, according to researchers in Paris." },
        { label: "B", text: "Street trees and private gardens provide flowers from spring until autumn." },
      ],
      groups: [
        { type: "tfng", instructions: "Questions 1-2 Choose TRUE, FALSE or NOT GIVEN.", questions: [
          { number: 1, prompt: "City hives made less honey.", answer: "FALSE" },
          { number: 2, prompt: "Bees prefer roses.", answer: "NOT GIVEN" },
        ] },
        { type: "fill", instructions: "Questions 3-5 Choose NO MORE THAN TWO WORDS from the passage for each answer.", questions: [
          { number: 3, prompt: "Flowers come from gardens and ________.", answer: ["street trees"] },
          { number: 4, prompt: "Research took place in ________.", answer: ["London"] },
          { number: 5, prompt: "Flowers last until ________.", answer: ["late in the autumn season"] },
        ] },
      ],
    },
  ],
};

describe("prompts", () => {
  it("asks for the chosen types and the import shape", () => {
    const { prompt, system } = g.readingPrompt(opts);
    expect(prompt).toContain("about: bees");
    expect(prompt).toContain("tfng, fill");
    expect(prompt).toContain("NO MORE THAN TWO WORDS");
    expect(prompt).not.toContain('type "heading"');
    expect(system).toContain("do not reproduce");
    // the difficulty mix for this text, tilted by its position
    expect(prompt).toContain("Passage 1 (13 items): 7 locate, 5 paraphrase, 1 inference");
    expect(g.readingPrompt({ ...opts, position: 3 }).prompt).toContain("Passage 3 (14 items): 4 locate, 6 paraphrase, 4 inference");
  });
  it("covers General Training letters only when asked", () => {
    const gt = g.writingPrompt({ ...opts, skill: "writing", module: "general", writingTasks: ["task1", "task2"] });
    expect(gt.prompt).toContain("a letter task");
    expect(g.writingPrompt({ ...opts, skill: "writing", writingTasks: ["task1", "task2"] }).prompt).not.toContain("letter");
    expect(g.speakingPrompt({ ...opts, skill: "speaking" }).prompt).toContain("task card");
  });
});

describe("toTest / extractJson", () => {
  it("validates and stamps kind, module and an AI title", () => {
    const t = g.toTest(g.extractJson("```json\n" + JSON.stringify(draft) + "\n```"), opts, "reading");
    expect(t.title).toBe("AI · City Bees");
    expect(t.kind).toBe("reading");
    expect(t.passages[0].groups[0].questions[0].answer).toEqual(["FALSE"]);
  });
  it("explains broken replies", () => {
    expect(() => g.extractJson("Sorry, I can't")).toThrow(/형식/);
    expect(() => g.toTest({ title: "x", passages: [] }, opts, "reading")).toThrow(/형식이 맞지 않습니다/);
  });
});

describe("checks and review", () => {
  const t = () => g.toTest(draft, opts, "reading");

  it("reads word limits", () => {
    expect(g.wordLimit("Choose NO MORE THAN TWO WORDS from the passage")).toBe(2);
    expect(g.wordLimit("Write NO MORE THAN 3 WORDS")).toBe(3);
    expect(g.wordLimit("Choose A-D")).toBeNull();
  });

  it("drops gap answers missing from the passage or over the limit", () => {
    const { test, dropped } = g.checkAnswers(t());
    expect(test.passages[0].groups[1].questions.map((q) => q.number)).toEqual([3]);
    expect(dropped).toEqual([
      { number: 4, reason: "정답이 지문에 없음" },
      { number: 5, reason: "2단어 제한 초과" },
    ]);
  });

  it("applies fixes and drops from the reviewer", () => {
    const problems = g.parseReview(
      '{"problems":[{"number":2,"action":"drop","reason":"debatable"},{"number":1,"action":"fix","answer":["TRUE"],"reason":"x"},{"number":3,"action":"fix","reason":"no answer given"}]}',
    );
    const r = g.applyReview(t(), problems);
    expect(r.fixed).toBe(1);
    expect(r.dropped.map((d) => d.number)).toEqual([2, 3]);
    expect(r.test.passages[0].groups[0].questions[0].answer).toEqual(["TRUE"]);
  });

  it("renumbers and rewrites the ranges in the instructions", () => {
    const { test } = g.checkAnswers(g.applyReview(t(), [{ number: 1, action: "drop", reason: "" }]).test);
    const r = g.renumber(test);
    const groups = r.passages[0].groups;
    expect(groups.map((x) => x.questions.map((q) => q.number))).toEqual([[1], [2]]);
    expect(groups[0].instructions).toMatch(/^Question 1 Choose/);
    expect(groups[1].instructions).toMatch(/^Question 2 Choose/);
  });

  it("builds the review prompt with keys", () => {
    const p = g.reviewPrompt(t());
    expect(p).toContain("<passage>");
    expect(p).toContain("1. City hives made less honey. → key: FALSE");
  });
});

describe("listening", () => {
  const raw = {
    title: "Course enquiry",
    passages: [
      {
        title: "Part 1",
        speakers: { A: { role: "receptionist", gender: "female", accent: "british" }, B: { role: "caller", gender: "male" } },
        turns: [
          { speaker: "A", text: "Good morning, how can I help?" },
          { speaker: "B", text: "I'd like to book the photography course. My name is Hartley." },
          { speaker: "A", text: "The fee is 95 pounds." },
        ],
        groups: [
          { type: "fill", instructions: "Questions 1-2 Write ONE WORD AND/OR A NUMBER for each answer.", questions: [
            { number: 1, prompt: "Surname: ________", answer: ["Hartley"] },
            { number: 2, prompt: "Fee: £________", answer: ["95"] },
          ] },
        ],
      },
    ],
  };

  it("asks for at most two speakers and the chosen parts", () => {
    const { prompt } = g.listeningPrompt({ ...opts, skill: "listening", parts: [4, 1] });
    expect(prompt).toContain("(Part 1, Part 4)");
    expect(prompt).toContain("At most TWO speakers");
    expect(prompt).toContain("strictly alternate");
    expect(prompt).toContain("Part 1 (10 items): 5 locate");
    expect(prompt).toContain("Part 4 (10 items): 3 locate, 4 paraphrase, 3 inference");
  });

  it("turns scripts into a transcript and keeps the turns for synthesis", () => {
    const { importable, scripts } = g.splitListening(raw);
    const t = g.toTest(importable, opts, "listening");
    expect(t.kind).toBe("listening");
    expect(t.passages[0].body?.split("\n\n")[0]).toBe("Receptionist: Good morning, how can I help?");
    expect(scripts[0].speakers.B).toEqual({ role: "caller", gender: "male", accent: "british" });
    expect(scripts[0].turns).toHaveLength(3);
    expect(g.checkAnswers(t).dropped).toEqual([]);
  });

  it("reads one-word limits and rejects a third speaker", () => {
    expect(g.wordLimit("Write ONE WORD AND/OR A NUMBER for each answer.")).toBe(1);
    expect(g.wordLimit("Write ONE WORD ONLY for each answer.")).toBe(1);
    const three = { passages: [{ ...raw.passages[0], turns: [...raw.passages[0].turns, { speaker: "C", text: "Hello." }] }] };
    expect(() => g.splitListening(three)).toThrow(/셋 이상/);
  });
});

describe("academic task 1 charts", () => {
  const chart = { type: "line", title: "Cinema visits", unit: "millions", categories: ["2000", "2010", "2020"], series: [{ name: "UK", values: [140, 170, 44] }] };

  it("asks for a chart only in Academic Task 1", () => {
    const ac = g.writingPrompt({ ...opts, skill: "writing", module: "academic", writingTasks: ["task1", "task2"] });
    expect(ac.prompt).toContain('"chart"');
    expect(g.writingPrompt({ ...opts, skill: "writing", module: "general", writingTasks: ["task1"] }).prompt).not.toContain('Add "chart"');
  });

  it("puts the drawn figure after the sentence that introduces it", async () => {
    const raw = {
      title: "Cinema",
      passages: [
        { title: "Task 1", chart, sample: "The graph shows…", groups: [],
          body: "You should spend about 20 minutes on this task.\n\nThe line graph below shows cinema visits.\n\nSummarise the information.\n\nWrite at least 150 words." },
        { title: "Task 2", body: "Essay question", sample: "Essay", groups: [] },
      ],
    };
    const name = "img-0123456789abcdef0123456789abcdef.png";
    const out = (await g.attachCharts(raw, async () => name)) as { passages: Record<string, unknown>[] };
    const paras = out.passages[0].paragraphs as { text: string; image?: string }[];
    expect(paras.map((p) => p.image ?? p.text.slice(0, 12))).toEqual(["You should s", "The line gra", name, "Summarise th", "Write at lea"]);
    expect(out.passages[0].chart).toBeUndefined();
    expect(out.passages[1]).toEqual(raw.passages[1]);
    const t = g.toTest(out, { ...opts, skill: "writing" }, "writing");
    expect(t.passages[0].paragraphs?.[2]).toEqual({ text: "Cinema visits", image: name });
  });

  it("refuses charts it cannot draw", async () => {
    const bad = { passages: [{ title: "Task 1", body: "x", chart: { ...chart, type: "radar" }, groups: [] }] };
    await expect(g.attachCharts(bad, async () => "img")).rejects.toThrow(/그래프 종류/);
  });
});
