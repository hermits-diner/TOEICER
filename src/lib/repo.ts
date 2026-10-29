import { invoke } from "@tauri-apps/api/core";
import type { ExamSummary } from "./types";
import type { Feedback } from "./ai";
import { getDb } from "./db";
import { ARCHIVED_IMAGE_RE, passageToHtml } from "./importFormat";
import type {
  GenMeta,
  GenTopic,
  ImportTest,
  Module,
  Option,
  Passage,
  QuestionGroup,
  QuestionType,
  TestDetail,
  TestKind,
  TestSummary,
} from "./types";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parseOptions = (s: string | null): Option[] => (s ? (JSON.parse(s) as Option[]) : []);

/** An archived picture as a data URL. */
export const readImage = (name: string) => invoke<string>("read_image", { name });

/** Data URLs of the archived pictures a test refers to; pictures that were never collected are left out. */
async function loadImages(t: ImportTest): Promise<Record<string, string>> {
  const names = t.passages.flatMap((p) => [...(p.paragraphs ?? []).map((x) => x.image), ...p.groups.map((g) => g.image)]);
  const out: Record<string, string> = {};
  for (const name of new Set(names)) {
    if (name && ARCHIVED_IMAGE_RE.test(name)) out[name] = await readImage(name);
  }
  return out;
}

/** The id of a test saved from exactly this import form, or null. The same hash saveImportedTest keeps. */
export async function findSavedTest(t: ImportTest): Promise<number | null> {
  const db = await getDb();
  const [row] = await db.select<{ id: number }[]>("SELECT id FROM test WHERE content_hash = $1", [await sha256(JSON.stringify(t))]);
  return row?.id ?? null;
}

/** Stores a validated import. Returns the new test id. `origin` links a crawled test to its source and raw file. */
export async function saveImportedTest(
  t: ImportTest,
  origin: { sourceId: number | null; rawPath: string | null } = { sourceId: null, rawPath: null },
): Promise<number> {
  const db = await getDb();
  const hash = await sha256(JSON.stringify(t));

  const dup = await db.select<{ id: number }[]>("SELECT id FROM test WHERE content_hash = $1", [hash]);
  if (dup.length) throw new Error("이미 가져온 시험입니다.");
  const images = await loadImages(t);

  const res = await db.execute(
    `INSERT INTO test (title, kind, module, book_no, test_no, content_hash, status, confidence, source_id, raw_path)
     VALUES ($1, $2, $3, $4, $5, $6, 'published', 1.0, $7, $8)`,
    [t.title, t.kind, t.module, t.book ?? null, t.test ?? null, hash, origin.sourceId, origin.rawPath],
  );
  const testId = res.lastInsertId;
  if (testId === undefined) throw new Error("시험을 저장하지 못했습니다.");

  try {
    for (const [pi, p] of t.passages.entries()) {
      const pr = await db.execute(
        "INSERT INTO passage (test_id, ord, title, body_html) VALUES ($1, $2, $3, $4)",
        [testId, pi, p.title ?? null, passageToHtml(p, images)],
      );
      if (p.audio || p.sample) {
        await db.execute("INSERT INTO passage_extra (passage_id, audio, sample_html) VALUES ($1, $2, $3)", [
          pr.lastInsertId,
          p.audio ?? null,
          p.sample ? passageToHtml({ body: p.sample, groups: [] }) : null,
        ]);
      }
      for (const [gi, g] of p.groups.entries()) {
        const gr = await db.execute(
          "INSERT INTO question_group (passage_id, ord, type, instructions, options_json) VALUES ($1, $2, $3, $4, $5)",
          [pr.lastInsertId, gi, g.type, g.instructions ?? null, json(g.options)],
        );
        if (g.image && images[g.image]) {
          await db.execute("INSERT INTO group_image (group_id, data_url) VALUES ($1, $2)", [gr.lastInsertId, images[g.image]]);
        }
        for (const q of g.questions) {
          await db.execute(
            "INSERT INTO question (group_id, number, prompt, options_json, answer_json) VALUES ($1, $2, $3, $4, $5)",
            [gr.lastInsertId, q.number, q.prompt ?? null, json(q.options), JSON.stringify(q.answer)],
          );
        }
      }
    }
    await db.execute("INSERT OR REPLACE INTO test_source (test_id, json) VALUES ($1, $2)", [testId, JSON.stringify(t)]);
  } catch (e) {
    // No cross-statement transactions through the plugin's pool; clean up the partial insert instead.
    await db.execute("DELETE FROM test WHERE id = $1", [testId]);
    throw e;
  }
  return testId;
}

