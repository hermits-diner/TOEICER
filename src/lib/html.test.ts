// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { extractLinks, filterLinks, htmlToText } from "./html";

const PAGE = `<!doctype html><html><head><title>Site | Practice</title><style>p{color:red}</style></head><body>
<nav><a href="/home">Home</a></nav>
<article><h1>Reading  practice 1</h1>
<p>First paragraph<br>second line.</p><script>alert(1)</script>
<form><p>The answer is <input type="text" name="q1"> here. <input type="hidden" value="x"></p>
<ul><li>A  one</li><li>B  two</li></ul></form>
<a href="tests/one.pdf">Test one</a> <a href="/reading/two.html#top">Two</a> <a href="https://other.example/x.pdf">Other</a>
<a href="mailto:a@b.c">mail</a> <a href="tests/one.pdf"></a>
</article><footer>Copyright</footer></body></html>`;

describe("htmlToText", () => {
  const { title, text } = htmlToText(PAGE);
  it("prefers the h1 as title", () => expect(title).toBe("Reading practice 1"));
  it("drops scripts, styles, nav and footer", () => {
    expect(text).not.toMatch(/alert|color:red|Home|Copyright/);
  });
  it("keeps block structure and line breaks", () => {
    expect(text).toContain("First paragraph\nsecond line.");
    expect(text).toContain("A one\n\nB two");
  });
  it("shows text inputs as gaps", () => expect(text).toContain("The answer is ________ here."));
});

describe("htmlToText on a page without a content landmark", () => {
  const filler = "<p>" + "The orchard was planted along the southern wall of the old estate. ".repeat(8) + "</p>";
  const { text } = htmlToText(`<html><body><div class="menu"><p>Lessons</p><p>Tips</p></div>
<div><h1>Practice page</h1>${filler}
<div><p>ANSWERS</p><ol start="3"><li>True</li><li>orchard wall</li></ol></div></div></body></html>`);
  it("leaves out what precedes the page heading", () => {
    expect(text).not.toMatch(/Lessons|Tips|Practice page/);
    expect(text.startsWith("The orchard")).toBe(true);
  });
  it("numbers ordered list items from the list's start value", () => {
    expect(text).toContain("3. True\n\n4. orchard wall");
  });
});

describe("htmlToText details", () => {
  const filler = "<p>" + "The orchard was planted along the southern wall of the old estate. ".repeat(8) + "</p>";
  const { title, text } = htmlToText(`<html><head><title>Orchard reading practice - Site</title></head><body>
<div><h1>Sign up</h1></div><h1>Reading practice: the orchard</h1>${filler}
<img src="/a.png" alt="Plan of the orchard"><img src="/dot.png">
<table><tr><td><p>Apple</p></td><td><p>12 trees</p></td></tr><tr><td><p>Pear</p></td><td><p>7 trees</p></td></tr></table>
<ol type="A"><li>along the wall</li><li>by the gate</li></ol><ol type="i" start="4"><li>Pruning</li><li>Harvest</li></ol>
</body></html>`, "https://example.org/reading/orchard.html");
  it("takes the h1 that echoes the document title", () => expect(title).toBe("Reading practice: the orchard"));
  it("marks described pictures with their full address", () => {
    expect(text).toContain("![Plan of the orchard](https://example.org/a.png)");
    expect(text.match(/!\[/g)).toHaveLength(1);
  });
  it("keeps a table row on one line", () => expect(text).toContain("Apple 12 trees\n\nPear 7 trees"));
  it("shows lettered and roman list markers", () => {
    expect(text).toContain("A. along the wall\n\nB. by the gate");
    expect(text).toContain("iv. Pruning\n\nv. Harvest");
  });
});

describe("htmlToText on listening, writing and speaking pages", () => {
  const filler = "<p>" + "The orchard was planted along the southern wall of the old estate. ".repeat(8) + "</p>";
  const { text } = htmlToText(
    `<html><body><h1>Practice</h1>${filler}
<audio controls><source src="1.1.mp3" type="audio/mp3">Your browser cannot play this.</audio>
<img src="/images/chart.png" width="67%"><img src="/images/icon.png" width="20%">
<p>It was <span class="phrase tooltip">off the beaten track<span>Far from where most people go.</span></span>.</p>
<ol><li><p><strong>Introduce the chart.</strong></p><p>Say what it shows.</p></li></ol>
</body></html>`,
    "https://example.org/listening/sample-1.1.html",
  );
  it("marks a recording with its full address and drops the fallback text", () => {
    expect(text).toContain("@[audio](https://example.org/listening/1.1.mp3)");
    expect(text).not.toContain("cannot play");
  });
  it("keeps a wide picture without a description, not a narrow one", () => {
    expect(text).toContain("![](https://example.org/images/chart.png)");
    expect(text).not.toContain("icon.png");
  });
  it("leaves out the explanation that pops up over a phrase", () => {
    expect(text).toContain("It was off the beaten track.");
    expect(text).not.toContain("Far from");
  });
  it("keeps a list marker on the line of its item", () => {
    expect(text).toContain("1. Introduce the chart.\n\nSay what it shows.");
  });
});

describe("links", () => {
  const links = extractLinks(PAGE, "https://www.example.com/practice/index.html");
  it("resolves, de-duplicates and strips fragments", () => {
    expect(links.map((l) => l.url)).toEqual([
      "https://www.example.com/home",
      "https://www.example.com/practice/tests/one.pdf",
      "https://www.example.com/reading/two.html",
      "https://other.example/x.pdf",
    ]);
    expect(links[1].text).toBe("Test one");
  });
  it("keeps same-site links matching the pattern", () => {
    const page = "https://example.com/practice/index.html";
    expect(filterLinks(links, page).map((l) => l.url)).toEqual([
      "https://www.example.com/practice/tests/one.pdf",
      "https://www.example.com/reading/two.html",
    ]);
    expect(filterLinks(links, page, String.raw`\.pdf($|\?)`)).toHaveLength(1);
    expect(filterLinks(links, page, "([")).toHaveLength(2);
  });
});
