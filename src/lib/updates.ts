/**
 * Installing an update the market published (see release.yml). On Windows the updater runs the installer and ends
 * the process with `std::process::exit`, which skips both the window's close handler (closeGuard: an unfinished
 * attempt's last answers) and the Rust exit hook that ends the AI CLIs. installUpdate does both itself first.
 */
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { flushBeforeExit } from "./closeGuard";
import { draftWritesIdle } from "./draftQueue";

export const UPDATE_BUSY = "AI 생성이 끝나거나 취소한 뒤에 설치하십시오.";

/** Studio's generation job, whichever module the app keeps it in; a Reader build has none (and leaves jobStore out). */
async function generationBusy(): Promise<boolean> {
  if (!__STUDIO__) return false;
  const { anyJobBusy } = await import("./jobStore");
  return anyJobBusy();
}

export async function installUpdate(
  update: Pick<Update, "download" | "install">,
  onProgress: (percent: number | null) => void,
  busy: () => Promise<boolean> = generationBusy,
): Promise<void> {
  if (await busy()) throw new Error(UPDATE_BUSY);
  let total = 0;
  let got = 0;
  await update.download((e: DownloadEvent) => {
    if (e.event === "Started") {
      total = e.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((got / total) * 100)) : null);
    }
  });
  // A generation started while the installer downloaded: installing now would end its CLI half way.
  if (await busy()) throw new Error(UPDATE_BUSY);
  await flushBeforeExit();
  await draftWritesIdle();
  await invoke("ai_end_all_jobs");
  await update.install();
  // Windows never gets here (the installer restarts the app); other platforms need the relaunch.
  await relaunch();
}
