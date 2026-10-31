/**
 * TOEIC Listening and Reading uses two kinds of four-choice question (three choices in Part 2):
 * - lmcq: a listening choice whose options are heard, not printed (Parts 1 and 2). The option texts are the script of
 *   the choices and are shown only after grading.
 * - mcq: printed choices (A)–(D) (Parts 3–7).
 * A set is a Listening set (Parts 1–4) or a Reading set (Parts 5–7); its passages are titled "Part N · …".
 */
export type QuestionType = "mcq" | "lmcq";
export type TestKind = "listening" | "reading";

/** Where a set came from (see 001_schema.sql). */
export type Origin = "sample" | "ai" | "mine" | "shared" | "market";

export interface Option {
  key: string;
  text: string;
}

/* ---------- Import form: what set files carry, what the AI writes and what the converter makes ---------- */

export interface ImportQuestion {
  number: number;
  prompt?: string;
  options?: Option[];
  /** The key, one letter. */
  answer: string[];
}

export interface ImportGroup {
  type: QuestionType;
  /** Directions; a Part 3/4 graphic is written here as "Graphic\n…". */
  instructions?: string;
  options?: Option[];
  /** Part 1 photograph: a file name in the media archive. */
  image?: string;
  questions: ImportQuestion[];
}

export interface ImportParagraph {
  label?: string;
  text: string;
}

export interface ImportPassage {
  /** "Part 3 · Conversation 2 (…)": the part number decides how the set is shown and printed. */
  title?: string;
  /** Plain text; blank lines separate paragraphs. Ignored when `paragraphs` is given.
      The text for Reading; for Listening the script, shown after grading. */
  body?: string;
  paragraphs?: ImportParagraph[];
  /** Listening: the recording, a file name in the media archive. Without one the script is read by the Windows voice. */
  audio?: string;
  groups: ImportGroup[];
}

export interface ImportTest {
  title: string;
  kind: TestKind;
  passages: ImportPassage[];
}

/* ---------- Loaded from the database ---------- */

export interface Question {
  id: number;
  number: number;
  prompt: string | null;
  options: Option[];
  answer: string[];
}

export interface QuestionGroup {
  id: number;
  type: QuestionType;
  instructions: string | null;
  options: Option[];
  /** The Part 1 photograph as a data URL. */
  image: string | null;
  questions: Question[];
}

export interface Passage {
  id: number;
  ord: number;
  title: string | null;
  bodyHtml: string;
  /** Listening: archive name of the recording. */
  audio: string | null;
  groups: QuestionGroup[];
}

export interface TestDetail {
  id: number;
  title: string;
  kind: TestKind;
  passages: Passage[];
  origin: Origin;
  /** Written by the AI (Studio), which is when the "문제가 이상해요" report is offered. */
  ai: boolean;
  /** Question ids the user reported as flawed; not scored. */
  reported: number[];
}

export interface TestSummary {
  id: number;
  title: string;
  kind: TestKind;
  createdAt: string;
  questionCount: number;
  attempts: number;
  lastScore: number | null;
  lastBand: number | null;
  origin: Origin;
  /** How an AI-written set was asked for; null for other sets. */
  gen: GenMeta | null;
  /** An attempt left before submitting (practice_draft), or null. */
  draft: DraftSummary | null;
}

/** What the list shows of an unfinished attempt: questions answered and when it was last saved (UTC, as SQLite's
 *  datetime('now') writes it). */
export interface DraftSummary {
  answered: number;
  updatedAt: string;
}

/** The request behind an AI-written set, kept so the library can be filtered and searched by it. */
export interface GenMeta {
  /** The settings the items were written in; a random pick is stored as the words it resolved to. */
  topic: string;
  /** Target total score (600, 750, 900). */
  band: number;
  provider: string;
  /** Empty when a CLI provider ran its default model. */
  model: string;
  /** Parts, target and the verification record. */
  options: Record<string, unknown>;
}
