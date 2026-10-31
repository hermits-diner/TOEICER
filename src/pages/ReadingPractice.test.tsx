// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftUnreadable } from "../lib/draft";
import type { Draft } from "../lib/repo";
import type { TestDetail } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repo = vi.hoisted(() => ({
  loadTest: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  saveAttempt: vi.fn(),
  setQuestionReported: vi.fn(),
  updateAttemptScore: vi.fn(),
  loadAudio: vi.fn(),
}));
vi.mock("../lib/repo", () => repo);
/** The app's close handler, as the window would call it. */
const win = vi.hoisted(() => ({ close: null as null | ((e: unknown) => Promise<void>) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: (e: unknown) => Promise<void>) => {
      win.close = h;
      return () => {};
    },
  }),
}));
vi.mock("../components/ExplainPanel", () => ({ default: () => null }));
vi.mock("../components/AudioPlayer", () => ({ default: () => null }));
vi.mock("../components/SpeakButton", () => ({ default: () => null }));
const { default: ReadingPractice } = await import("./ReadingPractice");

const options = ["A", "B", "C", "D"].map((key) => ({ key, text: `Option ${key}` }));
const q = (id: number, number: number) => ({ id, number, prompt: `Question ${number}`, options, answer: ["B"] });
const group = (id: number, questions: ReturnType<typeof q>[]) => ({ id, type: "mcq" as const, instructions: null, options: [], image: null, questions });
/** Three Reading items, so the clock allows the minimum three minutes. */
const reading: TestDetail = {
  id: 7,
  title: "TOEIC Reading 1",
  kind: "reading",
  origin: "mine",
  ai: false,
  reported: [],
  passages: [
    { id: 1, ord: 0, title: "Part 7 · Single 1", bodyHtml: "<p>The office opens at nine.</p>", audio: null, groups: [group(10, [q(101, 147), q(102, 148)])] },
    { id: 2, ord: 1, title: "Part 7 · Single 2", bodyHtml: "<p>Parking is free.</p>", audio: null, groups: [group(20, [q(201, 149)])] },
  ],
};
const listening: TestDetail = {
  ...reading,
  title: "TOEIC Listening 1",
  kind: "listening",
  passages: [{ id: 3, ord: 0, title: "Part 3 · Conversation 1", bodyHtml: "<p>Woman: Hello.</p>", audio: null, groups: [group(30, [q(301, 32)])] }],
};
const draft = (over: Partial<Draft> = {}): Draft => ({
  answers: {},
  flagged: [],
  marked: null,
  passageIdx: 0,
  elapsedSec: 0,
  updatedAt: "2026-10-31 01:55:00",
  ...over,
});

let root: Root | null;
let host: HTMLDivElement;
async function open() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<ReadingPractice testId={7} onExit={() => {}} />));
}
const leave = () => {
  act(() => root!.unmount());
  root = null;
};
const text = () => document.body.textContent ?? "";
const timer = () => document.querySelector(".timer")?.textContent ?? "";
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label))!;
const choice = (questionId: number, key: string) =>
  [...document.querySelectorAll(`#q-${questionId} .choice`)].find((b) => b.querySelector("b")?.textContent === key)!;
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T02:00:00Z"));
  for (const f of Object.values(repo)) f.mockReset();
  repo.loadTest.mockResolvedValue(reading);
  repo.loadDraft.mockResolvedValue(null);
  repo.saveDraft.mockResolvedValue(undefined);
  repo.deleteDraft.mockResolvedValue(undefined);
  repo.saveAttempt.mockResolvedValue(1);
  repo.setQuestionReported.mockResolvedValue(undefined);
});
afterEach(() => {
  if (root) leave();
  host.remove();
  vi.useRealTimers();
});

