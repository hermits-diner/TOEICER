// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToeicStep, ToeicUnit } from "../lib/toeicGen";
import type { GenSection } from "../lib/toeicJob";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn(async (_cmd: string): Promise<unknown> => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }));
const generateToeic = vi.fn();
vi.mock("../lib/toeicGen", async (orig) => ({ ...(await orig<typeof import("../lib/toeicGen")>()), generateToeic: (...a: unknown[]) => generateToeic(...a) }));
let saved = 0;
vi.mock("../lib/repo", () => ({
  saveImportedTest: async () => ++saved,
  saveGenMeta: async () => {},
  deleteTest: async () => {},
  referenceMaterial: async () => ({ text: "", tests: 0 }),
}));
vi.mock("../lib/trend", () => ({ officialBrief: async () => null, trendSection: () => [] }));

const { cancelGenJob, dismissGenJob, genPercent, getGenJob, startGenJob } = await import("../lib/toeicJob");
const { default: GenJobBadge } = await import("./GenJobBadge");

let root: Root;
let host: HTMLDivElement;
let progress: (section: GenSection, step: ToeicStep) => void;
let finish: (r: unknown) => void;
let fail: (e: unknown) => void;
const openPage = vi.fn();
const openTest = vi.fn();

const ALL: ToeicUnit[] = ["p12", "p3", "p4", "p56", "p7s", "p7m"];
const set = (kind: string) => ({ title: kind, kind, passages: [] });

beforeEach(() => {
  saved = 0;
  invoke.mockReset().mockResolvedValue(undefined);
  openPage.mockReset();
  openTest.mockReset();
  generateToeic.mockReset().mockImplementation(
    (_s: unknown, _o: unknown, onProgress: typeof progress) =>
      new Promise((a, b) => {
        progress = onProgress;
        finish = a;
        fail = b;
      }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<GenJobBadge onOpenPage={openPage} onOpenTest={openTest} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const start = async (units: ToeicUnit[] = ALL) => {
  let pending!: Promise<void>;
  act(() => {
    pending = startGenJob({ settings: { provider: "claude-cli", models: {} } as never, units, target: "750", topics: "", useRefs: false, geminiKey: false });
  });
  await act(async () => {
    await vi.waitFor(() => expect(generateToeic).toHaveBeenCalled());
  });
  // wrapped: an async function returning the promise itself would wait for the whole job
  return { pending };
};

describe("GenJobBadge", () => {
  it("shows nothing without a job, the step and a bar while one runs, and opens the generation page", async () => {
    expect(host.textContent).toBe("");
    const { pending } = await start();
    act(() => progress("p3", "solve"));
    expect(host.textContent).toContain("AI 생성 중… Part 3 · 정답 가린 풀이");
    const bar = host.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe(String(genPercent(ALL, { p3: "solve" }, "running")));
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(openPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      fail(new Error("Claude Code 오류: Rate limit reached"));
      await pending;
    });
    expect(host.textContent).toContain("AI 생성 실패");
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(getGenJob().status).toBe("failed");
  });

  it("opens a finished single set and clears itself", async () => {
    const { pending } = await start(["p56"]);
    await act(async () => {
      finish({ tests: [set("reading")], reports: [] });
      await pending;
    });
    expect(host.textContent).toContain("AI 생성 완료 — 열기");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(openTest).toHaveBeenCalledWith(1);
    expect(openPage).not.toHaveBeenCalled();
    expect(getGenJob().status).toBe("idle");
    expect(host.textContent).toBe("");
  });

  it("sends a finished full test to the generation page, where both its sets are offered", async () => {
    const { pending } = await start();
    await act(async () => {
      finish({ tests: [set("listening"), set("reading")], reports: [] });
      await pending;
    });
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(openTest).not.toHaveBeenCalled();
    expect(getGenJob().status).toBe("done");
    act(() => dismissGenJob());
    expect(host.textContent).toBe("");
  });

  it("says a job is being cancelled, and keeps a failed cancel's error reachable instead of dismissing it", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_cancel_job") throw new Error("taskkill missing");
      return undefined;
    });
    const { pending } = await start();
    act(() => void cancelGenJob());
    expect(host.textContent).toContain("AI 생성 취소하는 중…");
    await act(async () => {
      fail(new Error("취소했습니다."));
      await pending;
    });
    expect(host.textContent).toContain("취소됨");
    const b = host.querySelector("button") as HTMLButtonElement;
    expect(b.title).toContain("taskkill missing");
    act(() => b.click());
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(getGenJob().status).toBe("cancelled");
  });
});
