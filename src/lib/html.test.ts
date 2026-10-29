// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToText } from "./html";

describe("htmlToText", () => {
  it("keeps paragraphs and drops navigation, scripts and footers", () => {
    const html = `<html><body><nav>메뉴 홈 공지</nav><main><h1>TOEIC 시험 구성</h1><p>Listening 100문항과 Reading 100문항으로 구성됩니다.</p>
      <ul><li>Part 1 사진 묘사</li><li>Part 7 독해</li></ul><script>x()</script></main><footer>저작권</footer></body></html>`;
    const text = htmlToText(html);
    expect(text).toBe("TOEIC 시험 구성\n\nListening 100문항과 Reading 100문항으로 구성됩니다.\n\nPart 1 사진 묘사\n\nPart 7 독해");
  });
  it("reads the whole body when the main landmark says too little", () => {
    expect(htmlToText("<body><main>짧음</main><div>본문이 여기에 있습니다.</div></body>")).toContain("본문이 여기에 있습니다.");
  });
});
