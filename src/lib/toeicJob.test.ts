import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToeicStep, ToeicUnit } from "./toeicGen";
import type { GenSection } from "./toeicJob";

const invoke = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const generateToeic = vi.fn();
vi.mock("./toeicGen", async (orig) => ({ ...(await orig<typeof import("./toeicGen")>()), generateToeic: (...a: unknown[]) => generateToeic(...a) }));

const repo = {
  saveImportedTest: vi.fn(),
  saveGenMeta: vi.fn(),
  deleteTest: vi.fn(),
  referenceMaterial: vi.fn(),
};
vi.mock("./repo", () => ({
  saveImportedTest: (...a: unknown[]) => repo.saveImportedTest(...a),
  saveGenMeta: (...a: unknown[]) => repo.saveGenMeta(...a),
  deleteTest: (...a: unknown[]) => repo.deleteTest(...a),
  referenceMaterial: (...a: unknown[]) => repo.referenceMaterial(...a),
}));

const officialBrief = vi.fn();
vi.mock("./trend", () => ({ officialBrief: (...a: unknown[]) => officialBrief(...a), trendSection: () => [] }));

const { cancelGenJob, dismissGenJob, genPercent, getGenJob, startGenJob, subscribeGenJob } = await import("./toeicJob");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const ALL: ToeicUnit[] = ["p12", "p3", "p4", "p56", "p7s", "p7m"];
const settings = { provider: "claude-cli", models: { "claude-cli": "opus" } } as never;
const req = (units: ToeicUnit[] = ALL, geminiKey = false) => ({ settings, units, target: "750" as const, topics: "", useRefs: false, geminiKey });
const set = (kind: "listening" | "reading") => ({ title: `AI · TOEIC ${kind}`, kind, passages: [] });
const report = (unit: ToeicUnit) => ({ unit, writer: "claude-cli", checker: "claude-cli", cross: false, total: 0, agreed: 0, flagged: [], proofed: 0, rekeyed: 0, refilled: [], dropped: [], notes: [] });
const fullTest = { tests: [set("listening"), set("reading")], reports: ALL.map(report) };

let gen: ReturnType<typeof deferred<unknown>>;
let progress: (section: GenSection, step: ToeicStep) => void;
let options: { speech?: boolean; images?: boolean; units?: ToeicUnit[] };
let control: { job?: string; signal?: AbortSignal };
let pending: Promise<void> | undefined;

const begin = async (units?: ToeicUnit[], geminiKey?: boolean) => {
  pending = startGenJob(req(units, geminiKey));
  await vi.waitFor(() => expect(generateToeic).toHaveBeenCalled());
  return getGenJob().id;
};

beforeEach(() => {
  invoke.mockClear();
  generateToeic.mockReset();
  for (const f of Object.values(repo)) f.mockReset();
  officialBrief.mockReset().mockResolvedValue(null);
  gen = deferred();
  generateToeic.mockImplementation((_s: unknown, o: typeof options, onProgress: typeof progress, c: typeof control) => {
    options = o;
    progress = onProgress;
    control = c;
    return gen.promise;
  });
  let n = 10;
  repo.saveImportedTest.mockImplementation(async () => ++n);
  repo.saveGenMeta.mockResolvedValue(undefined);
  repo.deleteTest.mockResolvedValue(undefined);
  repo.referenceMaterial.mockResolvedValue({ text: "", tests: 0 });
});

afterEach(async () => {
  if (getGenJob().status === "running" || getGenJob().status === "cancelling") {
    cancelGenJob();
    gen.reject(new Error("취소했습니다."));
  }
  await pending;
  pending = undefined;
  dismissGenJob();
});

