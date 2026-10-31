/* TOEICER's AI generation job on the generic job store (src/lib/jobStore.ts): what one generation does (references,
   trend brief, generateToeic, saving the Listening and the Reading set it made), its step plan and the labels the
   generation page and the sidebar show. Every CLI call of the job carries its id; src-tauri/src/cli.rs keeps the
   processes per job, so a cancel ends the CLI the job is waiting on. */
import { CANCELLED, cancelJob, endJob, errorText, type AiSettings } from "./ai";
import { createJobStore, planPercent, type Job, type JobContext, type JobStatus, type Plan } from "./jobStore";
import { deleteTest, referenceMaterial, saveGenMeta, saveImportedTest } from "./repo";
import { generateToeic, reportLine, UNIT_LABEL, UNIT_PARTS, type ToeicGenReport, type ToeicStep, type ToeicUnit } from "./toeicGen";
import type { Target } from "./toeicSpec";
import { officialBrief, trendSection } from "./trend";
import type { TestKind } from "./types";

/** A writer unit of the job, or the photographs and speech made after all of them. */
export type GenSection = ToeicUnit | "media";

export interface GenRequest {
  settings: AiSettings;
  units: ToeicUnit[];
  target: Target;
  topics: string;
  /** Put the learner's reference material in the writer prompts. */
  useRefs: boolean;
  /** A Gemini key is stored: the listening parts then get Gemini speech, and Part 1 Gemini photographs. */
  geminiKey: boolean;
}

export interface GenResult {
  /** The saved sets in paper order: Listening (1–100) and/or Reading (101–200). */
  sets: { testId: number; kind: TestKind }[];
}

export type GenJob = Job<GenSection, ToeicStep, GenResult, ToeicGenReport>;

export const UNITS: ToeicUnit[] = ["p12", "p3", "p4", "p56", "p7s", "p7m"];

export const STEP_SHORT: Record<ToeicStep, string> = {
  write: "문제 쓰기",
  check: "형식 측정",
  rewrite: "고쳐 쓰기",
  proof: "교정",
  reproof: "고쳐 쓰고 다시 교정",
  solve: "정답 가린 풀이",
  fix: "애매한 문항 검토",
  refill: "뺀 문항 다시 쓰기",
  media: "사진·음성 만들기",
  done: "완료",
};

/** What the sidebar indicator says while the job runs or saves (followed by the step). */
export const JOB_RUNNING = "AI 생성 중…";
/** What it says in every other state that shows; typed over the statuses so a new one cannot show nothing. */
export const JOB_TEXT: Record<Exclude<JobStatus, "idle" | "running" | "saving">, string> = {
  cancelling: "AI 생성 취소하는 중…",
  done: "AI 생성 완료 — 열기",
  failed: "AI 생성 실패",
  cancelled: "취소됨",
};

/** The stages every unit goes through in this order; the photographs and speech are one stage of their own. */
const PLAN: Plan<ToeicStep> = [["write"], ["check", "rewrite"], ["proof", "reproof"], ["solve"], ["fix"], ["refill"]];
const MEDIA_PLAN: Plan<ToeicStep> = [["media"]];
/** Writing the units (and the media) takes this share of the bar; saving the rest. */
const WRITING_SHARE = 95;

const listeningUnit = (u: ToeicUnit) => UNIT_PARTS[u][0] <= 4;
const ordered = (units: ToeicUnit[]) => UNITS.filter((u) => units.includes(u));
const planOf = (s: GenSection): Plan<ToeicStep> => (s === "media" ? MEDIA_PLAN : PLAN);

/** Speech for Parts 1–4 needs the Gemini key and a listening part; photographs also need Part 1. */
export function mediaFor(req: Pick<GenRequest, "units" | "geminiKey">): { speech: boolean; images: boolean } {
  const speech = req.geminiKey && req.units.some(listeningUnit);
  return { speech, images: speech && req.units.includes("p12") };
}

