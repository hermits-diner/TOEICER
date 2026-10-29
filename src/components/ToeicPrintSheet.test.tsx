// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Passage, Question, TestDetail } from "../lib/types";
import ToeicPrintSheet, { genreOf } from "./ToeicPrintSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const q = (id: number, prompt: string, texts: string[], answer = "B"): Question => ({
  id,
  number: id,
  prompt,
  options: texts.map((text, i) => ({ key: "ABCD"[i], text })),
  answer: [answer],
});
const passage = (id: number, title: string, body: string, questions: Question[]): Passage => ({
  id,
  ord: id,
  title,
  bodyHtml: body,
  audio: null,
  sampleHtml: null,
  groups: [{ id, type: "mcq", instructions: null, options: [], image: null, questions }],
});

const reading: TestDetail = {
  id: 1,
  title: "AI · Reading",
  kind: "reading",
  module: "academic",
  ai: true,
  reported: [],
  passages: [
    passage(1, "Part 5 · Incomplete Sentences", "<p>A word or phrase is missing.</p>", [q(101, "The room is available ------- 2:00 P.M.", ["among", "between", "within", "from"])]),
    passage(2, "Part 7 · Single 1 (e-mail)", "<p>Dear Ms. Grant,</p>", [q(147, "Why was the e-mail sent?", ["To ask", "To thank", "To cancel", "To apply"], "A"), q(148, "What is attached?", ["A form", "A map", "A list", "A bill"], "C")]),
  ],
};

let root: Root;
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const render = (ui: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(ui));
  return document.body.querySelector(".toeic-sheet")!;
};

describe("ToeicPrintSheet", () => {
  it("prints like a test book: section band, PART bars, set lines, framed texts and an answer sheet", () => {
    const sheet = render(<ToeicPrintSheet test={reading} mode="questions" />);
    expect(sheet.querySelector(".tk-band b")?.textContent).toBe("READING TEST");
    expect([...sheet.querySelectorAll(".tk-part-head b")].map((b) => b.textContent)).toEqual(["PART 5", "PART 7"]);
    expect([...sheet.querySelectorAll(".tk-refer")].map((p) => p.textContent)).toEqual(["Questions 147–148 refer to the following e-mail."]);
    expect(sheet.querySelectorAll(".tk-text")).toHaveLength(1);
    expect(sheet.querySelector(".tk-choices.two")?.textContent).toBe("(A) among(B) between(C) within(D) from");
    expect([...sheet.querySelectorAll(".tk-omr-col tbody th")].map((t) => t.textContent)).toEqual(["101", "147", "148"]);
    expect(sheet.querySelector(".tk-key")).toBeNull();
  });
  it("adds a scoring page with part counts and an estimated score", () => {
    const sheet = render(<ToeicPrintSheet test={reading} mode="answers" responses={{ 101: "B", 147: "B" }} results={{ 101: true, 147: false, 148: true }} />);
    expect([...sheet.querySelectorAll(".tk-cell b")].map((b) => b.textContent)).toEqual(["B", "A", "C"]);
    expect(sheet.querySelector(".tk-cell.x i")?.textContent).toBe("B");
    expect([...sheet.querySelectorAll(".tk-key-parts td.fill")].map((t) => t.textContent)).toEqual(["1 / 1", "1 / 2"]);
    expect(Number(sheet.querySelector(".tk-key-est .fill")?.textContent)).toBeGreaterThan(5);
  });
  it("names the kind of text from the title", () => {
    expect(genreOf("Part 6 · Parking (email)")).toBe("e-mail");
    expect(genreOf("Part 7 · Text-message chain")).toBe("text-message chain");
    expect(genreOf("Part 7 · Double 2")).toBe("texts");
  });
});