describe("ReadingPractice: keeping an unfinished attempt", () => {
  it("saves the answers about a second after the last change", async () => {
    await open();
    await click(choice(101, "B"));
    await tick(900);
    await click(choice(102, "C"));
    await tick(900);
    expect(repo.saveDraft).not.toHaveBeenCalled();
    await tick(100);
    expect(repo.saveDraft).toHaveBeenCalledTimes(1);
    expect(repo.saveDraft).toHaveBeenCalledWith(7, expect.objectContaining({ answers: { 101: "B", 102: "C" }, flagged: [], passageIdx: 0 }));
  });

  it("still saves within about ten seconds while answers keep changing without a pause", async () => {
    await open();
    for (let i = 0; i < 20; i++) {
      await click(choice(101, i % 2 ? "B" : "C"));
      await tick(500);
    }
    expect(repo.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("saves straight away on moving to another passage, and on leaving", async () => {
    await open();
    await click(choice(101, "B"));
    await click(button("P7-2"));
    expect(repo.saveDraft).toHaveBeenLastCalledWith(7, expect.objectContaining({ answers: { 101: "B" }, passageIdx: 1 }));
    await click(choice(201, "D"));
    leave();
    await act(async () => {});
    expect(repo.saveDraft).toHaveBeenLastCalledWith(7, expect.objectContaining({ answers: { 101: "B", 201: "D" }, passageIdx: 1 }));
  });

  it("keeps no draft of a set that was only looked at", async () => {
    await open();
    await tick(5000);
    leave();
    await act(async () => {});
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  it("the 임시저장 button saves at once and briefly says when", async () => {
    await open();
    await click(choice(101, "B"));
    await click(button("임시저장"));
    expect(repo.saveDraft).toHaveBeenCalledTimes(1);
    expect(text()).toMatch(/임시저장됨 · \d{2}:\d{2}/);
    await tick(4000);
    expect(text()).not.toMatch(/임시저장됨/);
    expect(repo.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("offers to continue a saved attempt before the clock starts", async () => {
    repo.loadDraft.mockResolvedValue(draft({ answers: { 101: "A" }, elapsedSec: 40 }));
    await open();
    expect(text()).toContain("1/3문항 답함 · 5분 전 저장");
    expect(button("처음부터")).toBeTruthy();
    expect(document.querySelector(".practice-bar")).toBeNull();
    await tick(5000);
    await click(button("이어 풀기"));
    expect(timer()).toContain("02:20"); // 3:00 less the 40 s already spent; the choosing is not counted
  });

  it("이어 풀기 brings back answers, flags, highlights, passage and time", async () => {
    repo.loadDraft.mockResolvedValue(
      draft({
        answers: { 101: "B", 999: "C" },
        flagged: [102],
        marked: { 2: '<p><mark class="hl">Parking</mark> is free.</p>' },
        passageIdx: 1,
        elapsedSec: 125,
      }),
    );
    await open();
    await click(button("이어 풀기"));
    expect(document.querySelector(".passage-text")!.innerHTML).toContain('<mark class="hl">Parking</mark>');
    const nav = [...document.querySelectorAll(".qnav-btn")];
    expect(nav[0].className).toContain("answered");
    expect(nav[1].className).toContain("flagged");
    expect(text()).toContain("1/3 응답"); // the answer to a question no longer in the set is left out
    expect(timer()).toContain("00:55");
    await tick(1000);
    expect(timer()).toContain("00:54");
  });

  it("a Listening set resumes counting up from where it was", async () => {
    repo.loadTest.mockResolvedValue(listening);
    repo.loadDraft.mockResolvedValue(draft({ answers: { 301: "C" }, elapsedSec: 40 }));
    await open();
    expect(text()).toContain("1/1문항 답함");
    await click(button("이어 풀기"));
    expect(timer()).toContain("00:40");
    await tick(1000);
    expect(timer()).toContain("00:41");
    expect(document.querySelector(".submit-confirm")).toBeNull();
  });

  it("처음부터 deletes the draft and starts afresh", async () => {
    repo.loadDraft.mockResolvedValue(draft({ answers: { 101: "B" }, elapsedSec: 125 }));
    await open();
    await click(button("처음부터"));
    expect(repo.deleteDraft).toHaveBeenCalledWith(7);
    expect(text()).toContain("0/3 응답");
    expect(timer()).toContain("03:00");
  });

  it("a timed set whose time ran out opens at the submit question instead of submitting by itself", async () => {
    repo.loadDraft.mockResolvedValue(draft({ answers: { 101: "B" }, elapsedSec: 200 }));
    await open();
    await click(button("이어 풀기"));
    expect(document.querySelector(".submit-confirm")).not.toBeNull();
    expect(timer()).toContain("00:00");
    await tick(3000);
    expect(repo.saveAttempt).not.toHaveBeenCalled();
    await click(button("그대로 제출"));
    expect(repo.saveAttempt).toHaveBeenCalledTimes(1);
  });

  it("deletes the draft only once the attempt is saved, and saves no more drafts after submitting", async () => {
    let resolve!: (id: number) => void;
    repo.saveAttempt.mockReturnValue(new Promise<number>((r) => (resolve = r)));
    await open();
    await click(choice(101, "B"));
    await click(button("제출"));
    await click(button("그대로 제출"));
    expect(repo.saveAttempt).toHaveBeenCalledTimes(1);
    expect(repo.deleteDraft).not.toHaveBeenCalled();
    await act(async () => resolve(55));
    expect(repo.deleteDraft).toHaveBeenCalledWith(7);
    const saves = repo.saveDraft.mock.calls.length;
    await tick(5000);
    leave();
    await act(async () => {});
    expect(repo.saveDraft).toHaveBeenCalledTimes(saves);
  });

  it("saves the latest answers when the app window is closed", async () => {
    await open();
    await click(choice(101, "B"));
    await act(async () => win.close!({}));
    expect(repo.saveDraft).toHaveBeenCalledWith(7, expect.objectContaining({ answers: { 101: "B" } }));
  });

  it("removes a draft whose stored text it cannot read, says so and starts afresh", async () => {
    repo.loadDraft.mockRejectedValue(new DraftUnreadable("임시저장한 풀이를 읽지 못했습니다 (형식이 맞지 않습니다)"));
    await open();
    expect(repo.deleteDraft).toHaveBeenCalledWith(7);
    expect(text()).toContain("처음부터 시작합니다");
    expect(timer()).toContain("03:00");
  });

  it("keeps a draft it could not read because of a database error, and offers to try again", async () => {
    repo.loadDraft.mockRejectedValueOnce(new Error("database is locked")).mockResolvedValueOnce(draft({ answers: { 101: "A" }, elapsedSec: 40 }));
    await open();
    expect(repo.deleteDraft).not.toHaveBeenCalled();
    expect(text()).toContain("database is locked");
    expect(text()).toContain("임시저장은 그대로 두었습니다");
    // the clock does not run and nothing can overwrite the draft meanwhile
    expect(document.querySelector(".practice-bar")).toBeNull();
    await tick(3000);
    expect(repo.saveDraft).not.toHaveBeenCalled();
    await click(button("다시 불러오기"));
    expect(text()).toContain("1/3문항 답함");
    await click(button("이어 풀기"));
    expect(timer()).toContain("02:20");
  });

  it("shows on the result screen when the draft could not be removed after submitting", async () => {
    repo.deleteDraft.mockRejectedValue(new Error("database is locked"));
    await open();
    await click(choice(101, "B"));
    await click(button("제출"));
    await click(button("그대로 제출"));
    await act(async () => {});
    expect(document.querySelector(".result-banner")).not.toBeNull();
    expect(text()).toContain("임시저장 삭제 실패");
  });

  it("keeps the draft, with the latest answers, when the attempt could not be saved", async () => {
    repo.saveAttempt.mockRejectedValue(new Error("disk full"));
    await open();
    await click(choice(101, "B"));
    await click(button("제출"));
    await click(button("그대로 제출"));
    await act(async () => {});
    expect(text()).toContain("기록 저장 실패");
    expect(repo.deleteDraft).not.toHaveBeenCalled();
    expect(repo.saveDraft).toHaveBeenLastCalledWith(7, expect.objectContaining({ answers: { 101: "B" } }));
  });
});
