import { describe, expect, it, vi } from "vitest";
import { BUSY, createJobStore, elapsedText, isBusy, planPercent, type JobContext, type Plan } from "./jobStore";

type Sec = "a" | "b";
type Step = "x" | "y" | "done";
const PLAN: Plan<Step> = [["x"], ["y"]];

/** A store whose run waits until the test settles it. With `slowEnd`, forgetting a job waits for `releaseEnd`. */
function harness(opts: { cancelFails?: boolean; slowEnd?: boolean } = {}) {
  const runs: { ctx: JobContext<Sec, Step>; resolve: (v: { reports: string[]; result: { n: number } }) => void; reject: (e: unknown) => void }[] = [];
  const calls: string[] = [];
  let releaseEnd: () => void = () => {};
  const store = createJobStore<Sec, Step, { sections: Sec[] }, { n: number }, string>({
    describe: (req) => ({ label: req.sections.join("+"), sections: req.sections, planOf: () => PLAN }),
    doneStep: "done",
    share: 90,
    stepText: (s, step) => `${s}:${step}`,
    run: (_req, ctx) => new Promise((resolve, reject) => runs.push({ ctx, resolve, reject })),
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
      if (opts.cancelFails) throw new Error("taskkill missing");
    },
    end: async (id) => {
      calls.push(`end ${id}`);
      if (opts.slowEnd) await new Promise<void>((r) => (releaseEnd = r));
    },
  });
  return { store, runs, calls, last: () => runs[runs.length - 1], releaseEnd: () => releaseEnd() };
}

