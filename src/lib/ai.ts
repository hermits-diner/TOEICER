import { invoke } from "@tauri-apps/api/core";

/** Text providers: logged-in agent CLIs on this PC, used through their subscription. The only API key the app keeps is
 *  Gemini's, for speech (listening audio, transcription, speaking assessment), which no CLI can do. */
export type ProviderId = "claude-cli" | "codex-cli" | "antigravity-cli";
export type CliProviderId = ProviderId;

export const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "claude-cli", label: "Claude Code" },
  { id: "codex-cli", label: "Codex CLI" },
  { id: "antigravity-cli", label: "Antigravity CLI" },
];

export const isCli = (id: string): id is ProviderId => PROVIDERS.some((p) => p.id === id);

/** Offered before the CLI's own list is read (Codex, Antigravity); Claude Code has no list and takes these aliases. */
export const SUGGESTED_MODELS: Record<ProviderId, string[]> = {
  "claude-cli": ["opus", "fable", "sonnet", "haiku"],
  "codex-cli": ["gpt-5.6-terra", "gpt-5.6-luna"],
  "antigravity-cli": ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.1-pro-high", "claude-opus-5-5-high", "claude-sonnet-5-5-high"],
};

/** Gemini TTS models that accept the per-turn speaker form the app sends (the 2.5 previews do not). */
export const GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
];
/** Reasoning effort every CLI accepts; "" is the CLI's default. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Codex service tiers: priority is faster, flex slower and cheaper; "" is the account's default. */
export const CODEX_SPEEDS: { id: string; label: string; note: string }[] = [
  { id: "", label: "기본", note: "Codex 설정의 service_tier를 그대로 씁니다." },
  { id: "priority", label: "빠름", note: "priority 티어: 대기 시간이 짧고 요금이 높습니다." },
  { id: "flex", label: "느림·저렴", note: "flex 티어: 한가할 때 처리되어 느리지만 쌉니다." },
];

/** Gemini models that hear a recording: speaking assessment and transcription. */
/** Gemini models that return images; the catalog refresh replaces this with what the key can use. */
export const GEMINI_IMAGE_MODELS = ["gemini-2.5-flash-image"];

export const GEMINI_SPEECH_MODELS = ["gemini-3.8-flash", "gemini-3.8-pro", "gemini-3.1-flash"];

export interface AiSettings {
  provider: ProviderId;
  /** Chosen model per provider, so switching back keeps the earlier choice. Empty means the CLI's default. */
  models: Record<ProviderId, string>;
  /** Executable per CLI provider; empty means the app looks on PATH and in the usual install locations. */
  cliPaths: Record<ProviderId, string>;
  /** Reasoning effort per provider (EFFORT_LEVELS); empty means the CLI's default. */
  effort: Record<ProviderId, string>;
  /** Speed per provider; only Codex has one (CODEX_SPEEDS). */
  speed: Record<ProviderId, string>;
  /** Gemini TTS model that reads AI-written listening scripts. */
  ttsModel: string;
  /** Gemini model that listens to recordings (speaking assessment, transcripts). */
  speechModel: string;
  /** Gemini model that draws TOEIC Part 1 photographs. */
  imageModel: string;
}

const KEY = "toeicer.ai";
const DEFAULT: AiSettings = {
  provider: "claude-cli",
  models: { "claude-cli": "opus", "codex-cli": "", "antigravity-cli": "" },
  cliPaths: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  effort: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  speed: { "claude-cli": "", "codex-cli": "", "antigravity-cli": "" },
  ttsModel: GEMINI_TTS_MODELS[0],
  speechModel: GEMINI_SPEECH_MODELS[0],
  imageModel: GEMINI_IMAGE_MODELS[0],
};

const pick = (from: Record<string, unknown> | undefined, base: Record<ProviderId, string>): Record<ProviderId, string> =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p.id, typeof from?.[p.id] === "string" ? (from[p.id] as string) : base[p.id]]),
  ) as Record<ProviderId, string>;

/** Settings saved by earlier versions name API providers and keep the Gemini speech model under `models.gemini`. */
export function loadAiSettings(): AiSettings {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as
      | (Partial<AiSettings> & { models?: Record<string, unknown> })
      | null;
    if (!p) return DEFAULT;
    const legacySpeech = typeof p.models?.gemini === "string" ? p.models.gemini.trim() : "";
    return {
      provider: isCli(p.provider ?? "") ? (p.provider as ProviderId) : DEFAULT.provider,
      models: pick(p.models, DEFAULT.models),
      cliPaths: pick(p.cliPaths as Record<string, unknown> | undefined, DEFAULT.cliPaths),
      effort: pick(p.effort as Record<string, unknown> | undefined, DEFAULT.effort),
      speed: pick(p.speed as Record<string, unknown> | undefined, DEFAULT.speed),
      ttsModel: typeof p.ttsModel === "string" && p.ttsModel.trim() ? p.ttsModel.trim() : DEFAULT.ttsModel,
      speechModel:
        typeof p.speechModel === "string" && p.speechModel.trim() ? p.speechModel.trim() : legacySpeech || DEFAULT.speechModel,
      imageModel: typeof p.imageModel === "string" && p.imageModel.trim() ? p.imageModel.trim() : DEFAULT.imageModel,
    };
  } catch {
    return DEFAULT;
  }
}

