// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TestDetail } from "../lib/types";
import PromptPrintSheet from "./PromptPrintSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writing: TestDetail = {
  id: 1,
  title: "AI · IELTS Academic Writing: Habit Formation",
  kind: "writing",
  module: "academic",
  ai: true,
  reported: [],
  passages: [
    { id: 11, ord: 1, title: "Task 1", bodyHtml: "<p>The chart below shows…</p>", audio: null, sampleHtml: "<p>The chart illustrates…</p>", groups: [] },
    { id: 12, ord: 2, title: "Task 2", bodyHtml: "<p>Some people believe…</p>", audio: null, sampleHtml: "<p>It is often argued…</p>", groups: [] },
  ],
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

const texts = (sel: string) => [...document.body.querySelectorAll(sel)].map((e) => e.textContent);

describe("PromptPrintSheet", () => {
  it("prints every task with its model answer, mounted on <body>", () => {
    render(<PromptPrintSheet test={writing} />);
    const sheet = document.body.querySelector(".print-sheet")!;
    expect(sheet.parentElement).toBe(document.body);
    expect(sheet.querySelector("h1")?.textContent).toBe(writing.title);
    expect(sheet.textContent).toContain("Academic Writing");
    expect(texts(".print-sheet h2")).toEqual(["Task 1", "Task 2"]);
    expect(texts(".print-sheet h3")).toEqual(["모범 답안", "모범 답안"]);
    expect(sheet.textContent).toContain("The chart illustrates");
    expect(sheet.textContent).toContain("It is often argued");
    expect(sheet.textContent).not.toContain("내 답안");
  });

  it("adds the learner's draft under its own task only, one paragraph per blank line", () => {
    render(<PromptPrintSheet test={writing} draft={{ index: 1, text: "First paragraph.\n\nSecond paragraph." }} />);
    const [task1, task2] = [...document.body.querySelectorAll(".ps-passage")];
    expect(task1.textContent).not.toContain("내 답안");
    expect([...task2.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["내 답안", "모범 답안"]);
    expect(task2.querySelectorAll(".ps-body p").length).toBe(1 + 2 + 1);
  });

  it("labels a speaking set by parts and leaves out an empty draft and a missing model answer", () => {
    const speaking: TestDetail = { ...writing, kind: "speaking", title: "Speaking", passages: [{ ...writing.passages[0], title: null, sampleHtml: null }] };
    render(<PromptPrintSheet test={speaking} draft={{ index: 0, text: "   " }} />);
    const sheet = document.body.querySelector(".print-sheet")!;
    expect(sheet.textContent).toContain("TOEIC Speaking");
    expect(sheet.querySelector("h2")?.textContent).toBe("Part 1");
    expect(sheet.querySelectorAll("h3").length).toBe(0);
  });
});
