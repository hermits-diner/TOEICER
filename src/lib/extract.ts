/* Turns plain text (from a web page or PDF) into draft tests for review.
   Heuristic by design: every result carries a confidence score and a list of issues,
   and nothing reaches the library until the user confirms it in the review screen. */

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

export interface ExtractResult {
  draft: ImportTest;
  /** 0–1; how complete the draft looks. */
  confidence: number;
  issues: string[];
  /** The slice of the source text this draft was built from. */
  source: string;
}

const NOISE_RE = /^\s*(?:Page \d+ of \d+\b.*|Alternative answers are separated.*|.*\.{6,}\s*\d+)\s*$/i;
const GROUP_RE = /^\s*(?:(?:SECTION|PART)\s+\d\s*[.:–—-]?\s*)?Questions?\s+(\d{1,2})(?:\s*(?:[-–—]|to|and)\s*(\d{1,2}))?/i;
const PASSAGE_RE = /^\s*(?:READING\s+)?(?:PASSAGE|SECTION|PART)\s+\d\s*$/i;
const Q_RE = /^(\d{1,2})(?:\s*[.)]\s*|\s+|$)(.*)$/;
const INLINE_RE = /(?<![\d.,/-])\(?(\d{1,2})[.)]?\s*([£$€]?)\s*(?:_{2,}|\.{3,}|…[…\s]*)/g;
const LETTER_OPT_RE = /^([A-K])(\s*[.)]\s*|\s+)(\S.*)$/;
const ROMAN_OPT_RE = /^(i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)(\s*[.)]\s*|\s+)(\S.*)$/;
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const ANSWER_LINE_RE = /^\s*(\d{1,2})(?:\s*[.):]\s*|\s+)(\S.*)$/;
const ANSWER_PAIR_RE = /^\s*(\d{1,2})\s*&\s*(\d{1,2})\b/;
/** What a mistyped closing tag leaves behind an answer: "True/li>", "Not Given>". */
const TAG_DEBRIS_RE = /\s*(?:(?:<\/?|\/)[a-z]{1,10})?>\s*$/i;
const KEY_RE = /^([A-K]|i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)(?:\s{2,}\S.*)?$/;
const KEY_ONLY_RE = /^(?:[A-K]|i{1,3}|iv|vi{0,3}|ix|xi{0,2}|x)$/;
const BULLET_RE = /^[•·▪*–-]\s+/;
const LOOKALIKE: Record<string, string> = { "А": "A", "В": "B", "С": "C", "Е": "E" };
/** A picture, as htmlToText writes it and as the review screen shows it: "![description](address or archive name)". */
export const IMAGE_RE = /^\s*!\[([^\]]*)\]\((\S+)\)\s*$/;
/** A recording, as htmlToText writes it: "@[audio](address)". */
export const AUDIO_RE = /^\s*@\[audio\]\((\S+)\)\s*$/;
const RUBRIC_RE = /^(?:You should spend about \d+ minutes|Read (?:the |this )?(?:\w+ ){0,3}and answer Questions?\b)/i;
const LABEL_RE = /^(?:\(([A-K])\)|([A-K])[.)]?)\s+(?=[A-Z'"‘“])/;
const GAP_RE = /\.{4,}|…[…\s]*|_{3,}/g;
const HEAD_RES = [
  /^(.*?)\s*\(answers?(?:\s+keys?)?\)\s*:?$/i,
  /^(.*?)\s*[–—:-]\s*answers?(?:\s+keys?)?\s*:?$/i,
  /^()(?:answers?(?:\s+keys?)?|정답)\s*:?$/i,
];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const startsLower = (s: string) => /^[a-z]/.test(s);
const endsSentence = (s: string) => /[.!?]["'’”)\]]?\s*$/.test(s);
const firstToken = (s: string) => s.trim().split(/\s+/)[0] ?? "";

/* ---------- Answer keys ---------- */

/** "pure/distilled water" -> ["pure water", "distilled water"]; "(a/the) x" -> ["(a) x", "(the) x"]. */
function expandSlashes(s: string): string[] {
  const tokens = s.split(/\s+/);
  const i = tokens.findIndex((t) => t.includes("/") && !/^\d+\/\d+$/.test(t));
  if (i < 0) return [s];
  const tok = tokens[i];
  const wrapped = /^\(.*\)$/.test(tok);
  const variants = (wrapped ? tok.slice(1, -1) : tok).split("/").filter(Boolean);
  return variants
    .flatMap((v) => expandSlashes([...tokens.slice(0, i), wrapped ? `(${v})` : v, ...tokens.slice(i + 1)].join(" ")))
    .slice(0, 8);
}

/** One answer-key value -> accepted answers. "A ■ text" and "iii  Heading text" reduce to the key. */
export function parseAnswerValue(value: string): string[] {
  const parts = value
    .split("■")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const key = parts[0].match(KEY_RE);
  if (key) return [key[1]];
  const alts = parts.flatMap((p) => p.split(/\s+\/\s+|\s+OR\s+/)).flatMap(expandSlashes).map(squash);
  return [...new Set(alts.filter(Boolean))];
}

function readAnswerLine(line: string, into: Map<number, string[]>): boolean {
  const m = line.match(ANSWER_LINE_RE);
  if (!m) return false;
  const n = Number(m[1]);
  if (n < 1 || n > 40 || m[2].length > 120) return false;
  if (!into.has(n)) into.set(n, parseAnswerValue(m[2].replace(TAG_DEBRIS_RE, "")));
  return true;
}

/** Lenient parser for a pasted answer key: picks up every "n answer" line, ignores the rest. */
export function parseAnswerKey(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/\t+|\s{4,}(?=\d{1,2}[\s.)])/)) readAnswerLine(part, out);
  }
  return out;
}