export function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A convenience setting; the defaults still work.
  }
}

/* ---------- The Gemini key (speech only) ---------- */

export const geminiKeyStored = async () => (await invoke<Record<string, boolean>>("ai_key_status")).gemini === true;
export const setGeminiKey = (key: string) => invoke<void>("ai_set_key", { provider: "gemini", key });
export const deleteGeminiKey = () => invoke<void>("ai_delete_key", { provider: "gemini" });
/** Gemini text models the key can use, for the speech-model picker. */
export const listGeminiModels = () => invoke<string[]>("ai_list_models", { provider: "gemini", cliPath: null });

export const listModels = (s: AiSettings) =>
  invoke<string[]>("ai_list_models", { provider: s.provider, cliPath: s.cliPaths[s.provider] || null });

export interface CliStatus {
  path: string;
  version: string | null;
  loggedIn: boolean | null;
  account: string | null;
  /** Models the CLI lists (Codex, Antigravity); null when it has no listing or gave none. */
  models?: string[] | null;
}

/** Whether the CLI behind a provider is installed and signed in (no model call). */
export const cliStatus = (s: AiSettings, provider: ProviderId) =>
  invoke<CliStatus>("ai_cli_status", { provider, path: s.cliPaths[provider] || null });

export interface CompleteResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export function complete(s: AiSettings, system: string, prompt: string): Promise<CompleteResult> {
  return invoke<CompleteResult>("ai_complete", {
    req: {
      provider: s.provider,
      model: s.models[s.provider],
      cliPath: s.cliPaths[s.provider] || null,
      effort: s.effort[s.provider] ?? "",
      speed: s.speed[s.provider] ?? "",
      system,
      prompt,
    },
  });
}

export const errorText = (e: unknown) =>
  typeof e === "string" ? e : e instanceof Error ? e.message : String(e);

/* ---------- Writing / speaking feedback ---------- */

export interface CriterionScore {
  name: string;
  /** null when the criterion cannot be judged from text (speaking pronunciation). */
  band: number | null;
  comment: string;
}

export interface Correction {
  original: string;
  suggestion: string;
  note: string;
}

export interface Feedback {
  overall: number | null;
  summary: string;
  criteria: CriterionScore[];
  strengths: string[];
  improvements: string[];
  corrections: Correction[];
}

/** TOEFL iBT (2026) task kinds, from the passage title the generator and the samples give each task. */
export type ToeflTask = "email" | "discussion" | "interview" | "repeat";

export function toeflTaskOf(kind: "writing" | "speaking", title: string | null): ToeflTask {
  const t = title ?? "";
  if (/^listen and repeat/i.test(t)) return "repeat";
  if (kind === "speaking") return "interview";
  return /email/i.test(t) ? "email" : "discussion";
}

/**
 * What ETS's public scoring guides for the 2026 tasks look at, task by task. Each criterion is rated on the 0–5 rubric
 * scale the guides use; the overall is reported as a 1–6 band like the score report. See docs/toefl-sources.md.
 */
export const CRITERIA: Record<ToeflTask, string[]> = {
  email: ["Task completion", "Organization and development", "Tone and register", "Language use"],
  discussion: ["Relevance and contribution", "Elaboration", "Language use"],
  interview: ["Delivery", "Language use", "Topic development"],
  repeat: ["Accuracy of repetition", "Pronunciation and intonation"],
};

