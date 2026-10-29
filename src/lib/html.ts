/* Readable text of an official page for the trend brief (trend.ts). Needs a DOM. */

const DROP = "script,style,noscript,template,svg,nav,footer,aside,iframe,button,form,header";
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TABLE", "BLOCKQUOTE", "DD", "DT"]);

/** One block per paragraph; navigation, scripts and forms left out; the main landmark preferred when it says enough. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DROP).forEach((e) => e.remove());
  const render = (root: Element): string => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) return void out.push((n.textContent ?? "").replace(/\s+/g, " "));
      if (n.nodeType !== 1) return;
      const el = n as Element;
      if (el.tagName === "BR") return void out.push("\n");
      const block = BLOCK.has(el.tagName);
      if (block) out.push("\n\n");
      if (el.tagName === "TD" || el.tagName === "TH") out.push("  ");
      el.childNodes.forEach(walk);
      if (block) out.push("\n\n");
    };
    walk(root);
    return out.join("").replace(/[ \t]{2,}/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };
  const main = doc.querySelector("main, article, [role=main]");
  const text = main ? render(main) : "";
  return text.length >= 200 || !doc.body ? text : render(doc.body);
}
