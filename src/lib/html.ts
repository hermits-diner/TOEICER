/* HTML helpers for the crawler. These need a DOM, so they live apart from the text-only extractor. */

export interface PageLink {
  url: string;
  text: string;
}

const DROP = "script,style,noscript,template,svg,nav,footer,aside,iframe,button";
const BLOCK = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "MAIN", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL",
  "TABLE", "TR", "BLOCKQUOTE", "PRE", "DD", "DT", "FIGCAPTION", "FORM", "FIELDSET", "LABEL", "HR",
]);

/** Content that makes a table cell more than a short entry (a layout table rather than a data table). */
const CELL_BLOCKS = "table,ul,ol,div,form,h1,h2,h3,h4,h5,h6";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const roman = (n: number) => "x".repeat(Math.floor(n / 10)) + ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"][n % 10];

/** A page may carry several h1s (a sign-up box, for one); the page heading is the one that echoes the <title>. */
function pageHeading(doc: Document): string {
  const inTitle = words(doc.title);
  let best = "";
  let bestScore = -1;
  doc.querySelectorAll("h1").forEach((h) => {
    const text = squash(h.textContent ?? "");
    const score = [...words(text)].filter((w) => inTitle.has(w)).length;
    if (text && score > bestScore) {
      best = text;
      bestScore = score;
    }
  });
  return best || squash(doc.title);
}

/** The marker a browser shows for an <ol> item: 1, A, a, i or I, counted from the list's start value. */
function listMarker(list: Element, item: Element): string {
  const start = Number(list.getAttribute("start") ?? 1) || 1;
  const n = start + Array.from(list.children).filter((c) => c.tagName === "LI").indexOf(item);
  const type = list.getAttribute("type") ?? "1";
  if (type === "A" || type === "a") return String.fromCharCode((type === "A" ? 65 : 97) + ((n - 1) % 26));
  if (type === "i") return roman(n);
  if (type === "I") return roman(n).toUpperCase();
  return String(n);
}

/** Readable text of a page: one block per paragraph, form inputs shown as gaps so numbered blanks survive.
    `baseUrl` resolves the addresses of pictures and recordings. */
export function htmlToText(html: string, baseUrl?: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = pageHeading(doc);
  doc.querySelectorAll(DROP).forEach((e) => e.remove());

  const absolute = (src: string) => {
    let address = src;
    try {
      address = new URL(src, baseUrl).toString();
    } catch {
      // a relative address without a base stays as written
    }
    return address.replace(/[\s()]/g, (c) => encodeURIComponent(c));
  };

  const render = (root: Element): string => {
    const walk = (n: Node, out: string[]) => {
      if (n.nodeType === 3) {
        out.push((n.textContent ?? "").replace(/\s+/g, " "));
        return;
      }
      if (n.nodeType !== 1) return;
      const el = n as Element;
      const tag = el.tagName;
      if (tag === "BR") return void out.push("\n");
      if (tag === "SELECT" || tag === "TEXTAREA") return void out.push(" ________ ");
      if (tag === "IMG") {
        // A picture becomes "![description](address)" on a line of its own; decoration (no description, small) is left out.
        const alt = squash(el.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
        const src = el.getAttribute("src") ?? "";
        const width = el.getAttribute("width") ?? "";
        const wide = width.endsWith("%") ? parseFloat(width) >= 30 : Number(width) >= 100;
        if (src && !src.startsWith("data:") && (alt || wide)) out.push(`\n\n![${alt}](${absolute(src)})\n\n`);
        return;
      }
      if (tag === "AUDIO") {
        // A recording becomes "@[audio](address)"; the fallback text inside the element is not content.
        const src = el.getAttribute("src") ?? el.querySelector("source[src]")?.getAttribute("src");
        if (src) out.push(`\n\n@[audio](${absolute(src)})\n\n`);
        return;
      }
      if (el.classList.contains("tooltip")) {
        // The phrase stays; the explanation that pops up over it is not part of the sentence.
        el.childNodes.forEach((c) => c.nodeType === 3 && walk(c, out));
        return;
      }
      if (tag === "INPUT") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if (type === "text" || type === "search") out.push(" ________ ");
        return;
      }
      if (tag === "TR") {
        // A row of short cells reads as one line, even when each cell wraps its text in a paragraph.
        const cells = Array.from(el.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
        if (cells.length > 1 && cells.every((c) => !c.querySelector(CELL_BLOCKS) && (c.textContent ?? "").length <= 200)) {
          const row = cells.map((c) => {
            const cell: string[] = [];
            c.childNodes.forEach((k) => walk(k, cell));
            return squash(cell.join(""));
          });
          return void out.push("\n\n" + row.join(" ") + "\n\n");
        }
      }
      const block = BLOCK.has(tag);
      if (block) out.push("\n\n");
      if (tag === "TD" || tag === "TH") out.push("  ");
      // Ordered lists keep their markers: answer keys are often an <ol start="27">, options an <ol type="A">.
      const list = tag === "LI" ? el.parentElement : null;
      if (list?.tagName === "OL") out.push(`${listMarker(list, el)}. `);
      el.childNodes.forEach((c) => walk(c, out));
      if (block) out.push("\n\n");
    };
    const out: string[] = [];
    walk(root, out);
    return out
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      // A list item that opens with a block of its own would leave its marker alone on a line.
      .replace(/(^|\n)((?:\d{1,3}|[A-Za-z]|[ivx]{2,5})\.)\n\n(?=\S)/g, "$1$2 ")
      .trim();
  };

  const main = doc.querySelector("main, article, [role=main]");
  let text = main ? render(main) : "";
  if (text.length < 400 && doc.body) text = render(doc.body);

  // Whatever precedes the page heading is site navigation, not content.
  const lines = text.split("\n");
  const at = title ? lines.findIndex((l) => squash(l) === title) : -1;
  if (at > 0) {
    const rest = lines.slice(at + 1).join("\n").trim();
    if (rest.length >= 400) text = rest;
  }
  return { title, text };
}

/** Absolute http(s) links on the page, de-duplicated, fragments removed. */
export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const seen = new Map<string, PageLink>();
  doc.querySelectorAll("a[href]").forEach((a) => {
    let u: URL;
    try {
      u = new URL(a.getAttribute("href") ?? "", baseUrl);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    u.hash = "";
    const url = u.toString();
    const text = squash(a.textContent ?? "");
    const have = seen.get(url);
    if (!have) seen.set(url, { url, text });
    else if (!have.text && text) have.text = text;
  });
  return [...seen.values()];
}

const DEFAULT_LINK_RE = /\.pdf($|\?)|practice|sample|reading|listening/i;
const siteOf = (host: string) => host.replace(/^www\./, "");

/** Links worth offering for collection: same site, matching the source's pattern, not the page itself. */
export function filterLinks(links: PageLink[], pageUrl: string, pattern?: string): PageLink[] {
  let re = DEFAULT_LINK_RE;
  if (pattern) {
    try {
      re = new RegExp(pattern, "i");
    } catch {
      // keep the default for an invalid pattern
    }
  }
  const page = new URL(pageUrl);
  const self = pageUrl.replace(/#.*$/, "");
  return links
    .filter((l) => l.url !== self && siteOf(new URL(l.url).host) === siteOf(page.host) && re.test(l.url))
    .slice(0, 300);
}
