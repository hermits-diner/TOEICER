import { describe, expect, it } from "vitest";
import { detectType, extractTests, parseAnswerKey, parseAnswerValue } from "./extract";
import { validateImport } from "./importFormat";

/* Original text laid out the way PDF extraction delivers official sample tasks:
   page markers, a contents page, indented paragraphs, a repeated title on each answers page. */
const LONG = "The canal was dug by hand over eleven years and opened to barges in the spring. ".repeat(6);

const DOC = `
Practice Tasks
Page 1 of 9     example.org

Sample Task – True False ........................ 2
Sample Task – True False (Answers) .............. 3

Page 2 of 9     example.org

Sample Task – True False

[Note: This is an extract about a canal.]
  The Old Canal
  ${LONG}
  ${LONG}

Questions 1 – 3

Do the following statements agree with the information given in the passage?

In boxes 1-3 on your answer sheet, write

  TRUE  if the statement agrees with the information
  FALSE  if the statement contradicts the information
  NOT GIVEN  if there is no information on this

1  The canal was dug with machines.

2  Barges used the canal in its first
year.

3  The canal is still open today.

Page 3 of 9     example.org

Sample Task – True False
(Answers)

1  FALSE

2  TRUE

3  NOT GIVEN

Page 4 of 9     example.org

Sample Task – Multiple
Choice: one answer

  ${LONG}
  ${LONG}

Questions 4 – 5

Choose the correct letter, A, B, C or D.

4  The writer says the canal was

  A  wider than planned.
  B  cheaper than planned.
  C  finished late.
  D  never used.

5  Barges were pulled by

  A  horses.
  B  engines.
  C  sails.
  D  people.

Page 5 of 9     example.org

Sample Task – Multiple
Choice: one answer (Answers)

4  C ■ finished late

5  A ■ horses

Page 6 of 9     example.org

Sample Task – Notes

  ${LONG}
  ${LONG}

Questions 6 – 8

Complete the notes below.
Choose ONE WORD ONLY from the passage for each answer.

  The canal
  •  The canal was dug over a period of eleven

6 ………… .

•  It was opened to barges in the 7 ………… and closed in the 8 ………… .

Questions 9 – 10

Look at the following items and the list of groups below.
Match each item with the correct group.

9  the first lock

10  the tow path

  Built by

 A
B
C

 the farmers
the engineers
the army

Page 7 of 9     example.org

Sample Task – Notes
(Answers)

6  years
7  spring / springtime
8  (the) winter
9  B
10  C

Alternative answers are separated by a slash (/).
`;

describe("extractTests on a multi-task document", () => {
  const results = extractTests(DOC, { title: "Practice Tasks" });

  it("splits tasks at each answer key and takes titles from the answers page", () => {
    expect(results.map((r) => r.draft.title)).toEqual([
      "Sample Task – True False",
      "Sample Task – Multiple Choice: one answer",
      "Sample Task – Notes",
    ]);
  });

  it("produces drafts that pass import validation", () => {
    for (const r of results) expect(validateImport(r.draft).errors).toEqual([]);
    expect(results.every((r) => r.confidence === 1 && r.issues.length === 0)).toBe(true);
  });

  it("reads true/false statements, wrapped prompts and the passage", () => {
    const p = results[0].draft.passages[0];
    expect(p.title).toBe("The Old Canal");
    expect(p.paragraphs?.map((x) => x.text.slice(0, 13))).toEqual(["[Note: This i", "The canal was", "The canal was"]);
    expect(p.groups[0].type).toBe("tfng");
    expect(p.groups[0].questions).toEqual([
      { number: 1, prompt: "The canal was dug with machines.", options: undefined, answer: ["FALSE"] },
      { number: 2, prompt: "Barges used the canal in its first year.", options: undefined, answer: ["TRUE"] },
      { number: 3, prompt: "The canal is still open today.", options: undefined, answer: ["NOT GIVEN"] },
    ]);
  });

  it("keeps the contents page out of the first task", () => {
    expect(JSON.stringify(results[0].draft)).not.toContain("Practice Tasks");
    expect(results[0].source).not.toContain("Page 2 of 9");
  });

  it("attaches options to each multiple-choice question and reduces answers to the letter", () => {
    const g = results[1].draft.passages[0].groups[0];
    expect(g.type).toBe("mcq");
    expect(g.questions.map((q) => q.options?.map((o) => o.key).join(""))).toEqual(["ABCD", "ABCD"]);
    expect(g.questions[1].options?.[0]).toEqual({ key: "A", text: "horses." });
    expect(g.questions.map((q) => q.answer)).toEqual([["C"], ["A"]]);
  });

  it("finds gaps numbered inside sentences, joining a sentence split across lines", () => {
    const g = results[2].draft.passages[0].groups[0];
    expect(g.type).toBe("fill");
    expect(g.instructions).not.toContain("eleven");
    expect(g.questions[0].prompt).toBe("The canal was dug over a period of eleven ________ .");
    expect(g.questions[1].prompt).toBe(g.questions[2].prompt);
    expect(g.questions[1].prompt).toContain("(7) ________ and closed in the (8) ________");
    expect(g.questions.map((q) => q.answer)).toEqual([["years"], ["spring", "springtime"], ["(the) winter"]]);
  });

  it("reads options laid out as a column of letters followed by a column of texts", () => {
    const g = results[2].draft.passages[0].groups[1];
    expect(g.type).toBe("matching");
    expect(g.options).toEqual([
      { key: "A", text: "the farmers" },
      { key: "B", text: "the engineers" },
      { key: "C", text: "the army" },
    ]);
    expect(g.questions.map((q) => q.answer[0])).toEqual(["B", "C"]);
  });
});

