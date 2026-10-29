/* Automatic review: the checks a careful reader would make before a draft goes into the library.
   A draft that raises nothing here, and nothing during extraction, is stored without waiting for the user. */

import { isPromptKind, validateImport } from "./importFormat";
import type { ImportGroup, ImportPassage, ImportTest, TestKind } from "./types";

export interface Verdict {
  /** The normalised draft, ready to store; null when it cannot be stored as it is. */
  test: ImportTest | null;
  /** What a person should look at; empty when the draft passes. */
  reasons: string[];
  /** Why there is nothing worth keeping (no question or task has any wording); null otherwise. */
  unusable: string | null;
}

const GAP = "____";
const MAX_ANSWER = 60;

const span = (g: ImportGroup) => {
  const first = g.questions[0].number;
  const last = g.questions[g.questions.length - 1].number;
  return first === last ? `${first}번` : `${first}–${last}번`;
};

function reviewPassage(p: ImportPassage, index: number, many: boolean, kind: TestKind, reasons: string[]) {
  const where = many ? `${isPromptKind(kind) ? "과제" : "지문"} ${index + 1}: ` : "";
  const paragraphs = p.paragraphs ?? (p.body ?? "").split(/\n\s*\n/).map((text) => ({ text, label: undefined, image: undefined }));
  const written = paragraphs.filter((x) => x.image === undefined && x.text.trim());
  if (isPromptKind(kind)) {
    // A task to respond to: all it needs is its wording.
    if (written.reduce((n, x) => n + x.text.length, 0) < 20) reasons.push(`${where}과제 내용이 없습니다.`);
    return;
  }
  if (kind === "listening") {
    if (!p.audio) reasons.push(`${where}음성 파일이 없습니다.`);
  } else if (written.length < 2) {
    reasons.push(`${where}지문이 한 문단뿐입니다. 본문이 빠졌을 수 있습니다.`);
  }
  const labels = new Set(paragraphs.map((x) => x.label).filter(Boolean));

  for (const g of p.groups) {
    const options = g.options ?? [];
    const lettered = g.type === "heading" || g.type === "matching";
    const blank = options.filter((o) => !o.text.trim()).map((o) => o.key);
    if (lettered && blank.length === options.length && options.length > 0) {
      // Bare letters stand for places on a picture or for paragraphs; without either they mean nothing.
      const missing = blank.filter((k) => !labels.has(k));
      if (g.image) {
        // a map or diagram carries the letters
      } else if (kind === "listening") {
        reasons.push(`${where}${span(g)}: 선택지 ${blank.join(", ")}의 내용을 찾지 못했습니다.`);
      } else if (missing.length) {
        reasons.push(`${where}${span(g)}: 지문에서 문단 기호 ${missing.join(", ")}을(를) 찾지 못했습니다.`);
      }
    } else if (lettered && blank.length) {
      reasons.push(`${where}${span(g)}: 선택지 ${blank.join(", ")}의 내용이 비어 있습니다.`);
    }

    const noPrompt: number[] = [];
    const noGap: number[] = [];
    const badChoices: number[] = [];
    const longAnswer: number[] = [];
    for (const q of g.questions) {
      const choices = q.options?.length ? q.options : options;
      // A question may consist of a number on a picture, or share the group's one question.
      if (!q.prompt && !g.image && !(g.type === "mcq" && options.length)) noPrompt.push(q.number);
      if (g.type === "fill" && q.prompt && !q.prompt.includes(GAP)) noGap.push(q.number);
      if (g.type === "mcq" && (choices.length < 2 || choices.some((o) => !o.text.trim()))) badChoices.push(q.number);
      if (q.answer.some((a) => a.length > MAX_ANSWER)) longAnswer.push(q.number);
    }
    if (noPrompt.length) reasons.push(`${where}문항 내용이 없습니다: ${noPrompt.join(", ")}`);
    if (noGap.length) reasons.push(`${where}빈칸 완성 문항에 빈칸이 없습니다: ${noGap.join(", ")}`);
    if (badChoices.length) reasons.push(`${where}객관식 선택지가 모자라거나 비어 있습니다: ${badChoices.join(", ")}`);
    if (longAnswer.length) reasons.push(`${where}정답이 지나치게 깁니다: ${longAnswer.join(", ")}`);
  }
}

export function reviewDraft(draft: ImportTest): Verdict {
  const v = validateImport(draft);
  const reasons = [...v.errors, ...v.warnings];
  draft.passages.forEach((p, i) => reviewPassage(p, i, draft.passages.length > 1, draft.kind, reasons));
  if (isPromptKind(draft.kind)) {
    const text = draft.passages.flatMap((p) => p.paragraphs ?? [{ text: p.body ?? "" }]).reduce((n, x) => n + x.text.trim().length, 0);
    return { test: v.test, reasons, unusable: text < 20 ? "과제 내용이 없습니다." : null };
  }
  // A page that holds only an answer key yields questions without any wording: nothing a review could repair.
  // A draft with wording but something wrong is worth a look instead.
  const groups = draft.passages.flatMap((p) => p.groups);
  const worded = groups.some((g) => g.questions.some((q) => q.prompt) || (g.type === "mcq" && g.options?.length));
  return { test: v.test, reasons, unusable: worded ? null : "문항 내용이 없습니다. 정답표만 있는 문서로 보입니다." };
}

export type Outcome = "store" | "discard" | "ask";

/** What to do with a draft, given everything noted about it during extraction and review. */
export function decide(verdict: Verdict, notes: string[]): Outcome {
  if (verdict.unusable) return "discard";
  return notes.length === 0 && verdict.test ? "store" : "ask";
}
