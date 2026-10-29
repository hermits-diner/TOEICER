import { invoke } from "@tauri-apps/api/core";

/** Text providers: logged-in agent CLIs on this PC, used through their subscription. The only API key the app keeps is
 *  Gemini's, for the listening media no CLI can make: speech for Parts 1–4 and photographs for Part 1 (Studio). */
export type ProviderId = "claude-cli" | "codex-cli" | "antigravity-cli";

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

/** Gemini models that return images; the catalog refresh replaces this with what the key can use. */
export const GEMINI_IMAGE_MODELS = ["gemini-2.5-flash-image"];

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
  /** Gemini TTS model that reads listening scripts (Studio). */
  ttsModel: string;
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
  imageModel: GEMINI_IMAGE_MODELS[0],
};

const pick = (from: Record<string, unknown> | undefined, base: Record<ProviderId, string>): Record<ProviderId, string> =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p.id, typeof from?.[p.id] === "string" ? (from[p.id] as string) : base[p.id]]),
  ) as Record<ProviderId, string>;

/** Settings saved by earlier versions may name providers that are gone; those fall back to the default. */
export function loadAiSettings(): AiSettings {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as
      | (Partial<AiSettings> & { models?: Record<string, unknown> })
      | null;
    if (!p) return DEFAULT;
    return {
      provider: isCli(p.provider ?? "") ? (p.provider as ProviderId) : DEFAULT.provider,
      models: pick(p.models, DEFAULT.models),
      cliPaths: pick(p.cliPaths as Record<string, unknown> | undefined, DEFAULT.cliPaths),
      effort: pick(p.effort as Record<string, unknown> | undefined, DEFAULT.effort),
      speed: pick(p.speed as Record<string, unknown> | undefined, DEFAULT.speed),
      ttsModel: typeof p.ttsModel === "string" && p.ttsModel.trim() ? p.ttsModel.trim() : DEFAULT.ttsModel,
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

/* ---------- The Gemini key (listening speech and photographs) ---------- */

export const geminiKeyStored = async () => (await invoke<Record<string, boolean>>("ai_key_status")).gemini === true;
export const setGeminiKey = (key: string) => invoke<void>("ai_set_key", { provider: "gemini", key });
export const deleteGeminiKey = () => invoke<void>("ai_delete_key", { provider: "gemini" });
/** Gemini models the key can use, for the TTS and image pickers. */
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

export const providerLabel = (id: ProviderId): string => PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** The independent checker behind the writer: a different signed-in CLI when one is on this PC, else the
 *  writer's own CLI. A second model solving blind catches the errors a model repeats when it checks itself. */
export interface Verifier {
  settings: AiSettings;
  /** Whether the checker really is another CLI. */
  cross: boolean;
}

export async function pickVerifier(s: AiSettings): Promise<Verifier> {
  for (const id of PROVIDERS.map((p) => p.id).filter((p) => p !== s.provider)) {
    try {
      if ((await cliStatus(s, id)).loggedIn) return { settings: { ...s, provider: id }, cross: true };
    } catch {
      // not installed
    }
  }
  return { settings: s, cross: false };
}
