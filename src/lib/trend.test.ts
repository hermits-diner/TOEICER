// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const complete = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("./ai", () => ({ complete: (...a: unknown[]) => complete(...a) }));
vi.mock("./generate", () => ({ extractJson: (t: string) => JSON.parse(t) }));

const { officialBrief, parseBrief, trendPrompt, trendSection, loadTrendBrief } = await import("./trend");

const reply = { summary: "2016년 개정 이후의 200문항 구성이 그대로 시행됩니다.", trends: ["문자 메시지·온라인 채팅 지문"], changes: [], mismatch: [] };

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  complete.mockReset();
});

describe("trend brief", () => {
  it("reads the official pages, keeps the brief and reuses it within a week", async () => {
    invoke.mockResolvedValue({ kind: "text", text: "TOEIC 정기시험 일정 및 시험 구성 안내" });
    complete.mockResolvedValue({ text: JSON.stringify(reply) });
    const b = await officialBrief({} as never);
    expect(b?.summary).toBe(reply.summary);
    expect(b?.sources).toEqual(["https://exam.toeic.co.kr", "https://www.ets.org/toeic.html"]);
    expect(complete.mock.calls[0][2]).toContain("TOEIC 정기시험 일정 및 시험 구성 안내");
    expect(loadTrendBrief()?.summary).toBe(reply.summary);
    expect(localStorage.getItem("toeicer.trend")).toContain(reply.summary);
    await officialBrief({} as never);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("keeps the last brief when the sites cannot be read", async () => {
    invoke.mockResolvedValue({ kind: "text", text: "x" });
    complete.mockResolvedValue({ text: JSON.stringify(reply) });
    await officialBrief({} as never);
    invoke.mockRejectedValue("offline");
    expect((await officialBrief({} as never, true))?.summary).toBe(reply.summary);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("rejects an empty brief and turns a brief into writer lines", () => {
    expect(parseBrief({ trends: ["x"] }, [], "2026-10-29T00:00:00Z")).toBeNull();
    const b = parseBrief({ ...reply, changes: ["2027년 Part 3 문항 수 변경"] }, ["https://exam.toeic.co.kr"], "2026-10-29T00:00:00Z")!;
    const lines = trendSection(b).join("\n");
    expect(lines).toContain("# 최신 출제 동향 (공식 사이트 2026-10-29 확인)");
    expect(lines).toContain("- 문자 메시지·온라인 채팅 지문");
    expect(lines).toContain("Announced changes:\n- 2027년 Part 3 문항 수 변경");
    expect(trendSection(null)).toEqual([]);
  });
  it("asks the CLI to compare the pages with the built-in format", () => {
    const p = trendPrompt([{ url: "https://exam.toeic.co.kr", text: "" }]);
    expect(p).toContain("(불러오지 못함)");
    expect(p).toContain('"mismatch"');
    expect(p).toContain("Part 7 Reading Comprehension (54 questions");
    expect(p).toContain("2016 revision");
  });
});