function answerHead(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 90 || /\b(?:write|your|sheet|boxes)\b/i.test(t)) return null;
  for (const re of HEAD_RES) {
    const m = t.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** Strict parser for an answer block in a document: stops at the first line that isn't part of the key. */
function parseAnswerBlock(lines: string[], from: number, preamble = 0): { answers: Map<number, string[]>; end: number } {
  const answers = new Map<number, string[]>();
  let pair: number[] | null = null;
  let i = from;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const p = line.match(ANSWER_PAIR_RE);
    if (p) {
      pair = [Number(p[1]), Number(p[2])];
      continue;
    }
    const letter = pair && line.trim().match(/^([A-K])\s*(?:■|$)/);
    if (pair && letter) {
      for (const n of pair) answers.set(n, [...(answers.get(n) ?? []), letter[1]]);
      continue;
    }
    pair = null;
    if (readAnswerLine(line, answers)) continue;
    // A sentence or two may sit between the heading and the key ("Each correct answer scores 1 mark.").
    if (answers.size > 0 || preamble-- <= 0 || line.trim().length > 120) break;
  }
  return { answers, end: i };
}

/* ---------- Splitting a document into tasks ---------- */

interface RawTask {
  title?: string;
  lines: string[];
  answers: Map<number, string[]>;
  source: string[];
}

function splitTasks(lines: string[]): RawTask[] {
  const tasks: RawTask[] = [];
  let start = 0;
  let i = 0;
  while (i < lines.length) {
    const head = answerHead(lines[i]);
    if (head === null) {
      i++;
      continue;
    }
    const { answers, end } = parseAnswerBlock(lines, i + 1, head === "" ? 3 : 0);
    if (answers.size === 0) {
      i++;
      continue;
    }
    // The answers page usually repeats the task title, possibly wrapped over up to three lines.
    // Find the earlier copy of that title: the task's content starts right after it.
    const prevs: string[] = [];
    for (let k = i - 1; k >= Math.max(start, i - 2) && lines[k].trim(); k--) prevs.unshift(lines[k].trim());
    let title: string | undefined = head || undefined;
    let from = start;
    let to = i;
    for (let n = prevs.length; n >= 0; n--) {
      const cand = [...prevs.slice(prevs.length - n), head].filter(Boolean);
      if (cand.length === 0) continue;
      let j = -1;
      for (let k = i - n - 1; k >= start; k--) {
        if (lines[k].trim() === cand[0]) {
          j = k;
          break;
        }
      }
      if (j < 0) continue;
      title = squash(cand.join(" "));
      from = j + 1;
      to = i - n;
      for (const part of cand.slice(1)) {
        const next = lines.slice(from, to).findIndex((l) => l.trim());
        if (next < 0 || lines[from + next].trim() !== part) break;
        from += next + 1;
      }
      break;
    }
    tasks.push({ title, lines: lines.slice(from, to), answers, source: lines.slice(from, end) });
    start = end;
    i = end;
  }
  const rest = lines.slice(start);
  if (rest.some((l) => GROUP_RE.test(l))) tasks.push({ lines: rest, answers: new Map(), source: rest });
  return tasks;
}

/* ---------- Question groups ---------- */

