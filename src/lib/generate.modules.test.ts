import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
const g = await import("./generate");
import type { GenOptions } from "./generate";
import type { ImportTest } from "./types";

const opts: GenOptions = {
  skill: "reading",
  module: "academic",
  topic: "bees",
  band: 6.5,
  types: [],
  writingTasks: [],
  parts: [],
};

const PLAIN =
  "Close your eyes and imagine walking along a sandy beach as the sun rises. How clear is the picture in your mind? Most people can call up images easily. " +
  "But some people cannot see anything at all when they try. Scientists gave the condition a name only a few years ago. One man first noticed it at school, when a teacher asked the class to picture a scene. " +
  "He saw nothing, and he assumed everyone else was pretending too. Later he read about the condition online and wrote to a researcher in Exeter. The researcher had been collecting similar stories for years.";

const DENSE =
  "Epidemiological investigations of neurodegenerative pathologies have increasingly emphasised the suprachiasmatic regulation of circadian periodicity. " +
  "Contemporary neurobiological conceptualisations characterise consolidation as a heterogeneous, multidimensional phenomenon encompassing synaptic homeostasis. " +
  "Nevertheless, methodological heterogeneity complicates systematic comparability across longitudinal cohorts, necessitating standardised operationalisation.";

const makeTest = (text: string, questions: number): ImportTest => ({
  title: "t",
  kind: "reading",
  module: "academic",
  passages: [
    {
      title: "T",
      paragraphs: [{ label: "A", text }],
      groups: [
        {
          type: "tfng",
          instructions: "Questions 1-" + questions,
          questions: Array.from({ length: questions }, (_, i) => ({
            number: i + 1,
            prompt: `s${i}`,
            answer: [["TRUE", "FALSE", "NOT GIVEN"][i % 3]],
          })),
        },
      ],
    },
  ],
});

describe("readability", () => {
  it("separates magazine prose from a dense review", () => {
    const plain = g.readability(PLAIN.repeat(3));
    const dense = g.readability(DENSE.repeat(3));
    expect(plain.fk).toBeLessThan(10);
    expect(plain.longShare).toBeLessThan(0.25);
    expect(dense.fk).toBeGreaterThan(16);
    expect(dense.longShare).toBeGreaterThan(0.5);
    expect(plain.words).toBeGreaterThan(dense.words);
  });
  it("is calm on tiny input", () => {
    expect(g.readability("Hi.")).toMatchObject({ fk: 0, longShare: 0 });
  });
});

describe("reading specs", () => {
  it("gives both modules three texts that make 40 questions", () => {
    const total = (m: "academic" | "general") =>
      [1, 2, 3].reduce(
        (n, p) => n + g.readingSpec(m, p as 1 | 2 | 3).questions,
        0,
      );
    expect(total("academic")).toBe(40);
    expect(total("general")).toBe(40);
    expect(g.readingSpec("general", 1).questions).toBe(14);
    expect(g.readingSpec("academic", 3).questions).toBe(14);
    expect(g.readingSpec("general", 1).maxGrade).toBeLessThan(
      g.readingSpec("academic", 1).maxGrade,
    );
    // the Academic band is centred on the human-written passages in the library (grade 11.5)
    expect(
      (g.readingSpec("academic", 2).minGrade +
        g.readingSpec("academic", 2).maxGrade) /
        2,
    ).toBe(12);
  });
  it("writes the Academic prompt for a passage and the General Training prompt for a section", () => {
    const ac = g.readingPrompt({ ...opts, position: 2 }).prompt;
    expect(ac).toContain("Academic Reading Passage 2 about: bees");
    expect(ac).toContain("exactly 13 questions");
    expect(ac).toContain("Flesch-Kincaid grade 11-13");
    expect(ac).toContain("Passage 2 of 3");
    expect(ac).not.toContain("demanding academic vocabulary");
    const gt = g.readingPrompt({
      ...opts,
      module: "general",
      position: 1,
    }).prompt;
    expect(gt).toContain("General Training Reading Section 1 about: bees");
    expect(gt).toContain("exactly 14 questions");
    expect(gt).toContain("social survival");
    expect(gt).toContain('type "matching"');
    expect(gt).not.toContain("Passage 1 of 3");
    expect(
      g.readingPrompt({ ...opts, module: "general", position: 2 }).prompt,
    ).toContain("workplace survival");
  });
  it("draws General Training Section 2 topics from the workplace", () => {
    const seen = new Set(
      Array.from({ length: 40 }, () => g.randomTopic("general", 2)),
    );
    expect(
      [...seen].every((t) =>
        /job|staff|working|contract|training|expenses|appraisal|safety/i.test(
          t,
        ),
      ),
    ).toBe(true);
    expect(g.randomTopic("general", 3)).not.toMatch(/job advertisement/);
  });
});

