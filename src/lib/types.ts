/**
 * TOEFL iBT (2026) items use mcq, cword and build. The IELTS-style types stay valid so that collected
 * and imported practice material in those formats still opens.
 * - cword: "Complete the Words". The passage body holds the paragraph with `[[n]]` where question n's blank is;
 *   each question's prompt is the visible start of the word, its answer the missing letters (and the whole word).
 * - lmcq: a listening choice whose options are heard, not printed (TOEIC Parts 1 and 2). The option texts are the
 *   script of the choices and are shown only after grading.
 * - build: "Build a Sentence". The prompt is the other speaker's line, options are the word chunks (one may be a
 *   distractor), the answer is the finished sentence.
 */
export type QuestionType = "mcq" | "lmcq" | "cword" | "build" | "tfng" | "ynng" | "heading" | "matching" | "fill" | "short";
export type TestKind = "reading" | "listening" | "writing" | "speaking";
export type Module = "academic" | "general";

export interface Option {
  key: string;
  text: string;
}

/* ---------- Import format (also the target format for crawler adapters) ---------- */

export interface ImportQuestion {
  number: number;
  prompt?: string;
  options?: Option[];
  /** Accepted answers. Parentheses mark optional words: "(the) river". */
  answer: string[];
}

export interface ImportGroup {
  type: QuestionType;
  instructions?: string;
  options?: Option[];
  /** Picture the questions refer to (a diagram to label): a file name in the archive, or its address before collection. */
  image?: string;
  questions: ImportQuestion[];
}

export interface ImportParagraph {
  label?: string;
  text: string;
  /** A picture in place of text, with `text` as its description: a file name in the archive, or its address before collection. */
  image?: string;
}

export interface ImportPassage {
  title?: string;
  /** Plain text; blank lines separate paragraphs. Ignored when `paragraphs` is given.
      The passage for reading, the transcript (if any) for listening, the task or cue card for writing and speaking. */
  body?: string;
  paragraphs?: ImportParagraph[];
  /** Listening: the recording, as its address or as a file name in the archive. */
  audio?: string;
  /** Writing and speaking: a model answer, as plain text with blank lines between paragraphs. */
  sample?: string;
  /** Empty for writing and speaking, which have a task instead of questions. */
  groups: ImportGroup[];
}

export interface ImportTest {
  title: string;
  kind: TestKind;
  module: Module;
  book?: number;
  test?: number;
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
  /** The group's picture as a data URL. */
  image: string | null;
  questions: Question[];
}

export interface Passage {
  id: number;
  ord: number;
  title: string | null;
  bodyHtml: string;
  /** Listening: address or archive name of the recording. */
  audio: string | null;
  /** Writing and speaking: the model answer. */
  sampleHtml: string | null;
  groups: QuestionGroup[];
}

export interface TestDetail {
  id: number;
  title: string;
  kind: TestKind;
  module: Module;
  passages: Passage[];
  /** Written by the AI (src/lib/generate.ts). */
  ai: boolean;
  /** Question ids the user reported as flawed; not scored. */
  reported: number[];
}

export interface TestSummary {
  id: number;
  title: string;
  kind: TestKind;
  module: Module;
  createdAt: string;
  questionCount: number;
  /** Tasks or parts; what a writing or speaking set is counted in. */
  passageCount: number;
  /** Saved writing or speaking practice entries. */
  entries: number;
  attempts: number;
  lastScore: number | null;
  lastBand: number | null;
  /** Written by the AI rather than collected or imported. */
  ai: boolean;
  /** Imported from a shared package (.toeicset). */
  shared: boolean;
  /** How an AI-written set was asked for; null for collected and imported sets. */
  gen: GenMeta | null;
}

/** A topic AI-written sets were made on, and how many sets of one kind used it. */
export interface GenTopic {
  topic: string;
  kind: TestKind;
  count: number;
}

/** The request behind an AI-written set, kept so the library can be filtered and searched by it. */
export interface GenMeta {
  /** The topic the text was written on; a random pick is stored as the words it resolved to. */
  topic: string;
  band: number;
  provider: string;
  /** Empty when a CLI provider ran its default model. */
  model: string;
  /** Reading question types, listening parts, writing tasks, text position: whatever the skill took. */
  options: Record<string, unknown>;
}

/** A whole exam: its sets in paper order (listening, reading ×3, writing, speaking). */
export interface ExamSummary {
  id: number;
  title: string;
  module: Module;
  band: number | null;
  createdAt: string;
  tests: {
    id: number;
    kind: TestKind;
    title: string;
    ord: number;
    questionCount: number;
    attempts: number;
    /** Saved writing or speaking practice entries. */
    entries: number;
    lastScore: number | null;
    lastBand: number | null;
  }[];
}