/** The import form a test was saved from, or null for tests saved before it was kept. */
export async function loadTestSource(id: number): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.select<{ json: string }[]>("SELECT json FROM test_source WHERE test_id = $1", [id]);
  return r?.json ?? null;
}

/** Id of the "공유 파일" source row (seeded in db.ts), for sets imported from packages. */
export async function packageSourceId(): Promise<number | null> {
  const db = await getDb();
  const [r] = await db.select<{ id: number }[]>("SELECT id FROM source WHERE adapter = 'package' LIMIT 1");
  return r?.id ?? null;
}

/** Puts a picture into the archive; returns its name. */
export const saveImage = (bytes: Uint8Array) => invoke<string>("save_image", bytes);

interface SummaryRow {
  id: number;
  title: string;
  kind: TestKind;
  module: Module | null;
  created_at: string;
  question_count: number;
  passage_count: number;
  entries: number;
  attempts: number;
  last_score: number | null;
  last_band: number | null;
  adapter: string | null;
  gen_topic: string | null;
  gen_band: number | null;
  gen_provider: string | null;
  gen_model: string | null;
  gen_options: string | null;
}

/** Records how an AI-written set was asked for; shown and filtered on in the library. */
export async function saveGenMeta(testId: number, meta: GenMeta): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO test_gen (test_id, topic, band, provider, model, options_json) VALUES ($1, $2, $3, $4, $5, $6)`,
    [testId, meta.topic, meta.band, meta.provider, meta.model, JSON.stringify(meta.options)],
  );
}

/** Topics of AI-written sets in the library, with how many sets of each kind used them. */
export async function listGenTopics(): Promise<GenTopic[]> {
  const db = await getDb();
  return db.select<GenTopic[]>(
    `SELECT g.topic AS topic, t.kind AS kind, COUNT(*) AS count
       FROM test_gen g JOIN test t ON t.id = g.test_id
      WHERE g.topic <> '' GROUP BY lower(trim(g.topic)), t.kind`,
  );
}

function genOf(r: SummaryRow): GenMeta | null {
  if (r.gen_band === null || r.gen_provider === null) return null;
  let options: Record<string, unknown> = {};
  try {
    options = JSON.parse(r.gen_options ?? "{}");
  } catch {
    options = {};
  }
  return { topic: r.gen_topic ?? "", band: r.gen_band, provider: r.gen_provider, model: r.gen_model ?? "", options };
}

export async function listTests(kind?: TestKind): Promise<TestSummary[]> {
  const db = await getDb();
  const rows = await db.select<SummaryRow[]>(
    `SELECT t.id, t.title, t.kind, t.module, t.created_at,
       (SELECT COUNT(*) FROM question q
          JOIN question_group g ON q.group_id = g.id
          JOIN passage p ON g.passage_id = p.id
         WHERE p.test_id = t.id) AS question_count,
       (SELECT COUNT(*) FROM passage p WHERE p.test_id = t.id) AS passage_count,
       (SELECT COUNT(*) FROM practice_entry e JOIN passage p ON e.passage_id = p.id WHERE p.test_id = t.id) AS entries,
       (SELECT COUNT(*) FROM attempt a WHERE a.test_id = t.id) AS attempts,
       (SELECT score FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_score,
       (SELECT band FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_band,
       (SELECT s.adapter FROM source s WHERE s.id = t.source_id) AS adapter,
       g.topic AS gen_topic, g.band AS gen_band, g.provider AS gen_provider, g.model AS gen_model, g.options_json AS gen_options
     FROM test t LEFT JOIN test_gen g ON g.test_id = t.id
     WHERE t.status = 'published' AND ($1 IS NULL OR t.kind = $1)
     ORDER BY t.id DESC`,
    [kind ?? null],
  );
  // Collected sections arrive in bulk, so the list reads by title ("Test 2" before "Test 10"), newest first among equals.
  rows.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    module: r.module ?? "academic",
    createdAt: r.created_at,
    questionCount: r.question_count,
    passageCount: r.passage_count,
    entries: r.entries,
    attempts: r.attempts,
    lastScore: r.last_score,
    ai: r.adapter === "ai",
    shared: r.adapter === "package",
    lastBand: r.last_band,
    gen: genOf(r),
  }));
}

export async function loadTest(id: number): Promise<TestDetail> {
  const db = await getDb();
  const [t] = await db.select<{ id: number; title: string; kind: TestKind; module: Module | null; ai: number | null }[]>(
    "SELECT id, title, kind, module, (SELECT s.adapter = 'ai' FROM source s WHERE s.id = test.source_id) AS ai FROM test WHERE id = $1",
    [id],
  );
  if (!t) throw new Error("시험을 찾을 수 없습니다.");

  const passages = await db.select<
    { id: number; ord: number; title: string | null; body_html: string; audio: string | null; sample_html: string | null }[]
  >(
    `SELECT p.id, p.ord, p.title, p.body_html, x.audio, x.sample_html
       FROM passage p LEFT JOIN passage_extra x ON x.passage_id = p.id
      WHERE p.test_id = $1 ORDER BY p.ord`,
    [id],
  );
  const groups = await db.select<
    {
      id: number;
      passage_id: number;
      type: QuestionType;
      instructions: string | null;
      options_json: string | null;
      image: string | null;
    }[]
  >(
    `SELECT g.id, g.passage_id, g.type, g.instructions, g.options_json,
            (SELECT i.data_url FROM group_image i WHERE i.group_id = g.id) AS image
       FROM question_group g JOIN passage p ON g.passage_id = p.id
      WHERE p.test_id = $1 ORDER BY p.ord, g.ord`,
    [id],
  );
  const questions = await db.select<
    { id: number; group_id: number; number: number; prompt: string | null; options_json: string | null; answer_json: string }[]
  >(
    `SELECT q.id, q.group_id, q.number, q.prompt, q.options_json, q.answer_json
       FROM question q JOIN question_group g ON q.group_id = g.id JOIN passage p ON g.passage_id = p.id
      WHERE p.test_id = $1 ORDER BY q.number`,
    [id],
  );

  const groupMap = new Map<number, QuestionGroup & { passageId: number }>();
  for (const g of groups) {
    groupMap.set(g.id, {
      id: g.id,
      passageId: g.passage_id,
      type: g.type,
      instructions: g.instructions,
      options: parseOptions(g.options_json),
      image: g.image,
      questions: [],
    });
  }
  for (const q of questions) {
    groupMap.get(q.group_id)?.questions.push({
      id: q.id,
      number: q.number,
      prompt: q.prompt,
      options: parseOptions(q.options_json),
      answer: JSON.parse(q.answer_json) as string[],
    });
  }

  const outPassages: Passage[] = passages.map((p) => ({
    id: p.id,
    ord: p.ord,
    title: p.title,
    bodyHtml: p.body_html,
    audio: p.audio,
    sampleHtml: p.sample_html,
    groups: [...groupMap.values()].filter((g) => g.passageId === p.id),
  }));
  const reported = await db.select<{ question_id: number }[]>(
    `SELECT f.question_id FROM question_flag f
       JOIN question q ON q.id = f.question_id JOIN question_group g ON q.group_id = g.id JOIN passage p ON g.passage_id = p.id
      WHERE p.test_id = $1`,
    [id],
  );
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    module: t.module ?? "academic",
    passages: outPassages,
    ai: !!t.ai,
    reported: reported.map((r) => r.question_id),
  };
}

/** Reports a flawed question (or withdraws the report); reported questions are left out of scoring and statistics. */
export async function setQuestionReported(questionId: number, reported: boolean): Promise<void> {
  const db = await getDb();
  if (reported) await db.execute("INSERT OR IGNORE INTO question_flag (question_id) VALUES ($1)", [questionId]);
  else await db.execute("DELETE FROM question_flag WHERE question_id = $1", [questionId]);
}

/** Rescores a saved attempt after a report changed which questions count. */
export async function updateAttemptScore(attemptId: number, score: number, band: number | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE attempt SET score = $1, band = $2 WHERE id = $3", [score, band, attemptId]);
}

export async function getTestKind(id: number): Promise<TestKind> {
  return (await getTestShape(id)).kind;
}

/** A test's kind and whether it has questions with a key (TOEFL Writing's Build a Sentence does; Email and Discussion do not). */
export async function getTestShape(id: number): Promise<{ kind: TestKind; questions: number }> {
  const db = await getDb();
  const [t] = await db.select<{ kind: TestKind; questions: number }[]>(
    `SELECT t.kind, (SELECT COUNT(*) FROM question q JOIN question_group g ON g.id = q.group_id
                     JOIN passage p ON p.id = g.passage_id WHERE p.test_id = t.id) AS questions
     FROM test t WHERE t.id = $1`,
    [id],
  );
  if (!t) throw new Error("시험을 찾을 수 없습니다.");
  return t;
}

const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav" };

/** An object URL for a recording. One given by its address is archived on first use and played from the archive afterwards. */
export async function loadAudio(source: string): Promise<string> {
  const name = /^https?:/.test(source)
    ? await invoke<string>("crawl_audio", { req: { url: source, minIntervalMs: 3000, respectRobots: true } })
    : source;
  const bytes = await invoke<ArrayBuffer>("read_audio", { name });
  return URL.createObjectURL(new Blob([bytes], { type: AUDIO_MIME[name.split(".").pop() ?? ""] ?? "audio/mpeg" }));
}

/** Stores a transcript for a listening section that came without one. `bodyHtml` comes from passageToHtml. */
export async function updatePassageBody(passageId: number, bodyHtml: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE passage SET body_html = $1 WHERE id = $2", [bodyHtml, passageId]);
}

/* ---------- Writing and speaking practice ---------- */

export interface EntryFeedback {
  provider: string;
  model: string;
  feedback: Feedback;
  createdAt: string;
}

export interface PracticeEntry {
  id: number;
  passageId: number;
  body: string;
  wordCount: number;
  durationSec: number | null;
  createdAt: string;
  feedback: EntryFeedback | null;
  /** Archive name of the spoken answer, for speaking entries recorded in the app. */
  audio: string | null;
}

export async function listEntries(testId: number): Promise<PracticeEntry[]> {
  const db = await getDb();
  const rows = await db.select<
    {
      id: number;
      passage_id: number;
      body: string;
      word_count: number;
      duration_sec: number | null;
      created_at: string;
      provider: string | null;
      model: string | null;
      feedback_json: string | null;
      feedback_at: string | null;
      audio: string | null;
    }[]
  >(
    `SELECT e.id, e.passage_id, e.body, e.word_count, e.duration_sec, e.created_at,
            f.provider, f.model, f.feedback_json, f.created_at AS feedback_at, a.file AS audio
       FROM practice_entry e JOIN passage p ON e.passage_id = p.id
       LEFT JOIN ai_feedback f ON f.entry_id = e.id
       LEFT JOIN entry_audio a ON a.entry_id = e.id
      WHERE p.test_id = $1 ORDER BY e.id DESC`,
    [testId],
  );
  return rows.map((r) => ({
    id: r.id,
    passageId: r.passage_id,
    body: r.body,
    wordCount: r.word_count,
    durationSec: r.duration_sec,
    createdAt: r.created_at,
    feedback:
      r.feedback_json && r.provider && r.model
        ? { provider: r.provider, model: r.model, feedback: JSON.parse(r.feedback_json) as Feedback, createdAt: r.feedback_at ?? "" }
        : null,
    audio: r.audio,
  }));
}

export async function setEntryAudio(entryId: number, file: string, durationSec: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO entry_audio (entry_id, file, duration_sec) VALUES ($1, $2, $3) ON CONFLICT(entry_id) DO UPDATE SET file = excluded.file, duration_sec = excluded.duration_sec",
    [entryId, file, durationSec],
  );
}

/** Replaces a spoken entry's placeholder text with its transcript. */
export async function updateEntryBody(entryId: number, body: string): Promise<void> {
  const db = await getDb();
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  await db.execute("UPDATE practice_entry SET body = $1, word_count = $2 WHERE id = $3", [body, words, entryId]);
}

/** Returns the new entry's id. */
export async function saveEntry(passageId: number, body: string, wordCount: number, durationSec: number): Promise<number> {
  const db = await getDb();
  const res = await db.execute("INSERT INTO practice_entry (passage_id, body, word_count, duration_sec) VALUES ($1, $2, $3, $4)", [
    passageId,
    body,
    wordCount,
    durationSec,
  ]);
  return res.lastInsertId ?? 0;
}

/** Keeps the latest feedback per entry; asking again replaces it. */
export async function saveFeedback(entryId: number, provider: string, model: string, feedback: Feedback): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ai_feedback (entry_id, provider, model, feedback_json, band) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(entry_id) DO UPDATE SET provider = excluded.provider, model = excluded.model,
       feedback_json = excluded.feedback_json, band = excluded.band, created_at = datetime('now')`,
    [entryId, provider, model, JSON.stringify(feedback), feedback.overall],
  );
}

