/* One background job at a time, owned by the app instead of the screen that started it, generic over the job's
   sections, steps, result and report. The screen can be left and come back to, a sidebar can show how far the job
   is, and cancelling ends the processes it waits on (the app's `cancel`, e.g. ai_cancel_job). A finished job holds its
   result until the user opens it, so nothing jumps to another screen by itself. The app-specific part (what the job
   does, its step plan and labels) lives in a module like src/lib/toeicJob.ts. */
import { useSyncExternalStore } from "react";

export type JobStatus = "idle" | "running" | "cancelling" | "saving" | "done" | "failed" | "cancelled";

export interface Job<Sec extends string, Step extends string, Res, Rep> {
  status: JobStatus;
  id: string;
  startedAt: string;
  /** When it ended: done, failed or cancelled. */
  finishedAt: string | null;
  label: string;
  /** The sections in the order they run. */
  sections: Sec[];
  progress: Partial<Record<Sec, Step>>;
  /** 0–100 from the step plan (planPercent); never goes backwards. */
  percent: number;
  /** The current step in a few words. */
  step: string;
  reports: Rep[] | null;
  error: string | null;
  result: Res | null;
}

/** The stages a section goes through, in order; each stage lists the steps that belong to it. */
export type Plan<Step extends string> = Step[][];

export interface JobContext<Sec extends string, Step extends string> {
  job: string;
  signal: AbortSignal;
  onProgress: (section: Sec, step: Step) => void;
  /** Called right before saving starts: from then on the job cannot be cancelled. */
  onSaving: () => void;
}

export interface JobSpec<Sec extends string, Step extends string, Req, Res, Rep> {
  /** What a request covers: a label, its sections in order and each section's plan. */
  describe: (req: Req) => { label: string; sections: Sec[]; planOf: (section: Sec) => Plan<Step> };
  /** The step that ends a section. */
  doneStep: Step;
  /** The bar's share for the sections; saving takes the rest. */
  share: number;
  stepText: (section: Sec, step: Step) => string;
  /** The work, with no React in it. It checks ctx.signal before each costly step and before saving. */
  run: (req: Req, ctx: JobContext<Sec, Step>) => Promise<{ reports: Rep[]; result: Res }>;
  /** Ends the job's running processes and refuses its later calls. */
  cancel: (id: string) => Promise<void>;
  /** Forgets the ended job in the process registry. */
  end: (id: string) => Promise<void>;
}

export const BUSY = "다른 생성이 진행 중입니다.";
const PREPARING = "준비 중";
const SAVING = "저장 중";
const CANCELLING = "취소하는 중";

/** A job that is still running, saving or being cancelled: nothing else may start. */
export const isBusy = (j: { status: JobStatus }) => j.status === "running" || j.status === "saving" || j.status === "cancelling";

const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

/** How far a job is, 0–100: each section an equal part of `share`, split evenly over its plan's stages; a step a
 *  section skips counts as passed once it moves on; saving fills the rest. */
export function planPercent<Sec extends string, Step extends string>(
  sections: Sec[],
  progress: Partial<Record<Sec, Step>>,
  phase: "running" | "saving" | "done",
  planOf: (section: Sec) => Plan<Step>,
  doneStep: Step,
  share: number,
): number {
  if (phase === "done") return 100;
  let sum = 0;
  for (const s of sections) {
    const step = progress[s];
    if (!step) continue;
    const plan = planOf(s);
    const at = step === doneStep ? plan.length : plan.findIndex((stage) => stage.includes(step));
    sum += (at < 0 ? plan.length - 1 : at) / plan.length;
  }
  const p = sections.length ? Math.round((sum / sections.length) * share) : 0;
  return phase === "saving" ? Math.max(p, share) : p;
}

