// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionGroup } from "../lib/types";
import QuestionGroupView from "./QuestionGroupView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ExplainPanel", () => ({ default: () => null }));

const options = ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, text: `Option ${key}` }));

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

/** Holds the answers the way ReadingPractice does, so several onAnswer calls in a row all land. */
function Harness({ group, onChange }: { group: QuestionGroup; onChange: (a: Record<number, string>) => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  return (
    <QuestionGroupView
      group={group}
      answers={answers}
      onAnswer={(id, v) =>
        setAnswers((a) => {
          const next = { ...a, [id]: v };
          onChange(next);
          return next;
        })
      }
    />
  );
}

const choiceButton = (key: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".choice")].find((b) => b.querySelector("b")?.textContent === key)!;
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("QuestionGroupView: Choose THREE letters", () => {
  it("shows the item once, numbered 6–8, with one list of options", () => {
    render(<Harness group={chooseThree} onChange={() => {}} />);
    expect(document.body.querySelectorAll(".question").length).toBe(1);
    expect(document.body.querySelector(".qnum")?.textContent).toBe("6–8");
    expect(document.body.querySelectorAll(".choice").length).toBe(6);
    expect(document.body.textContent).toContain("3개 선택");
  });

  it("lets three letters be picked and stores them one per question", () => {
    let latest: Record<number, string> = {};
    render(<Harness group={chooseThree} onChange={(a) => (latest = a)} />);
    click(choiceButton("E"));
    click(choiceButton("B"));
    click(choiceButton("D"));
    expect([...document.body.querySelectorAll(".choice.on")].map((b) => b.querySelector("b")?.textContent)).toEqual(["B", "D", "E"]);
    expect(latest).toEqual({ 6: "B", 7: "D", 8: "E" });
  });

  it("blocks a fourth pick until one is cleared", () => {
    let latest: Record<number, string> = {};
    render(<Harness group={chooseThree} onChange={(a) => (latest = a)} />);
    for (const k of ["A", "B", "C"]) click(choiceButton(k));
    expect(choiceButton("D").disabled).toBe(true);
    click(choiceButton("B"));
    expect(choiceButton("D").disabled).toBe(false);
    click(choiceButton("D"));
    expect(latest).toEqual({ 6: "A", 7: "C", 8: "D" });
  });

  it("after submission marks each picked letter and shows the whole key", () => {
    render(
      <QuestionGroupView
        group={chooseThree}
        answers={{ 6: "B", 7: "C", 8: "E" }}
        onAnswer={() => {}}
        results={{ 6: true, 7: false, 8: true }}
      />,
    );
    expect(choiceButton("B").classList.contains("ok")).toBe(true);
    expect(choiceButton("E").classList.contains("ok")).toBe(true);
    expect(choiceButton("C").classList.contains("bad")).toBe(true);
    expect(document.body.textContent).toContain("2/3");
    expect(document.body.querySelector(".answer-key")?.textContent).toContain("B, D, E");
  });

  it("still renders an ordinary mcq group one question at a time", () => {
    const plain: QuestionGroup = {
      ...chooseThree,
      questions: [
        { id: 1, number: 1, prompt: "When does the course start?", options: options.slice(0, 3), answer: ["A"] },
        { id: 2, number: 2, prompt: "How much is the deposit?", options: options.slice(0, 3), answer: ["C"] },
      ],
    };
    render(<Harness group={plain} onChange={() => {}} />);
    expect(document.body.querySelectorAll(".question").length).toBe(2);
    expect(document.body.textContent).not.toContain("개 선택");
  });
});
