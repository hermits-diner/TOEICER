/** Unfinished attempts (practice_draft): what is kept, what of it still fits the set, and how the list labels it. */
import type { DraftSummary, TestDetail } from "./types";

export interface DraftInput {
  /** Question id → answer. */
  answers: Record<number, string>;
  flagged: number[];
  /** Passage id → the passage HTML with the learner's highlights. */
  marked: Record<number, string> | null;
  passageIdx: number;
  elapsedSec: number;
}

export interface Draft extends DraftInput {
  /** UTC, as SQLite's datetime('now') writes it. */
  updatedAt: string;
}

/** A stored draft whose text cannot be read: it is of no use and may be removed. A database error is not this — the
 *  draft may be fine, so it is never removed for one. */
export class DraftUnreadable extends Error {}

/** Answers that say something; an emptied choice does not count. */
export const answeredIn = (answers: Record<number, unknown>): number =>
  Object.values(answers).filter((v) => typeof v === "string" && v.trim() !== "").length;

/** The same count from a stored answers_json. An unreadable one counts 0 so the list still opens; the set reports it. */
export function answeredInJson(json: string): number {
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" ? answeredIn(v as Record<number, unknown>) : 0;
  } catch {
    return 0;
  }
}

const textOf = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent?.replace(/\s+/g, " ").trim() ?? "";
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(lo, Math.trunc(n) || 0), hi);

/**
 * What of a saved draft still fits the set, which Studio may have edited since: answers and flags of questions it still
 * has, highlights only on passages whose text is unchanged, and a passage index inside the set.
 */
export function restoreDraft(test: TestDetail, d: DraftInput): DraftInput & { marked: Record<number, string> } {
  const ids = new Set(test.passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.id))));
  const answers: Record<number, string> = {};
  for (const [k, v] of Object.entries(d.answers)) if (ids.has(Number(k)) && typeof v === "string") answers[Number(k)] = v;
  const marked: Record<number, string> = {};
  for (const p of test.passages) {
    const html = d.marked?.[p.id];
    if (html && textOf(html) === textOf(p.bodyHtml)) marked[p.id] = html;
  }
  return {
    answers,
    flagged: d.flagged.filter((id) => ids.has(id)),
    marked,
    passageIdx: clamp(d.passageIdx, 0, Math.max(0, test.passages.length - 1)),
    elapsedSec: Math.max(0, Math.trunc(d.elapsedSec) || 0),
  };
}

/** "5분 전" for a time SQLite wrote (UTC, "YYYY-MM-DD HH:MM:SS"). */
export function savedAgo(updatedAt: string, now = new Date()): string {
  const at = new Date(updatedAt.replace(" ", "T") + "Z");
  const min = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (Number.isNaN(min)) return updatedAt;
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return `${at.getMonth() + 1}월 ${at.getDate()}일`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local "HH:MM", for "임시저장됨 · 14:05". */
export const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Every TOEIC set is answered question by question, so a draft counts questions. */
export const draftBadge = (d: DraftSummary) => `풀던 중 · ${d.answered}문항`;
export const RESUME_LABEL = "이어 풀기";
