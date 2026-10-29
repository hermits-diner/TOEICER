import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.0.0") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const { buildManifest, htmlToParagraphs, mediaOf } = await import("./package");
const { passageToHtml } = await import("./importFormat");

const IMG = "img-0123456789abcdef0123456789abcdef.png";
const AUD = "aud-0123456789abcdef0123456789abcdef.wav";

describe("htmlToParagraphs", () => {
  it("inverts passageToHtml: labels, line breaks, escaped text and figures", () => {
    const paras = [{ label: "A", text: "Bees & flowers.\nSecond line." }, { text: "Plain <b>para</b>." }, { text: "Chart", image: IMG }];
    const html = passageToHtml({ paragraphs: paras, groups: [] }, { [IMG]: "data:image/png;base64,AAAA" });
    expect(htmlToParagraphs(html)).toEqual([
      { label: "A", text: "Bees & flowers.\nSecond line." },
      { text: "Plain <b>para</b>." },
      { text: "Chart", image: "data:image/png;base64,AAAA" },
    ]);
  });
  it("turns other HTML into plain blocks", () => {
    expect(htmlToParagraphs("<div>One</div><h2>Two</h2>")).toEqual([{ text: "One" }, { text: "Two" }]);
  });
});

describe("mediaOf / buildManifest", () => {
  const listening = {
    title: "Set",
    kind: "listening",
    module: "academic",
    passages: [
      { audio: AUD, paragraphs: [{ text: "x", image: IMG }], groups: [{ type: "mcq", image: IMG, questions: [{ number: 1, answer: ["A"] }] }] },
      { audio: "https://example.com/a.mp3", groups: [{ type: "fill", questions: [{ number: 2, answer: ["x"] }, { number: 3, answer: ["y"] }] }] },
    ],
  } as never;
  const speaking = { title: "Talk", kind: "speaking", module: "academic", passages: [{ body: "q", groups: [] }] } as never;
  it("lists archived audio and pictures once, never addresses", () => {
    expect(mediaOf([listening, speaking])).toEqual([AUD, IMG]);
  });
  it("describes one set", async () => {
    const m = await buildManifest([listening]);
    expect([m.format, m.title, m.module, m.exam, m.appVersion]).toEqual([2, "Set", "academic", undefined, "0.0.0"]);
    expect(m.tests).toEqual([{ skill: "listening", ord: 0, title: "Set", questions: 3 }]);
  });
  it("describes a whole exam", async () => {
    const m = await buildManifest([listening, speaking], { title: "Test 1", module: "general", band: 6.5 });
    expect([m.title, m.module, m.exam?.band, m.tests.length]).toEqual(["Test 1", "general", 6.5, 2]);
    expect(m.tests[1]).toEqual({ skill: "speaking", ord: 1, title: "Talk", questions: 0 });
  });
});
