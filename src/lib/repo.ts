import { invoke } from "@tauri-apps/api/core";
import { getDb, sourceId } from "./db";
import { passageToHtml } from "./importFormat";
import type { GenMeta, ImportTest, Option, Origin, Passage, QuestionGroup, QuestionType, TestDetail, TestKind, TestSummary } from "./types";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parseOptions = (s: string | null): Option[] => (s ? (JSON.parse(s) as Option[]) : []);

/** An archived picture as a data URL. */
export const readImage = (name: string) => invoke<string>("read_image", { name });

/** Data URLs of the Part 1 photographs a test refers to. */
async function loadImages(t: ImportTest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of new Set(t.passages.flatMap((p) => p.groups.map((g) => g.image)))) if (name) out[name] = await readImage(name);
  return out;
}

const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav" };

/** An object URL for an archived recording, for the player. */
export async function loadAudio(name: string): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("read_audio", { name });
  return URL.createObjectURL(new Blob([bytes], { type: AUDIO_MIME[name.split(".").pop() ?? ""] ?? "audio/mpeg" }));
}

/** The id of a test saved from exactly this import form, or null. The same hash saveImportedTest keeps. */
export async function findSavedTest(t: ImportTest): Promise<number | null> {
  const db = await getDb();
  const [row] = await db.select<{ id: number }[]>("SELECT id FROM test WHERE content_hash = $1", [await sha256(JSON.stringify(t))]);
  return row?.id ?? null;
}

/**
 * Removes built-in sets that are no longer among `current` (an older version of a sample), as long as nobody has
 * practised them: a set with an attempt or a note on one of its questions stays. Returns how many were removed.
 */
export async function removeOutdatedSamples(current: ImportTest[]): Promise<number> {
  const db = await getDb();
  const keep = new Set(await Promise.all(current.map((t) => sha256(JSON.stringify(t)))));
  const rows = await db.select<{ id: number; content_hash: string | null }[]>(
    `SELECT t.id, t.content_hash FROM test t JOIN source s ON s.id = t.source_id
     WHERE s.adapter = 'sample'
       AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.test_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM note n JOIN question q ON q.id = n.question_id JOIN question_group g ON g.id = q.group_id
                       JOIN passage p ON p.id = g.passage_id WHERE p.test_id = t.id)`,
  );
  const old = rows.filter((r) => !r.content_hash || !keep.has(r.content_hash));
  for (const r of old) await db.execute("DELETE FROM test WHERE id = $1", [r.id]);
  return old.length;
}

