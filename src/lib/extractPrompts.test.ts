import { describe, expect, it } from "vitest";
import { decide, reviewDraft } from "./autoReview";
import { extractDrafts, extractPrompts } from "./extractPrompts";
import { passageToHtml, validateImport } from "./importFormat";

/* Original text in the layout of practice pages: a task box, tips, a model answer, then the site's own lines. */
const WRITING = `You should spend about 20 minutes on this task.

The chart below shows how many barges used the canal each year.

Write a report describing the information shown.

Write at least 150 words.

![](https://example.org/images/canal-chart.png)

How to answer this task?

1. Introduce the chart.

Model answer

The chart shows the number of barges on the canal over ten years.

Overall, traffic rose steadily.

(152 words)

Next sample >

Contact us About the project`;

const SPEAKING = `Our special formatting styles:

Part 1

Do you like canals?

Yes, I do. I grew up near one.

Where do you usually walk?

Along the towpath, most evenings.

Part 2

Now, have a look at the card and prepare a monologue.

Describe a canal you once visited. You should say:

Where it is

Who you went with

and say what you liked about it

A few years ago I walked along an old canal with my sister.

Part 3

Why do towns keep their old canals?

Mostly for leisure these days.

Next >

Contact us About the project`;

const LISTENING = `This is the first section of the test. Listen and answer.

@[audio](https://example.org/listening/1.1.mp3)

Questions 1-2

Complete the notes below.

Lock number (1) ________

Opened in (2) ________

Questions 3-4

Choose TWO letters, A-D.

Which TWO things did the caller bring?

A. A map

B. A lamp

C. A rope

D. A pump

ANSWERS

1. 7

2. spring

3. B

4. D`;

describe("writing pages", () => {
  const [r] = extractPrompts(WRITING, { title: "General Writing Task 1. Sample 1" });
  const task = r.draft.passages[0];

  it("takes the task, its chart and the model answer", () => {
    expect(r.draft.kind).toBe("writing");
    expect(r.draft.module).toBe("general");
    expect(task.title).toBe("Task 1");
    expect(task.paragraphs?.map((x) => x.image ?? x.text)).toEqual([
      "You should spend about 20 minutes on this task.",
      "The chart below shows how many barges used the canal each year.",
      "Write a report describing the information shown.",
      "Write at least 150 words.",
      "https://example.org/images/canal-chart.png",
    ]);
    expect(task.sample?.startsWith("How to answer this task?")).toBe(true);
    expect(task.sample?.endsWith("(152 words)")).toBe(true);
    expect(task.groups).toEqual([]);
  });

  it("names the essay Task 2 by its 40 minutes", () => {
    const essay = "You should spend about 40 minutes on this task.\n\nSome people think canals should be filled in. Do you agree?\n\nWrite at least 250 words.";
    const [e] = extractPrompts(essay, { title: "Essay" });
    expect(e.draft.passages[0].title).toBe("Task 2");
    expect(e.draft.passages[0].sample).toBeUndefined();
    expect(e.confidence).toBeLessThan(1);
  });
});

describe("speaking pages", () => {
  const [r] = extractDrafts(SPEAKING, { title: "Speaking practice: Canals" });
  const [one, two, three] = r.draft.passages;

  it("splits the parts into the examiner's questions and the model replies", () => {
    expect(r.draft.kind).toBe("speaking");
    expect(one.paragraphs?.map((x) => x.text)).toEqual(["Do you like canals?", "Where do you usually walk?"]);
    expect(one.sample).toBe("Q. Do you like canals?\n\nYes, I do. I grew up near one.\n\nQ. Where do you usually walk?\n\nAlong the towpath, most evenings.");
    expect(three.paragraphs?.map((x) => x.text)).toEqual(["Why do towns keep their old canals?"]);
    expect(three.sample).toBe("Q. Why do towns keep their old canals?\n\nMostly for leisure these days.");
  });

  it("keeps the cue card whole", () => {
    expect(two.paragraphs?.map((x) => x.text)).toEqual([
      "Describe a canal you once visited. You should say:",
      "Where it is",
      "Who you went with",
      "and say what you liked about it",
    ]);
    expect(two.sample).toBe("A few years ago I walked along an old canal with my sister.");
  });

  it("passes the automatic review and can be stored", () => {
    const v = reviewDraft(r.draft);
    expect(v.reasons).toEqual([]);
    expect(decide(v, r.issues)).toBe("store");
    expect(v.test?.passages[1].sample).toBe(two.sample);
  });
});

describe("listening pages", () => {
  const [r] = extractDrafts(LISTENING, { title: "Listening Sample 1. Section 1" });
  const p = r.draft.passages[0];

  it("keeps the recording, not the introduction, and needs no passage", () => {
    expect(r.draft.kind).toBe("listening");
    expect(p.audio).toBe("https://example.org/listening/1.1.mp3");
    expect(p.paragraphs).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.confidence).toBe(1);
  });

  it("accepts the chosen letters in any order", () => {
    expect(p.groups[1].questions.map((q) => q.answer)).toEqual([["B", "D"], ["B", "D"]]);
  });

  it("is stored by the automatic review, and held back without a recording", () => {
    expect(decide(reviewDraft(r.draft), r.issues)).toBe("store");
    const [silent] = extractDrafts(LISTENING.replace(/@\[audio\].*\n/, ""), { title: "Listening Sample 1. Section 1" });
    expect(silent.issues).toEqual(["음성 파일을 찾지 못했습니다."]);
    expect(decide(reviewDraft(silent.draft), silent.issues)).toBe("ask");
  });
});

describe("import format for the new kinds", () => {
  it("accepts tasks without questions only for writing and speaking", () => {
    const passage = { title: "Task 2", body: "Some people think canals should be filled in. Do you agree?", sample: "I disagree.\n\nCanals are useful." };
    const writing = validateImport({ title: "Essay", kind: "writing", passages: [passage] });
    expect(writing.errors).toEqual([]);
    expect(writing.test?.passages[0].sample).toBe(passage.sample);
    expect(passageToHtml({ body: passage.sample, groups: [] })).toBe("<p>I disagree.</p>\n<p>Canals are useful.</p>");
    expect(validateImport({ title: "Essay", kind: "reading", passages: [passage] }).errors).toEqual(["passages[0].groups: 문항 그룹이 하나 이상 필요합니다."]);
  });
});
