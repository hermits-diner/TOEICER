// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionGroup } from "../lib/types";
import QuestionGroupView from "./QuestionGroupView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ExplainPanel", () => ({ default: () => null }));

const group: QuestionGroup = {
  id: 1,
  type: "mcq",
  instructions: null,
  options: [],
  image: null,
  questions: [9, 10].map((n) => ({
    id: n,
    number: n,
    prompt: n === 9 ? "What is the purpose of the e-mail?" : "What will the man most likely do next?",
    options: ["A", "B", "C", "D"].map((key) => ({ key, text: `${key} choice` })),
    answer: ["B"],
  })),
};
const heard: QuestionGroup = {
  ...group,
  type: "lmcq",
  image: "data:image/png;base64,AAAA",
  questions: [{ id: 1, number: 1, prompt: "Number 1", options: ["A", "B", "C", "D"].map((key) => ({ key, text: `statement ${key}` })), answer: ["C"] }],
};

let root: Root;
let host: HTMLDivElement;
function render(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness({ results, g = group }: { results?: Record<number, boolean>; g?: QuestionGroup }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  return <QuestionGroupView group={g} answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} results={results} />;
}

const choices = (n: number) => [...host.querySelectorAll(`#q-${n} .choice`)] as HTMLButtonElement[];

describe("QuestionGroupView", () => {
  it("picks one choice per question and clears it on a second click", () => {
    render(<Harness />);
    act(() => choices(9)[1].click());
    expect(choices(9)[1].className).toContain("on");
    act(() => choices(9)[2].click());
    expect(choices(9).filter((b) => b.className.includes("on"))).toHaveLength(1);
    act(() => choices(9)[2].click());
    expect(choices(9).some((b) => b.className.includes("on"))).toBe(false);
  });
  it("locks the choices and shows the key after grading", () => {
    render(<Harness results={{ 9: true, 10: false }} />);
    expect(choices(9).every((b) => b.disabled)).toBe(true);
    expect(host.querySelector("#q-9")?.className).toContain("correct");
    expect(host.querySelector("#q-10 .answer-key")?.textContent).toBe("정답: B");
  });
  it("shows a heard item's photo and letters only, and its words once graded", () => {
    render(<Harness g={heard} />);
    expect(host.querySelector("img.qgroup-figure")?.getAttribute("src")).toContain("data:image/png");
    expect(choices(1).map((b) => b.textContent)).toEqual(["A", "B", "C", "D"]);
    act(() => root.unmount());
    host.remove();
    render(<Harness g={heard} results={{ 1: false }} />);
    expect(choices(1)[2].textContent).toBe("Cstatement C");
  });
});
