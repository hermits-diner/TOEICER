import { describe, expect, it } from "vitest";
import { passageTab } from "./taskLabels";

describe("passageTab", () => {
  it("names TOEIC passages by part and set", () => {
    expect(passageTab("Part 2 · Question-Response", 0)).toBe("Part 2");
    expect(passageTab("Part 3 · Conversation 2 (with a graphic)", 2)).toBe("P3-2");
    expect(passageTab("Part 7 · Double 1 (Order)", 9)).toBe("P7-1");
    expect(passageTab("Part 1 · Photograph 4", 3)).toBe("P1-4");
    expect(passageTab("Part 2 · 7–11", 6)).toBe("P2-7");
    expect(passageTab(null, 6)).toBe("7");
  });
});