describe("readingProblems", () => {
  it("sends back a short dense draft with the wrong number of questions", () => {
    const problems = g.readingProblems(
      makeTest(DENSE, 12),
      g.readingSpec("academic", 1),
      ["tfng"],
    );
    expect(problems.map((p) => p.en)).toEqual([
      expect.stringContaining("at least 720"),
      expect.stringContaining("Flesch-Kincaid grade"),
      expect.stringContaining("seven or more letters"),
      expect.stringContaining("exactly 13"),
    ]);
    expect(problems.every((p) => /단어|난도|문항/.test(p.ko))).toBe(true);
  });
  it("passes plain prose of the right length and count for a General Training section, but sends it back as too easy for Academic", () => {
    expect(
      g.readingProblems(
        { ...makeTest(PLAIN.repeat(8), 14), module: "general" },
        g.readingSpec("general", 1),
        ["tfng"],
      ),
    ).toEqual([]);
    const ac = g.readingProblems(
      makeTest(PLAIN.repeat(8), 13),
      g.readingSpec("academic", 1),
      ["tfng"],
    );
    expect(ac.map((p) => p.en)).toEqual([
      expect.stringContaining("easier than the test"),
    ]);
    expect(ac[0].kind).toBe("easy");
    expect(g.readingPrompt({ ...opts, position: 1 }).prompt).toContain(
      "Flesch-Kincaid grade 11-13",
    );
  });
});

describe("blind solver", () => {
  const draft: ImportTest = {
    title: "t",
    kind: "reading",
    module: "academic",
    passages: [
      {
        title: "T",
        body: "Bees in cities visit street trees. The study was done in London.",
        groups: [
          {
            type: "tfng",
            instructions: "Questions 1-2",
            questions: [
              { number: 1, prompt: "Bees avoid trees.", answer: ["FALSE"] },
              { number: 2, prompt: "Bees like roses.", answer: ["NOT GIVEN"] },
            ],
          },
          {
            type: "fill",
            instructions: "Questions 3-4 Choose NO MORE THAN TWO WORDS",
            questions: [
              {
                number: 3,
                prompt: "Bees visit ________.",
                answer: ["street trees"],
              },
              { number: 4, prompt: "Done in ________.", answer: ["London"] },
            ],
          },
          {
            type: "mcq",
            instructions: "Question 5",
            questions: [
              {
                number: 5,
                prompt: "Where?",
                options: [
                  { key: "A", text: "Paris" },
                  { key: "B", text: "London" },
                ],
                answer: ["B"],
              },
            ],
          },
        ],
      },
    ],
  };
  it("asks without the keys and parses the answers", () => {
    const p = g.solverPrompt(draft);
    expect(p).toContain("<text>");
    expect(p).toContain("3. Bees visit ________.");
    expect(p).not.toContain("key:");
    const parsed = g.parseSolver(
      '```json\n{"answers":[{"number":1,"answer":"TRUE","evidence":"visit street trees"},{"number":3,"answer":"Street Trees","evidence":"x"},{"number":5,"answer":"B"}]}\n```',
    );
    expect(parsed.get(1)).toEqual({
      answer: "TRUE",
      evidence: "visit street trees",
    });
    expect(parsed.get(5)).toEqual({ answer: "B", evidence: "" });
    expect(g.parseSolver("no json").size).toBe(0);
  });
  it("lists only real disagreements, judged like the app's scoring", () => {
    const solved = new Map([
      [1, { answer: "TRUE", evidence: "visit street trees" }],
      [2, { answer: "not given", evidence: "" }],
      [3, { answer: "Street Trees", evidence: "" }],
      [4, { answer: "in London", evidence: "" }],
      [5, { answer: "B", evidence: "" }],
    ]);
    const d = g.solverDisagreements(draft, solved);
    expect(d.map((x) => x.number)).toEqual([1, 4]);
    expect(d[0]).toMatchObject({
      key: ["FALSE"],
      given: "TRUE",
      evidence: "visit street trees",
    });
    const review = g.reviewPrompt(draft, d);
    expect(review).toContain("<solver>");
    expect(review).toContain("1. key: FALSE / candidate: TRUE");
    expect(g.reviewPrompt(draft)).not.toContain("<solver>");
    expect(g.REVIEW_SYSTEM).toContain("could not see the keys");
  });
});

