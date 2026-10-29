import { getDb } from "./db";
import type { TestKind } from "./types";

/** Sections a full test needs: three reading passages or four listening parts. */
const REQUIRED: Partial<Record<TestKind, number>> = { reading: 3, listening: 4 };
const SECTION_RE = /^(.*?)[\s.,:-]*(?:Section|Part|Passage)\s*(\d+)\s*$/i;

export interface MockSet {
  kind: TestKind;
  /** The shared title, e.g. "IELTS Academic Reading Test 1". */
  name: string;
  /** Source test ids in section order. */
  testIds: number[];
  questionCount: number;
  /** Id of the combined test if it was already created. */
  existingId: number | null;
}

export interface SectionRow {
  id: number;
  title: string;
  kind: TestKind;
  questions: number;
}

const hashFor = (ids: number[]) => `mock:${ids.join(",")}`;

/** Groups "… Section 1/2/3" style tests into complete sets. Pure, for testing. */
export function groupSections(rows: SectionRow[]): Omit<MockSet, "existingId">[] {
  const groups = new Map<string, { kind: TestKind; name: string; parts: Map<number, SectionRow> }>();
  for (const r of rows) {
    const m = r.title.match(SECTION_RE);
    if (!m || !REQUIRED[r.kind]) continue;
    const name = m[1].trim();
    const key = `${r.kind}|${name.toLowerCase()}`;
    const g = groups.get(key) ?? { kind: r.kind, name, parts: new Map() };
    const n = Number(m[2]);
    if (!g.parts.has(n)) g.parts.set(n, r);
    groups.set(key, g);
  }
  const out: Omit<MockSet, "existingId">[] = [];
  for (const g of groups.values()) {
    const need = REQUIRED[g.kind]!;
    const parts = Array.from({ length: need }, (_, i) => g.parts.get(i + 1));
    if (parts.some((p) => !p)) continue;
    out.push({
      kind: g.kind,
      name: g.name,
      testIds: parts.map((p) => p!.id),
      questionCount: parts.reduce((n, p) => n + p!.questions, 0),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

export async function findMockSets(kind: TestKind): Promise<MockSet[]> {
  const db = await getDb();
  const rows = await db.select<SectionRow[]>(
    `SELECT t.id, t.title, t.kind,
       (SELECT COUNT(*) FROM question q JOIN question_group g ON g.id = q.group_id
          JOIN passage p ON p.id = g.passage_id WHERE p.test_id = t.id) AS questions
     FROM test t WHERE t.status = 'published' AND t.kind = $1 AND COALESCE(t.content_hash, '') NOT LIKE 'mock:%'`,
    [kind],
  );
  const sets = groupSections(rows);
  const made = await db.select<{ id: number; content_hash: string }[]>(
    "SELECT id, content_hash FROM test WHERE content_hash LIKE 'mock:%'",
  );
  const byHash = new Map(made.map((m) => [m.content_hash, m.id]));
  return sets.map((s) => ({ ...s, existingId: byHash.get(hashFor(s.testIds)) ?? null }));
}

/** Copies the sections into one new test, numbering its questions 1…n as in the real exam. Returns its id. */
export async function createMockTest(set: MockSet): Promise<number> {
  const db = await getDb();
  const [first] = await db.select<{ module: string | null }[]>("SELECT module FROM test WHERE id = $1", [set.testIds[0]]);
  const res = await db.execute(
    `INSERT INTO test (title, kind, module, content_hash, status, confidence) VALUES ($1, $2, $3, $4, 'published', 1.0)`,
    [`${set.name} · 실전 모의고사`, set.kind, first?.module ?? "academic", hashFor(set.testIds)],
  );
  const testId = res.lastInsertId;
  if (testId === undefined) throw new Error("모의고사를 만들지 못했습니다.");

  try {
    let number = 0;
    let ord = 0;
    for (const src of set.testIds) {
      const passages = await db.select<{ id: number; title: string | null; body_html: string }[]>(
        "SELECT id, title, body_html FROM passage WHERE test_id = $1 ORDER BY ord",
        [src],
      );
      for (const p of passages) {
        const np = await db.execute("INSERT INTO passage (test_id, ord, title, body_html) VALUES ($1, $2, $3, $4)", [
          testId,
          ord++,
          p.title,
          p.body_html,
        ]);
        await db.execute(
          "INSERT INTO passage_extra (passage_id, audio, sample_html) SELECT $1, audio, sample_html FROM passage_extra WHERE passage_id = $2",
          [np.lastInsertId, p.id],
        );
        const groups = await db.select<{ id: number; ord: number; type: string; instructions: string | null; options_json: string | null }[]>(
          "SELECT id, ord, type, instructions, options_json FROM question_group WHERE passage_id = $1 ORDER BY ord",
          [p.id],
        );
        for (const g of groups) {
          const ng = await db.execute(
            "INSERT INTO question_group (passage_id, ord, type, instructions, options_json) VALUES ($1, $2, $3, $4, $5)",
            [np.lastInsertId, g.ord, g.type, g.instructions, g.options_json],
          );
          await db.execute("INSERT INTO group_image (group_id, data_url) SELECT $1, data_url FROM group_image WHERE group_id = $2", [
            ng.lastInsertId,
            g.id,
          ]);
          const qs = await db.select<{ prompt: string | null; options_json: string | null; answer_json: string }[]>(
            "SELECT prompt, options_json, answer_json FROM question WHERE group_id = $1 ORDER BY number",
            [g.id],
          );
          for (const q of qs) {
            await db.execute(
              "INSERT INTO question (group_id, number, prompt, options_json, answer_json) VALUES ($1, $2, $3, $4, $5)",
              [ng.lastInsertId, ++number, q.prompt, q.options_json, q.answer_json],
            );
          }
        }
      }
    }
  } catch (e) {
    await db.execute("DELETE FROM test WHERE id = $1", [testId]);
    throw e;
  }
  return testId;
}
