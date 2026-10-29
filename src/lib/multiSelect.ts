/* "Choose TWO/THREE letters" items. The import format stores one question per mark (6, 7, 8), each with the same
   prompt and each accepting every letter of the pool, so that scoring and records stay one letter per question.
   The practice screen folds such a run back into one item with several picks; these helpers do the folding and
   keep the picks spread over the questions, one distinct letter each, so a repeated letter cannot earn two marks. */

import type { Option, Question, QuestionGroup } from "./types";

export type GroupItem = { kind: "single"; question: Question } | { kind: "multi"; questions: Question[] };

const poolKey = (q: Question) => [...new Set(q.answer.map((a) => a.trim().toUpperCase()))].sort().join("|");
const promptKey = (q: Question) => (q.prompt ?? "").replace(/\s+/g, " ").trim();

function sameItem(a: Question, b: Question): boolean {
  return a.options.length === 0 && b.options.length === 0 && promptKey(a) === promptKey(b) && poolKey(a) === poolKey(b);
}

/** The group's questions, with each "Choose N letters" run folded into one multi-select item. */
export function groupItems(group: QuestionGroup): GroupItem[] {
  if (group.type !== "mcq") return group.questions.map((question) => ({ kind: "single", question }));
  const items: GroupItem[] = [];
  const qs = group.questions;
  let i = 0;
  while (i < qs.length) {
    let j = i + 1;
    while (j < qs.length && sameItem(qs[i], qs[j])) j++;
    const run = qs.slice(i, j);
    const pool = new Set(qs[i].answer.map((a) => a.trim().toUpperCase()));
    if (run.length >= 2 && pool.size >= run.length && group.options.length >= run.length) {
      items.push({ kind: "multi", questions: run });
    } else {
      for (const question of run) items.push({ kind: "single", question });
    }
    i = j;
  }
  return items;
}

/** Letters currently picked for a folded item, in the order they are stored. */
export function picksOf(answers: Record<number, string>, questions: Question[]): string[] {
  return questions.map((q) => answers[q.id] ?? "").filter((v) => v !== "");
}

/**
 * Adds or removes one letter and returns the new value of every question in the run: picks in option order,
 * one per question, blanks after them. Empty when a new letter is offered with every mark already taken.
 */
export function togglePick(
  answers: Record<number, string>,
  questions: Question[],
  options: Option[],
  key: string,
): [number, string][] {
  const current = new Set(picksOf(answers, questions));
  if (current.has(key)) current.delete(key);
  else if (current.size < questions.length) current.add(key);
  else return [];
  const order = new Map(options.map((o, idx) => [o.key, idx]));
  const sorted = [...current].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  return questions.map((q, idx) => [q.id, sorted[idx] ?? ""]);
}
