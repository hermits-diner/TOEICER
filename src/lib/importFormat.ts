import { canonicalJudgement } from "./scoring";
import type {
  ImportGroup,
  ImportParagraph,
  ImportPassage,
  ImportQuestion,
  ImportTest,
  Module,
  Option,
  QuestionType,
  TestKind,
} from "./types";

const TYPES: QuestionType[] = ["mcq", "lmcq", "cword", "build", "tfng", "ynng", "heading", "matching", "fill", "short"];

/** File name of a picture in the archive (see crawl_image); anything else is an address that was never collected. */
export const ARCHIVED_IMAGE_RE = /^img-[0-9a-f]{32}\.[a-z]+$/;
const KINDS: TestKind[] = ["reading", "listening", "writing", "speaking"];
/** Writing and speaking sets hold tasks to respond to, not questions with a key. */
export const isPromptKind = (kind: TestKind) => kind === "writing" || kind === "speaking";

export interface ValidationResult {
  test: ImportTest | null;
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const optStr = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function parseOptions(v: unknown, path: string, errors: string[]): Option[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.push(`${path}: options는 배열이어야 합니다.`);
    return undefined;
  }
  const out: Option[] = [];
  v.forEach((o, i) => {
    if (isObj(o) && nonEmpty(o.key) && typeof o.text === "string") out.push({ key: o.key.trim(), text: o.text });
    else errors.push(`${path}[${i}]: { "key": "A", "text": "..." } 형식이어야 합니다.`);
  });
  return out;
}

function parseAnswer(v: unknown, path: string, errors: string[]): string[] {
  const arr = typeof v === "string" ? [v] : Array.isArray(v) ? v : null;
  if (!arr || arr.length === 0 || !arr.every(nonEmpty)) {
    errors.push(`${path}: answer는 비어 있지 않은 문자열 또는 문자열 배열이어야 합니다.`);
    return [];
  }
  return (arr as string[]).map((s) => s.trim());
}

function parseParagraphs(v: unknown, path: string, errors: string[]): ImportParagraph[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.push(`${path}: paragraphs는 배열이어야 합니다.`);
    return undefined;
  }
  const out: ImportParagraph[] = [];
  v.forEach((p, i) => {
    if (typeof p === "string" && p.trim()) out.push({ text: p.trim() });
    else if (isObj(p) && nonEmpty(p.image)) out.push({ text: typeof p.text === "string" ? p.text.trim() : "", image: p.image.trim() });
    else if (isObj(p) && nonEmpty(p.text)) out.push({ label: optStr(p.label), text: p.text.trim() });
    else errors.push(`${path}[${i}]: 문단은 문자열 또는 { "label": "A", "text": "..." } 형식이어야 합니다.`);
  });
  return out;
}

function parseQuestion(
  raw: unknown,
  path: string,
  type: QuestionType,
  groupOptions: Option[] | undefined,
  errors: string[],
  warnings: string[],
): ImportQuestion | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 문항은 객체여야 합니다.`);
    return null;
  }
  const number = raw.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
    errors.push(`${path}: number는 1 이상의 정수여야 합니다.`);
    return null;
  }
  const options = parseOptions(raw.options, `${path}.options`, errors);
  let answer = parseAnswer(raw.answer, `${path}.answer`, errors);

  if (type === "tfng" || type === "ynng") {
    const canon = answer.map(canonicalJudgement);
    const allowed = type === "tfng" ? ["TRUE", "FALSE", "NOT GIVEN"] : ["YES", "NO", "NOT GIVEN"];
    if (canon.some((c) => c === null || !allowed.includes(c))) {
      errors.push(`${path}.answer: ${allowed.join(" / ")} 중 하나여야 합니다.`);
    } else {
      answer = canon as string[];
    }
  }

  if (type === "build" && (!options || options.length < 2)) {
    errors.push(`${path}: build 문항에는 단어 덩어리(options)가 두 개 이상 필요합니다.`);
  }
  if (type === "cword" && !optStr(raw.prompt)) {
    warnings.push(`${path}: cword 문항의 prompt(단어 앞부분)가 비어 있습니다.`);
  }

  if (type === "mcq" || type === "lmcq" || type === "heading" || type === "matching") {
    const choices = options ?? groupOptions;
    if (!choices || choices.length === 0) {
      errors.push(`${path}: ${type} 문항에는 선택지(options)가 필요합니다.`);
    } else {
      const keys = new Set(choices.map((o) => o.key.toLowerCase()));
      const missing = answer.filter((a) => !keys.has(a.toLowerCase()));
      if (missing.length) warnings.push(`${path}: 정답 "${missing.join(", ")}"이(가) 선택지 키에 없습니다.`);
    }
  }

  return { number, prompt: optStr(raw.prompt), options, answer };
}

function parseGroup(raw: unknown, path: string, errors: string[], warnings: string[]): ImportGroup | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 문항 그룹은 객체여야 합니다.`);
    return null;
  }
  const type = raw.type as QuestionType;
  if (!TYPES.includes(type)) {
    errors.push(`${path}.type: ${TYPES.join(", ")} 중 하나여야 합니다.`);
    return null;
  }
  const options = parseOptions(raw.options, `${path}.options`, errors);
  if ((type === "heading" || type === "matching") && !options) {
    errors.push(`${path}: ${type} 그룹에는 그룹 단위 options가 필요합니다.`);
  }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    errors.push(`${path}.questions: 문항이 하나 이상 필요합니다.`);
    return null;
  }
  const questions = raw.questions
    .map((q, i) => parseQuestion(q, `${path}.questions[${i}]`, type, options, errors, warnings))
    .filter((q): q is ImportQuestion => q !== null);
  return { type, instructions: optStr(raw.instructions), options, image: optStr(raw.image), questions };
}