describe("listening specs", () => {
  it("asks for exactly ten questions, longer parts and a spoken lecture", () => {
    const { prompt } = g.listeningPrompt({
      ...opts,
      skill: "listening",
      parts: [1, 4],
    });
    expect(prompt).toContain(
      "650-750 words. Listening focus: main idea and detail. Exactly 10",
    );
    expect(prompt).toContain(
      "Part 4: a university lecture, one speaker, 750-850 words",
    );
    expect(prompt).toContain("lecturer talking to students");
    expect(prompt).toContain("Length and count are enforced");
    expect(prompt).toContain(
      "at least 3 of the 10 items ask for more than a single fact",
    );
    expect(prompt).toContain("no two answers fall in the same turn");
    expect(prompt).toContain("one speaker is female and the other male");
    expect(prompt).not.toContain("Choose TWO letters");
    const p23 = g.listeningPrompt({
      ...opts,
      skill: "listening",
      parts: [2, 3],
    }).prompt;
    expect(p23).toContain("Choose TWO letters, A-E");
    expect(p23).toContain(
      "at most two formats, each used for at least 3 items",
    );
    expect(p23).toContain("800-950 words");
  });
  it("extends a short part in place, keeping its questions, and shows the editor the text letters", () => {
    const passage: import("./types").ImportPassage = {
      title: "Part 2",
      body: `Guide: ${PLAIN.repeat(3)}`,
      groups: [
        {
          type: "mcq",
          instructions: "Questions 11-13",
          questions: [
            {
              number: 11,
              prompt: "Why?",
              options: [
                { key: "A", text: "x" },
                { key: "B", text: "y" },
                { key: "C", text: "z" },
              ],
              answer: ["B"],
            },
          ],
        },
      ],
    };
    const script = {
      speakers: {
        A: {
          role: "guide",
          gender: "female" as const,
          accent: "british" as const,
        },
      },
      turns: [{ speaker: "A", text: PLAIN }],
    };
    const problems = g.listeningProblems(
      {
        title: "L",
        kind: "listening",
        module: "academic",
        passages: [passage],
      },
      [2],
    )[0];
    expect(problems.map((p) => p.kind)).toEqual(["length", "count"]);
    const { prompt } = g.listeningExtendPrompt(
      { ...opts, skill: "listening", parts: [2] },
      2,
      passage,
      script,
      problems.filter((p) => p.kind === "length"),
    );
    expect(prompt).toContain("Extend it rather than rewriting it");
    expect(prompt).toContain("at least 650 words");
    expect(prompt).toContain('"number":11');
    const gt: ImportTest = {
      title: "S",
      kind: "reading",
      module: "general",
      passages: [
        {
          title: "S1",
          paragraphs: [
            { label: "A", text: "NOTICE ONE" },
            { text: "Details." },
            { label: "B", text: "NOTICE TWO" },
          ],
          groups: [],
        },
      ],
    };
    expect(g.labelledText(gt)).toBe(
      "[A] NOTICE ONE\n\nDetails.\n\n[B] NOTICE TWO",
    );
    expect(g.solverPrompt(gt)).toContain("[B] NOTICE TWO");
    expect(g.passageText(gt)).not.toContain("[B]");
    expect(g.readingSpec("general", 2).minGrade).toBe(8);
  });
  it("flags answers heard in the opening or crowded into one turn", () => {
    const body =
      "Guide: Welcome to the Oakwood centre, I'm Sam and I'll show you round.\n\nVisitor: Thanks. Is the pool open on Mondays?\n\nGuide: Yes, from seven until nine, and the sauna costs four pounds.";
    const t: ImportTest = {
      title: "L",
      kind: "listening",
      module: "academic",
      passages: [
        {
          title: "Part 1",
          body,
          groups: [
            {
              type: "fill",
              instructions: "Questions 1-3",
              questions: [
                {
                  number: 1,
                  prompt: "Guide's name: ________",
                  answer: ["Sam"],
                },
                {
                  number: 2,
                  prompt: "Pool opens at ________",
                  answer: ["seven"],
                },
                { number: 3, prompt: "Sauna: £________", answer: ["four"] },
              ],
            },
          ],
        },
      ],
    };
    const en = g.listeningProblems(t, [1])[0].map((p) => p.en);
    expect(en).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "question 1 is heard within the first 40 words",
        ),
        expect.stringContaining(
          "questions 2 and 3 are answered in the same turn",
        ),
      ]),
    );
  });
  it("measures each part's script, count and, for a lecture, register", () => {
    const part = (body: string, n: number) => ({
      title: "P",
      body,
      groups: [
        {
          type: "fill" as const,
          instructions: "Questions",
          questions: Array.from({ length: n }, (_, i) => ({
            number: i + 1,
            prompt: "x ________",
            answer: ["zzzq"],
          })),
        },
      ],
    });
    const t: ImportTest = {
      title: "L",
      kind: "listening",
      module: "academic",
      passages: [
        part(`Receptionist: ${PLAIN.repeat(6)}`, 10),
        part(`Lecturer: ${DENSE.repeat(18)}`, 9),
      ],
    };
    const problems = g.listeningProblems(t, [1, 4]);
    expect(problems[0]).toEqual([]);
    expect(problems[1].map((p) => p.en)).toEqual([
      expect.stringContaining("Part 4 has 9 questions"),
      expect.stringContaining("written article"),
    ]);
    // a talk (Part 2) is allowed a little more density than a lecture, but prose is still sent back
    const talk: ImportTest = {
      ...t,
      passages: [part(`Guide: ${DENSE.repeat(18)}`, 10)],
    };
    expect(g.listeningProblems(talk, [2])[0].map((p) => p.kind)).toEqual([
      "register",
    ]);
    expect(
      g.listeningProblems(
        { ...t, passages: [part(`Guide: ${PLAIN.repeat(7)}`, 10)] },
        [2],
      )[0],
    ).toEqual([]);
  });
});