describe("createJobStore", () => {
  it("runs one job, shows its progress to a subscriber that comes later, and holds the result", async () => {
    const { store, last, calls } = harness();
    const pending = store.start({ sections: ["a", "b"] });
    const { id } = store.get();
    expect(store.get()).toMatchObject({ status: "running", label: "a+b", sections: ["a", "b"], percent: 0, step: "준비 중", finishedAt: null });
    expect(last().ctx.job).toBe(id);

    const seen: string[] = [];
    const off = store.subscribe(() => seen.push(store.get().step));
    last().ctx.onProgress("a", "y");
    expect(seen).toEqual(["a:y"]);
    expect(store.get().percent).toBe(planPercent(["a", "b"], { a: "y" }, "running", () => PLAN, "done", 90));
    // a step reported out of order never moves the bar back
    const before = store.get().percent;
    last().ctx.onProgress("a", "x");
    expect(store.get().percent).toBe(before);
    off();

    last().resolve({ reports: ["ok"], result: { n: 1 } });
    await pending;
    expect(store.get()).toMatchObject({ status: "done", percent: 100, step: "완료", reports: ["ok"], result: { n: 1 }, error: null });
    expect(store.get().finishedAt).not.toBeNull();
    expect(calls).toEqual([`end ${id}`]);
  });

  it("refuses a new start while a job runs and while a cancelled one is still unwinding", async () => {
    const { store, last, calls } = harness();
    const pending = store.start({ sections: ["a"] });
    const { id } = store.get();
    expect(() => store.start({ sections: ["b"] })).toThrow(BUSY);

    expect(store.cancel()).toBe(true);
    expect(last().ctx.signal.aborted).toBe(true);
    expect(store.get()).toMatchObject({ status: "cancelling", step: "취소하는 중" });
    expect(isBusy(store.get())).toBe(true);
    expect(() => store.start({ sections: ["b"] })).toThrow(BUSY);
    expect(store.cancel()).toBe(false);
    store.dismiss();
    expect(store.get().status).toBe("cancelling");

    last().reject(new Error("취소했습니다."));
    await pending;
    expect(store.get()).toMatchObject({ status: "cancelled", error: null });
    // the registry entry is ended only after the cancel went through
    expect(calls).toEqual([`cancel ${id}`, `end ${id}`]);
    const next = store.start({ sections: ["b"] });
    expect(store.get().status).toBe("running");
    last().reject(new Error("x"));
    await next;
  });

  it("cannot cancel a run that has already settled while its end is still on its way", async () => {
    const { store, last, calls, releaseEnd } = harness({ slowEnd: true });
    const pending = store.start({ sections: ["a"] });
    const { id } = store.get();
    last().reject(new Error("Claude Code 오류: Rate limit reached"));
    await vi.waitFor(() => expect(calls).toEqual([`end ${id}`]));
    // the run is over: a cancel now would only show "취소하는 중…" and leave a cancelled entry nobody ends
    expect(store.cancel()).toBe(false);
    expect(store.get().status).not.toBe("cancelling");
    expect(isBusy(store.get())).toBe(true);
    releaseEnd();
    await pending;
    expect(store.get()).toMatchObject({ status: "failed", error: "Claude Code 오류: Rate limit reached" });
    expect(calls).toEqual([`end ${id}`]);
  });

  it("keeps a failed cancel visible on the cancelled job", async () => {
    const { store, last } = harness({ cancelFails: true });
    const pending = store.start({ sections: ["a"] });
    store.cancel();
    last().reject(new Error("취소했습니다."));
    await pending;
    expect(store.get().status).toBe("cancelled");
    expect(store.get().error).toContain("taskkill missing");
  });

  it("cannot be cancelled once saving has started; a failure keeps its error", async () => {
    const { store, last } = harness();
    const pending = store.start({ sections: ["a", "b"] });
    last().ctx.onSaving();
    expect(store.get()).toMatchObject({ status: "saving", percent: 90, step: "저장 중" });
    expect(store.cancel()).toBe(false);
    last().reject(new Error("disk full"));
    await pending;
    expect(store.get()).toMatchObject({ status: "failed", error: "disk full", result: null });
    store.dismiss();
    expect(store.get().status).toBe("idle");
  });

  it("a subscriber that throws does not stop the job", async () => {
    const { store, last } = harness();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    store.subscribe(() => {
      throw new Error("broken screen");
    });
    const pending = store.start({ sections: ["a"] });
    expect(() => last().ctx.onProgress("a", "x")).not.toThrow();
    last().resolve({ reports: [], result: { n: 2 } });
    await pending;
    expect(store.get().status).toBe("done");
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("a late call of an old job does not touch the next one", async () => {
    const { store, runs } = harness();
    const first = store.start({ sections: ["a"] });
    runs[0].resolve({ reports: [], result: { n: 1 } });
    await first;
    store.dismiss();
    const second = store.start({ sections: ["b"] });
    runs[0].ctx.onProgress("a", "y");
    runs[0].ctx.onSaving();
    expect(store.get()).toMatchObject({ status: "running", progress: {}, sections: ["b"] });
    runs[1].reject(new Error("x"));
    await second;
  });
});

describe("planPercent and elapsedText", () => {
  it("gives each section an equal share of the bar, saving the rest", () => {
    const plan = () => PLAN;
    expect(planPercent(["a", "b"], {}, "running", plan, "done", 90)).toBe(0);
    expect(planPercent(["a", "b"], { a: "done" }, "running", plan, "done", 90)).toBe(45);
    expect(planPercent(["a", "b"], { a: "done", b: "done" }, "running", plan, "done", 90)).toBe(90);
    expect(planPercent(["a", "b"], { a: "done", b: "done" }, "saving", plan, "done", 90)).toBe(90);
    expect(planPercent(["a", "b"], {}, "done", plan, "done", 90)).toBe(100);
  });

  it("shows minutes and seconds since the start, until the end", () => {
    expect(elapsedText({ startedAt: "2026-10-31T00:00:00Z", finishedAt: "2026-10-31T01:02:03Z" })).toBe("62:03");
    expect(elapsedText({ startedAt: "2026-10-31T00:00:00Z", finishedAt: null }, Date.parse("2026-10-31T00:00:09Z"))).toBe("00:09");
    expect(elapsedText({ startedAt: "", finishedAt: null })).toBe("00:00");
  });
});
