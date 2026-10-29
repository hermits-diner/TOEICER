/**
 * A CSV file of the practice records, one row per answered question.
 * Written where the user picks, UTF-8 with a byte-order mark (package.rs write_text) so Excel reads Korean.
 */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getDb } from "./db";
import { KIND_LABEL, ORIGIN_LABEL } from "./library";
import { partOfTitle } from "./toeicSpec";
import type { Origin, TestKind } from "./types";

export type CsvCell = string | number | null | undefined;

const cell = (v: CsvCell): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows joined with CRLF, fields quoted where they hold a comma, a quote or a line break. */
export const toCsv = (rows: CsvCell[][]): string => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

async function writeCsv(name: string, csv: string): Promise<string | null> {
  const dest = await save({ defaultPath: `${name}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!dest) return null;
  await invoke("write_text", { dest, text: csv });
  return dest;
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Every answered question: the attempt it belongs to, the set, the item, the answer given and the key. */
export async function exportResponsesCsv(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<
    {
      attempt_id: number;
      started_at: string;
      title: string;
      kind: TestKind;
      origin: Origin | null;
      score: number | null;
      band: number | null;
      duration_sec: number | null;
      number: number;
      passage_title: string | null;
      prompt: string | null;
      user_answer: string | null;
      answer_json: string;
      is_correct: number | null;
      time_spent: number | null;
      flagged: number;
    }[]
  >(
    `SELECT a.id AS attempt_id, a.started_at, t.title, t.kind,
            (SELECT s.adapter FROM source s WHERE s.id = t.source_id) AS origin,
            a.score, a.band, a.duration_sec,
            q.number, p.title AS passage_title, q.prompt, r.user_answer, q.answer_json, r.is_correct, r.time_spent,
            EXISTS (SELECT 1 FROM question_flag f WHERE f.question_id = q.id) AS flagged
       FROM response r
       JOIN attempt a ON a.id = r.attempt_id
       JOIN test t ON t.id = a.test_id
       JOIN question q ON q.id = r.question_id
       JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id
      ORDER BY a.id, q.number`,
  );
  const header = ["풀이 번호", "날짜", "세트", "영역", "출처", "맞힌 수", "예상 점수", "풀이 시간(초)", "문항", "파트", "문제", "내 답", "정답", "정오", "문항 시간(초)", "신고"];
  const body = rows.map((r) => [
    r.attempt_id,
    r.started_at,
    r.title,
    KIND_LABEL[r.kind],
    r.origin ? ORIGIN_LABEL[r.origin] : "",
    r.score,
    r.band,
    r.duration_sec,
    r.number,
    partOfTitle(r.passage_title) ?? "",
    r.prompt ?? "",
    r.user_answer ?? "",
    keyText(r.answer_json),
    r.is_correct === null ? "" : r.is_correct ? "O" : "X",
    r.time_spent,
    r.flagged ? "신고" : "",
  ]);
  return writeCsv(`toeicer-responses-${stamp()}`, toCsv([header, ...body]));
}

/** The accepted answers as one cell: "A | B" for alternatives. */
export function keyText(answerJson: string): string {
  try {
    const a = JSON.parse(answerJson);
    return Array.isArray(a) ? a.map(String).join(" | ") : String(a);
  } catch {
    return answerJson;
  }
}
