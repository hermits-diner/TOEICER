/**
 * The models the providers offer right now, read from the CLIs (`codex debug models`, `agy models`) and the Gemini
 * API at every start and kept in localStorage, so the pickers show the live lists and a chosen model that has
 * disappeared is flagged. Claude Code has no listing; its size aliases are suggested as they are.
 */
import {
  GEMINI_SPEECH_MODELS,
  GEMINI_TTS_MODELS,
  geminiKeyStored,
  listGeminiModels,
  listModels,
  PROVIDERS,
  SUGGESTED_MODELS,
  type AiSettings,
  type ProviderId,
} from "./ai";

export interface Catalog {
  /** Live list per CLI that has one. */
  lists: Partial<Record<ProviderId, string[]>>;
  gemini?: { speech: string[]; tts: string[] };
  /** Epoch ms of the last successful refresh; 0 when never. */
  checkedAt: number;
}

const KEY = "toeicer.models";
export const CATALOG_EVENT = "toeicer:models";

export function loadCatalog(): Catalog {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Catalog> | null;
    return { lists: c?.lists ?? {}, gemini: c?.gemini, checkedAt: c?.checkedAt ?? 0 };
  } catch {
    return { lists: {}, checkedAt: 0 };
  }
}

function save(c: Catalog): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // The suggestions still work without a stored list.
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(CATALOG_EVENT));
}

/** Newest first by the version in the name, pro before flash at the same version; a tie keeps the API's order. */
const byVersionDesc = (a: string, b: string) => {
  const v = (s: string) => Number((s.match(/(\d+(?:\.\d+)?)/) ?? ["", "0"])[1]);
  const tier = (s: string) => (/pro/i.test(s) ? 0 : /flash/i.test(s) ? 1 : 2);
  return v(b) - v(a) || tier(a) - tier(b);
};

/** Speech models hear a recording (Gemini text models); TTS models read a script. Embedding, image and tutoring models are neither. */
export function splitGeminiModels(names: string[]): { speech: string[]; tts: string[] } {
  const gemini = names.filter((n) => /^gemini-/i.test(n));
  const tts = gemini.filter((n) => /tts/i.test(n)).sort(byVersionDesc);
  const speech = gemini.filter((n) => !/tts|image|embedding|live|audio/i.test(n)).sort(byVersionDesc);
  return { speech, tts };
}

/** Asks every provider that can list; a failure keeps that provider's earlier list. */
export async function refreshCatalog(s: AiSettings): Promise<Catalog> {
  const c = loadCatalog();
  for (const p of PROVIDERS) {
    if (p.id === "claude-cli") continue;
    try {
      const ids = await listModels({ ...s, provider: p.id });
      if (ids.length) c.lists[p.id] = ids;
    } catch {
      // Not installed or not logged in: the suggestions or the last list stay.
    }
  }
  try {
    if (await geminiKeyStored()) {
      const split = splitGeminiModels(await listGeminiModels());
      if (split.speech.length || split.tts.length) c.gemini = split;
    }
  } catch {
    // Same: keep what we had.
  }
  c.checkedAt = Date.now();
  save(c);
  return c;
}

/** Stores a list a status check brought back, so the panels agree with it. */
export function storeList(provider: ProviderId, ids: string[]): void {
  if (!ids.length) return;
  const c = loadCatalog();
  c.lists[provider] = ids;
  save(c);
}

/** Stores a Gemini list the voice panel fetched. */
export function storeGemini(names: string[]): void {
  const split = splitGeminiModels(names);
  if (!split.speech.length && !split.tts.length) return;
  const c = loadCatalog();
  c.gemini = split;
  save(c);
}

export const modelOptions = (provider: ProviderId): string[] => loadCatalog().lists[provider] ?? SUGGESTED_MODELS[provider];
export const speechOptions = (): string[] => loadCatalog().gemini?.speech ?? GEMINI_SPEECH_MODELS;
export const ttsOptions = (): string[] => loadCatalog().gemini?.tts ?? GEMINI_TTS_MODELS;

/** True when a live list exists for the provider and the chosen (non-empty) model is not in it. */
export function isStale(provider: ProviderId, model: string): boolean {
  const live = loadCatalog().lists[provider];
  return !!live && !!model.trim() && !live.includes(model.trim());
}
