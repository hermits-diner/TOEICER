import { partOfTitle, sectionOf } from "./toeicSpec";
import type { ImportGroup, ImportParagraph, ImportPassage, ImportQuestion, ImportTest, Option, QuestionType, TestKind } from "./types";

/**
 * The import form of a set: what set files carry and what the AI writer and the converter produce. A set is a
 * Listening set (Parts 1–4) or a Reading set (Parts 5–7); every passage is titled "Part N · …". Part 1 and 2 items are
 * heard choices (`lmcq`), Part 2 with three (A)–(C), Part 1 with four; every other item has four printed choices
 * (A)–(D). Each item has one key among its choices.
 */

export const KEYS = ["A", "B", "C", "D"] as const;
/** Archive names of media (see src-tauri/src/media.rs). */
export const ARCHIVED_IMAGE_RE = /^img-[0-9a-f]{32}\.(png|jpg|gif|webp|svg)$/;
export const ARCHIVED_AUDIO_RE = /^aud-[0-9a-f]{32}\.(mp3|ogg|m4a|wav)$/;

export interface ValidationResult {
  test: ImportTest | null;
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const optStr = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function parseOptions(v: unknown, path: string, errors: string[]): Option[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.push(`${path}: 선택지는 목록이어야 합니다.`);
    return undefined;
  }
  const out: Option[] = [];
  v.forEach((o, i) => {
    if (isObj(o) && nonEmpty(o.key) && typeof o.text === "string") out.push({ key: o.key.trim().toUpperCase(), text: o.text });
    else errors.push(`${path}[${i}]: 선택지는 기호와 내용이 있어야 합니다.`);
  });
  return out;
}

function parseParagraphs(v: unknown, path: string, errors: string[]): ImportParagraph[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.push(`${path}: 문단은 목록이어야 합니다.`);
    return undefined;
  }
  const out: ImportParagraph[] = [];
  v.forEach((p, i) => {
    if (typeof p === "string" && p.trim()) out.push({ text: p.trim() });
    else if (isObj(p) && nonEmpty(p.text)) out.push({ label: optStr(p.label), text: p.text.trim() });
    else errors.push(`${path}[${i}]: 문단 내용이 없습니다.`);
  });
  return out;
}

/** How many choices an item of this part takes: three in Part 2, four everywhere else. */
export const choiceCount = (part: number) => (part === 2 ? 3 : 4);

function parseQuestion(raw: unknown, path: string, part: number, groupOptions: Option[] | undefined, errors: string[]): ImportQuestion | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 문항 형식이 올바르지 않습니다.`);
    return null;
  }
  const number = raw.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
    errors.push(`${path}: 문항 번호는 1 이상의 정수여야 합니다.`);
    return null;
  }
  const options = parseOptions(raw.options, `${path}.options`, errors);
  const answer = (typeof raw.answer === "string" ? [raw.answer] : Array.isArray(raw.answer) ? raw.answer : [])
    .filter(nonEmpty)
    .map((a) => a.trim().toUpperCase());
  const keys = KEYS.slice(0, choiceCount(part));
  const choices = options ?? groupOptions ?? [];
  const range = `(${keys[0]})–(${keys[keys.length - 1]})`;
  if (choices.length !== keys.length || choices.some((o, i) => o.key !== keys[i] || !o.text.trim()))
    errors.push(`${number}번: Part ${part} 문항의 선택지는 ${range} ${keys.length}개여야 합니다.`);
  else if (answer.length !== 1 || !keys.includes(answer[0] as (typeof KEYS)[number])) errors.push(`${number}번: 정답은 ${range} 중 하나여야 합니다.`);
  return { number, prompt: optStr(raw.prompt), options, answer };
}

function parseGroup(raw: unknown, path: string, part: number, errors: string[]): ImportGroup | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 문항 묶음 형식이 올바르지 않습니다.`);
    return null;
  }
  // Parts 1 and 2 are heard choices, everything else printed choices.
  const type: QuestionType = part <= 2 ? "lmcq" : "mcq";
  if ((raw.type ?? type) !== type) {
    errors.push(`${path}: Part ${part}에는 ${type === "lmcq" ? "듣고 고르는" : "선택지가 인쇄된"} 문항만 들어갈 수 있습니다.`);
    return null;
  }
  const options = parseOptions(raw.options, `${path}.options`, errors);
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    errors.push(`${path}: 문항이 하나 이상 필요합니다.`);
    return null;
  }
  const questions = raw.questions
    .map((q, i) => parseQuestion(q, `${path}.questions[${i}]`, part, options, errors))
    .filter((q): q is ImportQuestion => q !== null);
  const image = optStr(raw.image);
  if (image && !ARCHIVED_IMAGE_RE.test(image)) errors.push(`${path}: 사진은 보관된 그림 파일이어야 합니다.`);
  return { type, instructions: optStr(raw.instructions), options, image, questions };
}