export async function deleteEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM practice_entry WHERE id = $1", [id]);
}

export async function deleteTest(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM test WHERE id = $1", [id]);
}

export async function saveAttempt(
  testId: number,
  durationSec: number,
  score: number,
  band: number | null,
  results: { questionId: number; userAnswer: string; isCorrect: boolean }[],
): Promise<number> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO attempt (test_id, duration_sec, score, band) VALUES ($1, $2, $3, $4)",
    [testId, durationSec, score, band],
  );
  for (const r of results) {
    await db.execute(
      "INSERT INTO response (attempt_id, question_id, user_answer, is_correct) VALUES ($1, $2, $3, $4)",
      [res.lastInsertId, r.questionId, r.userAnswer, r.isCorrect ? 1 : 0],
    );
  }
  return res.lastInsertId ?? 0;
}

/** Id of the "AI 생성" source row (seeded in db.ts). */
export async function aiSourceId(): Promise<number | null> {
  const db = await getDb();
  const [r] = await db.select<{ id: number }[]>("SELECT id FROM source WHERE adapter = 'ai' LIMIT 1");
  return r?.id ?? null;
}

/** Word timings of synthesized listening audio, one JSON list per passage in passage order. */
export async function saveTimings(testId: number, timings: string[]): Promise<void> {
  const db = await getDb();
  const passages = await db.select<{ id: number }[]>("SELECT id FROM passage WHERE test_id = $1 ORDER BY ord", [testId]);
  for (const [i, p] of passages.entries()) {
    if (timings[i]) await db.execute("INSERT OR REPLACE INTO passage_timing (passage_id, words_json) VALUES ($1, $2)", [p.id, timings[i]]);
  }
}

