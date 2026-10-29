import { complete, type AiSettings } from "./ai";
import { getDb } from "./db";
import { nextInterval } from "./stats";
import { BRAND } from "./brand";

export interface VocabWord {
  id: number;
  word: string;
  meaning: string;
  context: string | null;
  testId: number | null;
  testTitle: string | null;
  ai: WordInsight | null;
  intervalDays: number | null;
  reviewDue: string;
  createdAt: string;
}

/** What the AI adds for a word in its sentence. */
export interface WordInsight {
  meaning: string;
  explanation: string;
  synonyms: string[];
  collocations: string[];
  example: string;
}

interface Row {
  id: number;
  word: string;
  meaning: string;
  context: string | null;
  test_id: number | null;
  test_title: string | null;
  ai_json: string | null;
  interval_days: number | null;
  review_due: string;
  created_at: string;
}

const toWord = (r: Row): VocabWord => ({
  id: r.id,
  word: r.word,
  meaning: r.meaning,
  context: r.context,
  testId: r.test_id,
  testTitle: r.test_title,
  ai: r.ai_json ? (JSON.parse(r.ai_json) as WordInsight) : null,
  intervalDays: r.interval_days,
  reviewDue: r.review_due,
  createdAt: r.created_at,
});

const SELECT = "SELECT v.*, t.title AS test_title FROM vocab_word v LEFT JOIN test t ON t.id = v.test_id";

export async function listWords(dueOnly = false): Promise<VocabWord[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    dueOnly
      ? `${SELECT} WHERE v.review_due <= datetime('now') ORDER BY v.review_due`
      : `${SELECT} ORDER BY v.id DESC`,
  );
  return rows.map(toWord);
}

export interface WordSet {
  testId: number;
  title: string;
  count: number;
}

/** Sets the saved words came from, most words first: the texts worth reading again. */
export async function listWordSets(limit = 5): Promise<WordSet[]> {
  const db = await getDb();
  const rows = await db.select<{ test_id: number; title: string; count: number }[]>(
    `SELECT v.test_id, t.title, COUNT(*) AS count
       FROM vocab_word v JOIN test t ON t.id = v.test_id
      GROUP BY v.test_id ORDER BY count DESC, v.test_id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ testId: r.test_id, title: r.title, count: r.count }));
}

export async function countDueWords(): Promise<number> {
  const db = await getDb();
  const [r] = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM vocab_word WHERE review_due <= datetime('now')");
  return r?.n ?? 0;
}

export async function findWord(word: string): Promise<VocabWord | null> {
  const db = await getDb();
  const [r] = await db.select<Row[]>(`${SELECT} WHERE v.word = $1`, [word.toLowerCase()]);
  return r ? toWord(r) : null;
}

/** Adds a word (or refreshes its meaning if already saved). New words are due for review straight away. */
export async function saveWord(w: {
  word: string;
  meaning: string;
  context?: string | null;
  testId?: number | null;
  ai?: WordInsight | null;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO vocab_word (word, meaning, context, test_id, ai_json) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(word) DO UPDATE SET meaning = excluded.meaning,
       context = COALESCE(excluded.context, vocab_word.context),
       test_id = COALESCE(excluded.test_id, vocab_word.test_id),
       ai_json = COALESCE(excluded.ai_json, vocab_word.ai_json)`,
    [w.word.toLowerCase(), w.meaning, w.context ?? null, w.testId ?? null, w.ai ? JSON.stringify(w.ai) : null],
  );
}

export async function updateMeaning(id: number, meaning: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE vocab_word SET meaning = $1 WHERE id = $2", [meaning.trim(), id]);
}

export async function deleteWord(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM vocab_word WHERE id = $1", [id]);
}

/** "알았음" pushes the next review out (1, 3, 7, 15, 30 days); "모름" brings it back tomorrow. */
export async function gradeWord(w: VocabWord, known: boolean): Promise<number> {
  const db = await getDb();
  const days = known ? nextInterval(w.intervalDays) : 1;
  await db.execute(
    "UPDATE vocab_word SET interval_days = $1, review_due = datetime('now', '+' || $2 || ' days') WHERE id = $3",
    [known ? days : null, days, w.id],
  );
  return days;
}

/* ---------- AI word help ---------- */

const SYSTEM = `You help a Korean learner preparing for ${BRAND.examName} understand one English word in context.
Reply with a single JSON object and nothing else:
{"meaning": string, "explanation": string, "synonyms": [string], "collocations": [string], "example": string}
- meaning: the Korean meaning that fits this sentence, short (a dictionary-style gloss).
- explanation: one or two Korean sentences on the nuance or usage here (polite 합니다체).
- synonyms: 2-5 English words or phrases ${BRAND.examName} questions might use to paraphrase it in this sense.
- collocations: 2-4 common English collocations with it.
- example: one natural English example sentence in the same sense, followed by its Korean translation in parentheses.`;

export function insightPrompt(word: string, sentence: string | null): string {
  return sentence
    ? `Word: ${word}\nSentence: ${sentence}`
    : `Word: ${word}\n(No sentence available; use the most common academic sense.)`;
}

export function parseInsight(text: string): WordInsight {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 풀이를 읽지 못했습니다. 다시 시도해 주십시오.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("AI 풀이를 읽지 못했습니다. 다시 시도해 주십시오.");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 5) : []);
  const insight = {
    meaning: str(raw.meaning),
    explanation: str(raw.explanation),
    synonyms: list(raw.synonyms),
    collocations: list(raw.collocations),
    example: str(raw.example),
  };
  if (!insight.meaning) throw new Error("AI 풀이에 뜻이 없습니다. 다시 시도해 주십시오.");
  return insight;
}

export async function explainWord(settings: AiSettings, word: string, sentence: string | null): Promise<WordInsight> {
  const r = await complete(settings, SYSTEM, insightPrompt(word, sentence));
  return parseInsight(r.text);
}

/** The sentence around a character offset, for context. */
export function sentenceAround(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const startMatch = before.match(/.*[.!?]\s+/s);
  const start = startMatch ? startMatch[0].length : 0;
  const rest = text.slice(offset);
  const endMatch = rest.match(/[.!?](\s|$)/);
  const end = endMatch && endMatch.index !== undefined ? offset + endMatch.index + 1 : text.length;
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 400);
}
