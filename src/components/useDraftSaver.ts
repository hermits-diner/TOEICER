import { useCallback, useEffect, useRef, useState } from "react";
import { onWindowClose } from "../lib/closeGuard";
import { deleteDraftOnceSaved, queueDraftWrite } from "../lib/draftQueue";
import { deleteDraft, saveDraft, type DraftInput } from "../lib/repo";

/** How long after the last change a draft is written. */
const DEBOUNCE_MS = 1000;
/** Changes that never pause are still written this often. */
const MAX_WAIT_MS = 10_000;
/** How long "임시저장됨 · HH:MM" stays on the button. */
const SAVED_NOTICE_MS = 3000;

/**
 * Keeps a practice screen's unfinished attempt in the database (practice_draft).
 *
 * `snapshot` is read when a write actually runs, so it always sees the latest state. It returns the draft to keep,
 * null when nothing is left worth keeping (the stored draft is deleted), or undefined when the draft must not be
 * touched at all (nothing done yet, or already submitted). Writes go through the app-wide draft queue (draftQueue.ts),
 * so they land in the order they were asked for; the last changes are also written when the window closes.
 */
export function useDraftSaver(testId: number, snapshot: () => DraftInput | null | undefined) {
  const read = useRef(snapshot);
  read.current = snapshot;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** When the oldest change not yet written was made. */
  const pendingSince = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const report = useCallback(
    (write: Promise<void>, what: string): Promise<boolean> =>
      write.then(
        () => {
          setError(null);
          return true;
        },
        (e: unknown) => {
          setError(`${what} 실패: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        },
      ),
    [],
  );

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pendingSince.current = null;
  };

  /** Writes the current state now (or deletes the draft when nothing is left). True once written. */
  const flush = useCallback((): Promise<boolean> => {
    cancel();
    const d = read.current();
    if (d === undefined) return Promise.resolve(false);
    return d === null
      ? report(queueDraftWrite(() => deleteDraft(testId)), "임시저장 정리")
      : report(queueDraftWrite(() => saveDraft(testId, d)), "임시저장");
  }, [testId, report]);

  /** Writes after a pause in changes, or at the latest MAX_WAIT_MS after the first change not yet written. */
  const schedule = useCallback(() => {
    const now = Date.now();
    pendingSince.current ??= now;
    clearTimeout(timer.current);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, pendingSince.current + MAX_WAIT_MS - now));
    timer.current = setTimeout(() => void flush(), wait);
  }, [flush]);

  /** Drops any pending write and deletes the stored draft (starting over). */
  const discard = useCallback((): Promise<boolean> => {
    cancel();
    return report(queueDraftWrite(() => deleteDraft(testId)), "임시저장 삭제");
  }, [testId, report]);

  /** After submission: deletes the draft once `saving` (the attempt) is stored; keeps it if that fails or hangs. */
  const discardOnceSaved = useCallback(
    (saving: Promise<unknown>): Promise<boolean> => {
      cancel();
      return report(deleteDraftOnceSaved(testId, saving), "임시저장 삭제");
    },
    [testId, report],
  );

  /** The 임시저장 button: writes now and says when. */
  const saveNow = useCallback(async () => {
    if (await flush()) setSavedAt(new Date());
  }, [flush]);

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), SAVED_NOTICE_MS);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Leaving the screen, or closing the window, writes what the pause had not written yet.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const unregister = onWindowClose(() => flushRef.current());
    return () => {
      unregister();
      void flushRef.current();
    };
  }, []);

  return { schedule, flush, discard, discardOnceSaved, saveNow, savedAt, error };
}