/* ---------- Whole exams ---------- */

/** Groups saved sets as one exam, `tests` in paper order. Returns the exam id. */
export async function createExam(
  title: string,
  module: Module,
  band: number | null,
  tests: { testId: number; skill: TestKind; ord: number }[],
): Promise<number> {
  const db = await getDb();
  const res = await db.execute("INSERT INTO exam (title, module, band) VALUES ($1, $2, $3)", [title, module, band]);
  const id = res.lastInsertId;
  if (id === undefined) throw new Error("시험을 묶지 못했습니다.");
  for (const t of tests) {
    await db.execute("INSERT INTO exam_test (exam_id, test_id, ord, skill) VALUES ($1, $2, $3, $4)", [id, t.testId, t.ord, t.skill]);
  }
  return id;
}

interface ExamRow {
  id: number;
  title: string;
  module: Module | null;
  band: number | null;
  created_at: string;
}
interface ExamTestRow {
  exam_id: number;
  id: number;
  kind: TestKind;
  title: string;
  ord: number;
  question_count: number;
  attempts: number;
  entries: number;
  last_score: number | null;
  last_band: number | null;
}

async function examsFrom(rows: ExamRow[]): Promise<ExamSummary[]> {
  if (!rows.length) return [];
  const db = await getDb();
  const tests = await db.select<ExamTestRow[]>(
    `SELECT et.exam_id, t.id, t.kind, t.title, et.ord,
       (SELECT COUNT(*) FROM question q JOIN question_group g ON q.group_id = g.id JOIN passage p ON g.passage_id = p.id WHERE p.test_id = t.id) AS question_count,
       (SELECT COUNT(*) FROM attempt a WHERE a.test_id = t.id) AS attempts,
       (SELECT COUNT(*) FROM practice_entry e JOIN passage p ON e.passage_id = p.id WHERE p.test_id = t.id) AS entries,
       (SELECT score FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_score,
       (SELECT band FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_band
     FROM exam_test et JOIN test t ON t.id = et.test_id
     WHERE et.exam_id IN (${rows.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY et.exam_id, et.ord`,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    module: r.module ?? "academic",
    band: r.band,
    createdAt: r.created_at,
    tests: tests
      .filter((t) => t.exam_id === r.id)
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        ord: t.ord,
        questionCount: t.question_count,
        attempts: t.attempts,
        entries: t.entries,
        lastScore: t.last_score,
        lastBand: t.last_band,
      })),
  }));
}

