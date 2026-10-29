import { invoke } from "@tauri-apps/api/core";

/** Speech for AI-written listening parts, made by Google's Gemini TTS models (ai_tts in src-tauri/src/ai.rs). */

export interface SynthTurn {
  speaker: string;
  text: string;
}

export interface SynthResult {
  /** Archive name, playable through loadAudio. */
  name: string;
  duration: number;
  /** Word timing as JSON; empty, because Gemini returns none. Kept so the pipeline can store timing if a later engine has it. */
  words: string;
}

export interface SpeakerInfo {
  role: string;
  gender: "female" | "male";
  accent: "british" | "american";
}

/** Gemini prebuilt voices by the sound of them; the first of each list is the default. */
export const GEMINI_VOICES: Record<SpeakerInfo["gender"], string[]> = {
  female: ["Kore", "Leda", "Aoede", "Zephyr"],
  male: ["Puck", "Charon", "Fenrir", "Orus"],
};

/** Gives each speaker a Gemini voice by gender; two speakers never share a voice. */
export function assignGeminiVoices(speakers: Record<string, SpeakerInfo>): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const [id, s] of Object.entries(speakers)) {
    const list = GEMINI_VOICES[s.gender === "male" ? "male" : "female"];
    const pick = list.find((v) => !used.has(v)) ?? list[0];
    out[id] = pick;
    used.add(pick);
  }
  return out;
}

/** Synthesizes a whole part in one call. */
export const geminiSynthesize = (model: string, turns: SynthTurn[], voices: Record<string, string>) =>
  invoke<SynthResult>("ai_tts", { req: { model, turns, voices } });
