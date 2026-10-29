import { describe, expect, it } from "vitest";
import { decide, reviewDraft } from "./autoReview";
import { extractTests } from "./extract";
import type { ImportTest } from "./types";

const LONG = "The canal was dug by hand over eleven years and opened to barges in the spring. ".repeat(6);

const clean = (): ImportTest => ({
  title: "Canal",
  kind: "reading",
  module: "academic",
  passages: [
    {
      title: "The Old Canal",
      paragraphs: [
        { label: "A", text: LONG },
        { label: "B", text: LONG },
      ],
      groups: [
        {
          type: "matching",
          options: [
            { key: "A", text: "" },
            { key: "B", text: "" },
          ],
          questions: [{ number: 1, prompt: "the first barges", answer: ["B"] }],
        },
        { type: "tfng", questions: [{ number: 2, prompt: "The canal was dug by hand.", answer: ["TRUE"] }] },
        { type: "fill", questions: [{ number: 3, prompt: "It opened in the ________ .", answer: ["spring"] }] },
        {
          type: "mcq",
          questions: [
            {
              number: 4,
              prompt: "The canal took",
              options: [
                { key: "A", text: "eleven years" },
                { key: "B", text: "two years" },
              ],
              answer: ["A"],
            },
          ],
        },
      ],
    },
  ],
});

describe("reviewDraft", () => {
  it("passes a complete draft", () => {
    const v = reviewDraft(clean());
    expect(v.reasons).toEqual([]);
    expect(v.unusable).toBeNull();
    expect(decide(v, [])).toBe("store");
  });

  it("leaves a draft to the user when extraction noted something", () => {
    expect(decide(reviewDraft(clean()), ["그림을 받지 못했습니다: …"])).toBe("ask");
  });

  it("asks when paragraph letters, gaps, choices or answers look wrong", () => {
    const d = clean();
    const p = d.passages[0];
    p.paragraphs![1].label = undefined;
    p.groups[2].questions[0].prompt = "It opened in the spring.";
    p.groups[3].questions[0].options!.pop();
    p.groups[1].questions[0].answer = ["MAYBE"];
    const v = reviewDraft(d);
    expect(v.reasons).toEqual([
      "passages[0].groups[1].questions[0].answer: TRUE / FALSE / NOT GIVEN 중 하나여야 합니다.",
      "1번: 지문에서 문단 기호 B을(를) 찾지 못했습니다.",
      "빈칸 완성 문항에 빈칸이 없습니다: 3",
      "객관식 선택지가 모자라거나 비어 있습니다: 4",
    ]);
    expect(v.test).toBeNull(); // it cannot be stored as it is, but it has wording worth a look
    expect(decide(v, v.reasons)).toBe("ask");
  });

  it("asks rather than discards when the draft is storable but doubtful", () => {
    const d = clean();
    d.passages[0].groups[3].questions[0].answer = ["C"];
    const v = reviewDraft(d);
    expect(v.reasons).toEqual(['passages[0].groups[3].questions[0]: 정답 "C"이(가) 선택지 키에 없습니다.']);
    expect(decide(v, v.reasons)).toBe("ask");
  });

  it("discards a page that holds nothing but an answer key", () => {
    const [r] = extractTests("Sample task (Answers)\n1  B\n2  D\n3  A\n");
    const v = reviewDraft(r.draft);
    expect(v.unusable).toBe("문항 내용이 없습니다. 정답표만 있는 문서로 보입니다.");
    expect(decide(v, r.issues)).toBe("discard");
  });
});