export function detectType(instructions: string): QuestionType {
  const t = squash(instructions);
  if (/\bTRUE\b.*\bFALSE\b.*\bNOT GIVEN\b/.test(t)) return "tfng";
  if (/\bYES\b.*\bNO\b.*\bNOT GIVEN\b/.test(t)) return "ynng";
  if (/\bheadings?\b/i.test(t)) return "heading";
  if (/choose the correct letter|(?:choose|mark) \w+ letters?\b|\bA, B, C or D\b/i.test(t)) return "mcq";
  if (/\bmatch\b|correct ending|which (?:paragraph|section) contains|list of words|from the (?:list|box)|write the (?:correct )?letters?\b/i.test(t))
    return "matching";
  if (/\bcomplete\b|NO MORE THAN|ONE WORD/i.test(t)) return "fill";
  if (/answer the questions/i.test(t)) return "short";
  return "fill";
}

/** Accepts the line only if it continues the sequence already collected (A, B, C… or i, ii, iii…). */
function nextOption(line: string, have: Option[], underQuestion = false): Option | null {
  if (line.length > (underQuestion ? 400 : 160)) return null;
  const letter = line.match(LETTER_OPT_RE);
  if (
    letter &&
    letter[1] === String.fromCharCode(65 + have.length) &&
    (have.length === 0 || have[0].key === "A") &&
    // "A risk to…" is prose, not an option: a bare single space needs a capitalised or numeric start,
    // except right under a multiple-choice question, where options may be lower-case ("A five people").
    (underQuestion || /[.)]|\s{2,}/.test(letter[2]) || /^[A-Z0-9'"‘“(]/.test(letter[3]))
  ) {
    return { key: letter[1], text: squash(letter[3]) };
  }
  const roman = line.match(ROMAN_OPT_RE);
  if (roman && roman[1] === ROMAN[have.length] && (have.length === 0 || have[0].key === "i")) {
    return { key: roman[1], text: squash(roman[3]) };
  }
  return null;
}

function optionsFromTail(tail: string[], underQuestion = false): Option[] {
  const inline: Option[] = [];
  for (const raw of tail) {
    const o = raw.trim() ? nextOption(raw.trim(), inline, underQuestion) : null;
    if (o) inline.push(o);
  }
  if (inline.length >= 2) return inline;
  // Column layout: the letters in one run, their texts in the next.
  const nb = tail.map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < nb.length; i++) {
    let k = 0;
    while (nb[i + k] === String.fromCharCode(65 + k)) k++;
    if (k >= 2 && nb.length >= i + 2 * k) {
      return Array.from({ length: k }, (_, j) => ({ key: String.fromCharCode(65 + j), text: nb[i + k + j] }));
    }
  }
  // A word box in mixed layout: "A" / "difficult" / "B" / "complex" / "D  admired  E  material".
  const cells = nb.flatMap((l) => l.split(/\s{2,}/));
  const box: Option[] = [];
  for (let i = 0; i + 1 < cells.length; i++) {
    const text = cells[i + 1];
    if (cells[i] === String.fromCharCode(65 + box.length) && text.length <= 160 && !KEY_ONLY_RE.test(text)) {
      box.push({ key: cells[i], text });
      i++;
    }
  }
  return box.length >= 2 ? box : [];
}

