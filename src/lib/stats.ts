import { getDb } from "./db";
import type { QuestionType, TestKind } from "./types";

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "객관식",
  lmcq: "듣고 고르기",
  cword: "Complete the Words",
  build: "Build a Sentence",
  tfng: "True / False / Not Given",
  ynng: "Yes / No / Not Given",
  heading: "제목 매칭",
  matching: "정보·특징 매칭",
  fill: "빈칸 완성",
  short: "단답형",
};

export interface Overview {
  attempts: number;
  /** Total time across attempts and writing/speaking entries. */
  seconds: number;
  answered: number;
  correct: number;
  entries: number;
  /** Mean band of the last five banded attempts. */
  recentBand: number | null;
}

export interface BandPoint {
  attemptId: number;
  date: string;
  band: number;
  title: string;
  kind: TestKind;
}

export interface TypeAccuracy {
  type: QuestionType;
  answered: number;
  correct: number;
}

/** Accuracy over one slice of the answered questions: a skill, or the target band of an AI-written set. */
export interface Accuracy {
  label: string;
  answered: number;
  correct: number | null;
}

export interface WrongItem {
  questionId: number;
  testId: number;
  testTitle: string;
  number: number;
  type: QuestionType;
  prompt: string | null;
  userAnswer: string;
  answer: string[];
  date: string;
  /** Times this question has been answered wrong overall. */
  misses: number;
  memo: string | null;
}

export async function loadOverview(): Promise<Overview> {
  const db = await getDb();
  const [a] = await db.select<{ attempts: number; seconds: number | null }[]>(
    "SELECT COUNT(*) AS attempts, SUM(duration_sec) AS seconds FROM attempt",
  );
  const [r] = await db.select<{ answered: number; correct: number | null }[]>(
    "SELECT COUNT(*) AS answered, SUM(is_correct) AS correct FROM response r WHERE NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)",
  );
  const [e] = await db.select<{ entries: number; seconds: number | null }[]>(
    "SELECT COUNT(*) AS entries, SUM(duration_sec) AS seconds FROM practice_entry",
  );
  const recent = await db.select<{ band: number }[]>(
    "SELECT band FROM attempt WHERE band IS NOT NULL ORDER BY id DESC LIMIT 5",
  );
  return {
    attempts: a.attempts,
    seconds: (a.seconds ?? 0) + (e.seconds ?? 0),
    answered: r.answered,
    correct: r.correct ?? 0,
    entries: e.entries,
    recentBand: recent.length ? recent.reduce((s, x) => s + x.band, 0) / recent.length : null,
  };
}

export async function loadBandHistory(): Promise<BandPoint[]> {
  const db = await getDb();
  const rows = await db.select<{ id: number; started_at: string; band: number; title: string; kind: TestKind }[]>(
    `SELECT a.id, a.started_at, a.band, t.title, t.kind
       FROM attempt a JOIN test t ON t.id = a.test_id
      WHERE a.band IS NOT NULL
      ORDER BY a.id DESC LIMIT 30`,
  );
  return rows.reverse().map((r) => ({ attemptId: r.id, date: r.started_at, band: r.band, title: r.title, kind: r.kind }));
}

export async function loadTypeAccuracy(): Promise<TypeAccuracy[]> {
  const db = await getDb();
  return db.select<TypeAccuracy[]>(
    `SELECT g.type AS type, COUNT(*) AS answered, SUM(r.is_correct) AS correct
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
      WHERE NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)
      GROUP BY g.type`,
  );
}

const KIND_LABEL: Record<string, string> = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };

/** Accuracy by skill, flagged questions left out. */
export async function loadKindAccuracy(): Promise<Accuracy[]> {
  const db = await getDb();
  const rows = await db.select<{ kind: string; answered: number; correct: number | null }[]>(
    `SELECT t.kind AS kind, COUNT(*) AS answered, SUM(r.is_correct) AS correct
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id
       JOIN test t ON t.id = p.test_id
      WHERE NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)
      GROUP BY t.kind`,
  );
  return rows.map((r) => ({ label: KIND_LABEL[r.kind] ?? r.kind, answered: r.answered, correct: r.correct }));
}

/** Accuracy by the target band an AI-written set was asked for; tells which difficulty is the working edge. */
export async function loadBandAccuracy(): Promise<Accuracy[]> {
  const db = await getDb();
  const rows = await db.select<{ band: number; answered: number; correct: number | null }[]>(
    `SELECT x.band AS band, COUNT(*) AS answered, SUM(r.is_correct) AS correct
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id
       JOIN test_gen x ON x.test_id = p.test_id
      WHERE NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)
      GROUP BY x.band ORDER BY x.band`,
  );
  return rows.map((r) => ({ label: `Band ${r.band}`, answered: r.answered, correct: r.correct }));
}

/**
 * Questions whose most recent answer was wrong and which are due for review.
 * Marking one as reviewed pushes it out by a growing interval (1, 3, 7, 15, 30 days).
 */
