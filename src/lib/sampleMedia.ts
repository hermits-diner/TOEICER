// Speech and photographs for the built-in Listening set. scripts/sample-audio.mjs has Gemini TTS read every audio job
// and scripts/sample-photos.mjs has a Gemini image model draw every photo job; the files are kept in public/sample-audio
// and public/sample-photos under their archive names, and SAMPLE_AUDIO / SAMPLE_PHOTOS map each job's key to that name.
// A job's key changes with its words, voices or prompt, so editing a script leaves it without media until the script
// is run again.
import { SAMPLE_AUDIO } from "../data/sampleAudio";
import { SAMPLE_PHOTOS } from "../data/samplePhotos";
import { GEMINI_VOICES, type SpeakerInfo, type SynthTurn } from "./tts";

/** The model the speech was made with (the app's default TTS model). */
export const SAMPLE_TTS_MODEL = "gemini-3.8-flash-tts";
/** The model the Part 1 photographs were made with. */
export const SAMPLE_IMAGE_MODEL = "gemini-3-pro-image";

export interface SampleAudioJob {
  key: string;
  turns: SynthTurn[];
  /** speaker → Gemini prebuilt voice */
  voices: Record<string, string>;
}

export interface SamplePhotoJob {
  key: string;
  /** The same prompt the generator sends to ai_image. */
  prompt: string;
}

/** 32-bit FNV-1a, enough to tell one script from another. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Voices by gender, turned by `shift` so the items of the set do not all sound alike; two speakers never share one. */
function voicesFor(speakers: Record<string, SpeakerInfo>, shift: number): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const [id, s] of Object.entries(speakers)) {
    const list = GEMINI_VOICES[s.gender];
    const turned = [...list.slice(shift % list.length), ...list.slice(0, shift % list.length)];
    const pick = turned.find((v) => !used.has(v)) ?? turned[0];
    out[id] = pick;
    used.add(pick);
  }
  return out;
}

export function audioJob(id: string, turns: SynthTurn[], speakers: Record<string, SpeakerInfo>, shift: number): SampleAudioJob {
  const voices = voicesFor(speakers, shift);
  return { key: `${id}-${fnv1a(JSON.stringify({ model: SAMPLE_TTS_MODEL, turns, voices }))}`, turns, voices };
}

export const photoJob = (id: string, prompt: string): SamplePhotoJob => ({
  key: `${id}-${fnv1a(JSON.stringify({ model: SAMPLE_IMAGE_MODEL, prompt }))}`,
  prompt,
});

/** Archive name of a job's speech or photograph, when it has been made. */
export const sampleAudioName = (j: SampleAudioJob): string | undefined => SAMPLE_AUDIO[j.key];
export const samplePhotoName = (j: SamplePhotoJob): string | undefined => SAMPLE_PHOTOS[j.key];
