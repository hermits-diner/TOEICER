/**
 * Saving a listening recording as a file. Recordings are kept in the archive as MP3 (Gemini speech arrives as WAV
 * and is converted by the MP3 encoder that ships with Windows, src-tauri/src/mp3.rs); a WAV that came with a set
 * file is converted on the way out.
 */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export const isArchivedAudio = (name: string | null | undefined) => !!name && /^aud-[0-9a-f]{32}\.[a-z0-9]+$/.test(name);
const isArchivedWav = (name: string) => /\.wav$/.test(name);

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
