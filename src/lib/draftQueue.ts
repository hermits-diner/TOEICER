/**
 * Every draft write in the app runs through one queue, in the order it was asked for. The SQL plugin spreads
 * statements over a connection pool, so without it a list read started as a practice screen closes could run before
 * that screen's last save (or the delete after submission) and show the set as it was a moment before.
 */
import { deleteDraft } from "./repo";

/** How long the delete after submission waits for the attempt to be saved before it gives up and keeps the draft. */
export const DRAFT_SAVE_WAIT_MS = 15_000;

let tail: Promise<unknown> = Promise.resolve();

/** Runs `op` after every draft write queued before it; the result (or error) is the op's own. */
export function queueDraftWrite<T>(op: () => Promise<T>): Promise<T> {
  const done = tail.then(op);
  tail = done.catch(() => {});
  return done;
}

/**
 * The delete that follows submission. It waits in the queue for the attempt to be saved, so neither a save from a new
 * attempt ("다시 풀기") nor a list read gets ahead of it; if the attempt could not be saved, the draft stays. An attempt
 * save that hangs holds the queue (and every set's draft writes behind it) at most DRAFT_SAVE_WAIT_MS: the draft then
 * stays, and the delete fails with a message saying so.
 */
export const deleteDraftOnceSaved = (testId: number, saving: Promise<unknown>): Promise<void> =>
  queueDraftWrite(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      saving.then(
        () => "saved" as const,
        () => "failed" as const,
      ),
      new Promise<"late">((r) => (timer = setTimeout(() => r("late"), DRAFT_SAVE_WAIT_MS))),
    ]);
    clearTimeout(timer);
    if (outcome === "failed") return;
    if (outcome === "late") throw new Error(`기록 저장이 ${DRAFT_SAVE_WAIT_MS / 1000}초 안에 끝나지 않아 임시저장을 남겨 두었습니다`);
    await deleteDraft(testId);
  });

/**
 * Resolves once the draft writes queued so far have finished, so a list read after it shows them. A write that hangs
 * holds the list back at most `maxWaitMs`; the list is then a moment behind rather than never shown.
 */
export async function draftWritesIdle(maxWaitMs = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([tail, new Promise<void>((r) => (timer = setTimeout(r, maxWaitMs)))]);
  clearTimeout(timer);
}
