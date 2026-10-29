/**
 * Recordings in the archive: speech from the TTS service used to be kept as WAV (24 kHz, about 2.9 MB a minute).
 * The app now keeps MP3 (64 kbps, a tenth of that) and converts older WAV sets on demand, through the MP3 encoder
 * that ships with Windows (src-tauri/src/mp3.rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getDb } from "./db";
import { loadTestSource } from "./repo";

export const isArchivedWav = (name: string | null | undefined) => !!name && /^aud-[0-9a-f]{32}\.wav$/.test(name);
export const isArchivedAudio = (name: string | null | undefined) => !!name && /^aud-[0-9a-f]{32}\.[a-z0-9]+$/.test(name);

/** Converts an archived WAV to MP3 in the archive; returns the MP3's archive name. */
export const audioToMp3 = (name: string) => invoke<string>("audio_to_mp3", { name });

/**
 * Converts a test's WAV recordings to MP3 and points the test at them, in the passage rows and in the stored import
 * form, so playback and export use the small files from then on. Returns how many were converted.
 */
export async function convertTestAudio(testId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ passage_id: number; audio: string | null }[]>(
    "SELECT x.passage_id, x.audio FROM passage_extra x JOIN passage p ON p.id = x.passage_id WHERE p.test_id = $1",
    [testId],
  );
  const renamed: [string, string][] = [];
  for (const r of rows) {
    if (!isArchivedWav(r.audio)) continue;
    const mp3 = await audioToMp3(r.audio!);
    await db.execute("UPDATE passage_extra SET audio = $1 WHERE passage_id = $2", [mp3, r.passage_id]);
    renamed.push([r.audio!, mp3]);
  }
  if (renamed.length) {
    const src = await loadTestSource(testId);
    if (src) {
      let json = src;
      for (const [from, to] of renamed) json = json.split(from).join(to);
      await db.execute("UPDATE test_source SET json = $1 WHERE test_id = $2", [json, testId]);
    }
  }
  return renamed.length;
}

/** Lets the user save an archived recording as a file; a WAV is converted to MP3 unless they choose .wav. */
export async function saveAudioAs(name: string, suggested: string): Promise<string | null> {
  const dest = await save({
    defaultPath: `${suggested.replace(/[\\/:*?"<>|]+/g, " ").trim() || "listening"}.mp3`,
    // only a WAV source can be saved as WAV; the app does not decode MP3
    filters: isArchivedWav(name) ? [{ name: "MP3", extensions: ["mp3"] }, { name: "WAV", extensions: ["wav"] }] : [{ name: "MP3", extensions: ["mp3"] }],
  });
  if (!dest) return null;
  await invoke<number>("save_audio_as", { name, dest });
  return dest;
}
