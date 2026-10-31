// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToeicStep, ToeicUnit } from "../lib/toeicGen";
import type { GenSection } from "../lib/toeicJob";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn(async (cmd: string): Promise<unknown> => (cmd === "ai_key_status" ? { gemini: false } : undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }));
const generateToeic = vi.fn();
vi.mock("../lib/toeicGen", async (orig) => ({ ...(await orig<typeof import("../lib/toeicGen")>()), generateToeic: (...a: unknown[]) => generateToeic(...a) }));
let saved = 0;
vi.mock("../lib/repo", () => ({
  addReferenceDoc: async () => {},
  deleteReferenceDoc: async () => {},
  listReferenceDocs: async () => [],
  referenceMaterial: async () => ({ text: "", tests: 0 }),
  setReferenceDocEnabled: async () => {},
  saveImportedTest: async () => ++saved,
  saveGenMeta: async () => {},
  deleteTest: async () => {},
}));
const brief = vi.fn(async (): Promise<null> => null);
vi.mock("../lib/trend", async (orig) => ({ ...(await orig<typeof import("../lib/trend")>()), officialBrief: () => brief() }));

const { genPercent, getGenJob } = await import("../lib/toeicJob");
const { default: ToeicGeneratePanel } = await import("./ToeicGeneratePanel");

const ALL: ToeicUnit[] = ["p12", "p3", "p4", "p56", "p7s", "p7m"];
const set = (kind: string) => ({ title: kind, kind, passages: [] });

let root: Root;
let host: HTMLDivElement;
let progress: (section: GenSection, step: ToeicStep) => void;
let finish: (r: unknown) => void;
const onCreated = vi.fn();

const mount = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<ToeicGeneratePanel onCreated={onCreated} />));
};
const unmount = () => {
  act(() => root.unmount());
  host.remove();
};
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

beforeEach(() => {
  saved = 0;
  onCreated.mockReset();
  generateToeic.mockReset().mockImplementation(
    (_s: unknown, _o: unknown, onProgress: typeof progress) =>
      new Promise((a) => {
        progress = onProgress;
        finish = a;
      }),
  );
});

afterEach(() => unmount());

describe("ToeicGeneratePanel", () => {
  it("shows the job's progress bar, keeps it across a remount, and opens a set only when asked", async () => {
    await mount();
    await act(async () => button("200문항 한 회분 만들기")!.click());
    await act(async () => {
      await vi.waitFor(() => expect(generateToeic).toHaveBeenCalled());
    });
    act(() => progress("p12", "proof"));

    const bar = host.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe(String(genPercent(ALL, { p12: "proof" }, "running")));
    expect(bar?.getAttribute("aria-valuemin")).toBe("0");
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(host.textContent).toMatch(/\d+% · Part 1–2 · 교정 · \d\d:\d\d/);
    expect(button("200문항 한 회분 만들기")?.disabled).toBe(true);
    expect(button("200문항 한 회분 만들기")?.title).toBe("다른 생성이 진행 중입니다.");
    expect(button("취소")?.disabled).toBe(false);

    // the user goes to another screen and comes back
    unmount();
    await mount();
    act(() => progress("p12", "solve"));
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(String(genPercent(ALL, { p12: "solve" }, "running")));
    expect(host.querySelectorAll(".gen-steps li")).toHaveLength(6);

    await act(async () => finish({ tests: [set("listening"), set("reading")], reports: [] }));
    await act(async () => {
      await vi.waitFor(() => expect(getGenJob().status).toBe("done"));
    });
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
    expect(onCreated).not.toHaveBeenCalled();
    act(() => button("Reading 풀기")!.click());
    expect(onCreated).toHaveBeenCalledWith(2);
    expect(getGenJob().status).toBe("idle");
  });

  it("cancels the running job and says nothing was saved", async () => {
    await mount();
    await act(async () => button("200문항 한 회분 만들기")!.click());
    await act(async () => {
      await vi.waitFor(() => expect(generateToeic).toHaveBeenCalled());
    });
    await act(async () => button("취소")!.click());
    expect(invoke).toHaveBeenCalledWith("ai_cancel_job");
    // until the run has settled nothing can start beside it
    expect(host.textContent).toContain("취소하는 중…");
    expect(button("200문항 한 회분 만들기")?.disabled).toBe(true);
    await act(async () => finish({ tests: [set("listening")], reports: [] }));
    await act(async () => {
      await vi.waitFor(() => expect(getGenJob().status).toBe("cancelled"));
    });
    expect(host.textContent).toContain("생성을 취소했습니다. 저장한 것은 없습니다.");
    expect(button("200문항 한 회분 만들기")?.disabled).toBe(false);
    expect(saved).toBe(0);
    act(() => button("닫기")!.click());
    expect(getGenJob().status).toBe("idle");
  });

  it("cannot start while the manual trend check runs", async () => {
    let checked!: (v: null) => void;
    brief.mockImplementationOnce(() => new Promise<null>((r) => (checked = r)));
    await mount();
    await act(async () => button("지금 확인")!.click());
    expect(button("200문항 한 회분 만들기")?.disabled).toBe(true);
    await act(async () => checked(null));
    expect(button("200문항 한 회분 만들기")?.disabled).toBe(false);
  });
});
