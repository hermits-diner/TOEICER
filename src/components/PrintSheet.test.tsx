// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TestDetail } from "../lib/types";
import PrintSheet from "./PrintSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, text: `Option ${key}` }));

const listening: TestDetail = {
  id: 1,
  title: "IELTS Listening Sample 5. Section 1",
  kind: "listening",
  module: "academic",
  ai: false,
  reported: [],
  passages: [
    {
      id: 11,
      ord: 1,
      title: "Section 1",
      bodyHtml: "<p>Transcript</p>",
      audio: null,
      sampleHtml: null,
      groups: [
        {
          id: 1,
          type: "fill",
          instructions: "Questions 1-2 Complete the notes.",
          options: [],
          image: null,
          questions: [
            { id: 1, number: 1, prompt: "Name: ________", options: [], answer: ["Smith"] },
            { id: 2, number: 2, prompt: "Phone: ________", options: [], answer: ["07833 419205"] },
          ],
        },
        {
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
        },
      ],
    },
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

const texts = (sel: string) => [...document.body.querySelectorAll(sel)].map((e) => e.textContent?.trim());

describe("PrintSheet: Choose THREE letters", () => {
  it("prints the item once, numbered 6–8, with one option list and three answer blanks", () => {
    render(<PrintSheet test={listening} mode="questions" />);
    expect(texts(".ps-num")).toEqual(["1", "2", "6–8"]);
    const sheet = document.body.querySelector(".print-sheet")!;
    expect(sheet.textContent?.match(/Which THREE things/g)?.length).toBe(1);
    expect(document.body.querySelectorAll(".ps-options li").length).toBe(6);
    expect(sheet.textContent).toContain("3개 선택");
    const all = [...document.body.querySelectorAll(".ps-q")];
    const last = all[all.length - 1];
    const lines = [...last.querySelectorAll(".ps-line")].map((e) => e.textContent);
    expect(lines.length).toBe(1);
    expect(lines[0]?.match(/_{4,}/g)?.length).toBe(3);
  });

  it("gives the key one row for the item with every letter, and a tally after scoring", () => {
    render(
      <PrintSheet
        test={listening}
        mode="answers"
        responses={{ 1: "Smith", 2: "", 6: "B", 7: "C", 8: "E" }}
        results={{ 1: true, 2: false, 6: true, 7: false, 8: true }}
      />,
    );
    const rows = [...document.body.querySelectorAll(".ps-key tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["1", "Smith", "Smith", "O"],
      ["2", "07833 419205", "—", "X"],
      ["6–8", "B, D, E", "B, C, E", "2/3"],
    ]);
  });

  it("still counts every mark in the header", () => {
    render(<PrintSheet test={listening} mode="questions" />);
    expect(document.body.querySelector(".ps-meta")?.textContent).toContain("5문항");
  });
});

describe("PrintSheet: TOEFL items", () => {
  const reading: TestDetail = {
    id: 2,
    title: "AI · Reading",
    kind: "reading",
    module: "academic",
    ai: true,
    reported: [],
    passages: [
      {
        id: 21,
        ord: 1,
        title: "Climate",
        bodyHtml: "<p>Plants grow toward light. They [[1]] this because of [[2]].</p>",
        audio: null,
        sampleHtml: null,
        groups: [
          {
            id: 3,
            type: "cword",
            instructions: "Fill in the missing letters in the paragraph.",
            options: [],
            image: null,
            questions: [
              { id: 31, number: 1, prompt: "d", options: [], answer: ["o", "do"] },
              { id: 32, number: 2, prompt: "hor", options: [], answer: ["mones", "hormones"] },
            ],
          },
        ],
      },
      {
        id: 22,
        ord: 2,
        title: "Build a Sentence",
        bodyHtml: "<p>Make an appropriate sentence.</p>",
        audio: null,
        sampleHtml: null,
        groups: [
          {
            id: 4,
            type: "build",
            instructions: null,
            options: [],
            image: null,
            questions: [
              {
                id: 41,
                number: 3,
                prompt: "Where should I put these boxes?",
                options: ["the door", "you can", "leave them", "next to"].map((text, i) => ({ key: String(i + 1), text })),
                answer: ["You can leave them next to the door."],
              },
            ],
          },
        ],
      },
    ],
  };

  it("prints Complete the Words inside the paragraph with numbered blanks sized to the missing letters", () => {
    render(<PrintSheet test={reading} mode="questions" />);
    const body = document.body.querySelector(".ps-body")!;
    expect(body.textContent).toContain("They d__1 this because of hor______2.");
    expect(body.innerHTML).not.toContain("[[");
    // no separate question list for the blanks
    expect(texts(".ps-num")).toEqual(["3"]);
  });

  it("prints Build a Sentence with its chunks and keys both items", () => {
    render(<PrintSheet test={reading} mode="answers" />);
    expect(texts(".ps-chunks span")).toEqual(["the door", "you can", "leave them", "next to"]);
    const keys = [...document.body.querySelectorAll(".ps-key tbody tr")].map((tr) => tr.querySelectorAll("td")[1].textContent);
    expect(keys).toEqual(["o / do", "mones / hormones", "You can leave them next to the door."]);
  });

  it("prints a listening script only with the answers", () => {
    render(<PrintSheet test={listening} mode="questions" />);
    expect(document.body.querySelector(".ps-script")).toBeNull();
    act(() => root.render(<PrintSheet test={listening} mode="answers" />));
    expect(document.body.querySelector(".ps-script")?.textContent).toContain("Transcript");
  });
});