describe("item-writing practices from Green & Hawkey (2010)", () => {
  it("shapes the text and the task mix as trained item writers do", () => {
    const ac = g.readingPrompt({ ...opts, position: 1 }).prompt;
    expect(ac).toContain("no journalistic hook");
    expect(ac).toContain("Start from the general");
    expect(ac).toContain("whole-text task");
    expect(ac).toContain("locating words");
    expect(ac).toContain("definite referent");
    const s1 = g.readingPrompt({
      ...opts,
      module: "general",
      position: 1,
    }).prompt;
    expect(s1).toContain("Documents read as the real thing");
    expect(s1).not.toContain("no journalistic hook");
    expect(
      g.readingPrompt({ ...opts, module: "general", position: 3 }).prompt,
    ).toContain("no journalistic hook");
  });
  it("states the editing-meeting checks for each type", () => {
    const p = g.readingPrompt({
      ...opts,
      types: ["tfng", "mcq", "fill"],
    }).prompt;
    expect(p).toContain("antonym or one changed detail");
    expect(p).toContain("never addresses");
    expect(p).toContain("no two of them meaning the same thing");
    expect(p).toContain("about equally often");
    expect(p).toContain("nouns or noun phrases");
    expect(g.REVIEW_SYSTEM).toContain("preposition that could point two ways");
    expect(g.REVIEW_SYSTEM).toContain(
      "keys of a group sit in the same position",
    );
    expect(g.REVIEW_SYSTEM).toContain('"text": []');
  });
  it("reads the editor's remarks on the passage", () => {
    expect(
      g.parseReviewNotes(
        '{"problems": [], "text": ["GPS is not glossed", " "]}',
      ),
    ).toEqual(["GPS is not glossed"]);
    expect(g.parseReviewNotes('{"problems": []}')).toEqual([]);
    expect(g.parseReviewNotes("not json")).toEqual([]);
  });
});

describe("speaking", () => {
  it("frames the parts as the examiner guidelines and examiner evidence suggest", () => {
    const p = g.speakingPrompt({ ...opts, skill: "speaking" }).prompt;
    expect(p).toContain("do something else at the moment");
    expect(p).toContain("Tell me more about that");
    expect(p).toContain("Rounding-off questions (optional)");
    expect(p).toContain("one to two minutes");
    expect(p).toContain('"(easier)"');
    expect(p).toContain("stereotypes");
    expect(p).toContain("task card");
    expect(p).not.toContain("your hometown.");
  });
});

describe("task format checks for writing and speaking", () => {
  const base = { ...opts, module: "academic" as const };
  const writing = (over: Partial<ImportTest["passages"][number]>[]): ImportTest => ({
    title: "w",
    kind: "writing",
    module: "academic",
    passages: over.map((p) => ({ groups: [], ...p })),
  });
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const task1 = {
    title: "Task 1",
    paragraphs: [
      { text: "You should spend about 20 minutes on this task." },
      { text: "The bar chart below shows visits." },
      { text: "Visits", image: "chart.png" },
      { text: "Summarise the information by selecting and reporting the main features, and make comparisons where relevant." },
      { text: "Write at least 150 words." },
    ],
    sample: words(180),
  };
  const task2 = {
    title: "Task 2",
    body: "You should spend about 40 minutes on this task.\n\nSome people think cities should ban cars. To what extent do you agree?\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.",
    sample: words(290),
  };
  it("passes a complete writing set and names what a draft lacks", () => {
    const o = { ...base, skill: "writing" as const, writingTasks: ["task1", "task2"] as ("task1" | "task2")[] };
    expect(g.taskProblems(writing([task1, task2]), o)).toEqual([]);
    const noChart = writing([{ ...task1, paragraphs: task1.paragraphs.filter((p) => !p.image) }, task2]);
    expect(g.taskProblems(noChart, o).map((p) => p.kind)).toEqual(["format"]);
    const shortEssay = writing([task1, { ...task2, sample: words(120) }]);
    expect(g.taskProblems(shortEssay, o).map((p) => p.kind)).toEqual(["sample"]);
    expect(g.taskProblems(writing([task2]), o).map((p) => p.kind)).toEqual(["count"]);
    expect(g.taskProblems(writing([task2]), { ...o, writingTasks: ["task2"] })).toEqual([]);
    const letter = writing([
      { title: "Task 1", body: "You should spend about 20 minutes on this task.\n\nYou recently moved. Write a letter to a friend. In your letter:\n- explain why you moved\n- describe the new place\n- invite them to visit\n\nWrite at least 150 words.\n\nYou do NOT need to write any addresses.\n\nBegin your letter as follows:\n\nDear …,", sample: words(190) },
    ]);
    expect(g.taskProblems(letter, { ...o, module: "general", writingTasks: ["task1"] })).toEqual([]);
    const flatLetter = { ...letter, passages: [{ ...letter.passages[0], body: letter.passages[0].body!.replace(/\n- /g, " ") }] };
    expect(g.taskProblems(flatLetter, { ...o, module: "general", writingTasks: ["task1"] }).map((p) => p.kind)).toEqual(["format"]);
  });
  it("checks the speaking frames: question counts, the card wording and the Part 3 marks", () => {
    const o = { ...base, skill: "speaking" as const };
    const q = (n: number) => Array.from({ length: n }, (_, i) => `Question ${i}?`).join("\n");
    const set: ImportTest = {
      title: "s",
      kind: "speaking",
      module: "academic",
      passages: [
        { title: "Part 1", body: `Let's talk about what you do.\n${q(3)}\nFollow-up: Tell me more about that.\nLet's talk about food.\n${q(3)}\nFollow-up: Why?\nLet's talk about weekends.\n${q(3)}\nFollow-up: When?`, sample: words(60), groups: [] },
        { title: "Part 2", body: "Describe a place you like.\nYou should say:\nwhere it is\nwhat it looks like\nhow often you go\nand explain why you like it.\nYou will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say.", sample: words(200), groups: [] },
        { title: "Part 3", body: `Let's consider first public places.\n${q(3)} (easier)\nIs that hard? (challenging)\nLet's consider cities.\n${q(3)}`, sample: words(120), groups: [] },
      ],
    };
    expect(g.taskProblems(set, o)).toEqual([]);
    const thin = { ...set, passages: [{ ...set.passages[0], body: `Let's talk.\n${q(4)}\nFollow-up: Why?` }, set.passages[1], set.passages[2]] };
    expect(g.taskProblems(thin, o).map((p) => p.kind)).toEqual(["count"]);
    const card = { ...set, passages: [set.passages[0], { ...set.passages[1], body: "Talk about a place you like for two minutes." }, set.passages[2]] };
    expect(g.taskProblems(card, o).map((p) => p.kind)).toEqual(["format", "format"]);
    const noMarks = { ...set, passages: [set.passages[0], set.passages[1], { ...set.passages[2], body: set.passages[2].body!.replace(/ \((easier|challenging)\)/g, "") }] };
    expect(g.taskProblems(noMarks, o).map((p) => p.kind)).toEqual(["format"]);
    expect(g.taskProblems({ ...set, passages: set.passages.slice(0, 2) }, o).map((p) => p.kind)).toEqual(["count"]);
  });
});

