import { describe, expect, it } from "vitest";
import { escapeHtml, parseImportText, passageToHtml, validateImport } from "./importFormat";
import { sampleTest } from "./sampleTest";

describe("validateImport", () => {
  it("accepts the bundled sample", () => {
    const r = validateImport(sampleTest);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.test?.passages[0].groups).toHaveLength(4);
  });

  it("canonicalises TFNG answers and accepts a single string answer", () => {
    const r = validateImport({
      title: "t",
      passages: [{ body: "x", groups: [{ type: "tfng", questions: [{ number: 1, answer: "ng" }] }] }],
    });
    expect(r.errors).toEqual([]);
    expect(r.test?.passages[0].groups[0].questions[0].answer).toEqual(["NOT GIVEN"]);
    expect(r.test?.kind).toBe("reading");
    expect(r.test?.module).toBe("academic");
  });

  it("reports missing pieces with paths", () => {
    const r = validateImport({
      title: "",
      passages: [{ groups: [{ type: "mcq", questions: [{ number: 1, answer: "A" }] }] }],
    });
    expect(r.test).toBeNull();
    expect(r.errors).toContain("title이 필요합니다.");
    expect(r.errors.some((e) => e.startsWith("passages[0]: body"))).toBe(true);
    expect(r.errors.some((e) => e.includes("선택지(options)가 필요합니다"))).toBe(true);
  });

  it("rejects duplicate numbers and warns about gaps", () => {
    const q = (n: number) => ({ number: n, answer: "x" });
    const r = validateImport({
      title: "t",
      passages: [{ body: "x", groups: [{ type: "fill", questions: [q(1), q(1), q(3)] }] }],
    });
    expect(r.errors).toContain("문항 번호가 중복됩니다: 1");
    expect(r.warnings[0]).toContain("연속되지 않습니다");
  });

  it("reports JSON syntax errors", () => {
    expect(parseImportText("{oops").errors[0]).toMatch(/^JSON 구문 오류/);
  });
});

describe("passageToHtml", () => {
  it("escapes source text", () => {
    expect(escapeHtml(`<b>"&'`)).toBe("&lt;b&gt;&quot;&amp;&#39;");
    const html = passageToHtml({ body: "<script>x</script>\n\nSecond", groups: [] });
    expect(html).not.toContain("<script>");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });
  it("renders paragraph labels", () => {
    expect(passageToHtml({ paragraphs: [{ label: "A", text: "Hi" }], groups: [] })).toBe(
      '<p><span class="para-label">A</span>Hi</p>',
    );
  });
  it("embeds archived pictures and leaves a description for the others", () => {
    const name = "img-0123456789abcdef0123456789abcdef.png";
    const paragraphs = [
      { text: 'A "map"', image: name },
      { text: "A chart", image: "https://example.org/chart.png" },
      { text: "", image: "https://example.org/dot.png" },
    ];
    expect(passageToHtml({ paragraphs, groups: [] }, { [name]: "data:image/png;base64,AAAA" })).toBe(
      '<figure><img src="data:image/png;base64,AAAA" alt="A &quot;map&quot;" style="max-width:100%"></figure>\n<p>[A chart]</p>',
    );
  });
});

describe("pictures in the import format", () => {
  const group = { type: "fill", questions: [{ number: 1, answer: "x" }] };
  it("keeps picture paragraphs and group pictures, and warns about uncollected ones", () => {
    const name = "img-0123456789abcdef0123456789abcdef.png";
    const ok = validateImport({ title: "t", passages: [{ paragraphs: [{ text: "Map", image: name }, "Text"], groups: [{ ...group, image: name }] }] });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
    expect(ok.test?.passages[0].paragraphs?.[0]).toEqual({ text: "Map", image: name });
    expect(ok.test?.passages[0].groups[0].image).toBe(name);

    const loose = validateImport({ title: "t", passages: [{ paragraphs: [{ image: "https://example.org/a.png" }, "Text"], groups: [group] }] });
    expect(loose.errors).toEqual([]);
    expect(loose.warnings).toEqual(["passages[0]: 받지 못한 그림은 저장할 때 빠집니다."]);
  });
});
