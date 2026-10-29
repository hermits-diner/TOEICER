import { describe, expect, it } from "vitest";
import { difficultyGuide, difficultyMix, sectionBand, splitCounts, tierShares } from "./difficulty";

describe("tierShares", () => {
  it("moves from mostly locating items to mostly inference as the band rises", () => {
    expect(tierShares(5.5)).toEqual({ easy: 0.6, mid: 0.3, hard: 0.1 });
    expect(tierShares(6.5)).toEqual({ easy: 0.4, mid: 0.4, hard: 0.2 });
    expect(tierShares(7.5)).toEqual({ easy: 0.2, mid: 0.4, hard: 0.4 });
    expect(tierShares(8.0)).toEqual({ easy: 0.15, mid: 0.35, hard: 0.5 });
  });

  it("never leaves out a tier, even past the ends of the scale", () => {
    for (const b of [4, 5, 8.5, 9]) {
      const s = tierShares(b);
      expect(s.easy).toBeGreaterThan(0);
      expect(s.hard).toBeGreaterThan(0);
      expect(s.easy + s.mid + s.hard).toBeCloseTo(1);
    }
  });
});

describe("splitCounts", () => {
  it("rounds to whole items that add up to the total", () => {
    expect(splitCounts(13, { easy: 0.4, mid: 0.4, hard: 0.2 })).toEqual({ easy: 5, mid: 5, hard: 3 });
    expect(splitCounts(10, { easy: 0.6, mid: 0.3, hard: 0.1 })).toEqual({ easy: 6, mid: 3, hard: 1 });
    expect(splitCounts(14, { easy: 0.15, mid: 0.35, hard: 0.5 })).toEqual({ easy: 2, mid: 5, hard: 7 });
  });

  it("keeps at least one item in every tier when the total allows", () => {
    const c = splitCounts(10, { easy: 0.95, mid: 0.04, hard: 0.01 });
    expect(c).toEqual({ easy: 8, mid: 1, hard: 1 });
    expect(splitCounts(2, { easy: 0.95, mid: 0.04, hard: 0.01 })).toEqual({ easy: 1, mid: 1, hard: 0 });
  });
});

describe("sectionBand", () => {
  it("tilts the paper: the first text or part sits below the target, the last above", () => {
    expect(sectionBand(6.5, "reading", 1)).toBe(6);
    expect(sectionBand(6.5, "reading", 2)).toBe(6.5);
    expect(sectionBand(6.5, "reading", 3)).toBe(7);
    expect([1, 2, 3, 4].map((p) => sectionBand(6.5, "listening", p))).toEqual([6, 6.5, 6.5, 7]);
  });
});

describe("difficultyMix / difficultyGuide", () => {
  it("gives each section its own counts from the tilted band", () => {
    expect(difficultyMix(6.5, "reading", 1, 13)).toEqual({ band: 6, easy: 7, mid: 5, hard: 1 });
    expect(difficultyMix(6.5, "reading", 3, 14)).toEqual({ band: 7, easy: 4, mid: 6, hard: 4 });
  });

  it("writes one line per section with the three tiers, and names the target", () => {
    const g = difficultyGuide(6.5, "listening", [
      { position: 1, total: 10 },
      { position: 4, total: 10 },
    ]);
    expect(g).toContain("band 6.5");
    expect(g).toContain("Part 1 (10 items): 5 locate, 4 paraphrase, 1 inference");
    expect(g).toContain("Part 4 (10 items): 3 locate");
    expect(g).toContain("inference");
    expect(g).toContain("mixed");
    expect(difficultyGuide(6.5, "reading", [{ position: 2, total: 13 }])).toContain("Passage 2 (13 items): 5 locate, 5 paraphrase, 3 inference");
    expect(difficultyGuide(6.5, "reading", [{ position: 2, total: 13 }], "general")).toContain("Section 2 (13 items)");
  });
});