const sectionsOf = (req: GenRequest): GenSection[] => {
  const { speech, images } = mediaFor(req);
  return [...ordered(req.units), ...(speech || images ? (["media"] as const) : [])];
};

export const sectionLabel = (s: GenSection) => (s === "media" ? "사진·음성" : UNIT_LABEL[s]);

/** How far a generation is, 0–100 (see planPercent). */
export function genPercent(sections: GenSection[], progress: Partial<Record<GenSection, ToeicStep>>, phase: "running" | "saving" | "done"): number {
  return planPercent(sections, progress, phase, planOf, "done", WRITING_SHARE);
}

/** Everything one generation does, with no React in it: the reference material and the trend brief, the writing and
 *  checking, then saving every set with its verification record. A save that fails midway removes what this run
 *  already saved. */
export async function runGeneration(req: GenRequest, ctx: JobContext<GenSection, ToeicStep>): Promise<{ reports: ToeicGenReport[]; result: GenResult }> {
  const stop = () => {
    if (ctx.signal.aborted) throw new Error(CANCELLED);
  };
  const { settings, target, topics, useRefs } = req;
  const units = ordered(req.units);
  const references = useRefs ? (await referenceMaterial()).text : "";
  stop();
  const brief = await officialBrief(settings, false, { job: ctx.job, signal: ctx.signal });
  stop();
  const gen = await generateToeic(
    settings,
    { units, target, topics, references, ...mediaFor(req), trend: trendSection(brief) },
    ctx.onProgress,
    { job: ctx.job, signal: ctx.signal },
  );
  stop();
  ctx.onSaving();

  const saved: GenResult["sets"] = [];
  try {
    for (const t of gen.tests) {
      const testId = await saveImportedTest(t, "ai");
      saved.push({ testId, kind: t.kind });
      await saveGenMeta(testId, {
        topic: topics.trim() || "(AI가 고름)",
        band: Number(target),
        provider: settings.provider,
        model: settings.models[settings.provider] ?? "",
        options: {
          exam: "toeic",
          target,
          units,
          references: useRefs,
          trendCheckedAt: brief?.checkedAt ?? null,
          verification: gen.reports
            .filter((r) => (t.kind === "listening") === listeningUnit(r.unit))
            .map((r) => ({ unit: r.unit, checker: r.checker, cross: r.cross, line: reportLine(r) })),
        },
      });
    }
    return { reports: gen.reports, result: { sets: saved } };
  } catch (e) {
    const left: number[] = [];
    for (const { testId } of saved) await deleteTest(testId).catch(() => left.push(testId));
    const undo = !saved.length
      ? ""
      : left.length
        ? ` 먼저 저장된 세트 ${left.length}개를 지우지 못했습니다. 라이브러리에서 직접 지워 주십시오.`
        : ` 먼저 저장된 세트 ${saved.length}개는 지웠습니다.`;
    throw new Error(`만든 세트를 저장하지 못했습니다: ${errorText(e)}${undo}`);
  }
}

const store = createJobStore<GenSection, ToeicStep, GenRequest, GenResult, ToeicGenReport>({
  describe: (req) => {
    const units = ordered(req.units);
    return {
      label: units.length === UNITS.length ? "TOEIC 200문항 한 회분" : units.map((u) => UNIT_LABEL[u]).join(" · "),
      sections: sectionsOf(req),
      planOf,
    };
  },
  doneStep: "done",
  share: WRITING_SHARE,
  stepText: (s, step) => (s === "media" ? STEP_SHORT.media : `${sectionLabel(s)} · ${STEP_SHORT[step]}`),
  run: runGeneration,
  cancel: cancelJob,
  end: endJob,
});

export const startGenJob = store.start;
export const cancelGenJob = store.cancel;
export const dismissGenJob = store.dismiss;
export const getGenJob = store.get;
export const subscribeGenJob = store.subscribe;
export const useGenJob = store.use;