describe("writing", () => {
  it("rotates Task 2 through rhetorical kinds and keeps the chart small", () => {
    const w = (task2Kind?: import("./generate").Task2Kind) =>
      g.writingPrompt({
        ...opts,
        skill: "writing",
        module: "academic",
        writingTasks: ["task1", "task2"],
        task2Kind,
      }).prompt;
    expect(w("explain")).toContain("its causes and its effects");
    expect(w("explain")).not.toContain("Should …?");
    expect(w("hortatory")).toContain("Should …?");
    expect(w("opinion")).toContain("never a named real person");
    expect(w()).toContain("3-6 categories and 1-3 series, 12-20 values");
    expect(w()).toContain("never listing every value");
    expect(g.TASK2_KINDS.filter((k) => k.id === "hortatory")).toHaveLength(1);
    const seen = new Set(Array.from({ length: 60 }, () => g.randomTask2Kind()));
    expect(seen.size).toBeGreaterThan(3);
  });
  it("steers General Training Task 2 to everyday life", () => {
    expect(
      g.writingPrompt({
        ...opts,
        skill: "writing",
        module: "general",
        writingTasks: ["task2"],
      }).prompt,
    ).toContain("everyday social or practical life");
    expect(
      g.writingPrompt({
        ...opts,
        skill: "writing",
        module: "academic",
        writingTasks: ["task2"],
      }).prompt,
    ).not.toContain("everyday social or practical life");
  });
});

describe("key check and quotation marks", () => {
  it("finds a key the passage puts in quotation marks, and keeps apostrophes inside words", () => {
    const t: ImportTest = {
      title: "t",
      kind: "reading",
      module: "academic",
      passages: [
        {
          title: "T",
          body: "Researchers call the turning point 'peak water'. Near the glacier's edge, work starts at six o'clock. He said \u201cno more\u201d.",
          groups: [
            {
              type: "fill",
              instructions:
                "Questions 1-4 Choose NO MORE THAN TWO WORDS from the passage for each answer.",
              questions: [
                { number: 1, prompt: "a ________", answer: ["peak water"] },
                { number: 2, prompt: "b ________", answer: ["glacier's edge"] },
                { number: 3, prompt: "c ________", answer: ["o'clock"] },
                { number: 4, prompt: "d ________", answer: ["no more"] },
              ],
            },
          ],
        },
      ],
    };
    expect(g.checkAnswers(t).dropped).toEqual([]);
  });
});