describe("generation job", () => {
  it("keeps running when its screen is gone, and a screen that subscribes later sees its progress", async () => {
    const id = await begin();
    expect(getGenJob()).toMatchObject({ status: "running", label: "TOEIC 200문항 한 회분", sections: ALL, percent: 0, step: "준비 중" });
    expect(control.job).toBe(id);
    expect(control.signal).toBeInstanceOf(AbortSignal);
    // the trend check inside the job is one of its CLI calls, and a cancel stops it
    expect(officialBrief).toHaveBeenCalledWith(settings, false, { job: id, signal: control.signal });

    const seen: string[] = [];
    const off = subscribeGenJob(() => seen.push(getGenJob().progress.p12 ?? ""));
    progress("p12", "write");
    progress("p12", "proof");
    off();
    expect(seen).toEqual(["write", "proof"]);
    expect(getGenJob().step).toBe("Part 1–2 · 교정");
    expect(getGenJob().percent).toBe(genPercent(ALL, { p12: "proof" }, "running"));
    expect(getGenJob().percent).toBeGreaterThan(0);

    gen.resolve(fullTest);
    await pending;
    expect(getGenJob().status).toBe("done");
  });

  it("makes photos and speech only with a Gemini key and a listening part, as a step of its own", async () => {
    await begin(ALL, true);
    expect(options).toMatchObject({ units: ALL, speech: true, images: true });
    expect(getGenJob().sections).toEqual([...ALL, "media"]);
    progress("media", "media");
    expect(getGenJob().step).toBe("사진·음성 만들기");
    gen.reject(new Error("x"));
    await pending;
    dismissGenJob();

    gen = deferred();
    await begin(["p3", "p56"], true);
    // Part 3 is spoken but has no photographs
    expect(options).toMatchObject({ speech: true, images: false });
    expect(getGenJob().label).toBe("Part 3 · Part 5–6");
    gen.reject(new Error("x"));
    await pending;
    dismissGenJob();

    gen = deferred();
    await begin(["p56", "p7s"], true);
    expect(options).toMatchObject({ speech: false, images: false });
    expect(getGenJob().sections).toEqual(["p56", "p7s"]);
  });

  it("refuses a second start while one runs", async () => {
    await begin();
    expect(() => startGenJob(req())).toThrow("다른 생성이 진행 중입니다");
    expect(generateToeic).toHaveBeenCalledTimes(1);
  });

  it("cancel ends the job's CLI and saves nothing, even when the generation still finishes", async () => {
    const id = await begin();
    expect(cancelGenJob()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ai_cancel_job", { job: id });
    expect(control.signal?.aborted).toBe(true);
    // until the run has settled it still counts as busy: no second job can start beside it
    expect(getGenJob().status).toBe("cancelling");
    expect(() => startGenJob(req())).toThrow("다른 생성이 진행 중입니다");

    gen.resolve(fullTest); // the CLI answered just as the user cancelled
    await pending;
    expect(getGenJob()).toMatchObject({ status: "cancelled", error: null, result: null });
    expect(repo.saveImportedTest).not.toHaveBeenCalled();
    expect(repo.saveGenMeta).not.toHaveBeenCalled();
    // the job's entry in the process registry is cleared after the cancel went through
    const order = invoke.mock.calls.map((c) => c[0]);
    expect(order.indexOf("ai_end_job")).toBeGreaterThan(order.indexOf("ai_cancel_job"));
    expect(invoke).toHaveBeenCalledWith("ai_end_job", { job: id });
  });

  it("a CLI killed by the cancel ends the job as cancelled, not failed", async () => {
    await begin();
    cancelGenJob();
    gen.reject(new Error("취소했습니다."));
    await pending;
    expect(getGenJob()).toMatchObject({ status: "cancelled", error: null });
  });

  it("holds both sets of a full test when done instead of opening one", async () => {
    await begin();
    gen.resolve(fullTest);
    await pending;
    expect(getGenJob()).toMatchObject({
      status: "done",
      percent: 100,
      result: { sets: [{ testId: 11, kind: "listening" }, { testId: 12, kind: "reading" }] },
      error: null,
    });
    expect(getGenJob().reports).toHaveLength(6);
    expect(repo.saveImportedTest).toHaveBeenCalledTimes(2);
    expect(repo.saveGenMeta).toHaveBeenCalledTimes(2);
    const [listening, reading] = repo.saveGenMeta.mock.calls.map((c) => c[1]);
    expect(listening).toMatchObject({ topic: "(AI가 고름)", band: 750, provider: "claude-cli", model: "opus", options: { exam: "toeic", target: "750", units: ALL } });
    // each set keeps the verification of its own parts
    expect(listening.options.verification.map((v: { unit: string }) => v.unit)).toEqual(["p12", "p3", "p4"]);
    expect(reading.options.verification.map((v: { unit: string }) => v.unit)).toEqual(["p56", "p7s", "p7m"]);
    expect(cancelGenJob()).toBe(false);
  });

  it("a single set is held the same way", async () => {
    await begin(["p56"]);
    gen.resolve({ tests: [set("reading")], reports: [report("p56")] });
    await pending;
    expect(getGenJob()).toMatchObject({ status: "done", result: { sets: [{ testId: 11, kind: "reading" }] } });
  });

  it("a failed generation shows its error", async () => {
    await begin();
    gen.reject(new Error("Claude Code 오류: Rate limit reached"));
    await pending;
    expect(getGenJob()).toMatchObject({ status: "failed", error: "Claude Code 오류: Rate limit reached", result: null });
    expect(repo.saveImportedTest).not.toHaveBeenCalled();
  });

  it("a save that fails midway removes the sets this job already saved", async () => {
    let n = 10;
    repo.saveImportedTest.mockImplementation(async () => {
      if (n === 11) throw new Error("디스크가 가득 찼습니다");
      return ++n;
    });
    await begin();
    gen.resolve(fullTest);
    await pending;
    expect(repo.deleteTest.mock.calls.map((c) => c[0])).toEqual([11]);
    expect(getGenJob().status).toBe("failed");
    expect(getGenJob().error).toContain("디스크가 가득 찼습니다");
    expect(getGenJob().error).toContain("먼저 저장된 세트 1개는 지웠습니다");
  });

  it("cannot be cancelled once saving has started", async () => {
    const save = deferred<number>();
    repo.saveImportedTest.mockReturnValueOnce(save.promise);
    await begin(["p56"]);
    gen.resolve({ tests: [set("reading")], reports: [report("p56")] });
    await vi.waitFor(() => expect(getGenJob().status).toBe("saving"));
    expect(getGenJob().step).toBe("저장 중");
    expect(cancelGenJob()).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("ai_cancel_job", expect.anything());
    save.resolve(31);
    await pending;
    expect(getGenJob()).toMatchObject({ status: "done", result: { sets: [{ testId: 31, kind: "reading" }] } });
  });

  it("a finished job can be dismissed or replaced by a new one", async () => {
    await begin(["p4"]);
    gen.resolve({ tests: [set("listening")], reports: [report("p4")] });
    await pending;
    gen = deferred();
    const first = getGenJob().id;
    const second = await begin(["p7m"]);
    expect(second).not.toBe(first);
    expect(getGenJob()).toMatchObject({ status: "running", sections: ["p7m"] });
    gen.reject(new Error("x"));
    await pending;
    dismissGenJob();
    expect(getGenJob().status).toBe("idle");
  });
});

describe("genPercent", () => {
  const done = Object.fromEntries(ALL.map((s) => [s, "done"])) as Record<ToeicUnit, ToeicStep>;

  it("starts at 0, reaches 95 when every part is written, and 100 when saved", () => {
    expect(genPercent(ALL, {}, "running")).toBe(0);
    expect(genPercent(ALL, done, "running")).toBe(95);
    expect(genPercent(ALL, done, "saving")).toBe(95);
    expect(genPercent(ALL, done, "done")).toBe(100);
    expect(genPercent([...ALL, "media"], done, "running")).toBeLessThan(95);
    expect(genPercent([...ALL, "media"], { ...done, media: "done" }, "running")).toBe(95);
  });

  it("never goes backwards through a whole run, skipped steps included", () => {
    // What generateToeic reports when a unit needs no rewrite or refill, then the photos and speech.
    const run: [GenSection, ToeicStep][] = [
      ...(["write", "check", "rewrite", "proof", "reproof", "solve", "fix", "refill", "done"] as const).map((s) => ["p12", s] as [GenSection, ToeicStep]),
      ...(["write", "check", "proof", "solve", "done"] as const).map((s) => ["p3", s] as [GenSection, ToeicStep]),
      ...(["write", "check", "proof", "solve", "fix", "done"] as const).map((s) => ["p4", s] as [GenSection, ToeicStep]),
      ...(["write", "check", "proof", "solve", "refill", "done"] as const).map((s) => ["p56", s] as [GenSection, ToeicStep]),
      ...(["write", "check", "proof", "solve", "done"] as const).map((s) => ["p7s", s] as [GenSection, ToeicStep]),
      ...(["write", "check", "proof", "solve", "done"] as const).map((s) => ["p7m", s] as [GenSection, ToeicStep]),
      ["media", "media"],
      ["media", "done"],
    ];
    const map: Partial<Record<GenSection, ToeicStep>> = {};
    let last = 0;
    for (const [section, step] of run) {
      map[section] = step;
      const p = genPercent([...ALL, "media"], map, "running");
      expect(p, `${section} ${step}`).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(last).toBe(95);
  });

  it("gives each part an equal share, a part that skips its refill counting as finished", () => {
    expect(genPercent(["p3", "p56"], { p3: "done", p56: "write" }, "running")).toBe(48);
    expect(genPercent(["p3", "p56"], { p3: "fix" }, "running")).toBeLessThan(48);
    // rewriting the faulted units and proofreading them again is part of the proofreading stage
    expect(genPercent(["p3"], { p3: "reproof" }, "running")).toBe(genPercent(["p3"], { p3: "proof" }, "running"));
  });
});