describe("extractTests edge cases", () => {
  it("takes the passage from after the questions when they come first", () => {
    const doc = `Questions 1 – 2
Choose the correct heading for each section from the list of headings below.
      List of Headings
i  How it began
ii  Why it failed
iii  What came next

1  Section A
2  Section B

  A  ${LONG}
  B  ${LONG}
`;
    const [r] = extractTests(doc, { title: "Headings page" });
    const p = r.draft.passages[0];
    expect(r.draft.title).toBe("Headings page");
    expect(p.groups[0].type).toBe("heading");
    expect(p.groups[0].options?.map((o) => o.key)).toEqual(["i", "ii", "iii"]);
    expect(p.paragraphs?.map((x) => x.label)).toEqual(["A", "B"]);
    expect(r.issues).toEqual(["정답표를 찾지 못했습니다. 검수 화면에서 정답을 붙여넣어 주십시오."]);
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("handles a shared option list for 'choose TWO letters' and paired answers", () => {
    const doc = `Task
${LONG}${LONG}
Questions 1 and 2
Choose TWO letters, A-C.
Which TWO reasons are given by the writer?
 A  It was cheap.
B  It was fast.
C  It was safe.

Answers
1&2  IN EITHER ORDER
  A ■ It was cheap
  C ■ It was safe
`;
    const [r] = extractTests(doc);
    const g = r.draft.passages[0].groups[0];
    expect(g.type).toBe("mcq");
    expect(g.options).toHaveLength(3);
    expect(g.questions.map((q) => q.prompt)).toEqual(Array(2).fill("Which TWO reasons are given by the writer?"));
    expect(g.questions.map((q) => q.answer)).toEqual([["A", "C"], ["A", "C"]]);
    expect(validateImport(r.draft).errors).toEqual([]);
  });

  it("reads sentence endings that follow the last question without a blank line", () => {
    const doc = `${LONG}${LONG}
Questions 1 – 2
Complete each sentence with the correct ending, A-C, below.

1  The canal was dug by hand because

2  The canal closed because
    A    the railway took its trade.
B  machines were too costly
to bring in.
C  it froze every winter.

Answers
1  B ■ machines were too costly to bring in
2  A ■ the railway took its trade
`;
    const g = extractTests(doc)[0].draft.passages[0].groups[0];
    expect(g.type).toBe("matching");
    expect(g.options).toEqual([
      { key: "A", text: "the railway took its trade." },
      { key: "B", text: "machines were too costly to bring in." },
      { key: "C", text: "it froze every winter." },
    ]);
    expect(g.questions.map((q) => [q.prompt, q.answer[0]])).toEqual([
      ["The canal was dug by hand because", "B"],
      ["The canal closed because", "A"],
    ]);
  });

  it("reads a word box whose letters and words are laid out unevenly", () => {
    const doc = `${LONG}${LONG}
Questions 1 – 2
Complete the summary using the list of words, A-D, below.

The canal was 1 ............ to dig and 2 ………… to run.

A
slow
B
costly
C  cheap  D  easy

Answers
1  A ■ slow
2  C ■ cheap
`;
    const g = extractTests(doc)[0].draft.passages[0].groups[0];
    expect(g.type).toBe("matching");
    expect(g.options?.map((o) => `${o.key} ${o.text}`)).toEqual(["A slow", "B costly", "C cheap", "D easy"]);
    expect(g.questions.map((q) => q.answer)).toEqual([["A"], ["C"]]);
  });

  it("flags missing questions and returns nothing for pages without questions", () => {
    const [r] = extractTests(`${LONG}${LONG}\nQuestions 1-3\nAnswer the questions below.\n1  Who dug it?\n`);
    expect(r.draft.passages[0].groups[0].questions).toHaveLength(3);
    expect(r.issues[0]).toContain("3개 중 2개");
    expect(extractTests("Welcome to our site.\nPractice tests are listed below.")).toEqual([]);
  });
});

describe("extractTests on text from a web page", () => {
  // Layout of an interactive practice page: drop-downs and inputs become gaps, the key sits in a list at the end.
  const page = `This page holds section 1 of the practice test.

READING PASSAGE 1

You should spend about 20 minutes on Questions 1–6, which are based on Reading Passage 1 below.

The Old Canal

(A) ${LONG}

(B) ${LONG}

Questions 1–2

Do the following statements agree with the information in the text? Write

TRUE if the statement agrees with the information

FALSE if the statement contradicts the information

NOT GIVEN if there is no information on this

1. The canal was dug with machines.
________

2. Barges used the canal in its first year. ________

3. The canal is still open today. ________

Question 4

Choose the correct letter, A, B or C.

4. The canal was built by

A local farmers

B hired diggers

C the army

Questions 5–6

Complete the summary below. Write ONE WORD ONLY.

The canal took eleven 5. ________ to dig and opened in the 6. ________ .

ANSWERS

Each question correctly answered scores 1 mark.

Section 1

1. False

2. True

3. Not Given

4. B

5. years

6. spring

Contact us`;
  const [r] = extractTests(page, { title: "General Reading Test 1. Section 1" });
  const p = r.draft.passages[0];

  it("reads the key under a bare heading despite the lines before it", () => {
    expect(p.groups.flatMap((g) => g.questions.map((q) => q.answer[0]))).toEqual(["FALSE", "TRUE", "NOT GIVEN", "B", "years", "spring"]);
    expect(r.issues).toEqual([]);
    expect(r.confidence).toBe(1);
  });

  it("follows the numbering past a heading that declares too few questions", () => {
    expect(p.groups[0].questions.map((q) => q.prompt)).toEqual([
      "The canal was dug with machines.",
      "Barges used the canal in its first year.",
      "The canal is still open today.",
    ]);
  });

  it("accepts lower-case options under a question and gaps numbered with a full stop", () => {
    expect(p.groups[1].questions[0].options).toEqual([
      { key: "A", text: "local farmers" },
      { key: "B", text: "hired diggers" },
      { key: "C", text: "the army" },
    ]);
    expect(p.groups[2].questions[0].prompt).toBe("The canal took eleven (5) ________ to dig and opened in the (6) ________ .");
  });

  it("keeps the introduction out of the passage and reads bracketed paragraph labels", () => {
    expect(p.title).toBe("The Old Canal");
    expect(p.paragraphs?.map((x) => x.label)).toEqual(["A", "B"]);
    expect(p.paragraphs?.[0].text.startsWith("The canal was dug by hand")).toBe(true);
  });

  it("takes the module from the page title", () => {
    expect(r.draft.module).toBe("general");
    expect(validateImport(r.draft).errors).toEqual([]);
  });
});

describe("extractTests on pages with irregular headings", () => {
  const page = `Read the text below and answer Questions 1–7

Why did the canal close?

![Map of the canal](https://example.org/canal-map.png)

(A) ${LONG}

(B) ${LONG}

(C) ${LONG}

The passage has three paragraphs, A–C.

Which paragraph contains the following information? Write the correct letter, A–C.

1. the cost of digging

2. the first barges

Questions 3–5

Choose the correct letter, A, B or C.

3. The canal was dug

A by hand

B by machines that the company had bought from abroad, long before any other canal in the region was begun, at a price which its owners later described as ruinous

C by soldiers

4. It opened

A in spring

B in winter

C in summer

Questions 5–7

Complete the summary below.

![Lock diagram](img-0123456789abcdef0123456789abcdef.png)

The canal took eleven 5. ________ to dig. It opened to 6. ________ in the spring. Its banks were lined with 7. ________ .

ANSWERS

1. B

2. A

3. A

4. A

5. years/li>

6. barges>

7. clay

8. unused`;
  const [r] = extractTests(page, { title: "Canal test" });
  const [first, mcq, summary] = r.draft.passages[0].groups;

  it("recovers questions printed without a heading, using the key's numbering", () => {
    expect(first.type).toBe("matching");
    expect(first.questions.map((q) => [q.number, q.prompt, q.answer[0]])).toEqual([
      [1, "the cost of digging", "B"],
      [2, "the first barges", "A"],
    ]);
    expect(first.instructions).toContain("The passage has three paragraphs");
  });

  it("offers the letters named in the instructions, not just those used in the key", () => {
    expect(first.options?.map((o) => o.key)).toEqual(["A", "B", "C"]);
  });

  it("cuts a heading short when it overlaps the next one, and reads long options", () => {
    expect(mcq.questions.map((q) => q.number)).toEqual([3, 4]);
    expect(mcq.questions[0].options).toHaveLength(3);
    expect(mcq.questions[0].options?.[1].text).toContain("ruinous");
  });

  it("gives each gap of a summary its own sentence and drops markup debris from the key", () => {
    expect(summary.questions.map((q) => q.prompt)).toEqual([
      "The canal took eleven ________ to dig.",
      "It opened to ________ in the spring.",
      "Its banks were lined with ________ .",
    ]);
    expect(summary.questions.map((q) => q.answer)).toEqual([["years"], ["barges"], ["clay"]]);
  });

  it("takes a question as the passage title, drops the rubric and keeps pictures in place", () => {
    const p = r.draft.passages[0];
    expect(p.title).toBe("Why did the canal close?");
    expect(p.paragraphs?.map((x) => x.label ?? x.text)).toEqual(["Map of the canal", "A", "B", "C"]);
    expect(p.paragraphs?.[0].image).toBe("https://example.org/canal-map.png");
    expect(summary.image).toBe("img-0123456789abcdef0123456789abcdef.png");
    expect(summary.instructions).toBe("Questions 5–7 Complete the summary below.");
    expect(first.image).toBeUndefined();
  });

  it("reports answers without a question", () => {
    expect(r.issues).toEqual(["정답표에는 있지만 문항을 찾지 못한 번호: 8"]);
  });

  it("reports diagram questions that come without a picture", () => {
    const doc = `${LONG}${LONG}
Questions 1-2
Label the diagram below.
1 ............
2 ............

Answers
1 lock
2 gate
`;
    expect(extractTests(doc)[0].issues).toContain("그림을 보고 푸는 문항으로 보이는데 그림을 찾지 못했습니다: 1, 2");
  });
});

describe("answer keys", () => {
  it("parses answer values", () => {
    expect(parseAnswerValue("A ■ abolishing pay schemes")).toEqual(["A"]);
    expect(parseAnswerValue("iii  How a concept was applied")).toEqual(["iii"]);
    expect(parseAnswerValue("two to five / 2-5")).toEqual(["two to five", "2-5"]);
    expect(parseAnswerValue("South African tunneling/tunnelling")).toEqual(["South African tunneling", "South African tunnelling"]);
    expect(parseAnswerValue("(a/the) condenser")).toEqual(["(a) condenser", "(the) condenser"]);
    expect(parseAnswerValue("hot dry air ■ dry hot air")).toEqual(["hot dry air", "dry hot air"]);
  });

  it("parses a pasted key in several layouts", () => {
    const key = parseAnswerKey("Answers\n1. TRUE\n2) B\n3 river bank\nnot an answer\n4: 1985     5 NOT GIVEN");
    expect([...key.entries()]).toEqual([
      [1, ["TRUE"]],
      [2, ["B"]],
      [3, ["river bank"]],
      [4, ["1985"]],
      [5, ["NOT GIVEN"]],
    ]);
  });
});

describe("detectType", () => {
  it("recognises the common instruction wordings", () => {
    expect(detectType("write TRUE if… FALSE if… NOT GIVEN if…")).toBe("tfng");
    expect(detectType("write YES if… NO if… NOT GIVEN if…")).toBe("ynng");
    expect(detectType("Choose the correct heading for each paragraph")).toBe("heading");
    expect(detectType("Choose TWO letters, A-E.")).toBe("mcq");
    expect(detectType("Complete each sentence with the correct ending, A-F")).toBe("matching");
    expect(detectType("Complete the summary. NO MORE THAN TWO WORDS")).toBe("fill");
    expect(detectType("Answer the questions below.")).toBe("short");
  });
});
