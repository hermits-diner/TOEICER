import { toeicSampleTests } from "./toeicSamples";
import { findSavedTest, saveImportedTest } from "./repo";

/** Puts the built-in sets into the library on first run (and after it was deleted, if asked); returns how many. */
export async function installSamples(): Promise<number> {
  let added = 0;
  for (const t of toeicSampleTests()) {
    if ((await findSavedTest(t)) !== null) continue;
    await saveImportedTest(t, "sample");
    added++;
  }
  return added;
}
