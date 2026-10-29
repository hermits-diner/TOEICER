import { describe, expect, it } from "vitest";
import { passageTab } from "./taskLabels";

describe("passageTab", () => {
  it("names TOEIC passages by part and set", () => {
    expect(passageTab("Part 2 · Question-Response", 0, 4, "Section")).toBe("Part 2");
    expect(passageTab("Part 3 · Conversation 2 (with a graphic)", 2, 4, "Section")).toBe("P3-2");
    expect(passageTab("Part 7 · Double 1 (Order)", 9, 20, "Passage")).toBe("P7-1");
    expect(passageTab("Part 1 · Photograph 4", 3, 30, "Section")).toBe("P1-4");
    expect(passageTab("Part 2 · 7–11", 6, 30, "Section")).toBe("P2-7");
  });
});
