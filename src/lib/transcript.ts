/* Scripts for listening sets that came without one. The section's recording goes to a model that accepts audio
   (the same `ai_audio` command the speaking recorder uses) and the transcript is stored as the passage body, so the
   screen (after submission) and the print sheet show it like the script of an AI-written set. */

import { invoke } from "@tauri-apps/api/core";
import { geminiKeyStored, type AiSettings } from "./ai";

export interface SpeechProvider {
  provider: "gemini";
  model: string;
}

/** Gemini listens when it has a key and a chosen model; no CLI can take audio. */
export function speechProvider(geminiKey: boolean, settings: AiSettings): SpeechProvider | null {
  const model = settings.speechModel.trim();
  return geminiKey && model ? { provider: "gemini", model } : null;
}

export const TRANSCRIBE_SYSTEM =
  "You transcribe IELTS Listening recordings for a learner who will read the script after taking the test. " +
  "Write the speech verbatim, including numbers, names and spellings exactly as spoken. " +
  "Put each speaker turn on its own line as 'SPEAKER: words', using the names given in the recording and otherwise " +
  "NARRATOR, MAN, WOMAN, MAN 2 and so on. Output only the transcript: no title, no notes, no code fence.";

export const TRANSCRIBE_PROMPT = "Transcribe this recording.";

/**
 * The model's reply as passage text: fences and blank lines dropped, a turn wrapped over several lines joined,
 * one paragraph (blank line) per speaker turn so passageToHtml keeps the turns apart.
 */
export function transcriptToBody(raw: string): string {
  const lines = raw
    .replace(/```[a-z]*\n?/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const turns: string[] = [];
  const startsTurn = (l: string) => /^[A-Z][A-Za-z0-9 .'\-]{0,40}:\s/.test(l);
  for (const line of lines) {
    if (turns.length === 0 || startsTurn(line)) turns.push(line);
    else turns[turns.length - 1] += ` ${line}`;
  }
  return turns.join("\n\n");
}

/** The transcript of a listening recording (an archive name or an address, archived on first use). */
export async function transcribeListening(settings: AiSettings, source: string): Promise<string> {
  const chosen = speechProvider(await geminiKeyStored(), settings);
  if (!chosen) throw new Error("스크립트를 받아쓰려면 Gemini 키와 음성 모델이 필요합니다. 설정 › AI › 음성에서 저장하세요.");
  const name = /^https?:/.test(source)
    ? await invoke<string>("crawl_audio", { req: { url: source, minIntervalMs: 3000, respectRobots: true } })
    : source;
  const r = await invoke<{ text: string; model: string }>("ai_audio", {
    req: {
      provider: chosen.provider,
      model: chosen.model,
      system: TRANSCRIBE_SYSTEM,
      prompt: TRANSCRIBE_PROMPT,
      name,
    },
  });
  const body = transcriptToBody(r.text);
  if (!body) throw new Error("모델이 빈 스크립트를 돌려주었습니다. 다시 시도해 주십시오.");
  return body;
}