export async function loadWrongItems(includeScheduled = false): Promise<WrongItem[]> {
  const db = await getDb();
  const rows = await db.select<
    {
      question_id: number;
      test_id: number;
      test_title: string;
      number: number;
      type: QuestionType;
      prompt: string | null;
      user_answer: string | null;
      answer_json: string;
      started_at: string;
      misses: number;
      memo: string | null;
    }[]
  >(
    `WITH latest AS (
       SELECT r.question_id, MAX(r.id) AS rid FROM response r GROUP BY r.question_id
     )
     SELECT q.id AS question_id, t.id AS test_id, t.title AS test_title, q.number, g.type, q.prompt,
            r.user_answer, q.answer_json, a.started_at,
            (SELECT COUNT(*) FROM response r2 WHERE r2.question_id = q.id AND r2.is_correct = 0) AS misses,
            n.memo
       FROM latest l
       JOIN response r ON r.id = l.rid
       JOIN attempt a ON a.id = r.attempt_id
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id
       JOIN test t ON t.id = p.test_id
       LEFT JOIN note n ON n.question_id = q.id
      WHERE r.is_correct = 0
        AND NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)
        AND ($1 = 1 OR n.review_due IS NULL OR n.review_due <= datetime('now'))
      ORDER BY misses DESC, a.id DESC`,
    [includeScheduled ? 1 : 0],
  );
  return rows.map((r) => ({
    questionId: r.question_id,
    testId: r.test_id,
    testTitle: r.test_title,
    number: r.number,
    type: r.type,
    prompt: r.prompt,
    userAnswer: r.user_answer ?? "",
    answer: JSON.parse(r.answer_json) as string[],
    date: r.started_at,
    misses: r.misses,
    memo: r.memo,
  }));
}

const INTERVALS = [1, 3, 7, 15, 30];

export function nextInterval(current: number | null): number {
  if (current === null) return INTERVALS[0];
  return INTERVALS.find((d) => d > current) ?? INTERVALS[INTERVALS.length - 1];
}

async function noteRow(questionId: number) {
  const db = await getDb();
  const [n] = await db.select<{ id: number; interval_days: number; review_due: string | null }[]>(
    "SELECT id, interval_days, review_due FROM note WHERE question_id = $1",
    [questionId],
  );
  return { db, n };
}

/** Hides the item until its next review date. */
export async function markReviewed(questionId: number): Promise<number> {
  const { db, n } = await noteRow(questionId);
  const days = nextInterval(n?.review_due ? n.interval_days : null);
  if (n) {
    await db.execute(
      `UPDATE note SET interval_days = $1, review_due = datetime('now', '+' || $1 || ' days') WHERE id = $2`,
      [days, n.id],
    );
  } else {
    await db.execute(
      `INSERT INTO note (question_id, interval_days, review_due) VALUES ($1, $2, datetime('now', '+' || $2 || ' days'))`,
      [questionId, days],
    );
  }
  return days;
}

export async function saveMemo(questionId: number, memo: string): Promise<void> {
  const { db, n } = await noteRow(questionId);
  const value = memo.trim() || null;
  if (n) await db.execute("UPDATE note SET memo = $1 WHERE id = $2", [value, n.id]);
  else if (value) await db.execute("INSERT INTO note (question_id, memo) VALUES ($1, $2)", [questionId, value]);
}

/** Seconds studied over the last seven days (today included), across tests and writing/speaking entries. */
export async function loadWeekSeconds(): Promise<number> {
  const db = await getDb();
  const [a] = await db.select<{ s: number | null }[]>(
    "SELECT SUM(duration_sec) AS s FROM attempt WHERE started_at >= datetime('now', 'start of day', '-6 days')",
  );
  const [e] = await db.select<{ s: number | null }[]>(
    "SELECT SUM(duration_sec) AS s FROM practice_entry WHERE created_at >= datetime('now', 'start of day', '-6 days')",
  );
  return (a.s ?? 0) + (e.s ?? 0);
}

export interface RecentTest {
  testId: number;
  title: string;
  kind: TestKind;
  at: string;
}

/** Tests most recently practised, newest first, one row per test. */
export async function loadRecentTests(limit = 4): Promise<RecentTest[]> {
  const db = await getDb();
  const rows = await db.select<{ test_id: number; title: string; kind: TestKind; at: string }[]>(
    `SELECT t.id AS test_id, t.title, t.kind, MAX(x.at) AS at
       FROM (SELECT test_id, started_at AS at FROM attempt
             UNION ALL
             SELECT p.test_id, e.created_at FROM practice_entry e JOIN passage p ON p.id = e.passage_id) x
       JOIN test t ON t.id = x.test_id
      GROUP BY t.id
      ORDER BY at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ testId: r.test_id, title: r.title, kind: r.kind, at: r.at }));
}
