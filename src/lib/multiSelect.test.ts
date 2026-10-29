import { describe, expect, it } from "vitest";
import { groupItems, picksOf, togglePick } from "./multiSelect";
import type { QuestionGroup } from "./types";

const options = ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, text: `Option ${key}` }));

/** "Questions 6-8 Choose THREE letters": one question per mark, all sharing the prompt and the pool. */
const chooseThree: QuestionGroup = {
  id: 2,
  type: "mcq",
  instructions: "Questions 6-8 Choose THREE letters, A-F.",
  options,
  image: null,
  questions: [6, 7, 8].map((n) => ({
    id: n,
    number: n,
    prompt: "Which THREE things should the caller bring to the meeting?",
    options: [],
    answer: ["B", "D", "E"],
  })),
};

const q = (id: number, prompt: string, answer: string[], own = false) => ({
  id,
  number: id,
  prompt,
  options: own ? options.slice(0, 4) : [],
  answer,
});

describe("groupItems", () => {
  it("folds a run of questions that share one prompt and one pool into a multi-select item", () => {
    const items = groupItems(chooseThree);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("multi");
    if (items[0].kind === "multi") expect(items[0].questions.map((x) => x.id)).toEqual([6, 7, 8]);
  });

  it("keeps ordinary questions single, even when two happen to accept the same letter", () => {
    const group: QuestionGroup = {
      ...chooseThree,
      questions: [q(1, "What time does the shop open?", ["B"]), q(2, "Where is the entrance?", ["B"]), q(3, "Who pays?", ["A"])],
    };
    expect(groupItems(group).map((i) => i.kind)).toEqual(["single", "single", "single"]);
  });

  it("does not fold questions that carry their own option lists", () => {
    const group: QuestionGroup = {
      ...chooseThree,
      questions: [q(1, "Same prompt", ["A", "B"], true), q(2, "Same prompt", ["A", "B"], true)],
    };
    expect(groupItems(group).map((i) => i.kind)).toEqual(["single", "single"]);
  });

  it("needs the pool to cover the run: two questions with one shared answer stay single", () => {
    const group: QuestionGroup = { ...chooseThree, questions: [q(1, "Same prompt", ["A"]), q(2, "Same prompt", ["A"])] };
    expect(groupItems(group).map((i) => i.kind)).toEqual(["single", "single"]);
  });

  it("folds a 'Choose TWO' run sitting after a single question in the same group", () => {
    const group: QuestionGroup = {
      ...chooseThree,
      questions: [q(5, "What is the fee?", ["C"]), q(6, "Which TWO items are free?", ["A", "D"]), q(7, "Which TWO items are free?", ["A", "D"])],
    };
    const items = groupItems(group);
    expect(items.map((i) => i.kind)).toEqual(["single", "multi"]);
  });

  it("leaves non-mcq groups alone", () => {
    const group: QuestionGroup = { ...chooseThree, type: "matching" };
    expect(groupItems(group).map((i) => i.kind)).toEqual(["single", "single", "single"]);
  });
});

describe("togglePick", () => {
  const qs = chooseThree.questions;

  it("adds a letter and assigns the picks to the questions in option order", () => {
    let answers: Record<number, string> = {};
    for (const [id, v] of togglePick(answers, qs, options, "D")) answers[id] = v;
    expect(picksOf(answers, qs)).toEqual(["D"]);
    expect(answers).toEqual({ 6: "D", 7: "", 8: "" });

    for (const [id, v] of togglePick(answers, qs, options, "B")) answers[id] = v;
    expect(answers).toEqual({ 6: "B", 7: "D", 8: "" });
  });

  it("removes a letter that is already picked", () => {
    let answers: Record<number, string> = { 6: "B", 7: "D", 8: "E" };
    for (const [id, v] of togglePick(answers, qs, options, "D")) answers[id] = v;
    expect(answers).toEqual({ 6: "B", 7: "E", 8: "" });
  });

  it("ignores a new letter once every mark is taken", () => {
    const answers: Record<number, string> = { 6: "B", 7: "D", 8: "E" };
    expect(togglePick(answers, qs, options, "A")).toEqual([]);
  });

  it("never gives two questions the same letter, so a repeated pick cannot earn two marks", () => {
    let answers: Record<number, string> = { 6: "B", 7: "B", 8: "" };
    for (const [id, v] of togglePick(answers, qs, options, "E")) answers[id] = v;
    const values = Object.values(answers).filter(Boolean);
    expect(new Set(values).size).toBe(values.length);
  });
});