/** Stores a validated import under where it came from. Returns the new test id. */
export async function saveImportedTest(t: ImportTest, origin: Origin): Promise<number> {
  const db = await getDb();
  const hash = await sha256(JSON.stringify(t));
  const dup = await db.select<{ id: number }[]>("SELECT id FROM test WHERE content_hash = $1", [hash]);
  if (dup.length) throw new Error("이미 라이브러리에 있는 세트입니다.");
  const images = await loadImages(t);

  const res = await db.execute("INSERT INTO test (title, kind, content_hash, source_id) VALUES ($1, $2, $3, $4)", [
    t.title,
    t.kind,
    hash,
    await sourceId(origin),
  ]);
  const testId = res.lastInsertId;
  if (testId === undefined) throw new Error("세트를 저장하지 못했습니다.");

  try {
    for (const [pi, p] of t.passages.entries()) {
      const pr = await db.execute("INSERT INTO passage (test_id, ord, title, body_html, audio) VALUES ($1, $2, $3, $4, $5)", [
        testId,
        pi,
        p.title ?? null,
        passageToHtml(p),
        p.audio ?? null,
      ]);
      for (const [gi, g] of p.groups.entries()) {
        const gr = await db.execute(
          "INSERT INTO question_group (passage_id, ord, type, instructions, options_json, image) VALUES ($1, $2, $3, $4, $5, $6)",
          [pr.lastInsertId, gi, g.type, g.instructions ?? null, json(g.options), g.image ? images[g.image] : null],
        );
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

/** The import form a test was saved from (kept up to date by the editor). */
export async function loadTestSource(id: number): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.select<{ json: string }[]>("SELECT json FROM test_source WHERE test_id = $1", [id]);
  return r?.json ?? null;
}

/** Records how an AI-written set was asked for, with its verification record; shown and filtered on in the library. */
export async function saveGenMeta(testId: number, meta: GenMeta): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO test_gen (test_id, topic, band, provider, model, options_json) VALUES ($1, $2, $3, $4, $5, $6)`,
    [testId, meta.topic, meta.band, meta.provider, meta.model, JSON.stringify(meta.options)],
  );
}

export async function loadGenMeta(testId: number): Promise<GenMeta | null> {
  const db = await getDb();
  const [r] = await db.select<{ topic: string; band: number; provider: string; model: string; options_json: string }[]>(
    "SELECT topic, band, provider, model, options_json FROM test_gen WHERE test_id = $1",
    [testId],
  );
  return r ? { topic: r.topic, band: r.band, provider: r.provider, model: r.model, options: JSON.parse(r.options_json) } : null;
}

/** A bought set's market record, kept so the set is never edited or written out as one's own. */
export async function saveMarketRecord(testId: number, record: { itemId: string; buyer: string } & Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO test_market (test_id, item_id, buyer, json) VALUES ($1, $2, $3, $4)", [
    testId,
    record.itemId,
    record.buyer,
    JSON.stringify(record),
  ]);
}

interface SummaryRow {
  id: number;
  title: string;
  kind: TestKind;
  created_at: string;
  question_count: number;
  attempts: number;
  last_score: number | null;
  last_band: number | null;
  origin: Origin | null;
  gen_topic: string | null;
  gen_band: number | null;
  gen_provider: string | null;
  gen_model: string | null;
  gen_options: string | null;
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

export async function listTests(): Promise<TestSummary[]> {
  const db = await getDb();
  const rows = await db.select<SummaryRow[]>(
    `SELECT t.id, t.title, t.kind, t.created_at,
       (SELECT COUNT(*) FROM question q
          JOIN question_group g ON q.group_id = g.id
          JOIN passage p ON g.passage_id = p.id
         WHERE p.test_id = t.id) AS question_count,
       (SELECT COUNT(*) FROM attempt a WHERE a.test_id = t.id) AS attempts,
       (SELECT score FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_score,
       (SELECT band FROM attempt a WHERE a.test_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_band,
       s.adapter AS origin,
       g.topic AS gen_topic, g.band AS gen_band, g.provider AS gen_provider, g.model AS gen_model, g.options_json AS gen_options
     FROM test t LEFT JOIN source s ON s.id = t.source_id LEFT JOIN test_gen g ON g.test_id = t.id
     ORDER BY t.id DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    createdAt: r.created_at,
    questionCount: r.question_count,
    attempts: r.attempts,
    lastScore: r.last_score,
    lastBand: r.last_band,
    origin: r.origin ?? "mine",
    gen: genOf(r),
  }));
}

export async function loadTest(id: number): Promise<TestDetail> {
  const db = await getDb();
  const [t] = await db.select<{ id: number; title: string; kind: TestKind; origin: Origin | null }[]>(
    "SELECT t.id, t.title, t.kind, s.adapter AS origin FROM test t LEFT JOIN source s ON s.id = t.source_id WHERE t.id = $1",
    [id],
  );
  if (!t) throw new Error("세트를 찾을 수 없습니다.");

  const passages = await db.select<{ id: number; ord: number; title: string | null; body_html: string; audio: string | null }[]>(
    "SELECT id, ord, title, body_html, audio FROM passage WHERE test_id = $1 ORDER BY ord",
    [id],
  );
  const groups = await db.select<
    { id: number; passage_id: number; type: QuestionType; instructions: string | null; options_json: string | null; image: string | null }[]
  >(
    `SELECT g.id, g.passage_id, g.type, g.instructions, g.options_json, g.image
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
    groups: [...groupMap.values()].filter((g) => g.passageId === p.id),
  }));
  const reported = await db.select<{ question_id: number }[]>(
    `SELECT f.question_id FROM question_flag f
       JOIN question q ON q.id = f.question_id JOIN question_group g ON q.group_id = g.id JOIN passage p ON g.passage_id = p.id
      WHERE p.test_id = $1`,
    [id],
  );
  const origin = t.origin ?? "mine";
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    passages: outPassages,
    origin,
    ai: origin === "ai" || origin === "market",
    reported: reported.map((r) => r.question_id),
  };
}

/**
 * Saves an edited set (Studio): the same passages and questions with new wording, keys or title. Rows keep their ids,
 * so past attempts and notes stay attached; the stored import form is replaced so set files carry the edit.
 */
export async function saveEditedTest(id: number, t: ImportTest, detail: TestDetail): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE test SET title = $1, content_hash = $2 WHERE id = $3", [t.title, await sha256(JSON.stringify(t)), id]);
  for (const [pi, p] of t.passages.entries()) {
    const stored = detail.passages[pi];
    if (!stored) break;
    await db.execute("UPDATE passage SET title = $1, body_html = $2, audio = $3 WHERE id = $4", [
      p.title ?? null,
      passageToHtml(p),
      p.audio ?? null,
      stored.id,
    ]);
    for (const [gi, g] of p.groups.entries()) {
      const sg = stored.groups[gi];
      if (!sg) break;
      for (const [qi, q] of g.questions.entries()) {
        const sq = sg.questions[qi];
        if (!sq) break;
        await db.execute("UPDATE question SET prompt = $1, options_json = $2, answer_json = $3 WHERE id = $4", [
          q.prompt ?? null,
          json(q.options),
          JSON.stringify(q.answer),
          sq.id,
        ]);
      }
    }
  }
  await db.execute("INSERT OR REPLACE INTO test_source (test_id, json) VALUES ($1, $2)", [id, JSON.stringify(t)]);
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
  const res = await db.execute("INSERT INTO attempt (test_id, duration_sec, score, band) VALUES ($1, $2, $3, $4)", [testId, durationSec, score, band]);
  for (const r of results) {
    await db.execute("INSERT INTO response (attempt_id, question_id, user_answer, is_correct) VALUES ($1, $2, $3, $4)", [
      res.lastInsertId,
      r.questionId,
      r.userAnswer,
      r.isCorrect ? 1 : 0,
    ]);
  }
  return res.lastInsertId ?? 0;
}

/* ---------- Reference material for the writer (Studio) ---------- */

/** Plain text of stored HTML: paragraphs on their own lines. */
export const htmlToPlain = (html: string) =>
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
 * The learner's reference documents, then their own converted sets, as plain text with questions and keys, for the
 * writer to calibrate format and difficulty on. Stays on this computer; only the prompt carries it.
 */
export async function referenceMaterial(maxChars = 40_000): Promise<{ text: string; tests: number }> {
  const db = await getDb();
  const docs = await db.select<{ name: string; body: string }[]>("SELECT name, body FROM reference_doc WHERE enabled = 1 ORDER BY id");
  const tests = await db.select<{ id: number; title: string }[]>(
    "SELECT t.id, t.title FROM test t JOIN source s ON s.id = t.source_id WHERE s.adapter = 'mine' ORDER BY t.id",
  );
  const parts: string[] = [];
  let used = 0;
  let count = 0;
  for (const d of docs) {
    const block = `## Document · ${d.name}\n${d.body}`.slice(0, Math.max(0, maxChars - used));
    if (!block) break;
    parts.push(block);
    used += block.length;
    count++;
  }
  for (const t of tests) {
    const detail = await loadTest(t.id);
    const lines = [`## ${t.title}`];
    for (const p of detail.passages) {
      if (p.title) lines.push(`### ${p.title}`);
      lines.push(htmlToPlain(p.bodyHtml));
      for (const g of p.groups)
        for (const q of g.questions) {
          const opts = (q.options.length ? q.options : g.options).map((o) => `${o.key} ${o.text}`).join(" / ");
          lines.push(`${q.number}. ${q.prompt ?? ""} [${opts}] → ${q.answer.join("")}`);
        }
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
