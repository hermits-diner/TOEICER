// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { highlightRange, markAt, removeMark, setNote } from "./highlight";

function setup(html: string) {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.replaceChildren(div);
  return div;
}

describe("highlightRange", () => {
  it("wraps part of one text node", () => {
    const div = setup("<p>Bees thrive in cities.</p>");
    const t = div.querySelector("p")!.firstChild!;
    const r = document.createRange();
    r.setStart(t, 5);
    r.setEnd(t, 11);
    expect(highlightRange(r, div)).toBe(true);
    expect(div.innerHTML).toBe('<p>Bees <mark class="hl">thrive</mark> in cities.</p>');
  });

  it("spans paragraphs and keeps notes", () => {
    const div = setup("<p>First line.</p><p>Second line.</p>");
    const [a, b] = [...div.querySelectorAll("p")].map((p) => p.firstChild!);
    const r = document.createRange();
    r.setStart(a, 6);
    r.setEnd(b, 6);
    highlightRange(r, div, "핵심 근거");
    const marks = div.querySelectorAll("mark.hl.noted");
    expect([...marks].map((m) => m.textContent)).toEqual(["line.", "Second"]);
    expect((marks[0] as HTMLElement).dataset.note).toBe("핵심 근거");
  });

  it("removes a highlight and edits notes", () => {
    const div = setup('<p>A <mark class="hl">key</mark> word.</p>');
    const mark = markAt(div.querySelector("mark"))!;
    setNote(mark, "memo");
    expect(mark.title).toBe("memo");
    setNote(mark, "  ");
    expect(mark.classList.contains("noted")).toBe(false);
    removeMark(mark);
    expect(div.innerHTML).toBe("<p>A key word.</p>");
    expect(div.querySelector("p")!.childNodes).toHaveLength(1);
  });

  it("ignores empty selections and text outside the container", () => {
    const div = setup("<p>Text</p>");
    const r = document.createRange();
    r.setStart(div.querySelector("p")!.firstChild!, 1);
    expect(highlightRange(r, div)).toBe(false);
  });
});
