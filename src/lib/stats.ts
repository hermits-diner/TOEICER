import { getDb } from "./db";
import { partOfTitle, TOEIC_PARTS } from "./toeicSpec";
import type { TestKind } from "./types";

export interface Overview {
  attempts: number;
  /** Total time across attempts. */
  seconds: number;
  answered: number;
  correct: number;
  /** Mean estimated section score (5–495) of the last five attempts. */
  recentScore: number | null;
}

export interface ScorePoint {
  attemptId: number;
  date: string;
  band: number;
  title: string;
  kind: TestKind;
}

/** Accuracy over one slice of the answered questions: a section or part of the test, or the target of an AI-written set. */
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
  /** The TOEIC part the question belongs to, from its set's title. */
  part: number | null;
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
  const recent = await db.select<{ band: number }[]>(
    "SELECT band FROM attempt WHERE band IS NOT NULL ORDER BY id DESC LIMIT 5",
  );
  return {
    attempts: a.attempts,
    seconds: a.seconds ?? 0,
    answered: r.answered,
    correct: r.correct ?? 0,
    recentScore: recent.length ? recent.reduce((s, x) => s + x.band, 0) / recent.length : null,
  };
}

export async function loadScoreHistory(): Promise<ScorePoint[]> {
  const db = await getDb();
  const rows = await db.select<{ id: number; started_at: string; band: number; title: string; kind: TestKind }[]>(
    `SELECT a.id, a.started_at, a.band, t.title, t.kind
       FROM attempt a JOIN test t ON t.id = a.test_id
      WHERE a.band IS NOT NULL
      ORDER BY a.id DESC LIMIT 30`,
  );
  return rows.reverse().map((r) => ({ attemptId: r.id, date: r.started_at, band: r.band, title: r.title, kind: r.kind }));
}

/** Answers by the set they belong to (its part is in the title, "Part 3 · …"), flagged questions left out. */
async function byPassage(): Promise<{ kind: TestKind; title: string | null; answered: number; correct: number | null }[]> {
  const db = await getDb();
  return db.select(
    `SELECT t.kind AS kind, p.title AS title, COUNT(*) AS answered, SUM(r.is_correct) AS correct
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id
       JOIN test t ON t.id = p.test_id
      WHERE NOT EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = r.question_id)
      GROUP BY t.kind, p.title`,
  );
}

function tally<R extends { answered: number; correct: number | null }>(rows: R[], key: (r: R) => string | null, order: string[]): Accuracy[] {
  const out = new Map<string, Accuracy>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const a = out.get(k) ?? { label: k, answered: 0, correct: 0 };
    a.answered += r.answered;
    a.correct = (a.correct ?? 0) + (r.correct ?? 0);
    out.set(k, a);
  }
  return order.filter((k) => out.has(k)).map((k) => out.get(k)!);
}

const SECTION: Record<TestKind, string> = { listening: "Listening", reading: "Reading" };
const partLabel = (n: number) => {
  const p = TOEIC_PARTS.find((x) => x.part === n)!;
  return `Part ${n} · ${p.korean}`;
};

/** Accuracy by section: Listening and Reading. */
export async function loadSectionAccuracy(): Promise<Accuracy[]> {
  return tally(await byPassage(), (r) => SECTION[r.kind], Object.values(SECTION));
}

/** Accuracy by part (Part 1 사진 묘사 … Part 7 독해), in test order. */
export async function loadPartAccuracy(): Promise<Accuracy[]> {
  return tally(
    await byPassage(),
    (r) => {
      const n = partOfTitle(r.title);
      return n === null ? null : partLabel(n);
    },
    TOEIC_PARTS.map((p) => partLabel(p.part)),
  );
}

/** Accuracy by the target score an AI-written set was asked for; tells which difficulty is the working edge. */
export async function loadTargetAccuracy(): Promise<Accuracy[]> {
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
  return rows.map((r) => ({ label: `목표 ${r.band}점`, answered: r.answered, correct: r.correct }));
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
      passage_title: string | null;
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
     SELECT q.id AS question_id, t.id AS test_id, t.title AS test_title, q.number, p.title AS passage_title, q.prompt,
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
    part: partOfTitle(r.passage_title),
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

/** Seconds studied over the last seven days (today included). */
export async function loadWeekSeconds(): Promise<number> {
  const db = await getDb();
  const [a] = await db.select<{ s: number | null }[]>(
    "SELECT SUM(duration_sec) AS s FROM attempt WHERE started_at >= datetime('now', 'start of day', '-6 days')",
  );
  return a.s ?? 0;
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
    `SELECT t.id AS test_id, t.title, t.kind, MAX(a.started_at) AS at
       FROM attempt a JOIN test t ON t.id = a.test_id
      GROUP BY t.id
      ORDER BY at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ testId: r.test_id, title: r.title, kind: r.kind, at: r.at }));
}
