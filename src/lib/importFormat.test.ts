import { describe, expect, it } from "vitest";
import { escapeHtml, passageToHtml, validateImport } from "./importFormat";
import { toeicSampleTests } from "./toeicSamples";

const opts = (n: number) => ["A", "B", "C", "D"].slice(0, n).map((key, i) => ({ key, text: `w${i}` }));
const IMG = "img-0123456789abcdef0123456789abcdef.png";
const AUD = "aud-0123456789abcdef0123456789abcdef.mp3";

describe("validateImport", () => {
  it("accepts the built-in sets", () => {
    for (const t of toeicSampleTests()) expect(validateImport(t).errors, t.title).toEqual([]);
  });
  it("takes a Part 1 photo with its recording, a three-choice Part 2 and a Part 5 without text", () => {
    const listening = validateImport({
      title: "LC",
      kind: "listening",
      passages: [
        { title: "Part 1 · Photograph 1", audio: AUD, groups: [{ type: "lmcq", image: IMG, questions: [{ number: 1, options: opts(4), answer: "c" }] }] },
        { title: "Part 2 · 2–2", body: "Speaker: …", groups: [{ type: "lmcq", questions: [{ number: 2, options: opts(3), answer: ["B"] }] }] },
      ],
    });
    expect(listening.errors).toEqual([]);
    expect(listening.test?.passages[0].groups[0]).toMatchObject({ image: IMG, questions: [{ answer: ["C"] }] });
    const reading = validateImport({
      title: "RC",
      kind: "reading",
      passages: [{ title: "Part 5 · Incomplete Sentences", groups: [{ type: "mcq", questions: [{ number: 101, options: opts(4), answer: "A" }] }] }],
    });
    expect(reading.errors).toEqual([]);
  });
  it("refuses what the TOEIC paper does not have", () => {
    const r = validateImport({
      title: "",
      kind: "listening",
      passages: [
        { title: "Part 2 · x", body: "s", groups: [{ type: "lmcq", questions: [{ number: 1, options: opts(4), answer: "A" }] }] },
        { title: "Part 3 · x", body: "s", groups: [{ type: "mcq", questions: [{ number: 2, options: opts(4), answer: "E" }] }] },
        { title: "Part 3 · y", body: "s", groups: [{ type: "tfng", questions: [{ number: 3, answer: "TRUE" }] }] },
        { title: "Part 6 · Memo", body: "s", groups: [{ type: "mcq", questions: [{ number: 4, options: opts(4), answer: "A" }] }] },
        { title: "Section 1", body: "s", groups: [{ type: "mcq", questions: [{ number: 5, options: opts(4), answer: "A" }] }] },
        { title: "Part 4 · Talk 1", groups: [{ type: "mcq", questions: [{ number: 6, options: opts(4), answer: "A" }] }] },
        { title: "Part 4 · Talk 2", audio: "https://example.org/a.mp3", body: "s", groups: [{ type: "mcq", questions: [{ number: 7, options: opts(4), answer: "A" }] }] },
      ],
    });
    expect(r.test).toBeNull();
    expect(r.errors).toEqual([
      "제목이 필요합니다.",
      "1번: Part 2 문항의 선택지는 (A)–(C) 3개여야 합니다.",
      "2번: 정답은 (A)–(D) 중 하나여야 합니다.",
      "passages[2].groups[0]: Part 3에는 선택지가 인쇄된 문항만 들어갈 수 있습니다.",
      "passages[3]: Part 6는 Listening 세트에 들어갈 수 없습니다.",
      'passages[4]: 제목이 "Part 1"–"Part 7"로 시작해야 합니다.',
      "passages[5]: 음성도 스크립트도 없습니다.",
      "passages[6]: 음성은 보관된 음성 파일이어야 합니다.",
    ]);
    expect(validateImport({ title: "t", kind: "writing", passages: [] }).errors).toEqual(['kind는 "listening" 또는 "reading"이어야 합니다.']);
  });
  it("flags duplicate numbers and warns about gaps", () => {
    const q = (n: number) => ({ number: n, options: opts(4), answer: "A" });
    const r = validateImport({ title: "t", kind: "reading", passages: [{ title: "Part 7 · Email", body: "x", groups: [{ type: "mcq", questions: [q(1), q(1), q(3)] }] }] });
    expect(r.errors).toContain("문항 번호가 중복됩니다: 1");
    expect(r.warnings[0]).toContain("연속되지 않습니다");
  });
});

describe("passageToHtml", () => {
  it("escapes the text and keeps paragraphs and line breaks", () => {
    expect(passageToHtml({ body: "Dear <b>Ms. Lee</b> & team,\nThanks.\n\n---(131)---", groups: [] })).toBe(
      "<p>Dear &lt;b&gt;Ms. Lee&lt;/b&gt; &amp; team,<br>Thanks.</p>\n<p>---(131)---</p>",
    );
    expect(passageToHtml({ paragraphs: [{ label: "A", text: "Hi" }], groups: [] })).toBe('<p><span class="para-label">A</span>Hi</p>');
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});