export async function listExams(): Promise<ExamSummary[]> {
  const db = await getDb();
  return examsFrom(await db.select<ExamRow[]>("SELECT id, title, module, band, created_at FROM exam ORDER BY id DESC"));
}

export async function loadExam(id: number): Promise<ExamSummary> {
  const db = await getDb();
  const [e] = await examsFrom(await db.select<ExamRow[]>("SELECT id, title, module, band, created_at FROM exam WHERE id = $1", [id]));
  if (!e) throw new Error("시험을 찾을 수 없습니다.");
  return e;
}

/** An exam made of exactly these tests, or null. */
export async function findExamWithTests(testIds: number[]): Promise<number | null> {
  if (!testIds.length) return null;
  const db = await getDb();
  const rows = await db.select<{ exam_id: number }[]>(
    `SELECT exam_id FROM exam_test WHERE test_id IN (${testIds.map((_, i) => `$${i + 1}`).join(", ")})
      GROUP BY exam_id HAVING COUNT(*) = ${testIds.length}
         AND (SELECT COUNT(*) FROM exam_test x WHERE x.exam_id = exam_test.exam_id) = ${testIds.length}`,
    testIds,
  );
  return rows[0]?.exam_id ?? null;
}

/** Deletes an exam together with its sets. */
export async function deleteExam(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ test_id: number }[]>("SELECT test_id FROM exam_test WHERE exam_id = $1", [id]);
  for (const r of rows) await db.execute("DELETE FROM test WHERE id = $1", [r.test_id]);
  await db.execute("DELETE FROM exam WHERE id = $1", [id]);
}