describe("top-up after the checks", () => {
  const short: ImportTest = {
    title: "AI · t",
    kind: "reading",
    module: "academic",
    passages: [
      {
        title: "T",
        paragraphs: [
          {
            label: "A",
            text: "Bees in cities visit street trees. The study was done in London. Hives sit on flat roofs.",
          },
        ],
        groups: [
          {
            type: "tfng",
            instructions: "Questions 1-3",
            questions: [
              { number: 1, prompt: "Bees avoid trees.", answer: ["FALSE"] },
              { number: 2, prompt: "Bees like roses.", answer: ["NOT GIVEN"] },
              { number: 3, prompt: "Hives are on roofs.", answer: ["TRUE"] },
            ],
          },
          {
            type: "fill",
            instructions:
              "Questions 4-5 Choose NO MORE THAN TWO WORDS from the passage for each answer.",
            questions: [
              { number: 4, prompt: "Done in ________.", answer: ["London"] },
              {
                number: 5,
                prompt: "Hives sit on ________.",
                answer: ["flat roofs"],
              },
            ],
          },
        ],
      },
    ],
  };
  const dropped = [
    { number: 6, reason: "정답이 지문에 없음" },
    { number: 7, reason: "Q7 tests the same sentence as Q2" },
  ];

  it("asks for the shortfall with the groups, keys and faults listed", () => {
    const p = g.topUpPrompt(short, 0, 2, 7, dropped);
    expect(p).toContain("<passage>");
    expect(p).toContain("Group 1 [tfng] Questions 1-3");
    expect(p).toContain("4. Done in ________. → key: London");
    expect(p).toContain(
      "must carry 7 questions and now has 5. Write exactly 2 new items.",
    );
    expect(p).toContain("- the key does not appear word for word in the text");
    expect(p).toContain("- Q7 tests the same sentence as Q2");
    expect(p).toContain('type "fill"');
    expect(p).toContain('"group": 1, "after": 7');
    const l = g.topUpPrompt({ ...short, kind: "listening" }, 0, 1, 10, []);
    expect(l).toContain("<script>");
    expect(l).toContain(
      "This part must carry 10 questions and now has 9. Write exactly 1 new item.",
    );
    expect(l).not.toContain("<removed>");
    expect(l).not.toContain("Rules per type");
  });

  it("keeps only usable items and places them where the writer said", () => {
    const items = g.parseTopUp(
      {
        questions: [
          {
            group: 1,
            after: 3,
            prompt: "Bees never leave hives.",
            answer: ["FALSE"],
          },
          {
            group: 1,
            after: 3,
            prompt: "Trees are pruned yearly.",
            answer: [" NOT GIVEN "],
          },
          {
            group: 2,
            after: 0,
            prompt: "Bees visit ________.",
            answer: ["street trees"],
          },
          { group: 9, after: 0, prompt: "no such group", answer: ["x"] },
          { group: 2, after: 99, prompt: "no such anchor", answer: ["x"] },
          { group: 2, after: 4, prompt: "no answer", answer: [] },
          { group: 1, after: 1, prompt: "over the cap", answer: ["TRUE"] },
        ],
      },
      short.passages[0],
      3,
    );
    expect(items.map((i) => i.prompt)).toEqual([
      "Bees never leave hives.",
      "Trees are pruned yearly.",
      "Bees visit ________.",
    ]);
    expect(items[1].answer).toEqual(["NOT GIVEN"]);
    const ins = g.insertTopUp(short.passages[0], items);
    expect(ins.passage.groups[0].questions.map((q) => q.prompt)).toEqual([
      "Bees avoid trees.",
      "Bees like roses.",
      "Hives are on roofs.",
      "Bees never leave hives.",
      "Trees are pruned yearly.",
    ]);
    expect(ins.passage.groups[1].questions.map((q) => q.prompt)).toEqual([
      "Bees visit ________.",
      "Done in ________.",
      "Hives sit on ________.",
    ]);
    expect(ins.positions).toEqual([
      [0, 3],
      [0, 4],
      [1, 0],
    ]);
    expect(short.passages[0].groups[0].questions).toHaveLength(3);
    expect(g.parseTopUp("nonsense", short.passages[0], 2)).toEqual([]);
  });

  it("restores a type the set lost as a new group, only when asked", () => {
    expect(g.missingType(short.passages[0], ["tfng", "fill", "mcq", "heading"])).toBe("mcq");
    expect(g.missingType(short.passages[0], ["tfng", "fill"])).toBeUndefined();
    expect(g.missingType(short.passages[0], undefined)).toBeUndefined();
    const p = g.topUpPrompt(short, 0, 2, 7, [], "mcq");
    expect(p).toContain('one new group of type "mcq"');
    expect(p).toContain('"group": 0, "type": string, "instructions": string');
    expect(p).toContain('type "mcq"');
    expect(g.topUpPrompt(short, 0, 2, 7, [])).not.toContain('"group": 0');
    const raw = {
      questions: [
        { group: 0, type: "mcq", instructions: "Choose the correct letter, A, B or C.", after: 0, prompt: "Where are the hives?", options: [{ key: "A", text: "roofs" }, { key: "B", text: "parks" }, { key: "C", text: "gardens" }], answer: ["A"] },
        { group: 0, type: "mcq", instructions: "Choose the correct letter, A, B or C.", after: 0, prompt: "Where was the study?", options: [{ key: "A", text: "Paris" }, { key: "B", text: "London" }, { key: "C", text: "Rome" }], answer: ["B"] },
      ],
    };
    expect(g.parseTopUp(raw, short.passages[0], 2)).toEqual([]);
    const items = g.parseTopUp(raw, short.passages[0], 2, "mcq");
    expect(items.map((i) => i.newGroup?.type)).toEqual(["mcq", "mcq"]);
    const ins = g.insertTopUp(short.passages[0], items);
    expect(ins.passage.groups).toHaveLength(3);
    expect(ins.passage.groups[2]).toMatchObject({ type: "mcq", instructions: "Choose the correct letter, A, B or C." });
    expect(ins.passage.groups[2].questions.map((q) => q.prompt)).toEqual(["Where are the hives?", "Where was the study?"]);
    expect(ins.passage.groups[2].questions[0].options).toHaveLength(3);
    expect(ins.positions).toEqual([[2, 0], [2, 1]]);
  });

  it("runs a second round while items are still short and the first round added something", async () => {
    const reply = (text: string) => ({ text, model: "m", inputTokens: 0, outputTokens: 0 });
    let topUps = 0;
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      const req = (args as { req: { system: string; prompt: string } }).req;
      if (req.system === g.TOP_UP_SYSTEM) {
        topUps++;
        return reply(JSON.stringify({ questions: [{ group: 1, after: 2 + topUps, prompt: `Bees item ${topUps}.`, answer: ["TRUE"] }] }));
      }
      if (req.system === g.SOLVER_SYSTEM) return reply(JSON.stringify({ answers: [] }));
      return reply(JSON.stringify({ problems: [] }));
    });
    const settings = {
      provider: "claude-cli" as const,
      models: { "claude-cli": "m", "codex-cli": "", "antigravity-cli": "" },
      cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      ttsModel: "",
      speechModel: "",
      imageModel: "",
    };
    const r = await g.topUp(settings, short, [7], [], () => {});
    expect(topUps).toBe(2);
    expect(r.added).toBe(2);
    expect(r.notes).toEqual([]);
    expect(r.test.passages[0].groups[0].questions.map((q) => q.prompt)).toEqual([
      "Bees avoid trees.",
      "Bees like roses.",
      "Hives are on roofs.",
      "Bees item 1.",
      "Bees item 2.",
    ]);
    vi.mocked(invoke).mockReset();
  });

  it("verifies only the new items and reports what was kept", async () => {
    const reply = (text: string) => ({
      text,
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
    });
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (_cmd, args) => {
      const req = (args as { req: { system: string; prompt: string } }).req;
      calls.push(req.system.slice(0, 30));
      if (req.system === g.TOP_UP_SYSTEM)
        return reply(
          JSON.stringify({
            questions: [
              {
                group: 1,
                after: 3,
                prompt: "Bees never leave hives.",
                answer: ["FALSE"],
              },
              {
                group: 2,
                after: 0,
                prompt: "Bees visit ________.",
                answer: ["street trees"],
              },
            ],
          }),
        );
      if (req.system === g.SOLVER_SYSTEM)
        return reply(
          JSON.stringify({
            answers: [{ number: 4, answer: "TRUE", evidence: "x" }],
          }),
        );
      // the editor may touch only the new items: 1 is ignored, 5 (the new fill item) is dropped
      return reply(
        JSON.stringify({
          problems: [
            { number: 1, action: "drop", reason: "old item" },
            { number: 5, action: "drop", reason: "cues item 4" },
          ],
        }),
      );
    });
    const settings = {
      provider: "claude-cli" as const,
      models: { "claude-cli": "m", "codex-cli": "", "antigravity-cli": "" },
      cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
      ttsModel: "",
      speechModel: "",
      imageModel: "",
    };
    const steps: string[] = [];
    const r = await g.topUp(settings, short, [7], dropped, (s) =>
      steps.push(s), { rounds: 1 },
    );
    expect(steps).toEqual(["topup"]);
    expect(calls).toHaveLength(3);
    expect(
      r.test.passages[0].groups[0].questions.map(
        (q) => `${q.number} ${q.prompt}`,
      ),
    ).toEqual([
      "1 Bees avoid trees.",
      "2 Bees like roses.",
      "3 Hives are on roofs.",
      "4 Bees never leave hives.",
    ]);
    expect(r.test.passages[0].groups[1].questions.map((q) => q.number)).toEqual(
      [5, 6],
    );
    expect(r.test.passages[0].groups[1].instructions).toMatch(/^Questions 5-6/);
    expect(r).toMatchObject({
      fixed: 0,
      added: 1,
      notes: ["T: 보충 뒤에도 6/7문항"],
    });
    expect(r.dropped).toEqual([{ number: 5, reason: "cues item 4" }]);
    // nothing to do when the count is already right; a malformed reply leaves the test untouched
    expect(
      await g.topUp(settings, short, [5], [], (s) => steps.push(s)),
    ).toMatchObject({ test: short, added: 0 });
    vi.mocked(invoke).mockResolvedValue(reply("not json"));
    expect((await g.topUp(settings, short, [7], [], () => {})).test).toBe(
      short,
    );
    vi.mocked(invoke).mockReset();
  });
});

