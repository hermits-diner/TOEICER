import { invoke } from "@tauri-apps/api/core";
import { FEEDBACK_SYSTEM, geminiKeyStored, parseFeedback, speakingTaskGuide, type AiSettings, type Feedback } from "./ai";

/* ---------- Audio ---------- */

export const RECORD_RATE = 16_000;

/** 16-bit PCM mono WAV. Pure, so it can be tested. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Converts what MediaRecorder produced (webm/ogg) into 16 kHz mono WAV, which every speech model accepts. */
export async function toWav(blob: Blob): Promise<{ wav: Uint8Array; seconds: number }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const length = Math.ceil(decoded.duration * RECORD_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, length), RECORD_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded; // channels are mixed down to the single output channel
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { wav: encodeWav(rendered.getChannelData(0), RECORD_RATE), seconds: Math.round(decoded.duration) };
}

/** Stores the recording in the archive; the bytes travel as the raw request body. */
export const saveRecording = (wav: Uint8Array) => invoke<string>("save_recording", wav);

/* ---------- Evaluation ---------- */

const SPEAKING_AUDIO_SYSTEM = `${FEEDBACK_SYSTEM}
You are given the learner's own recording. Add a "transcript" field with what the learner actually said, verbatim in English (keep hesitations such as "um" and self-corrections).
Score every criterion from the audio, delivery and pronunciation included.`;

export function speakingAudioPrompt(part: string | null, task: string): string {
  const { criteria, guide } = speakingTaskGuide(part);
  return [
    `TOEFL iBT Speaking${part ? ` · ${part}` : ""}.`,
    `Criteria: ${criteria.join("; ")}.`,
    guide,
    "The recording is the learner's answer to this task (for Listen and Repeat, the sentence to repeat):",
    "<task>",
    task.trim(),
    "</task>",
  ].join("\n");
}

/** The "transcript" field of a JSON reply, if present. */
export function readTranscript(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  try {
    const t = (JSON.parse(text.slice(start, end + 1)) as { transcript?: unknown }).transcript;
    return typeof t === "string" ? t.trim() : "";
  } catch {
    return "";
  }
}

interface AudioResult {
  text: string;
  model: string;
}

const audioCall = (model: string, system: string, prompt: string, name: string) =>
  invoke<AudioResult>("ai_audio", { req: { provider: "gemini", model, system, prompt, name } });

export const NO_SPEECH = "녹음을 평가하려면 Gemini 키와 음성 모델이 필요합니다. 설정 › AI › 음성에서 저장하세요.";

export interface SpeakingResult {
  transcript: string;
  feedback: Feedback;
  provider: string;
  model: string;
}

/** Gemini hears the recording and scores all four criteria, pronunciation included; no CLI can take audio. */
export async function evaluateRecording(settings: AiSettings, name: string, part: string | null, task: string): Promise<SpeakingResult> {
  if (!settings.speechModel.trim() || !(await geminiKeyStored())) throw new Error(NO_SPEECH);
  const r = await audioCall(settings.speechModel.trim(), SPEAKING_AUDIO_SYSTEM, speakingAudioPrompt(part, task), name);
  return { transcript: readTranscript(r.text), feedback: parseFeedback(r.text), provider: "gemini", model: r.model };
}