/** A paragraph with several numbered gaps (a summary) is divided so that each gap is shown with its own sentences. */
function gapSentences(text: string, gaps: number[]): Map<number, string> {
  const chunks: { text: string; gaps: number[] }[] = [];
  let lead = ""; // sentences without a gap introduce the next one that has a gap
  for (const s of text.split(/(?<=[.!?]["'’”)]?)\s+(?=[A-Z"'‘“(])/)) {
    const own = gaps.filter((n) => new RegExp(`\\(${n}\\) [£$€]?__`).test(s));
    if (own.length) {
      chunks.push({ text: lead + s, gaps: own });
      lead = "";
    } else {
      lead += s + " ";
    }
  }
  if (lead && chunks.length) chunks[chunks.length - 1].text += " " + lead.trim();
  const out = new Map<number, string>();
  for (const c of chunks) for (const n of c.gaps) out.set(n, c.text);
  return out;
}

/** "22. … shopping. 23. The woman often …" on one line: each numbered sentence gets a line of its own. */
function splitRunOn(line: string): string[] {
  const first = line.trim().match(/^(\d{1,2})[.)]\s/);
  if (!first) return [line];
  const at = line.search(new RegExp(`(?<=[.?!])\\s+${Number(first[1]) + 1}[.)]\\s+(?=[A-Z])`));
  return at < 0 ? [line] : [line.slice(0, at), "", ...splitRunOn(line.slice(at).trimStart())];
}

interface RawGroup {
  start: number;
  end: number;
  /** Highest number the group may reach when more questions are printed than its heading declares. */
  limit?: number;
  lines: string[];
}

interface ParsedGroup {
  group: ImportGroup;
  /** Prose that followed the last question: the passage, when questions come first. */
  tail: string[];
  expected: number;
  found: number;
}

function parseGroup(raw: RawGroup, answers: Map<number, string[]>): ParsedGroup {
  const { start } = raw;
  let end = raw.end;
  const limit = Math.max(end, raw.limit ?? end);
  const instr: string[] = [raw.lines[0].trim()];
  const groupOptions: Option[] = [];
  /** Options that follow the last question without a blank line in between. */
  const trailing: Option[] = [];
  const found = new Map<number, { prompt: string; options: Option[] }>();
  let tail: string[] = [];
  let pending: string[] = [];
  let cur: { prompt: string; options: Option[] } | null = null;
  let last = start - 1;
  let gap = false;
  let type: QuestionType | null = null;
  const typeNow = () => (type ??= detectType(instr.join(" ")));
  /** The diagram the questions refer to, when the page shows one among them. */
  let image: string | undefined;

  for (const rawLine of raw.lines.slice(1).flatMap(splitRunOn)) {
    const line = rawLine.trim();
    if (!line) {
      gap = true;
      // An unfinished sentence may resume after a blank line ("…the element" / "" / "called 1 ……").
      if (pending.length && endsSentence(pending[pending.length - 1])) pending = [];
      if (last === end) tail.push("");
      continue;
    }
    const picture = line.match(IMAGE_RE);
    if (picture && !(last === end && gap)) {
      image ??= picture[2];
      continue;
    }
    if (last === end && gap) {
      // "Questions 1–5" printed over eight statements, "Questions 1-4" over ten gaps:
      // follow the numbering up to the next group.
      const numbered = line.match(Q_RE);
      const next = end + 1;
      const resumes =
        (numbered && Number(numbered[1]) === next && numbered[2].trim()) || [...line.matchAll(INLINE_RE)].some((m) => Number(m[1]) === next);
      if (end < limit && resumes) {
        end = next;
      } else {
        tail.push(rawLine);
        continue;
      }
    }

    // Gaps numbered inside a sentence: "called 1 ………… had the same property."
    const gaps: number[] = [];
    let upTo = last;
    for (const m of line.matchAll(INLINE_RE)) {
      const n = Number(m[1]);
      if (n > upTo && n >= start && (n <= end || (n === upTo + 1 && n <= limit))) {
        gaps.push(n);
        upTo = n;
      }
    }
    if (gaps.length) {
      end = Math.max(end, upTo);
      typeNow();
      // The sentence starts at the nearest bullet, or failing that on the previous line.
      const bullet = pending.map((l) => BULLET_RE.test(l)).lastIndexOf(true);
      const lead = startsLower(line) || bullet >= 0 ? pending.slice(bullet >= 0 ? bullet : -1) : [];
      const join = lead.length > 0;
      if (join && found.size === 0) instr.splice(instr.length - lead.length, lead.length);
      const text = ((join ? lead.join(" ") + " " : "") + line)
        .replace(BULLET_RE, "")
        .replace(INLINE_RE, (m, n, sign) => (gaps.includes(Number(n)) ? `(${n}) ${sign}________ ` : m));
      const sentences = gapSentences(squash(text), gaps);
      const shared = new Map<string, { prompt: string; options: Option[] }>();
      for (const n of gaps) {
        const prompt = sentences.get(n) ?? squash(text);
        cur = shared.get(prompt) ?? { prompt, options: [] };
        shared.set(prompt, cur);
        found.set(n, cur);
      }
      last = upTo;
      pending = [];
      gap = false;
      continue;
    }

    // Question numbered at the start of a line.
    const q = line.match(Q_RE);
    if (q) {
      const n = Number(q[1]);
      if (n > last && n >= start && n <= end) {
        typeNow();
        cur = { prompt: squash(q[2]), options: [] };
        found.set(n, cur);
        last = n;
        pending = [];
        gap = false;
        continue;
      }
      if (/^\d{1,3}$/.test(line)) continue; // stray page number
    }

    if (cur && typeNow() === "mcq") {
      const o = nextOption(line, cur.options, true);
      if (o) {
        cur.options.push(o);
        gap = false;
        continue;
      }
    }
    // Sentence endings listed straight after the last question: "3 … because" / "A she has…" / "B she started…".
    if (cur && last === end && typeNow() !== "mcq") {
      const o = nextOption(line, trailing);
      if (o) {
        trailing.push(o);
        continue;
      }
      if (trailing.length) {
        trailing[trailing.length - 1].text += " " + line;
        continue;
      }
    }
    if (!cur) {
      // "Choose FOUR answers from the box … letters A-E": the entries may be lower-case ("A define a problem").
      const boxed = line.length <= 80 && /\bletters?\b|\b[A-K]\s*[-–—]\s*[A-K]\b/.test(instr.join(" "));
      const o = nextOption(line, groupOptions, boxed);
      if (o) {
        typeNow();
        groupOptions.push(o);
        continue;
      }
    }

    if (found.size === 0 && groupOptions.length === 0) {
      instr.push(line);
      pending.push(line);
      continue;
    }
    if (cur && !gap) {
      if (cur.options.length) {
        cur.options[cur.options.length - 1].text += " " + line;
        continue;
      }
      if (!BULLET_RE.test(line) && !endsSentence(cur.prompt)) {
        cur.prompt = squash(cur.prompt + " " + line);
        continue;
      }
    }
    pending.push(line);
  }

  let t = typeNow();
  const lastQ = found.get(end);
  if (trailing.length >= 2 && groupOptions.length === 0) {
    groupOptions.push(...trailing);
  } else if (trailing.length && lastQ) {
    // A lone "A …" line was the question running on, not a list.
    lastQ.prompt = squash([lastQ.prompt, ...trailing.map((o) => `${o.key} ${o.text}`)].join(" "));
  }
  if (tail.length) {
    const tailOptions = optionsFromTail(tail, t === "mcq" && lastQ?.options.length === 0);
    if (tailOptions.length >= 2) {
      if (t === "mcq" && lastQ && lastQ.options.length === 0) {
        lastQ.options = tailOptions;
        tail = [];
      } else if (groupOptions.length === 0) {
        groupOptions.push(...tailOptions);
        tail = [];
      }
    }
  }
  if (squash(tail.join(" ")).length < 400) {
    // Too short for a passage; a picture among these lines still belongs to the questions.
    image ??= tail.map((l) => l.match(IMAGE_RE)?.[2]).find(Boolean);
    tail = [];
  }

  const expected = end - start + 1;
  let foundCount = found.size;
  const questions: ImportQuestion[] = [];
  const uses = new Map<object, number>();
  for (const f of found.values()) uses.set(f, (uses.get(f) ?? 0) + 1);
  for (let n = start; n <= end; n++) {
    const f = found.get(n);
    // A gap that has its sentence to itself needs no number of its own.
    const text = f && uses.get(f) === 1 ? f.prompt.replace(new RegExp(`\\(${n}\\) (?=[£$€]?_{8})`), "") : f?.prompt;
    questions.push({
      number: n,
      prompt: (text && squash(text.replace(GAP_RE, " ________ "))) || undefined,
      options: f?.options.length ? f.options : undefined,
      answer: answers.get(n) ?? [],
    });
  }

  // "Choose TWO letters": one shared option list, no per-question lines.
  if (t === "mcq" && found.size === 0 && groupOptions.length >= 2) {
    foundCount = expected;
    const ask = [...instr].reverse().find((l) => l.endsWith("?") || /_{3,}/.test(l));
    for (const q of questions) q.prompt = ask ?? instr[instr.length - 1];
    // The chosen letters may be given in any order, so each of the questions accepts each of them.
    const pool = [...new Set(questions.flatMap((q) => q.answer))];
    if (pool.length && pool.every((a) => KEY_ONLY_RE.test(firstToken(a)))) for (const q of questions) q.answer = pool;
  }

  const keyMap = (opts: Option[]) => new Map(opts.map((o) => [o.key.toLowerCase(), o.key]));
  const groupKeys = keyMap(groupOptions);
  const answered = questions.filter((q) => q.answer.length);
  if (
    (t === "fill" || t === "short") &&
    groupOptions.length >= 2 &&
    answered.length > 0 &&
    answered.every((q) => q.answer.every((a) => groupKeys.has(firstToken(a).toLowerCase())))
  ) {
    t = "matching"; // completion from a list of lettered words
  }
  for (const q of questions) {
    // A drop-down after the statement leaves a gap that carries no meaning for choice questions.
    if (t !== "fill" && t !== "short" && q.prompt && !/\(\d{1,2}\) _{3,}/.test(q.prompt)) {
      q.prompt = q.prompt.replace(/\s*_{3,}$/, "") || undefined;
    }
    if (t === "tfng" || t === "ynng") {
      q.answer = q.answer.map((a) => canonicalJudgement(a) ?? a);
    } else if (t === "mcq" || t === "heading" || t === "matching") {
      const keys = q.options?.length ? keyMap(q.options) : groupKeys;
      // "B, D" under one question number: either letter is accepted.
      q.answer = q.answer.flatMap((a) => (/^[A-K](?:\s*,\s*[A-K])+$/.test(a.trim()) ? a.split(",").map((x) => x.trim()) : [a]));
      q.answer = q.answer.map((a) => {
        const tok = firstToken(a);
        return keys.get(tok.toLowerCase()) ?? (KEY_ONLY_RE.test(tok) ? tok : a);
      });
    }
    q.answer = [...new Set(q.answer)];
  }
  if ((t === "matching" || t === "heading") && groupOptions.length === 0) {
    const letters = answered.flatMap((q) => q.answer);
    if (letters.length && letters.every((a) => /^[A-K]$/.test(a))) {
      // "paragraphs A–J … one paragraph is not used": the instructions name the full range.
      const named = squash(instr.join(" ")).match(/\bA\s*[-–—]\s*([B-K])\b/);
      const max = Math.max(named ? named[1].charCodeAt(0) : 0, ...letters.map((a) => a.charCodeAt(0)));
      for (let c = 65; c <= max; c++) groupOptions.push({ key: String.fromCharCode(c), text: "" });
    }
  }

  return {
    group: {
      type: t,
      instructions: squash(instr.join(" ")) || undefined,
      options: groupOptions.length ? groupOptions : undefined,
      image,
      questions,
    },
    tail,
    expected,
    found: foundCount,
  };
}

/* ---------- Passage body ---------- */

function buildBody(lines: string[]): { title?: string; paragraphs: ImportParagraph[] } {
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) chunks.push(squash(cur.join(" ")));
    cur = [];
  };
  for (const raw of lines) {
    if (!raw.trim() || /^\s*\d{1,3}\s*$/.test(raw)) {
      flush();
      continue;
    }
    if (/^\s{2,}\S/.test(raw)) flush(); // PDF text marks a new paragraph with an indent
    cur.push(raw.trim());
  }
  flush();

  // A paragraph split by a page break resumes in lower case.
  const paras: string[] = [];
  for (const c of chunks) {
    if (RUBRIC_RE.test(c)) continue;
    if (paras.length && startsLower(c) && !IMAGE_RE.test(paras[paras.length - 1])) paras[paras.length - 1] += " " + c;
    else paras.push(c);
  }

  let title: string | undefined;
  const firstLong = paras.findIndex((p) => p.length > 200);
  for (let i = (firstLong < 0 ? paras.length : firstLong) - 1; i >= 0; i--) {
    const p = paras[i];
    if (p.length <= 80 && !/^[[©(]|^Adapted\b/i.test(p) && !IMAGE_RE.test(p) && !/[.!]["'’”)\]]?\s*$/.test(p)) {
      title = p;
      paras.splice(i, 1);
      break;
    }
  }

  // Paragraph labels "A …", "B …" count only when they run in sequence.
  let next = 65;
  const labels = paras.map((p) => {
    const m = p.match(LABEL_RE);
    const label = m?.[1] ?? m?.[2];
    if (label && label.charCodeAt(0) === next) {
      next++;
      return label;
    }
    return undefined;
  });
  const useLabels = labels.filter(Boolean).length >= 2;
  return {
    title,
    paragraphs: paras.map((p, i) => {
      const picture = p.match(IMAGE_RE);
      if (picture) return { text: picture[1], image: picture[2] };
      return useLabels && labels[i] ? { label: labels[i], text: p.replace(LABEL_RE, "") } : { text: p };
    }),
  };
}

/* ---------- Tasks ---------- */

function parseTask(task: RawTask, pageTitle = ""): ExtractResult | null {
  interface RawPassage {
    body: string[];
    groups: RawGroup[];
    audio?: string;
  }
  let passages: RawPassage[] = [{ body: [], groups: [] }];
  let cur = passages[0];
  let group: RawGroup | null = null;
  for (const line of task.lines) {
    const recording = line.match(AUDIO_RE);
    if (recording) {
      cur.audio ??= recording[1];
      continue;
    }
    if (PASSAGE_RE.test(line) && line.trim().length <= 30) {
      if (cur.groups.length === 0 && squash(cur.body.join(" ")).length < 600) {
        cur.body = []; // an introduction to the page, not a passage
      } else {
        cur = { body: [], groups: [] };
        passages.push(cur);
      }
      group = null;
      continue;
    }
    const g = line.match(GROUP_RE);
    if (g && !/based on|spend about/i.test(line)) {
      const s = Number(g[1]);
      const e = g[2] ? Number(g[2]) : s;
      if (e >= s && e - s < 40) {
        // "SECTION 3. QUESTIONS 21-30" straight above "Questions 21-23" only announces the section.
        const prev = cur.groups[cur.groups.length - 1];
        const announces = (l: string) => /_{3,}|\.{4,}/.test(l) || Number(l.trim().match(Q_RE)?.[1]) === s;
        if (prev && prev.start === s && !prev.lines.slice(1).some(announces)) cur.groups.pop();
        group = { start: s, end: e, lines: [line] };
        cur.groups.push(group);
        continue;
      }
    }
    (group ? group.lines : cur.body).push(line);
  }

  // An answer list numbered from the wrong start (11–20 under questions 21–30): when the headings cover one
  // unbroken range and the key has exactly as many entries in an unbroken run, the key is shifted onto the questions.
  const declared = passages.flatMap((p) => p.groups);
  const keyed = [...task.answers.keys()].sort((a, b) => a - b);
  if (declared.length && keyed.length) {
    const from = Math.min(...declared.map((g) => g.start));
    const to = Math.max(...declared.map((g) => g.end));
    const unbroken = keyed[keyed.length - 1] - keyed[0] + 1 === keyed.length;
    const covered = declared.reduce((n, g) => n + g.end - g.start + 1, 0) === to - from + 1;
    if (unbroken && covered && keyed.length === to - from + 1 && keyed[0] !== from) {
      task.answers = new Map(keyed.map((n) => [n - keyed[0] + from, task.answers.get(n)!]));
    }
  }

  // Questions that follow a passage without a "Questions n–m" heading: the answer key tells where they start.
  let covered = 0;
  for (const p of passages) {
    const first = p.groups[0];
    if (!first) continue;
    const need = Math.min(...[...task.answers.keys()].filter((n) => n > covered));
    const at = need < first.start ? p.body.findIndex((l) => Number(l.trim().match(Q_RE)?.[1]) === need) : -1;
    if (at >= 0) {
      // The instructions are the few short lines above the first question.
      let from = at;
      for (let short = 0; from > 0 && p.body[from - 1].trim().length < 200 && short < 6; from--) {
        if (p.body[from - 1].trim()) short++;
      }
      p.groups.unshift({ start: need, end: first.start - 1, lines: ["", ...p.body.slice(from)] });
      p.body = p.body.slice(0, from);
    }
    covered = p.groups[p.groups.length - 1].end;
  }

  const issues: string[] = [];
  if (!passages.some((p) => p.groups.length)) {
    if (task.answers.size === 0) return null;
    const nums = [...task.answers.keys()];
    passages = [
      {
        body: task.lines,
        groups: [{ start: Math.min(...nums), end: Math.max(...nums), lines: ["", ...task.lines] }],
        audio: passages.find((p) => p.audio)?.audio,
      },
    ];
    issues.push("문항 범위 표시(Questions n–m)를 찾지 못해 정답표의 번호로 추정했습니다.");
  }

  // Text blocks without questions belong to the neighbouring passage.
  const merged: RawPassage[] = [];
  let carry: string[] = [];
  let carriedAudio: string | undefined;
  for (const p of passages) {
    if (p.groups.length) {
      merged.push({ body: [...carry, ...p.body], groups: p.groups, audio: p.audio ?? carriedAudio });
      carry = [];
      carriedAudio = undefined;
    } else {
      carry.push(...p.body, "");
      carriedAudio ??= p.audio;
    }
  }
  if (carry.length && merged.length) merged[merged.length - 1].body.push("", ...carry);

  // Numbering is continuous, so a group can run at most up to the next group's first question.
  const allGroups = merged.flatMap((p) => p.groups);
  allGroups.forEach((g, i) => {
    const next = allGroups[i + 1];
    // …and a heading that overlaps the next group ("Questions 6–9" before "Questions 9–13") is cut short.
    if (next && next.start > g.start && g.end >= next.start) g.end = next.start - 1;
    g.limit = next ? next.start - 1 : Math.max(g.end, ...task.answers.keys());
  });

  const all = task.lines.join("\n");
  const head = (task.title ?? pageTitle) + " " + all.slice(0, 600);
  const listening = merged.some((p) => p.audio) || (/\blistening\b/i.test(head) && !/\breading\b/i.test(head));
  const kind: TestKind = listening ? "listening" : "reading";
  const module: Module = /general (?:training|reading)/i.test(head) ? "general" : "academic";

  let expected = 0;
  let found = 0;
  const outPassages: ImportPassage[] = merged.map((p) => {
    const parsed = p.groups.map((g) => parseGroup(g, task.answers));
    expected += parsed.reduce((n, g) => n + g.expected, 0);
    found += parsed.reduce((n, g) => n + g.found, 0);
    const body = buildBody([...p.body, ...parsed.flatMap((g) => ["", ...g.tail])]);
    const groups = parsed.map((g) => g.group);
    // A listening page has no passage: what stands before the questions is an introduction, unless it is long enough to be a transcript.
    if (listening && body.paragraphs.reduce((n, x) => n + x.text.length, 0) < 400) return { paragraphs: [], audio: p.audio, groups };
    return { title: body.title, paragraphs: body.paragraphs, audio: p.audio, groups };
  });

  const questions = outPassages.flatMap((p) => p.groups.flatMap((g) => g.questions.map((q) => ({ q, g }))));
  const noPrompt = questions.filter(({ q, g }) => !q.prompt && !(g.type === "mcq" && g.options)).map(({ q }) => q.number);
  const noAnswer = questions.filter(({ q }) => q.answer.length === 0).map(({ q }) => q.number);
  const choice = questions.filter(({ g }) => g.type === "mcq" || g.type === "heading" || g.type === "matching");
  const noOptions = choice.filter(({ q, g }) => !q.options?.length && !g.options?.length).map(({ q }) => q.number);
  const bodyLen = outPassages.reduce((n, p) => n + (p.paragraphs ?? []).reduce((m, x) => m + x.text.length, 0), 0);

  if (found < expected) issues.push(`문항 ${expected}개 중 ${expected - found}개의 내용을 찾지 못했습니다 (번호: ${noPrompt.join(", ")}).`);
  if (noAnswer.length === questions.length) issues.push("정답표를 찾지 못했습니다. 검수 화면에서 정답을 붙여넣어 주십시오.");
  else if (noAnswer.length) issues.push(`정답이 없는 문항: ${noAnswer.join(", ")}`);
  if (noOptions.length) issues.push(`선택지를 찾지 못한 문항: ${noOptions.join(", ")}`);
  const numbers = new Set(questions.map(({ q }) => q.number));
  const stray = [...task.answers.keys()].filter((n) => !numbers.has(n));
  if (stray.length) issues.push(`정답표에는 있지만 문항을 찾지 못한 번호: ${stray.join(", ")}`);
  if (listening && outPassages.some((p) => !p.audio)) issues.push("음성 파일을 찾지 못했습니다.");
  if (!listening && bodyLen < 400) issues.push("지문이 짧거나 없습니다. 지문이 다른 페이지에 있을 수 있습니다.");
  const pictured = outPassages
    .flatMap((p) => p.groups)
    .filter((g) => !g.image && /\blabel\b|\b(?:map|plan|diagram|picture|(?<!flow-)chart)\s+below\b/i.test(g.instructions ?? ""))
    .flatMap((g) => g.questions.map((q) => q.number));
  if (pictured.length) issues.push(`그림을 보고 푸는 문항으로 보이는데 그림을 찾지 못했습니다: ${pictured.join(", ")}`);

  const confidence =
    0.35 * (expected ? found / expected : 0) +
    0.35 * (questions.length ? 1 - noAnswer.length / questions.length : 0) +
    0.2 * (listening ? (outPassages.every((p) => p.audio) ? 1 : 0) : Math.min(1, bodyLen / 400)) +
    0.1 * (choice.length ? 1 - noOptions.length / choice.length : 1);

  return {
    draft: { title: task.title ?? "", kind, module, passages: outPassages },
    confidence: Math.round(confidence * 100) / 100,
    issues,
    source: task.source.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/** A document may hold several tasks (each with its own answer key); each becomes its own draft. */
export function extractTests(text: string, meta: { title?: string } = {}): ExtractResult[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // Option letters typed on a Cyrillic keyboard look the same but are different characters.
    .replace(/(^|[\s(])([АВСЕ])(?=[\s.)]|$)/gm, (_, before: string, ch: string) => before + LOOKALIKE[ch])
    .split("\n")
    .filter((l) => !NOISE_RE.test(l));
  const results = splitTasks(lines)
    .map((t) => parseTask(t, meta.title))
    .filter((r): r is ExtractResult => r !== null);
  const base = meta.title?.trim() || "가져온 시험";
  results.forEach((r, i) => {
    if (!r.draft.title) r.draft.title = results.length > 1 ? `${base} (${i + 1})` : base;
  });
  return results;
}