describe("task types and key balance, whatever model wrote the draft", () => {
  const group = (
    type: ImportTest["passages"][number]["groups"][number]["type"],
    n: number,
    answers: string[],
  ) => ({
    type,
    instructions: "Questions",
    questions: Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      prompt: `p${i}`,
      answer: [answers[i % answers.length]],
    })),
  });
  const withGroups = (...groups: ReturnType<typeof group>[]): ImportTest => ({
    title: "t",
    kind: "reading",
    module: "academic",
    passages: [
      {
        title: "T",
        paragraphs: [{ label: "A", text: PLAIN.repeat(8) }],
        groups,
      },
    ],
  });

  it("sends back types that were not asked for, too few types, and single-item groups", () => {
    const allowed = g.readingSpec("academic", 2).types; // matching, tfng, mcq, fill
    const stray = withGroups(
      group("heading", 5, ["i"]),
      group("tfng", 4, ["TRUE", "FALSE", "NOT GIVEN"]),
      group("fill", 4, ["x"]),
    );
    expect(g.typeProblems(stray, allowed, 3).map((p) => p.en)).toEqual([
      expect.stringContaining(
        "heading not allowed here; use only: matching, tfng, mcq, fill",
      ),
    ]);
    const few = withGroups(
      group("tfng", 7, ["TRUE", "FALSE", "NOT GIVEN"]),
      group("fill", 6, ["x"]),
    );
    expect(g.typeProblems(few, allowed, 3).map((p) => p.en)).toEqual([
      expect.stringContaining(
        "only 2 question types used (tfng, fill); use at least 3",
      ),
    ]);
    const lonely = withGroups(
      group("matching", 5, ["A"]),
      group("tfng", 4, ["TRUE", "FALSE", "NOT GIVEN"]),
      group("mcq", 3, ["A"]),
      group("fill", 1, ["x"]),
    );
    expect(g.typeProblems(lonely, allowed, 3).map((p) => p.kind)).toEqual([
      "types",
    ]);
    expect(g.typeProblems(lonely, allowed, 3)[0].en).toContain(
      "single item (fill)",
    );
    // a learner practising one type asks for one type, and that is enough
    expect(
      g.typeProblems(
        withGroups(group("tfng", 13, ["TRUE", "FALSE", "NOT GIVEN"])),
        ["tfng"],
        3,
      ),
    ).toEqual([]);
    const fine = withGroups(
      group("matching", 5, ["A"]),
      group("tfng", 4, ["TRUE", "FALSE", "NOT GIVEN"]),
      group("fill", 4, ["x"]),
    );
    expect(g.typeProblems(fine, allowed, 3)).toEqual([]);
    // readingProblems carries both checks and the user's own type choice
    expect(
      g
        .readingProblems(
          {
            ...fine,
            passages: [
              { ...fine.passages[0], groups: [...fine.passages[0].groups] },
            ],
          },
          g.readingSpec("academic", 2),
          ["heading", "fill"],
        )
        .map((p) => p.kind),
    ).toEqual(["easy", "types"]);
  });

  it("sends back TRUE/FALSE/NOT GIVEN groups whose keys are skewed", () => {
    const skewed = withGroups(
      group("tfng", 6, ["TRUE", "TRUE", "TRUE", "TRUE", "FALSE", "FALSE"]),
    );
    const p = g.balanceProblems(skewed);
    expect(p.map((x) => x.kind)).toEqual(["balance"]);
    expect(p[0].en).toContain("NOT GIVEN never occurs");
    expect(p[0].en).toContain("TRUE takes more than half");
    expect(p[0].ko).toContain("쏠렸습니다");
    expect(
      g.balanceProblems(
        withGroups(group("ynng", 5, ["YES", "NO", "NOT GIVEN", "YES", "NO"])),
      ),
    ).toEqual([]);
    // tiny groups and other types are left alone
    expect(
      g.balanceProblems(
        withGroups(group("tfng", 2, ["TRUE"]), group("mcq", 5, ["A"])),
      ),
    ).toEqual([]);
  });

  it("holds listening parts to their formats", () => {
    const part = (groups: ReturnType<typeof group>[]) => ({
      title: "P",
      body: `A: ${PLAIN.repeat(7)}`,
      groups,
    });
    const t: ImportTest = {
      title: "t",
      kind: "listening",
      module: "academic",
      passages: [
        part([group("mcq", 10, ["A"])]), // Part 1 takes completion only
        part([
          group("mcq", 4, ["A"]),
          group("matching", 4, ["A"]),
          group("fill", 2, ["x"]),
        ]), // three formats, one thin
        part([group("mcq", 5, ["A"]), group("matching", 5, ["B"])]), // fine
        part([group("fill", 10, ["zzzq"])]),
      ],
    };
    const en = g
      .listeningProblems(t, [1, 2, 3, 4])
      .map((ps) => ps.filter((p) => p.kind === "types").map((p) => p.en));
    expect(en[0]).toEqual([
      expect.stringContaining(
        "Part 1 uses mcq items; this part takes only fill",
      ),
    ]);
    expect(en[1]).toEqual([
      expect.stringContaining("3 formats"),
      expect.stringContaining("fill format has fewer than 3 items"),
    ]);
    expect(en[2]).toEqual([]);
    expect(en[3]).toEqual([]);
  });
});

describe("randomTopic avoiding used topics", () => {
  it("never returns a topic in the avoid list while others remain, ignoring case", async () => {
    const g = await import("./generate");
    const first = g.randomTopic("academic");
    const picks = Array.from({ length: 60 }, () => g.randomTopic("academic", undefined, [first.toUpperCase()]));
    expect(picks).not.toContain(first);
  });
  it("falls back to the whole pool once every topic is used", async () => {
    const g = await import("./generate");
    const all = Array.from({ length: 400 }, () => g.randomTopic("academic"));
    const t = g.randomTopic("academic", undefined, all);
    expect(all).toContain(t);
  });
});
