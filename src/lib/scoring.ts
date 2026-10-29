import type { QuestionType } from "./types";

const JUDGEMENT_ALIASES: Record<string, string> = {
  t: "TRUE",
  true: "TRUE",
  f: "FALSE",
  false: "FALSE",
  y: "YES",
  yes: "YES",
  n: "NO",
  no: "NO",
  ng: "NOT GIVEN",
  "not given": "NOT GIVEN",
  notgiven: "NOT GIVEN",
};

/** Maps TRUE/T/ng/"Not Given" etc. to a canonical judgement, or null if unrecognised. */
export function canonicalJudgement(s: string): string | null {
  const key = s.trim().toLowerCase().replace(/\s+/g, " ");
  return JUDGEMENT_ALIASES[key] ?? null;
}

/** Lower-case, unify quotes/dashes, collapse whitespace, strip surrounding punctuation. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?"']+|[\s.,;:!?"']+$/g, "");
}

/** "(the) river bank" -> ["the river bank", "river bank"]. Handles several optional parts. */
export function expandOptional(answer: string): string[] {
  const m = answer.match(/\(([^()]*)\)/);
  if (!m || m.index === undefined) return [answer.replace(/\s+/g, " ").trim()];
  const before = answer.slice(0, m.index);
  const after = answer.slice(m.index + m[0].length);
  return [
    ...expandOptional(before + m[1] + after),
    ...expandOptional(before + " " + after),
  ];
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "seven" -> "7", "twenty-one" -> "21"; anything else unchanged. */
function wordToNumber(w: string): string {
  const unit = UNITS.indexOf(w);
  if (unit >= 0) return String(unit);
  const [t, u] = w.split("-");
  const ten = TENS.indexOf(t);
  if (ten < 2) return w;
  if (u === undefined) return String(ten * 10);
  const one = UNITS.indexOf(u);
  return one > 0 && one < 10 ? String(ten * 10 + one) : w;
}

/**
 * How a gap answer is compared, following the IELTS marking conventions: numbers may be written in digits or words,
 * a currency symbol or an ordinal ending may be left out, and digit groups may be spaced ("07833 419205").
 */
export function gapKey(s: string): string {
  return normalizeText(s)
    .split(" ")
    .map(wordToNumber)
    .join(" ")
    .replace(/[£$€]/g, "")
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/(\d)[\s-]+(?=\d)/g, "$1")
    .trim();
}

/** "Build a Sentence": case, spacing and end punctuation do not count; word order and every word do. */
export function sentenceKey(s: string): string {
  return normalizeText(s)
    .replace(/[.,!?;:"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCorrect(type: QuestionType, user: string | undefined, accepted: string[]): boolean {
  if (!user || user.trim() === "") return false;
  switch (type) {
    case "cword": {
      // Either the missing letters or the whole word; letters only, case ignored.
      const u = user.trim().toLowerCase().replace(/[^a-z'’-]/g, "");
      return accepted.some((a) => a.trim().toLowerCase().replace(/[^a-z'’-]/g, "") === u);
    }
    case "build": {
      const u = sentenceKey(user);
      return accepted.some((a) => sentenceKey(a) === u);
    }
    case "tfng":
    case "ynng": {
      const u = canonicalJudgement(user);
      return u !== null && accepted.some((a) => canonicalJudgement(a) === u);
    }
    case "mcq":
    case "lmcq":
    case "heading":
    case "matching": {
      const u = user.trim().toLowerCase();
      return accepted.some((a) => a.trim().toLowerCase() === u);
    }
    case "fill":
    case "short": {
      const u = gapKey(user);
      return accepted.some((a) => expandOptional(a).some((v) => gapKey(v) === u));
    }
  }
}

export interface ScorableQuestion {
  id: number;
  type: QuestionType;
  answer: string[];
}

export interface ScoreResult {
  correct: number;
  total: number;
  results: { questionId: number; userAnswer: string; isCorrect: boolean }[];
}

export function scoreTest(questions: ScorableQuestion[], responses: Record<number, string>): ScoreResult {
  const results = questions.map((q) => {
    const userAnswer = responses[q.id] ?? "";
    return { questionId: q.id, userAnswer, isCorrect: isCorrect(q.type, userAnswer, q.answer) };
  });
  return { correct: results.filter((r) => r.isCorrect).length, total: questions.length, results };
}