/* ---------- Reference material for the TOEFL generator ---------- */

/** Plain text of stored HTML: paragraphs on their own lines, `[[n]]` blanks kept. */
const htmlToText = (html: string) =>
  html
    .replace(/<\/p>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export interface ReferenceDoc {
  id: number;
  name: string;
  chars: number;
  enabled: boolean;
}

export async function listReferenceDocs(): Promise<ReferenceDoc[]> {
  const db = await getDb();
  const rows = await db.select<{ id: number; name: string; chars: number; enabled: number }[]>(
    "SELECT id, name, length(body) AS chars, enabled FROM reference_doc ORDER BY id DESC",
  );
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export async function addReferenceDoc(name: string, body: string): Promise<void> {
  const text = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`${name}: 글자를 찾지 못했습니다. 스캔한 이미지 PDF는 읽을 수 없습니다.`);
  const db = await getDb();
  await db.execute("INSERT INTO reference_doc (name, body) VALUES ($1, $2)", [name, text]);
}

export async function setReferenceDocEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE reference_doc SET enabled = $1 WHERE id = $2", [enabled ? 1 : 0, id]);
}

export async function deleteReferenceDoc(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM reference_doc WHERE id = $1", [id]);
}

/**
 * The learner's reference documents, then collected and imported sets (not AI-written, not from shared packages) as
 * plain text with their questions and keys, for the generator to calibrate format and difficulty on.
 * Stays on this computer; only the prompt carries it. `tests` counts the documents and sets included.
 */
