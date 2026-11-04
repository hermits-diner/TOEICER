import { describe, expect, it } from "vitest";
import { SECTIONS } from "./guideContent";

const text = JSON.stringify(SECTIONS);

describe("guide", () => {
  it("the free edition's guide does not sell Studio", () => {
    expect(text).not.toContain("월 구독");
    expect(text).not.toContain("무료 체험");
    expect(text).not.toContain("마켓의 구독 키");
    expect(text).toContain("문제 세트는 모두의 영어시험에서 받거나 살 수 있습니다");
  });
});