function parsePassage(raw: unknown, path: string, kind: TestKind, errors: string[], warnings: string[]): ImportPassage | null {
  if (!isObj(raw)) {
    errors.push(`${path}: 지문은 객체여야 합니다.`);
    return null;
  }
  const paragraphs = parseParagraphs(raw.paragraphs, `${path}.paragraphs`, errors);
  const body = optStr(raw.body);
  // A listening section may come without a transcript; everything else needs its text.
  if (kind !== "listening" && !body && (!paragraphs || paragraphs.length === 0)) errors.push(`${path}: body 또는 paragraphs가 필요합니다.`);
  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  if (rawGroups.length === 0 && !isPromptKind(kind)) {
    errors.push(`${path}.groups: 문항 그룹이 하나 이상 필요합니다.`);
    return null;
  }
  const groups = rawGroups
    .map((g, i) => parseGroup(g, `${path}.groups[${i}]`, errors, warnings))
    .filter((g): g is ImportGroup => g !== null);
  const images = [...(paragraphs ?? []).map((x) => x.image), ...groups.map((g) => g.image)];
  if (images.some((name) => name && !ARCHIVED_IMAGE_RE.test(name))) warnings.push(`${path}: 받지 못한 그림은 저장할 때 빠집니다.`);
  return { title: optStr(raw.title), body, paragraphs, audio: optStr(raw.audio), sample: optStr(raw.sample), groups };
}

export function validateImport(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { test: null, errors: ["최상위 값은 객체여야 합니다."], warnings };

  if (!nonEmpty(raw.title)) errors.push("title이 필요합니다.");
  const kind = (raw.kind ?? "reading") as TestKind;
  if (!KINDS.includes(kind)) errors.push(`kind는 ${KINDS.join(", ")} 중 하나여야 합니다.`);
  const module = (raw.module ?? "academic") as Module;
  if (module !== "academic" && module !== "general") errors.push('module은 "academic" 또는 "general"이어야 합니다.');

  if (!Array.isArray(raw.passages) || raw.passages.length === 0) {
    errors.push("passages에 지문이 하나 이상 필요합니다.");
    return { test: null, errors, warnings };
  }
  const passages = raw.passages
    .map((p, i) => parsePassage(p, `passages[${i}]`, kind, errors, warnings))
    .filter((p): p is ImportPassage => p !== null);

  const numbers = passages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => q.number)));
  const dupes = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))];
  if (dupes.length) errors.push(`문항 번호가 중복됩니다: ${dupes.join(", ")}`);
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const gaps = sorted.filter((n, i) => i > 0 && n !== sorted[i - 1] + 1);
  if (gaps.length) warnings.push(`문항 번호가 연속되지 않습니다 (${gaps.map((n) => `${n} 앞`).join(", ")}).`);

  const test: ImportTest = {
    title: nonEmpty(raw.title) ? raw.title.trim() : "",
    kind,
    module,
    book: typeof raw.book === "number" ? raw.book : undefined,
    test: typeof raw.test === "number" ? raw.test : undefined,
    passages,
  };
  return { test: errors.length ? null : test, errors, warnings };
}

export function parseImportText(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { test: null, errors: [`JSON 구문 오류: ${(e as Error).message}`], warnings: [] };
  }
  return validateImport(raw);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Builds safe passage HTML from plain text. All source text is escaped.
    `images` maps archive names to data URLs; a picture without one leaves only its description. */
export function passageToHtml(p: ImportPassage, images: Record<string, string> = {}): string {
  const paras: ImportParagraph[] =
    p.paragraphs && p.paragraphs.length
      ? p.paragraphs
      : (p.body ?? "")
          .split(/\n\s*\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text) => ({ text }));
  return paras
    .map((para) => {
      if (para.image !== undefined) {
        const src = images[para.image];
        if (!src) return para.text ? `<p>[${escapeHtml(para.text)}]</p>` : "";
        return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(para.text)}" style="max-width:100%"></figure>`;
      }
      const label = para.label ? `<span class="para-label">${escapeHtml(para.label)}</span>` : "";
      return `<p>${label}${escapeHtml(para.text).replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}