/** mm:ss since the job started (until it ended). */
export function elapsedText(j: { startedAt: string; finishedAt: string | null }, now = Date.now()): string {
  if (!j.startedAt) return "00:00";
  const end = j.finishedAt ? Date.parse(j.finishedAt) : now;
  const sec = Math.max(0, Math.floor((end - Date.parse(j.startedAt)) / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export interface JobStore<Sec extends string, Step extends string, Req, Res, Rep> {
  /** Starts a job; throws BUSY while another one has not settled. Settles when the job has ended and never
   *  rejects: the outcome is in the job's state. */
  start: (req: Req) => Promise<void>;
  /** Cancels the running job; false once saving has started (a test is never left half saved), once its run has
   *  settled, or when none runs. */
  cancel: () => boolean;
  /** Clears a finished, failed or cancelled job. */
  dismiss: () => void;
  get: () => Job<Sec, Step, Res, Rep>;
  subscribe: (listener: () => void) => () => void;
  use: () => Job<Sec, Step, Res, Rep>;
}

/** The run that has not ended yet. `settled` is set as soon as its work has come back, before the registry entry is
 *  ended, so a cancel in between is refused instead of re-marking a finished job as cancelled. */
interface Current {
  id: string;
  controller: AbortController;
  settled: boolean;
  cancelled?: Promise<void>;
}

export function createJobStore<Sec extends string, Step extends string, Req, Res, Rep>(
  spec: JobSpec<Sec, Step, Req, Res, Rep>,
): JobStore<Sec, Step, Req, Res, Rep> {
  type J = Job<Sec, Step, Res, Rep>;
  const IDLE: J = {
    status: "idle",
    id: "",
    startedAt: "",
    finishedAt: null,
    label: "",
    sections: [],
    progress: {},
    percent: 0,
    step: "",
    reports: null,
    error: null,
    result: null,
  };
  let job: J = IDLE;
  /** The run that has not ended yet; while it is set, no other job may start. */
  let current: Current | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of listeners) {
      try {
        l();
      } catch (e) {
        // A broken screen must not stop the job.
        console.error("job listener failed", e);
      }
    }
  };

  /** Changes the job only while it is still the one shown, so a late call of an old job never touches a newer one. */
  const update = (id: string, patch: Partial<J>) => {
    if (job.id !== id) return;
    job = { ...job, ...patch };
    emit();
  };

  const get = () => job;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  function start(req: Req): Promise<void> {
    if (current || isBusy(job)) throw new Error(BUSY);
    const { label, sections, planOf } = spec.describe(req);
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const me: Current = { id, controller: new AbortController(), settled: false };
    current = me;
    job = { ...IDLE, status: "running", id, startedAt: new Date().toISOString(), label, sections, step: PREPARING };
    emit();
    const percentAt = (progress: Partial<Record<Sec, Step>>, phase: "running" | "saving") =>
      Math.max(job.percent, planPercent(sections, progress, phase, planOf, spec.doneStep, spec.share));
    const stepNow = (progress: Partial<Record<Sec, Step>>) => {
      const now = sections.find((s) => progress[s] && progress[s] !== spec.doneStep) ?? [...sections].reverse().find((s) => progress[s]);
      return now ? spec.stepText(now, progress[now]!) : PREPARING;
    };
    const mine = () => job.id === id;
    return spec
      .run(req, {
        job: id,
        signal: me.controller.signal,
        onProgress: (section, step) => {
          if (!mine() || job.status !== "running") return;
          const progress = { ...job.progress, [section]: step };
          update(id, { progress, percent: percentAt(progress, "running"), step: stepNow(progress) });
        },
        onSaving: () => {
          if (!mine() || job.status !== "running") return;
          update(id, { status: "saving", percent: percentAt(job.progress, "saving"), step: SAVING });
        },
      })
      .then(
        ({ reports, result }): Partial<J> => {
          me.settled = true;
          return { status: "done", percent: 100, step: "완료", reports, result };
        },
        (e): Partial<J> => {
          me.settled = true;
          return me.controller.signal.aborted ? { status: "cancelled", step: "취소됨" } : { status: "failed", error: errorText(e) };
        },
      )
      .then(async (outcome) => {
        // The registry entry goes only after the cancel has reached it, and the job counts as ended only after
        // both, so a new job never runs beside a cancelled one that is still unwinding.
        await me.cancelled;
        await spec.end(id).catch((e) => console.warn("ending the job failed", e));
        if (current === me) current = null;
        update(id, { ...outcome, finishedAt: new Date().toISOString() });
      });
  }

  function cancel(): boolean {
    const me = current;
    if (job.status !== "running" || !me || me.id !== job.id || me.settled) return false;
    me.controller.abort();
    me.cancelled = spec.cancel(me.id).catch((e) => update(me.id, { error: `생성은 멈췄지만 실행 중인 AI를 끄지 못했습니다: ${errorText(e)}` }));
    update(me.id, { status: "cancelling", step: CANCELLING });
    return true;
  }

  function dismiss(): void {
    if (current || job.status === "idle" || isBusy(job)) return;
    job = IDLE;
    emit();
  }

  return { start, cancel, dismiss, get, subscribe, use: () => useSyncExternalStore(subscribe, get, get) };
}
