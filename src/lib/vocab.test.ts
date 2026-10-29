import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { parseInsight, sentenceAround, insightPrompt } = await import("./vocab");

describe("sentenceAround", () => {
  const text = "Bees thrive in cities. Urban hives produced more honey! Critics disagree.";
  it("returns the sentence containing the offset", () => {
    expect(sentenceAround(text, text.indexOf("hives"))).toBe("Urban hives produced more honey!");
    expect(sentenceAround(text, 2)).toBe("Bees thrive in cities.");
    expect(sentenceAround(text, text.indexOf("disagree"))).toBe("Critics disagree.");
  });
});

describe("parseInsight", () => {
  it("reads a fenced reply and trims lists", () => {
    const r = parseInsight(
      '```json\n{"meaning":"감소하다","explanation":"수량이 줄어듭니다.","synonyms":["fall","drop",""],"collocations":["decline sharply"],"example":"Sales declined. (판매가 줄었다.)"}\n```',
    );
    expect(r.meaning).toBe("감소하다");
    expect(r.synonyms).toEqual(["fall", "drop"]);
  });
  it("rejects replies without a meaning", () => {
    expect(() => parseInsight('{"meaning":""}')).toThrow(/뜻/);
    expect(() => parseInsight("no json")).toThrow(/읽지 못했/);
  });
  it("builds a prompt with or without a sentence", () => {
    expect(insightPrompt("decline", "Sales declined.")).toContain("Sentence: Sales declined.");
    expect(insightPrompt("decline", null)).toContain("most common academic sense");
  });
});
