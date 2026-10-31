/**
 * Work to finish before the app window closes (an unfinished attempt's last changes). Closing the window does not
 * unmount the page, so the screens register their flush here instead. The close handler is installed once, on the
 * first registration; it waits for the flushers at most CLOSE_WAIT_MS and never throws, because the window is only
 * destroyed after it returns (which needs "core:window:allow-destroy").
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

export const CLOSE_WAIT_MS = 1500;

type Flusher = () => Promise<unknown>;
const flushers = new Set<Flusher>();
let installed = false;

async function flushAll(): Promise<void> {
  const all = Promise.all(
    [...flushers].map((f) => Promise.resolve().then(f).catch((e: unknown) => console.warn("could not save before closing", e))),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise<void>((r) => (timer = setTimeout(r, CLOSE_WAIT_MS)))]);
  clearTimeout(timer);
}

/** Registers work to run when the window is about to close; returns the function that unregisters it. */
export function onWindowClose(flush: Flusher): () => void {
  flushers.add(flush);
  if (!installed) {
    installed = true;
    try {
      getCurrentWindow()
        .onCloseRequested(() => flushAll())
        .catch((e: unknown) => console.warn("could not watch the window closing", e));
    } catch (e) {
      // Outside the app window (a plain browser): nothing to watch; leaving the screen still saves.
      console.warn("could not watch the window closing", e);
    }
  }
  return () => {
    flushers.delete(flush);
  };
}
