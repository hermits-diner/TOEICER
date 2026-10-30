import { invoke } from "@tauri-apps/api/core";
import { toeicSampleTests } from "./toeicSamples";
import { findSavedTest, removeOutdatedSamples, saveImportedTest } from "./repo";

/** Raised when the built-in sets change, so a library that has the older ones gets the new ones on the next start. */
export const SAMPLES_VERSION = "2";

/**
 * Copies a file the app ships for the built-in Listening set (public/sample-audio, public/sample-photos) into the media
 * archive. The file is named by its own hash, so the archive must hand back the same name.
 */
async function archiveSampleFile(dir: "sample-audio" | "sample-photos", name: string): Promise<void> {
  const res = await fetch(`/${dir}/${name}`);
  if (!res.ok) throw new Error(`샘플 파일을 찾을 수 없습니다: ${name}`);
  const command = dir === "sample-audio" ? "archive_sample_audio" : "archive_sample_image";
  const got = await invoke<string>(command, new Uint8Array(await res.arrayBuffer()));
  if (got !== name) throw new Error(`샘플 파일이 손상되었습니다: ${name}`);
}

/** Puts the built-in sets into the library, replacing older versions nobody has practised; returns how many were added. */
export async function installSamples(): Promise<number> {
  const tests = toeicSampleTests();
  await removeOutdatedSamples(tests);
  let added = 0;
  for (const t of tests) {
    if ((await findSavedTest(t)) !== null) continue;
    for (const p of t.passages) {
      if (p.audio) await archiveSampleFile("sample-audio", p.audio);
      for (const g of p.groups) if (g.image) await archiveSampleFile("sample-photos", g.image);
    }
    await saveImportedTest(t, "sample");
    added++;
  }
  return added;
}
