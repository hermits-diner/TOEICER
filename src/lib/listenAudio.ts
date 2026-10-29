/**
 * Studio: speech for Listening sets that have a script but no recording (the user's converted material, or a set
 * saved without Gemini). Each script line "Woman: …" is a turn; the speakers get Gemini voices by the sound of their
 * role. Gemini reads two voices at most, so a third speaker shares the voice of the second.
 */
import type { AiSettings } from "./ai";
import { paragraphsOf } from "./importFormat";
import { assignGeminiVoices, geminiSynthesize, type SpeakerInfo, type SynthTurn } from "./tts";
import type { ImportPassage, ImportTest } from "./types";

const FEMALE = /\b(woman|female|w|girl|ms\.?|mrs\.?|she)\b/i;
const MALE = /\b(man|male|m|boy|mr\.?|he)\b/i;

/** The turns and speakers of a script; lines without "Role:" belong to the narrator. */
export function scriptTurns(script: string): { turns: SynthTurn[]; speakers: Record<string, SpeakerInfo> } {
  const roles: string[] = [];
  const turns: SynthTurn[] = [];
  for (const line of script.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Z][\w .'-]{0,30}):\s+(.+)$/);
    const role = m ? m[1].trim() : "Narrator";
    const text = m ? m[2] : line;
    if (!roles.includes(role)) roles.push(role);
    // Two voices at most: the third and later speakers read with the second's.
    turns.push({ speaker: roles.indexOf(role) === 0 ? "A" : "B", text });
  }
  const speakers: Record<string, SpeakerInfo> = {};
  roles.slice(0, 2).forEach((role, i) => {
    const gender = FEMALE.test(role) ? "female" : MALE.test(role) ? "male" : i === 0 ? "female" : "male";
    speakers[i === 0 ? "A" : "B"] = { role, gender, accent: "american" };
  });
  if (speakers.A && speakers.B && speakers.A.gender === speakers.B.gender && !FEMALE.test(speakers.B.role) && !MALE.test(speakers.B.role))
    speakers.B.gender = speakers.A.gender === "female" ? "male" : "female";
  return { turns, speakers };
}

const needsAudio = (p: ImportPassage) => !p.audio && paragraphsOf(p).length > 0;

/** How many passages of a Listening set have a script and no recording yet. */
export const missingAudio = (t: ImportTest): number => (t.kind === "listening" ? t.passages.filter(needsAudio).length : 0);

/** The set with a Gemini recording for every passage that has a script but no audio. */
export async function makeAudio(settings: AiSettings, t: ImportTest, onProgress: (done: number, total: number) => void = () => {}): Promise<ImportTest> {
  const todo = t.passages.filter(needsAudio).length;
  let done = 0;
  const passages: ImportPassage[] = [];
  for (const p of t.passages) {
    if (!needsAudio(p)) {
      passages.push(p);
      continue;
    }
    onProgress(done, todo);
    const { turns, speakers } = scriptTurns(paragraphsOf(p).map((x) => x.text).join("\n"));
    const r = await geminiSynthesize(settings.ttsModel, turns, assignGeminiVoices(speakers));
    passages.push({ ...p, audio: r.name });
    done++;
  }
  onProgress(done, todo);
  return { ...t, passages };
}