function parsePassage(raw: unknown, path: string, kind: TestKind, errors: string[]): ImportPassage | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 지문 형식이 올바르지 않습니다.`);
    return null;
  }
  const title = optStr(raw.title);
  const part = partOfTitle(title ?? null);
  if (part === null) {
    errors.push(`${path}: 제목이 "Part 1"–"Part 7"로 시작해야 합니다.`);
    return null;
  }
  if (sectionOf(part) !== kind) {
    errors.push(`${path}: Part ${part}는 ${kind === "listening" ? "Listening" : "Reading"} 세트에 들어갈 수 없습니다.`);
    return null;
  }
  const paragraphs = parseParagraphs(raw.paragraphs, `${path}.paragraphs`, errors);
  const body = optStr(raw.body);
  const audio = optStr(raw.audio);
  if (audio && !ARCHIVED_AUDIO_RE.test(audio)) errors.push(`${path}: 음성은 보관된 음성 파일이어야 합니다.`);
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  if (rawGroups.length === 0) {
    errors.push(`${path}: 문항이 하나 이상 필요합니다.`);
    return null;
  }
  const groups = rawGroups.map((g, i) => parseGroup(g, `${path}.groups[${i}]`, part, errors)).filter((g): g is ImportGroup => g !== null);
  const text = !!body || !!paragraphs?.length;
  // Reading needs its text; Listening needs a recording or a script to be read aloud. Part 5 is only sentences.
  if (kind === "reading" && !text && part !== 5) errors.push(`${path}: 지문이 없습니다.`);
  if (kind === "listening" && !text && !audio) errors.push(`${path}: 음성도 스크립트도 없습니다.`);
  return { title, body, paragraphs, audio, groups };
}

export function validateImport(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { test: null, errors: ["세트 형식이 올바르지 않습니다."], warnings };
  if (!nonEmpty(raw.title)) errors.push("제목이 필요합니다.");
  const kind = raw.kind;
  if (kind !== "listening" && kind !== "reading") {
    errors.push('kind는 "listening" 또는 "reading"이어야 합니다.');
    return { test: null, errors, warnings };
  }
  if (!Array.isArray(raw.passages) || raw.passages.length === 0) {
    errors.push("지문이 하나 이상 필요합니다.");
    return { test: null, errors, warnings };
  }
  const passages = raw.passages.map((p, i) => parsePassage(p, `passages[${i}]`, kind, errors)).filter((p): p is ImportPassage => p !== null);

  const numbers = passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.number)));
  const dupes = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];
  if (dupes.length) errors.push(`문항 번호가 중복됩니다: ${dupes.join(", ")}`);
  const sorted = [...numbers].sort((a, b) => a - b);
  const gaps = sorted.filter((n, i) => i > 0 && n !== sorted[i - 1] + 1);
  if (gaps.length) warnings.push(`문항 번호가 연속되지 않습니다 (${gaps.map((n) => `${n} 앞`).join(", ")}).`);

  const test: ImportTest = { title: nonEmpty(raw.title) ? raw.title.trim() : "", kind, passages };
  return { test: errors.length ? null : test, errors, warnings };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A passage's paragraphs: `paragraphs` when given, otherwise the body split at blank lines. */
export const paragraphsOf = (p: ImportPassage): ImportParagraph[] =>
  p.paragraphs && p.paragraphs.length
    ? p.paragraphs
    : (p.body ?? "")
        .split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({ text }));

/** Builds safe passage HTML from plain text. All source text is escaped. */
export function passageToHtml(p: ImportPassage): string {
  return paragraphsOf(p)
    .map((para) => {
      const label = para.label ? `<span class="para-label">${escapeHtml(para.label)}</span>` : "";
      return `<p>${label}${escapeHtml(para.text).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}