export async function referenceMaterial(maxChars = 40_000): Promise<{ text: string; tests: number }> {
  const db = await getDb();
  const docs = await db.select<{ name: string; body: string }[]>("SELECT name, body FROM reference_doc WHERE enabled = 1 ORDER BY id");
  const tests = await db.select<{ id: number; title: string; kind: TestKind }[]>(
    `SELECT t.id, t.title, t.kind FROM test t LEFT JOIN source s ON s.id = t.source_id
     WHERE t.status = 'published' AND (s.adapter IS NULL OR s.adapter NOT IN ('ai', 'package'))
     ORDER BY t.kind, t.id`,
  );
  const parts: string[] = [];
  let used = 0;
  let count = 0;
  // The learner's own documents come first: they are what they chose to calibrate on.
  for (const d of docs) {
    const block = `## Document · ${d.name}\n${d.body}`.slice(0, Math.max(0, maxChars - used));
    if (!block) break;
    parts.push(block);
    used += block.length;
    count++;
  }
  for (const t of tests) {
    const detail = await loadTest(t.id);
    const lines = [`## ${t.kind.toUpperCase()} · ${t.title}`];
    for (const p of detail.passages) {
      if (p.title) lines.push(`### ${p.title}`);
      lines.push(htmlToText(p.bodyHtml));
      for (const g of p.groups) {
        if (g.instructions) lines.push(`(${g.type}) ${g.instructions}`);
        for (const q of g.questions) {
          const opts = (q.options.length ? q.options : g.options).map((o) => `${o.key}. ${o.text}`).join(" / ");
          lines.push(`${q.number}. ${q.prompt ?? ""}${opts ? ` [${opts}]` : ""} → ${q.answer.join(" | ")}`);
        }
      }
      if (p.sampleHtml) lines.push(`Model answer: ${htmlToText(p.sampleHtml)}`);
    }
    const block = lines.join("\n");
    if (used + block.length > maxChars) {
      if (count === 0) parts.push(block.slice(0, maxChars));
      break;
    }
    parts.push(block);
    used += block.length;
    count++;
  }
  return { text: parts.join("\n\n"), tests: count || (parts.length ? 1 : 0) };
}