const TASK_GUIDE: Record<ToeflTask, string> = {
  email:
    "Write an Email (7 minutes). Task completion: every one of the three required points is addressed and developed, not just mentioned. Organization: a clear purpose up front, one point per paragraph, a fitting close. Tone and register: right for the reader (a professor, an office, a classmate); polite requests and appropriate greetings. Language use: range and accuracy of grammar and vocabulary, spelling and punctuation; errors matter by how much they obscure meaning. A response that skips a required point cannot be above 3 on task completion.",
  discussion:
    "Write for an Academic Discussion (10 minutes, about 100 words or more is effective). Relevance and contribution: answers the professor's question with a clear position and adds something the two classmates did not already say; repeating a classmate's idea earns little. Elaboration: reasons explained and supported with specific examples or details, not listed. Language use: a variety of structures and precise vocabulary, with few errors; idiomatic, academic but natural.",
  interview:
    "Take an Interview (45 seconds, no preparation). Delivery: fluid speech with natural pauses, clear pronunciation, rhythm and intonation that carry meaning; judge intelligibility, never the accent. Language use: range and control of grammar and vocabulary for spontaneous speech; spoken grammar (ellipsis, short units) is not an error. Topic development: a direct answer to the question, developed with reasons and an example within the time; an off-topic or memorised answer earns little.",
  repeat:
    "Listen and Repeat. The learner had to repeat one sentence exactly. Accuracy of repetition: how many words, especially content words, and their order were reproduced; note omissions, substitutions and additions against the target sentence. Pronunciation and intonation: intelligible sounds, word stress, linking and the sentence's intonation contour.",
};

const RATING =
  "Rate each criterion on the 0–5 rubric scale in half points and the overall on the 1–6 band scale in half bands (5 on the rubric is about band 6, 4 about band 5, 3 about band 4, 2 about band 3, 1 about band 2). Do not inflate; do not withhold a top score that is earned. In each criterion comment, say what was met and what was not, quoting the answer.";

export const FEEDBACK_SYSTEM = `You are an experienced TOEFL iBT rater giving feedback to a Korean learner on the test format introduced in January 2026.
Score strictly against ETS's public scoring guides for each task.
Write every explanation in Korean (polite 합니다체). Quote the learner's English exactly when you point at it, and write suggested rewrites in English.
Reply with a single JSON object and nothing else, in this shape:
{"overall": number, "summary": string, "criteria": [{"name": string, "band": number|null, "comment": string}],
 "strengths": [string], "improvements": [string], "corrections": [{"original": string, "suggestion": string, "note": string}]}
"overall" is the 1–6 band; each criterion "band" is its 0–5 rubric score. List the criteria in the order given. Give 2-4 strengths, 3-5 improvements, and up to 8 corrections of real errors or clearly weaker phrasing.`;

export function feedbackPrompt(
  kind: "writing" | "speaking",
  taskTitle: string | null,
  task: string,
  answer: string,
  words: number,
): string {
  const t = toeflTaskOf(kind, taskTitle);
  const notes =
    kind === "speaking"
      ? "This is a written transcript or notes of a spoken answer. Delivery and pronunciation cannot be judged from text: set those criteria to null and say so briefly. Base overall on the rest."
      : `The answer has ${words} words.`;
  return [
    `TOEFL iBT ${kind === "speaking" ? "Speaking" : "Writing"}${taskTitle ? ` · ${taskTitle}` : ""}.`,
    `Criteria: ${CRITERIA[t].join("; ")}.`,
    notes,
    TASK_GUIDE[t],
    RATING,
    "",
    "<task>",
    task.trim(),
    "</task>",
    "",
    "<answer>",
    answer.trim(),
    "</answer>",
  ].join("\n");
}

/** The audio evaluation's task description (src/lib/speaking.ts), for a recording rather than a transcript. */
export function speakingTaskGuide(part: string | null): { criteria: string[]; guide: string } {
  const t = toeflTaskOf("speaking", part);
  return { criteria: CRITERIA[t], guide: `${TASK_GUIDE[t]}\n${RATING}` };
}

const band = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9
    ? Math.round(v * 2) / 2
    : null;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : [];

/** Reads the model's reply. Tolerates code fences and stray text around the object, since not every provider enforces JSON. */
export function parseFeedback(text: string): Feedback {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error(
      "첨삭 결과를 읽지 못했습니다. 모델이 정해진 형식으로 답하지 않았습니다.",
    );
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error(
      "첨삭 결과를 읽지 못했습니다. 다시 시도하거나 다른 모델을 골라 주십시오.",
    );
  }
  const criteria = (Array.isArray(raw.criteria) ? raw.criteria : [])
    .filter(
      (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
    )
    .map((c) => ({
      name: str(c.name),
      band: band(c.band),
      comment: str(c.comment),
    }))
    .filter((c) => c.name);
  const corrections = (Array.isArray(raw.corrections) ? raw.corrections : [])
    .filter(
      (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
    )
    .map((c) => ({
      original: str(c.original),
      suggestion: str(c.suggestion),
      note: str(c.note),
    }))
    .filter((c) => c.original || c.suggestion);
  if (!criteria.length && band(raw.overall) === null)
    throw new Error("첨삭 결과에 점수가 없습니다. 다시 시도해 주십시오.");
  return {
    overall: band(raw.overall),
    summary: str(raw.summary),
    criteria,
    strengths: strs(raw.strengths),
    improvements: strs(raw.improvements),
    corrections,
  };
}
