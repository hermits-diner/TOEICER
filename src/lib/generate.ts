/**
 * AI-written IELTS-style practice sets. The model is asked for the app's own import format, so a generated set goes
 * through the same validation, storage, practice, scoring and explanation paths as any imported test.
 *
 * Reading: generate → measure (length, readability, question count; one rewrite if off) → blind solve → self-review
 * (told where the solver disagreed) → mechanical checks → save. Listening follows the same path, part by part.
 */
import { difficultyGuide } from "./difficulty";
import { invoke } from "@tauri-apps/api/core";
import { complete, type AiSettings } from "./ai";
import { chartSvg, svgToPng, validateChart, type ChartSpec } from "./chart";
import {
  assignGeminiVoices,
  geminiSynthesize,
  type SpeakerInfo,
  type SynthTurn,
} from "./tts";
import { validateImport } from "./importFormat";
import { expandOptional, isCorrect, normalizeText } from "./scoring";
import type {
  ImportGroup,
  ImportPassage,
  ImportTest,
  Module,
  Option,
  QuestionType,
} from "./types";

export type GenSkill = "reading" | "listening" | "writing" | "speaking";

export interface GenOptions {
  skill: GenSkill;
  module: Module;
  /** Empty for a random topic. */
  topic: string;
  /** Target band, 5.5–8.0: the centre of the item-difficulty mix (difficulty.ts); the text's vocabulary does not change. */
  band: number;
  /** Reading: question types to include. */
  types: QuestionType[];
  /** Writing: which tasks. General Training Task 1 is a letter; Academic Task 1 is a chart drawn by the app. */
  writingTasks: ("task1" | "task2")[];
  /** Listening: which parts (1-4). Each part is ~3-5 minutes of audio. */
  parts: number[];
  /** Reading: which of the paper's three texts this is: Academic Passage 1-3, General Training Section 1-3. */
  position?: 1 | 2 | 3;
  /** Writing: the kind of Task 2 question; drawn at random from TASK2_KINDS when absent, so sets vary. */
  task2Kind?: Task2Kind;
  /** Topics of sets already in the library; a random topic is drawn from the rest. */
  avoidTopics?: string[];
}

export const READING_TYPES: { type: QuestionType; label: string }[] = [
  { type: "tfng", label: "True / False / Not Given" },
  { type: "ynng", label: "Yes / No / Not Given" },
  { type: "heading", label: "제목 매칭" },
  { type: "matching", label: "정보·특징 매칭" },
  { type: "mcq", label: "객관식" },
  { type: "fill", label: "빈칸 완성" },
  { type: "short", label: "단답형" },
];

const TOPICS = {
  academic: [
    "urban beekeeping",
    "the history of timekeeping",
    "coral reef restoration",
    "the psychology of habit formation",
    "ancient trade routes",
    "vertical farming",
    "the science of sleep",
    "language extinction",
    "deep-sea mining",
    "the invention of paper",
    "animal migration and magnetism",
    "microplastics in rivers",
    "early aviation",
    "the economics of tourism",
    "child language acquisition",
    "glacier retreat",
    "the origins of chess",
  ],
  general: [
    "a community garden scheme",
    "joining a public library",
    "a neighbourhood recycling service",
    "a guide to renting a flat",
    "evening courses at a college",
    "a local cycling club",
    "a city bus timetable",
    "a leisure centre membership",
  ],
  /** General Training Section 2: the workplace. */
  work: [
    "a job advertisement for a hotel receptionist",
    "induction for new warehouse staff",
    "a flexible working policy",
    "health and safety training for kitchen staff",
    "the terms of a part-time contract",
    "a company's travel expenses rules",
    "a training course for new sales staff",
    "a staff appraisal scheme",
  ],
};

/** A topic for the module; General Training Section 2 draws from the workplace, Section 3 from general interest. */
/** The same words, ignoring case and spacing, so "Urban beekeeping " and "urban beekeeping" are one topic. */
export const topicKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A topic from the pool for the module and text position; topics in `avoid` (sets already in the library) are
 * skipped while any other remains, so repeated generation does not keep landing on the same subjects.
 */
export function randomTopic(module: Module, position?: number, avoid: Iterable<string> = []): string {
  const list =
    module === "general" && position === 2
      ? TOPICS.work
      : module === "general" && position === 3
        ? TOPICS.academic
        : TOPICS[module];
  const used = new Set([...avoid].map(topicKey));
  const fresh = list.filter((t) => !used.has(topicKey(t)));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- Readability ----------
 *
 * Flesch-Kincaid grade and the share of long words, measured on the draft so a dense text is sent back for a rewrite.
 * Human-written IELTS passages in the library measure grade 11-13 with about one word in four of seven or more letters.
 */

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade level. */
  fk: number;
  /** Flesch Reading Ease. */
  fre: number;
  /** Share of words with seven or more letters. */
  longShare: number;
}

const WORD_RE = /[A-Za-z][A-Za-z'\u2019-]*/g;

function syllables(word: string): number {
  let w = word.toLowerCase().replace(/^['\u2019-]+|['\u2019-]+$/g, "");
  if (w.length > 3) w = w.replace(/e$/, "");
  return Math.max(1, (w.match(/[aeiouy]+/g) ?? []).length);
}

export function readability(text: string): Readability {
  const words = text.match(WORD_RE) ?? [];
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z"\u201c(])|\n+/)
    .filter((s) => (s.match(WORD_RE) ?? []).length >= 3);
  if (words.length < 20 || !sentences.length)
    return {
      words: words.length,
      sentences: sentences.length,
      fk: 0,
      fre: 100,
      longShare: 0,
    };
  const asl = words.length / sentences.length;
  const asw = words.reduce((n, w) => n + syllables(w), 0) / words.length;
  return {
    words: words.length,
    sentences: sentences.length,
    fk: 0.39 * asl + 11.8 * asw - 15.59,
    fre: 206.835 - 1.015 * asl - 84.6 * asw,
    longShare: words.filter((w) => w.length >= 7).length / words.length,
  };
}

/* ---------- Item-writing principles ----------
 *
 * The IELTS item-writer guidelines are confidential. What follows is reconstructed from public sources:
 * the official test-format pages and sample tasks (ielts.org), the Writing band descriptors (2023), and the
 * IELTS research reports that observed item writers at work (Seedhouse et al. 2011 and Inoue et al. 2021 on
 * Speaking; Green & Hawkey 2010, IELTS Research Reports 11, on Academic Reading, read in full on 2026-10-08).
 * From Green & Hawkey come the text-shaping practices of trained writers (cut a longer source to length, strip
 * journalistic touches, start from the general, gloss or replace technical words, one topic per paragraph,
 * enough distinct propositions, no culture-bound or arts topics that assume background knowledge), their item
 * practices (a locating cue plus paraphrase; FALSE by antonymy or one changed detail; NOT GIVEN on matters the
 * text never raises; text order; every paragraph tested; two tasks on specific information and one on the whole
 * text; MCQ distractors that are salient ideas with balanced keys; gap answers that are nouns the grammar does
 * not give away) and the checks of an editing meeting (precise referents, ambiguous prepositions, negative
 * stems, synonymous options, shared cues between items, unglossed terms, religion). See
 * docs/reading-green-hawkey-2010.md. Rules the sources state outright are followed as written; where they
 * are silent, the practice seen in published tests is used as best practice, not as an official rule.
 */

/** Editorial rules every item set must meet; the same ones a Cambridge editing meeting rejects items for. */
const ITEM_WRITING = [
  "Item-writing rules (apply to every question):",
  "- Exactly one defensible key. If a second option could be argued, rewrite or replace the item.",
  "- The text must be needed: nobody should get the key from general knowledge alone.",
  "- Paraphrase. A stem may carry one or two locating words (a name, a term, a figure) so the reader can find the place; everything else is reworded with synonyms, changed word forms and restructured clauses, so that word-matching alone does not give the answer.",
  "- Spread items across the whole text in text order: every paragraph is tested, no two items test the same sentence, no item depends on another item's answer, and neighbouring items share no cue word.",
  '- Stems are precise: a definite referent (not an open-ended "experiments" or "scientists"), no vague "a particular type of", no preposition that could point two ways, plain positive wording, no double negatives.',
  "- Fair to any test taker: avoid religion, war, politics, culture-specific references, and specialist knowledge.",
  "- TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN groups: at least one of each answer and no answer in more than half of the group; a NOT GIVEN statement is a plausible detail the text could have mentioned but does not, and a careful reader cannot infer it either way.",
];

/* ---------- Reading ---------- */

const TYPE_RULES: Record<QuestionType, string> = {
  lmcq: 'type "lmcq": not written by this IELTS-style generator; see the TOEIC generator.',
  cword: 'type "cword": not written by this IELTS-style generator; see the TOEFL generator.',
  build: 'type "build": not written by this IELTS-style generator; see the TOEFL generator.',
  tfng: 'type "tfng": statements about factual information in the passage, each a paraphrase of one place in the text with a locating cue; answer is exactly "TRUE", "FALSE" or "NOT GIVEN", with at least one of each. TRUE: the statement restates the text in other words. FALSE: the text contradicts it through an antonym or one changed detail (scope, time, cause, quantity). NOT GIVEN: the statement raises something the text never addresses, so a careful reader could not infer it either way; do not make one by altering a word of a true statement when the text implies the altered version. Avoid absolute words ("only", "entirely", "all") unless the text itself states them. Statements follow passage order.',
  ynng: 'type "ynng": statements about the writer\'s views or claims (use with an argumentative passage); answer is exactly "YES", "NO" or "NOT GIVEN", same rules as tfng.',
  heading:
    'type "heading": a whole-text task. Group "options" lists headings keyed with lower-case roman numerals ("i", "ii", …), with 2-3 more headings than paragraphs; each paragraph has one topic and its heading states that main idea, while the spare headings name a supporting detail or an idea from the wrong paragraph; no heading is used twice; each question prompt is "Paragraph A" etc.; answer is the numeral.',
  matching:
    'type "matching": group "options" lists features keyed "A", "B", … (researchers, places, periods, paragraphs, or the lettered texts of a General Training section); each question states a piece of information in different words from the passage; when the options are paragraphs or texts this is a whole-text task and the items may be in any order; answer is the key. Say in the instructions "NB You may use any letter more than once." when that is so.',
  mcq: 'type "mcq": each question has its own "options" keyed "A"-"D" with exactly one correct answer; the stem asks about an important idea, opinion or function in the text, never a trivial detail; distractors are salient ideas from the text that do not answer the stem, about the same length as the key, no two of them meaning the same thing, none ruled out by general knowledge alone; across the group the key falls in each position A-D about equally often; questions follow passage order; answer is the letter.',
  fill: 'type "fill": sentence or summary completion; prompts contain a gap written "________" and fit the answer grammatically; instructions state the word limit as "Choose NO MORE THAN TWO WORDS from the passage for each answer."; answers are nouns or noun phrases copied in exactly the form they have in the passage (no contractions; a hyphenated word counts as one word) and respect the limit; the words before a gap do not give the answer away through grammar (no article that fixes singular or plural, no preposition that fixes the kind of answer), and exactly one word form fits; the sentence around the gap paraphrases the passage. You may list acceptable variants.',
  short:
    'type "short": short-answer questions; instructions state "Answer with NO MORE THAN THREE WORDS from the passage."; each question paraphrases the passage, tests content rather than grammar, and has one unambiguous answer copied from the passage in the form found there.',
};

/** How a trained item writer shapes a source text for the paper (Green & Hawkey 2010, sections 4.2, 5.2, 6.2). */
const TEXT_SHAPING = [
  "Shape the text as a trained item writer edits a source for the test:",
  '- Academic in tone though written for the general reader: no journalistic hook, anecdote or news framing, no sensational words (amazing, surprising, incredible), no colloquialisms, no addressing the reader, no contractions, no positioning of the writer and reader ("we in the west").',
  "- Start from the general and move to specific examples; each paragraph has one topic that a heading could capture, and paragraphs do not overlap.",
  "- Enough distinct, testable propositions: a main idea illustrated by several different studies, cases, places or periods, never one point restated in different words; every paragraph adds information that an item can target.",
  "- Non-specialist: replace technical words with everyday ones where the meaning allows, gloss the few that stay in plain words at first use, expand abbreviations, no citations, footnotes or subheadings, and no works of literature or art the reader is expected to know.",
  "- Names, figures and dates are consistent throughout; nothing in a later sentence contradicts an earlier one.",
];

const TASK_MIX =
  "Of the groups, one is a whole-text task (matching headings, or locating information by paragraph or text, whose items may come in any order) and the others target specific information in text order, so the reader scans the whole text once rather than for every group.";

/** The shorter counterpart for General Training Sections 1 and 2, whose texts are documents rather than articles. */
const DOCUMENT_SHAPING =
  "Documents read as the real thing: a title, short sentences, lists or headings where a notice or policy would have them, consistent names, figures, dates and prices, no contradiction between texts, no colloquial asides, and no reference to a real organisation, law or place-specific rule.";

/** What one of the paper's three texts is, by module and position, with the limits the app measures on the draft. */
export interface ReadingSpec {
  /** Questions this text carries, so that the three texts make 40. */
  questions: number;
  /** The text, as the prompt describes it. */
  text: string;
  /** Question types used when the user picks none. */
  types: QuestionType[];
  /** Fewest words, the Flesch-Kincaid grade range and the largest share of long words the draft may have. */
  minWords: number;
  minGrade: number;
  maxGrade: number;
  maxLong: number;
}

const ACADEMIC_TEXT =
  "an Academic passage of 750-900 words (count them; fewer than 750 is rejected) in 6-7 paragraphs labelled A, B, C, … with a title, written as a feature article in a serious magazine or a chapter of a popular non-fiction book would be: for an educated general reader, never for specialists.";

const ACADEMIC_READABILITY = [
  "Readability targets, which the app measures and enforces:",
  "- Flesch-Kincaid grade 11-13 (Flesch Reading Ease 40-55): sentences that run 20-24 words on average with subordinate clauses, and precise, less common words where the meaning needs them. Drafts tend to come out easier than asked, so aim for the top of this range.",
  "- No more than one word in four has seven or more letters.",
  "- Sentences average 18-24 words, mixing short sentences with long ones; no sentence over 40 words.",
  "- At most one technical term per paragraph, explained in plain words at first use.",
  '- Prefer concrete people, places, dates, quantities and examples to abstract nouns: "the factory closed in 1911" rather than "the cessation of industrial operations"; everyday verbs ("found", "grew", "argued") rather than nominalisations ("the identification of", "the expansion of").',
];

const ACADEMIC_PASSAGES: Record<
  1 | 2 | 3,
  Pick<ReadingSpec, "questions" | "text" | "types">
> = {
  1: {
    questions: 13,
    types: ["heading", "tfng", "fill"],
    text: "Passage 1 of 3: descriptive and factual, the most accessible text of the paper, with the most direct items.",
  },
  2: {
    questions: 13,
    types: ["matching", "tfng", "mcq", "fill"],
    text: "Passage 2 of 3: discursive, explaining a development, a method, or a debate between positions.",
  },
  3: {
    questions: 14,
    types: ["heading", "ynng", "mcq", "short"],
    text: "Passage 3 of 3: argumentative, carrying the writer's own views and claims (so YES/NO/NOT GIVEN items fit), with the most demanding items of the paper.",
  },
};

const GT_SECTIONS: Record<1 | 2 | 3, ReadingSpec> = {
  1: {
    questions: 14,
    types: ["matching", "tfng", "fill"],
    minWords: 550,
    minGrade: 5,
    maxGrade: 10.5,
    maxLong: 0.25,
    text: 'Section 1 of 3, "social survival": two or three short factual texts of 150-300 words each (600-750 words in all) of the kind a newcomer meets in daily life in an English-speaking country: a notice, an advertisement, a timetable, a leaflet, a course list, a set of rules, a product guide. All texts go into the one "paragraphs" array, one after another: each text begins with its title line in capitals as a paragraph {"label": "A", "text": "TITLE"} (the letters run A, B, C), and its later paragraphs are plain {"text": "..."} objects with no "label" key. Plain practical English: Flesch-Kincaid grade 7-10, short sentences, no abstract vocabulary. Matching items ask which text (A, B, C) contains a piece of information; the other items move through the texts in order.',
  },
  2: {
    questions: 13,
    types: ["matching", "tfng", "fill", "mcq"],
    minWords: 550,
    minGrade: 8,
    maxGrade: 11.5,
    maxLong: 0.27,
    text: 'Section 2 of 3, "workplace survival": two texts of 300-400 words each about work: a job description, an extract from a contract, staff training or development material, a workplace policy, a guide for new employees. Both texts go into the one "paragraphs" array as in Section 1: a title line in capitals as a paragraph {"label": "A", "text": "TITLE"} (then "B"), followed by that text\'s paragraphs as plain {"text": "..."} objects with no "label" key. Flesch-Kincaid grade 8-11.',
  },
  3: {
    questions: 13,
    types: ["heading", "tfng", "matching", "fill"],
    minWords: 700,
    minGrade: 8,
    maxGrade: 13,
    maxLong: 0.28,
    text: "Section 3 of 3: one longer text of 750-900 words of general interest, descriptive or instructive rather than argumentative, as from a magazine or a book for the general reader, in 6-7 paragraphs labelled A, B, C, … with a title. Flesch-Kincaid grade 9-12; no more than one word in five of seven or more letters.",
  },
};

export function readingSpec(
  module: Module,
  position: 1 | 2 | 3 = 1,
): ReadingSpec {
  if (module === "general") return GT_SECTIONS[position];
  // Human-written passages in the library measure grade 11.5 (official samples 12.9): the band 10-14 is centred on them.
  return {
    ...ACADEMIC_PASSAGES[position],
    minWords: 720,
    minGrade: 10,
    maxGrade: 14,
    maxLong: 0.3,
  };
}

export function readingPrompt(o: GenOptions): {
  system: string;
  prompt: string;
} {
  const gt = o.module === "general";
  const position = o.position ?? 1;
  const spec = readingSpec(o.module, position);
  const types = o.types.length ? o.types : spec.types;
  const system = `You write original IELTS ${gt ? "General Training" : "Academic"} Reading practice material.
Write everything yourself; do not reproduce any published IELTS test or copyrighted text.
Reply with a single JSON object and nothing else.`;
  const prompt = [
    `Write ${gt ? "General Training Reading Section" : "Academic Reading Passage"} ${position} about: ${o.topic}.`,
    difficultyGuide(o.band, "reading", [{ position, total: spec.questions }], o.module),
    gt ? `Text: ${spec.text}` : `Text: ${ACADEMIC_TEXT} ${spec.text}`,
    ...(gt
      ? [
          "Situations and documents are invented: name no real company, school, law or product. Plain English for everyday readers; the app measures readability and sends dense text back.",
        ]
      : ACADEMIC_READABILITY),
    ...(gt && position < 3 ? [DOCUMENT_SHAPING] : TEXT_SHAPING),
    "Keep information density high and coherent; no padding, no repetition. Do not require specialist knowledge. A straightforward text takes straightforward items; do not pair an easy text with trick questions.",
    `Then write exactly ${spec.questions} questions numbered 1-${spec.questions} (the app rejects any other count), split into 3-4 groups by type. Within a group the items follow the order of the text (except summary and table completion, which may not).`,
    TASK_MIX,
    `Use these question types: ${types.join(", ")}.`,
    'Each group has IELTS-style instructions starting with the question range, e.g. "Questions 1-5", in the wording of the real test.',
    ...ITEM_WRITING,
    "Rules per type:",
    ...types.map((t) => `- ${TYPE_RULES[t]}`),
    "",
    "Before you reply: re-read the text once more and confirm every key against it; count the words and the questions; check the readability targets; then output the JSON.",
    "JSON shape:",
    `{"title": string, "passages": [{"title": string, "paragraphs": [{"label": "A", "text": string}], "groups": [{"type": string, "instructions": string, "options": [{"key": string, "text": string}], "questions": [{"number": 1, "prompt": string, "options": [{"key": "A", "text": string}], "answer": [string]}]}]}]}`,
    'Omit "options" where a type does not use them.',
  ].join("\n");
  return { system, prompt };
}

/** A problem the app measured on a draft: `en` goes back to the model, `ko` to the user. */
export interface Problem {
  en: string;
  ko: string;
  /** What kind of shortfall, so the pipeline can choose between extending a draft and rewriting it. */
  kind?:
    | "length"
    | "grade"
    | "easy"
    | "count"
    | "register"
    | "spacing"
    | "types"
    | "balance"
    | "format"
    | "sample";
}

/** Task types each listening part takes (the test format pages, Field 2023): completion only in Parts 1 and 4. */
const LISTENING_FORMATS: Record<number, QuestionType[]> = {
  1: ["fill"],
  2: ["mcq", "matching", "fill"],
  3: ["mcq", "matching", "fill"],
  4: ["fill"],
};

/**
 * The task types a draft uses against the ones asked for: every group's type must be allowed, enough distinct
 * types must appear (a paper's text carries 3-4 tasks), and no group may stand alone with a single item.
 */
export function typeProblems(
  t: ImportTest,
  allowed: QuestionType[],
  minDistinct: number,
): Problem[] {
  const groups = t.passages.flatMap((p) => p.groups);
  const used = [...new Set(groups.map((g) => g.type))];
  const need = Math.min(minDistinct, allowed.length);
  const out: Problem[] = [];
  const bad = used.filter((ty) => !allowed.includes(ty));
  if (bad.length)
    out.push({
      kind: "types",
      en: `question type${bad.length > 1 ? "s" : ""} ${bad.join(", ")} not allowed here; use only: ${allowed.join(", ")}`,
      ko: `허용되지 않는 문항 유형(${bad.join(", ")})이 있습니다`,
    });
  if (used.length < need)
    out.push({
      kind: "types",
      en: `only ${used.length} question type${used.length === 1 ? "" : "s"} used (${used.join(", ")}); use at least ${need} of: ${allowed.join(", ")}, one group per type`,
      ko: `문항 유형이 ${used.length}가지로 기준(${need}가지 이상)보다 적습니다`,
    });
  const lonely = groups.filter((g) => g.questions.length === 1);
  if (lonely.length)
    out.push({
      kind: "types",
      en: `a group of a single item (${lonely.map((g) => g.type).join(", ")}) is not a task; every group needs at least 2 items`,
      ko: `문항이 1개뿐인 그룹이 있습니다`,
    });
  return out;
}

/** TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN keys: at least one of each, none in more than half of the group. */
export function balanceProblems(t: ImportTest): Problem[] {
  const out: Problem[] = [];
  for (const g of t.passages.flatMap((p) => p.groups)) {
    if ((g.type !== "tfng" && g.type !== "ynng") || g.questions.length < 3)
      continue;
    const set =
      g.type === "tfng"
        ? ["TRUE", "FALSE", "NOT GIVEN"]
        : ["YES", "NO", "NOT GIVEN"];
    const keys = g.questions.map((q) =>
      (q.answer[0] ?? "").toUpperCase().replace(/\s+/g, " ").trim(),
    );
    const missing = set.filter((a) => !keys.includes(a));
    const over = set.filter(
      (a) => keys.filter((k) => k === a).length > g.questions.length / 2,
    );
    if (!missing.length && !over.length) continue;
    const why = [
      missing.length
        ? `${missing.join(" and ")} never occur${missing.length === 1 ? "s" : ""}`
        : "",
      over.length ? `${over.join(", ")} takes more than half of the group` : "",
    ]
      .filter(Boolean)
      .join("; ");
    out.push({
      kind: "balance",
      en: `the ${g.type === "tfng" ? "TRUE/FALSE/NOT GIVEN" : "YES/NO/NOT GIVEN"} keys are ${keys.join(", ")}: ${why}; at least one of each answer and none in more than half`,
      ko: `${g.type === "tfng" ? "TRUE/FALSE/NOT GIVEN" : "YES/NO/NOT GIVEN"} 정답이 한쪽으로 쏠렸습니다 (${keys.join(", ")})`,
    });
  }
  return out;
}

/**
 * Length, density, question count, task types and key balance of a reading draft against its spec (and the types
 * the user asked for); empty when the draft passes. The same checks run whatever model or CLI wrote the draft.
 */
export function readingProblems(
  t: ImportTest,
  spec: ReadingSpec,
  types: QuestionType[] = spec.types,
): Problem[] {
  const r = readability(passageText(t));
  const out: Problem[] = [];
  if (r.words < spec.minWords)
    out.push({
      kind: "length",
      en: `the text has ${r.words} words; at least ${spec.minWords} are required`,
      ko: `지문이 ${r.words}단어로 기준(${spec.minWords}단어 이상)보다 짧습니다`,
    });
  if (r.fk > spec.maxGrade)
    out.push({
      kind: "grade",
      en: `the text's Flesch-Kincaid grade is ${r.fk.toFixed(1)}; ${spec.maxGrade} or lower is required (shorter sentences, fewer long words)`,
      ko: `지문의 읽기 난도(Flesch-Kincaid ${r.fk.toFixed(1)})가 기준(${spec.maxGrade} 이하)보다 높습니다`,
    });
  if (r.words >= 50 && r.fk < spec.minGrade)
    out.push({
      kind: "easy",
      en: `the text is easier than the test: Flesch-Kincaid grade ${r.fk.toFixed(1)}; at least ${spec.minGrade} is required (longer, more varied sentences and some less common words)`,
      ko: `지문의 읽기 난도(Flesch-Kincaid ${r.fk.toFixed(1)})가 기준(${spec.minGrade} 이상)보다 낮습니다`,
    });
  if (r.longShare > spec.maxLong)
    out.push({
      en: `${Math.round(r.longShare * 100)}% of the words have seven or more letters; at most ${Math.round(spec.maxLong * 100)}% may (use everyday words and concrete nouns)`,
      ko: `긴 단어(7글자 이상) 비율이 ${Math.round(r.longShare * 100)}%로 기준(${Math.round(spec.maxLong * 100)}% 이하)을 넘습니다`,
    });
  const n = countQuestions(t);
  if (n !== spec.questions)
    out.push({
      kind: "count",
      en: `there are ${n} questions; exactly ${spec.questions} are required`,
      ko: `문항이 ${n}개로 기준(${spec.questions}개)과 다릅니다`,
    });
  out.push(
    ...typeProblems(t, types.length ? types : spec.types, 3),
    ...balanceProblems(t),
  );
  return out;
}

const rewriteNote = (problems: Problem[]) =>
  `Your previous attempt was rejected by the app's checks:\n${problems.map((p) => `- ${p.en}`).join("\n")}\nWrite a new text and new questions that meet every requirement.`;

/** Concrete levers for a text that measured too easy or too hard; the bare numbers alone did not move the model. */
const DENSIFY_NOTE =
  "To raise the grade while keeping the register: combine short sentences into longer ones with subordinate clauses and participial phrases (average 20-24 words, some over 30), add precise and less common vocabulary where the meaning calls for it (about one word in four with seven or more letters), and let paragraphs carry qualifications and comparisons rather than one plain statement after another.";
const SIMPLIFY_NOTE =
  "To lower the grade: split long sentences, replace abstract nouns with verbs and concrete examples, and swap technical or rare words for everyday ones, glossing the few that must stay.";
const READING_REWRITES = 2;

/** The first JSON object in a reply, tolerating code fences and stray text. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error(
      "AI가 정해진 형식으로 답하지 않았습니다. 다시 시도해 주십시오.",
    );
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(
      "AI 응답을 읽지 못했습니다. 다시 시도하거나 다른 모델을 골라 주십시오.",
    );
  }
}

/** Fixes the fields the app decides, then validates. */
export function toTest(
  raw: unknown,
  o: GenOptions,
  kind: ImportTest["kind"],
): ImportTest {
  if (typeof raw !== "object" || raw === null)
    throw new Error("AI 응답이 비어 있습니다.");
  const obj = raw as Record<string, unknown>;
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim()
      : o.topic;
  const v = validateImport({
    ...obj,
    kind,
    module: o.module,
    title: `AI · ${title}`,
  });
  if (!v.test)
    throw new Error(
      `AI가 만든 문제의 형식이 맞지 않습니다: ${v.errors.slice(0, 3).join(" / ")}`,
    );
  return v.test;
}

export const passageText = (t: ImportTest) =>
  t.passages
    .map((p) =>
      p.paragraphs?.length
        ? p.paragraphs.map((x) => x.text).join("\n\n")
        : (p.body ?? ""),
    )
    .join("\n\n");

/** The text as the reader sees it, with paragraph or text letters, for the editor and the solver (who must know which text is A). */
export const labelledText = (t: ImportTest) =>
  t.passages
    .map((p) =>
      p.paragraphs?.length
        ? p.paragraphs
            .map((x) => (x.label ? `[${x.label}] ${x.text}` : x.text))
            .join("\n\n")
        : (p.body ?? ""),
    )
    .join("\n\n");

const WORD_LIMITS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
};

/** "NO MORE THAN TWO WORDS" → 2. Numbers ("AND/OR A NUMBER") are allowed on top. */
export function wordLimit(instructions: string | undefined): number | null {
  if (/ONE WORD (ONLY|AND\/OR A NUMBER)/i.test(instructions ?? "")) return 1;
  const m = instructions?.match(
    /NO MORE THAN (ONE|TWO|THREE|FOUR|\d+) WORDS?/i,
  );
  if (!m) return null;
  return WORD_LIMITS[m[1].toUpperCase()] ?? Number(m[1]);
}

export interface Dropped {
  number: number;
  reason: string;
}

/**
 * Mechanical checks the model cannot be trusted with: gap answers must appear in the passage and respect the word
 * limit. Questions that fail are dropped (and reported) rather than shown with a wrong key.
 */
/**
 * Words only: punctuation goes, apostrophes inside words stay (don't, glacier's), and quotation marks around a term
 * ('peak water') go too, so that a key quoted in the passage is still found there.
 */
const bareWords = (s: string) =>
  normalizeText(s)
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/(^|[^a-z0-9])'+/g, "$1 ")
    .replace(/'+(?=[^a-z0-9]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function checkAnswers(t: ImportTest): {
  test: ImportTest;
  dropped: Dropped[];
} {
  const text = ` ${bareWords(passageText(t))} `;
  const dropped: Dropped[] = [];
  const passages = t.passages.map((p) => ({
    ...p,
    groups: p.groups.map((g) => {
      if (g.type !== "fill" && g.type !== "short") return g;
      const limit = wordLimit(g.instructions) ?? (g.type === "fill" ? 2 : 3);
      return {
        ...g,
        questions: g.questions.filter((q) => {
          const variants = q.answer.flatMap(expandOptional).map(bareWords);
          const fits = variants.filter(
            (a) =>
              a.split(/\s+/).filter((w) => !/^\d+$/.test(w)).length <= limit,
          );
          const found = fits.some((a) => a && text.includes(` ${a} `));
          if (!found)
            dropped.push({
              number: q.number,
              reason: fits.length
                ? "정답이 지문에 없음"
                : `${limit}단어 제한 초과`,
            });
          return found;
        }),
      };
    }),
  }));
  return { test: { ...t, passages }, dropped };
}

/** Numbers questions 1…n again and removes groups left empty, keeping each group's range in its instructions. */
export function renumber(t: ImportTest): ImportTest {
  let n = 0;
  const passages = t.passages.map((p) => ({
    ...p,
    groups: p.groups
      .filter((g) => g.questions.length > 0)
      .map((g): ImportGroup => {
        const first = n + 1;
        // Models sometimes write gaps as the question number ("[4]"), which goes stale here.
        const questions = g.questions.map((q) => ({
          ...q,
          number: ++n,
          prompt: q.prompt?.replace(/\[\d+\]/g, "________"),
        }));
        const range =
          first === n ? `Question ${first}` : `Questions ${first}-${n}`;
        const instructions = g.instructions?.replace(
          /^Questions? \d+(\s*[-–]\s*\d+)?/i,
          range,
        );
        return { ...g, questions, instructions };
      }),
  }));
  return { ...t, passages };
}

/* ---------- Blind solve ---------- */

/**
 * A second call answers the questions without seeing the keys. Where it disagrees with the key, the editor is told, so
 * TRUE/FALSE/NOT GIVEN, multiple-choice and heading keys get a check the mechanical pass cannot give them.
 */
export const SOLVER_SYSTEM = `You are a strong IELTS candidate (band 9). Answer every question using only the text; never from general knowledge.
Reply with a single JSON object and nothing else:
{"answers": [{"number": number, "answer": string, "evidence": string}]}
"answer" is the letter, the numeral, TRUE/FALSE/NOT GIVEN (or YES/NO/NOT GIVEN), or the words from the text, as the instructions require.
"evidence" quotes at most 15 words of the text that decide the answer, or "not in text" for NOT GIVEN.`;

function questionLines(t: ImportTest, withKeys: boolean): string[] {
  return t.passages.flatMap((p) =>
    p.groups.map((g) =>
      [
        `[${g.type}] ${g.instructions ?? ""}`,
        ...(g.options?.length
          ? [
              `Options: ${g.options.map((o) => `${o.key}=${o.text}`).join("; ")}`,
            ]
          : []),
        ...g.questions.map(
          (q) =>
            `${q.number}. ${q.prompt ?? ""}${q.options?.length ? ` (${q.options.map((o) => `${o.key}) ${o.text}`).join(" ")})` : ""}${withKeys ? ` → key: ${q.answer.join(" / ")}` : ""}`,
        ),
      ].join("\n"),
    ),
  );
}

export function solverPrompt(t: ImportTest): string {
  return `<text>\n${labelledText(t)}\n</text>\n\n<questions>\n${questionLines(t, false).join("\n\n")}\n</questions>`;
}

export interface SolverAnswer {
  answer: string;
  evidence: string;
}

export function parseSolver(text: string): Map<number, SolverAnswer> {
  const out = new Map<number, SolverAnswer>();
  let raw: { answers?: unknown };
  try {
    raw = extractJson(text) as { answers?: unknown };
  } catch {
    return out;
  }
  if (!Array.isArray(raw.answers)) return out;
  for (const a of raw.answers as Record<string, unknown>[]) {
    if (typeof a?.number === "number" && typeof a.answer === "string")
      out.set(a.number, {
        answer: a.answer.trim(),
        evidence: typeof a.evidence === "string" ? a.evidence.trim() : "",
      });
  }
  return out;
}

export interface Disagreement {
  number: number;
  key: string[];
  given: string;
  evidence: string;
}

/** Questions the solver answered differently from the key, judged with the app's own scoring. */
export function solverDisagreements(
  t: ImportTest,
  solved: Map<number, SolverAnswer>,
): Disagreement[] {
  const out: Disagreement[] = [];
  for (const p of t.passages)
    for (const g of p.groups)
      for (const q of g.questions) {
        const s = solved.get(q.number);
        if (s && s.answer && !isCorrect(g.type, s.answer, q.answer))
          out.push({
            number: q.number,
            key: q.answer,
            given: s.answer,
            evidence: s.evidence,
          });
      }
  return out;
}

/* ---------- Self-review ---------- */

export const REVIEW_SYSTEM = `You are the editor at an IELTS item-editing meeting. Check every question against the passage.
Reply with a single JSON object and nothing else:
{"problems": [{"number": number, "action": "fix" | "drop", "answer": [string], "prompt": string, "reason": string}]}
Report a question only if it fails one of these checks:
- a candidate who could not see the keys (listed under <solver>, if any) gave an answer the passage supports better than the key, or both answers can be defended; if the key is right and the candidate wrong, report nothing;
- the key is not supported by the passage, or a sentence elsewhere in the passage makes the key wrong;
- a second option could also be defended (two defensible answers);
- a TRUE/FALSE/NOT GIVEN or YES/NO/NOT GIVEN judgement is debatable, or a NOT GIVEN item can in fact be inferred from the passage;
- the stem or key reuses the passage's exact wording so that word-matching gives the answer away;
- the item can be answered from general knowledge without the passage;
- the wording is ambiguous or negative in a way that could mislead;
- two items test the same sentence of the passage, share a cue word, or one depends on the other's answer;
- a stem has an open-ended or vague referent, a preposition that could point two ways, a negative construction, or an absolute word ("only", "entirely", "all") the passage does not support;
- two multiple-choice options mean the same thing, or the keys of a group sit in the same position;
- a gap's answer is given away by the grammar before it, or more than one word form fits;
- a gap answer is not copied in the form found in the passage, or breaks the word limit.
Use "fix" with a corrected "answer" (and a reworded "prompt" if needed) when a clear correction exists; otherwise "drop".
Also list under "text" any flaw in the passage itself that an editing meeting would send back: a contradiction between sentences, an unglossed technical term or unexpanded abbreviation, a religious, political or culture-bound reference, a journalistic hook or colloquialism. Each entry is one short sentence; leave the list empty when the passage is sound.
Return {"problems": [], "text": []} when everything passes.`;

export function reviewPrompt(
  t: ImportTest,
  disagreements: Disagreement[] = [],
): string {
  const solver = disagreements.length
    ? `\n\n<solver>\nA candidate who could not see the keys answered these questions differently:\n${disagreements
        .map(
          (d) =>
            `${d.number}. key: ${d.key.join(" / ")} / candidate: ${d.given}${d.evidence ? ` (evidence: "${d.evidence}")` : ""}`,
        )
        .join("\n")}\n</solver>`
    : "";
  return `<passage>\n${labelledText(t)}\n</passage>\n\n<questions>\n${questionLines(t, true).join("\n\n")}\n</questions>${solver}`;
}

interface ReviewProblem {
  number: number;
  action: "fix" | "drop";
  answer?: string[];
  prompt?: string;
  reason: string;
}

/** The editor's remarks on the passage itself, shown to the user; the passage is not rewritten at this stage. */
export function parseReviewNotes(text: string): string[] {
  try {
    const raw = extractJson(text) as { text?: unknown };
    return Array.isArray(raw.text)
      ? raw.text
          .filter((n): n is string => typeof n === "string" && !!n.trim())
          .map((n) => n.trim())
      : [];
  } catch {
    return [];
  }
}

export function parseReview(text: string): ReviewProblem[] {
  const raw = extractJson(text) as { problems?: unknown };
  if (!Array.isArray(raw.problems)) return [];
  return raw.problems
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === "object" && p !== null && typeof p.number === "number",
    )
    .map((p) => ({
      number: p.number as number,
      action: p.action === "fix" ? "fix" : "drop",
      answer: Array.isArray(p.answer)
        ? p.answer.filter(
            (a): a is string => typeof a === "string" && !!a.trim(),
          )
        : undefined,
      prompt:
        typeof p.prompt === "string" && p.prompt.trim()
          ? p.prompt.trim()
          : undefined,
      reason: typeof p.reason === "string" ? p.reason : "",
    }));
}

/** Applies the reviewer's fixes and drops. A "fix" without a usable answer counts as a drop. */
export function applyReview(
  t: ImportTest,
  problems: ReviewProblem[],
): { test: ImportTest; fixed: number; dropped: Dropped[] } {
  const byNumber = new Map(problems.map((p) => [p.number, p]));
  let fixed = 0;
  const dropped: Dropped[] = [];
  const passages = t.passages.map((p) => ({
    ...p,
    groups: p.groups.map((g) => ({
      ...g,
      questions: g.questions.flatMap((q) => {
        const pr = byNumber.get(q.number);
        if (!pr) return [q];
        if (pr.action === "fix" && pr.answer?.length) {
          fixed++;
          return [{ ...q, answer: pr.answer, prompt: pr.prompt ?? q.prompt }];
        }
        dropped.push({
          number: q.number,
          reason: pr.reason || "검수에서 제외",
        });
        return [];
      }),
    })),
  }));
  return { test: { ...t, passages }, fixed, dropped };
}

/* ---------- Top-up: the standard count after the editing checks ----------
 *
 * The editor and the key check drop faulty items, so a text can end with 11-12 items instead of 13-14 and a
 * listening part with 8-9 instead of 10. A real paper always has 40, and the band tables assume 40, so the
 * shortfall is made up: the model writes replacements that join the existing groups, the new items alone go
 * through the blind solve, the editor and the key check, and whatever survives is kept.
 */

export const TOP_UP_SYSTEM = `You are an IELTS item writer at an editing meeting. The editor removed some items from a question set; you write replacements that join the existing groups and meet the same rules.
Write everything yourself; do not reproduce any published IELTS test. Reply with a single JSON object and nothing else.`;

/** Reasons the app's own checks give in Korean, put into English for the item writer. */
const faultInEnglish = (reason: string) =>
  reason.includes("정답이 지문에 없음")
    ? "the key does not appear word for word in the text"
    : /단어 제한 초과/.test(reason)
      ? "the key exceeds the word limit"
      : reason === "검수에서 제외"
        ? "removed by the editor"
        : reason;

function groupLines(p: ImportPassage): string[] {
  return p.groups.map((g, i) =>
    [
      `Group ${i + 1} [${g.type}] ${g.instructions ?? ""}`,
      ...(g.options?.length
        ? [`Options: ${g.options.map((o) => `${o.key}=${o.text}`).join("; ")}`]
        : []),
      ...g.questions.map(
        (q) =>
          `${q.number}. ${q.prompt ?? ""}${q.options?.length ? ` (${q.options.map((o) => `${o.key}) ${o.text}`).join(" ")})` : ""} → key: ${q.answer.join(" / ")}`,
      ),
    ].join("\n"),
  );
}

const LISTENING_TOP_UP_RULES = [
  "- The answers of a part are heard in the order of the questions, so place each new item by the point in the script where its answer is said; no two answers fall in the same turn, and the first answer comes only after the opening 40-60 words.",
  "- Stems and options paraphrase the recording: apart from the gap word itself, no phrase of the script is repeated in an item.",
  "- A gap answer is a run of words copied exactly from the script, digits included; multiple choice has three short, propositionally distinct options A-C whose distractors are heard but ruled out.",
];

export function topUpPrompt(
  t: ImportTest,
  index: number,
  deficit: number,
  target: number,
  dropped: Dropped[],
  /** A type the set was asked for that no group carries any more: the new items start a group of it. */
  missing?: QuestionType,
): string {
  const p = t.passages[index];
  const listening = t.kind === "listening";
  const tag = listening ? "script" : "passage";
  const types = [...new Set([...p.groups.map((g) => g.type), ...(missing ? [missing] : [])])];
  const removed = dropped.length
    ? `\n\n<removed>\nItems removed by the editor or the checks, with the faults to avoid:\n${dropped.map((d) => `- ${faultInEnglish(d.reason)}`).join("\n")}\n</removed>`
    : "";
  return [
    `<${tag}>\n${labelledText({ ...t, passages: [p] })}\n</${tag}>`,
    `<questions>\n${groupLines(p).join("\n\n")}\n</questions>${removed}`,
    "",
    `This ${listening ? "part" : "text"} must carry ${target} questions and now has ${target - deficit}. Write exactly ${deficit} new ${deficit === 1 ? "item" : "items"}.`,
    ...(missing
      ? [
          `The set was asked for "${missing}" items and none remain: write the new items as one new group of type "${missing}" with its own instructions (and option list where the type uses one), given as "group": 0 with "type" and "instructions" on each item.`,
        ]
      : []),
    "Each new item joins one of the groups above and follows that group's type, instructions, word limit and option list; prefer the groups that lost items, so that every group keeps at least 3 items. A heading or matching item takes its key from the group's option list (a heading not yet used, for a paragraph not yet asked about); a completion item's key is copied word for word from the text within the limit; a multiple-choice item brings its own options; TRUE/FALSE/NOT GIVEN items keep the group's balance of answers.",
    `Test a sentence that no remaining item tests and share no cue word with a neighbouring item${dropped.length ? ", and do not repeat the faults listed under <removed>" : ""}.`,
    ...(listening
      ? LISTENING_TOP_UP_RULES
      : [
          ...ITEM_WRITING.slice(1),
          "Rules per type:",
          ...types.map((ty) => `- ${TYPE_RULES[ty]}`),
        ]),
    "",
    "JSON shape:",
    `{"questions": [{"group": 1, "after": 7, "prompt": string, "options": [{"key": "A", "text": string}], "answer": [string]}]}`,
    '"group" is the number of the group the item joins (as listed above); "after" is the number of the existing item in that group that the new item follows in the order of the text (0 to place it first; the last number of the group for a whole-text task). Omit "options" where the type does not use them.',
    ...(missing
      ? ['An item of the new group instead carries "group": 0, "type": string, "instructions": string (the same instructions on each) and "after": 0; the new group goes after the groups above.']
      : []),
  ].join("\n");
}

export interface TopUpItem {
  /** 0 with `newGroup` set: the item starts a group of a type the set lost. */
  group: number;
  after: number;
  prompt?: string;
  options?: Option[];
  answer: string[];
  newGroup?: { type: QuestionType; instructions: string };
}

const QUESTION_TYPES: QuestionType[] = ["mcq", "tfng", "ynng", "heading", "matching", "fill", "short"];

/** The usable items of a top-up reply, at most `deficit` of them; an item naming no existing group or anchor is skipped. */
export function parseTopUp(
  raw: unknown,
  p: ImportPassage,
  deficit: number,
  /** The type a "group": 0 item may start; without it such items are skipped. */
  missing?: QuestionType,
): TopUpItem[] {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as {
    questions?: unknown;
  };
  if (!Array.isArray(obj.questions)) return [];
  const out: TopUpItem[] = [];
  for (const q of obj.questions as Record<string, unknown>[]) {
    if (out.length >= deficit || typeof q !== "object" || q === null) continue;
    const group = typeof q.group === "number" ? q.group : NaN;
    const after = typeof q.after === "number" ? q.after : NaN;
    const g = p.groups[group - 1];
    const fresh =
      group === 0 && missing && q.type === missing && QUESTION_TYPES.includes(missing)
        ? { type: missing, instructions: typeof q.instructions === "string" ? q.instructions.trim() : "" }
        : undefined;
    if (!fresh && (!g || !(after === 0 || g.questions.some((x) => x.number === after))))
      continue;
    const answer = Array.isArray(q.answer)
      ? q.answer
          .filter((a): a is string => typeof a === "string" && !!a.trim())
          .map((a) => a.trim())
      : [];
    if (!answer.length) continue;
    const prompt =
      typeof q.prompt === "string" && q.prompt.trim()
        ? q.prompt.trim()
        : undefined;
    const options = Array.isArray(q.options)
      ? (q.options as Record<string, unknown>[])
          .filter(
            (o) => typeof o?.key === "string" && typeof o?.text === "string",
          )
          .map((o) => ({
            key: String(o.key).trim(),
            text: String(o.text).trim(),
          }))
      : [];
    out.push({
      group,
      after: fresh ? 0 : after,
      prompt,
      options: options.length ? options : undefined,
      answer,
      ...(fresh ? { newGroup: fresh } : {}),
    });
  }
  return out;
}

/** Inserts the items into the passage's groups (numbers 0, renumbered later); `positions` says where they sit. */
export function insertTopUp(
  p: ImportPassage,
  items: TopUpItem[],
): { passage: ImportPassage; positions: [number, number][] } {
  type Marked =
    ImportTest["passages"][number]["groups"][number]["questions"][number] & {
      fresh?: boolean;
    };
  const groups = p.groups.map((g) => ({
    ...g,
    questions: g.questions.map((q): Marked => ({ ...q })),
  }));
  // Items starting a group the set lost: one new group of that type, after the existing ones, in the writer's order.
  const starting = items.filter((it) => it.newGroup);
  if (starting.length) {
    const { type, instructions } = starting[0].newGroup!;
    const own = starting.flatMap((it) => it.options ?? []);
    groups.push({
      type,
      instructions,
      options: type === "heading" || type === "matching" ? own.filter((o, i, a) => a.findIndex((x) => x.key === o.key) === i) : undefined,
      questions: starting.map(
        (it): Marked => ({
          number: 0,
          prompt: it.prompt,
          options: type === "mcq" ? it.options : undefined,
          answer: it.answer,
          fresh: true,
        }),
      ),
    });
  }
  // Reversed, so two items anchored on the same question keep the order the writer gave them.
  for (const it of [...items].reverse()) {
    if (it.newGroup) continue;
    const g = groups[it.group - 1];
    const at =
      it.after === 0
        ? 0
        : g.questions.findIndex((q) => !q.fresh && q.number === it.after) + 1;
    g.questions.splice(at, 0, {
      number: 0,
      prompt: it.prompt,
      options: it.options,
      answer: it.answer,
      fresh: true,
    });
  }
  const positions: [number, number][] = [];
  groups.forEach((g, gi) =>
    g.questions.forEach((q, qi) => q.fresh && positions.push([gi, qi])),
  );
  return {
    passage: {
      ...p,
      groups: groups.map((g) => ({
        ...g,
        questions: g.questions.map(({ fresh: _fresh, ...q }) => q),
      })),
    },
    positions,
  };
}

export interface TopUpResult {
  test: ImportTest;
  fixed: number;
  dropped: Dropped[];
  /** New items that survived their own review. */
  added: number;
  notes: string[];
}

const countOf = (p: ImportPassage) =>
  p.groups.reduce((n, g) => n + g.questions.length, 0);

export interface TopUpWant {
  /** The reading types the set was asked for; a type no group carries any more is restored as a new group. */
  types?: QuestionType[];
  /** How many rounds may run while items are still short and the last round added something (default 2). */
  rounds?: number;
}

/** The type the set was asked for that `p` no longer carries, when it has fewer distinct types than required. */
export function missingType(p: ImportPassage, asked: QuestionType[] | undefined): QuestionType | undefined {
  if (!asked?.length) return undefined;
  const used = new Set(p.groups.map((g) => g.type));
  if (used.size >= Math.min(3, asked.length)) return undefined;
  return asked.find((ty) => !used.has(ty));
}

/**
 * Makes up each passage's shortfall against `targets`; the new items are verified like the originals. A second
 * round runs when items are still short after the first one added something.
 */
export async function topUp(
  settings: AiSettings,
  t: ImportTest,
  targets: number[],
  dropped: Dropped[],
  onStep: (s: Step) => void,
  want: TopUpWant = {},
): Promise<TopUpResult> {
  const rounds = want.rounds ?? 2;
  let result = await topUpOnce(settings, t, targets, dropped, onStep, want.types);
  for (let round = 1; round < rounds && result.added > 0 && result.notes.length; round++) {
    const again = await topUpOnce(settings, result.test, targets, [...dropped, ...result.dropped], onStep, want.types);
    result = {
      test: again.test,
      fixed: result.fixed + again.fixed,
      dropped: [...result.dropped, ...again.dropped],
      added: result.added + again.added,
      notes: again.notes,
    };
  }
  return result;
}

async function topUpOnce(
  settings: AiSettings,
  t: ImportTest,
  targets: number[],
  dropped: Dropped[],
  onStep: (s: Step) => void,
  asked: QuestionType[] | undefined,
): Promise<TopUpResult> {
  const deficits = t.passages.map((p, i) =>
    Math.max(0, (targets[i] ?? 0) - countOf(p)),
  );
  const none: TopUpResult = {
    test: t,
    fixed: 0,
    dropped: [],
    added: 0,
    notes: [],
  };
  if (!deficits.some((d) => d > 0)) return none;
  onStep("topup");
  const passages = t.passages.slice();
  const positions = new Map<number, [number, number][]>();
  await Promise.all(
    deficits.map(async (deficit, i) => {
      if (!deficit) return;
      try {
        const missing = t.kind === "reading" ? missingType(t.passages[i], asked) : undefined;
        const r = await complete(
          settings,
          TOP_UP_SYSTEM,
          topUpPrompt(t, i, deficit, targets[i], dropped, missing),
        );
        const ins = insertTopUp(
          t.passages[i],
          parseTopUp(extractJson(r.text), t.passages[i], deficit, missing),
        );
        if (!ins.positions.length) return;
        passages[i] = ins.passage;
        positions.set(i, ins.positions);
      } catch {
        /* a malformed top-up leaves the passage as it was */
      }
    }),
  );
  if (!positions.size) return none;
  const v = validateImport(renumber({ ...t, passages }));
  if (!v.test) return none;
  let test = v.test;
  const fresh = new Set<number>();
  for (const [i, pos] of positions)
    for (const [gi, qi] of pos)
      fresh.add(test.passages[i].groups[gi].questions[qi].number);
  // The new items alone face the solver, the editor and the key check; the originals passed already.
  const disagreements = solverDisagreements(
    test,
    parseSolver(
      (await complete(settings, SOLVER_SYSTEM, solverPrompt(test))).text,
    ),
  ).filter((d) => fresh.has(d.number));
  const problems = parseReview(
    (await complete(settings, REVIEW_SYSTEM, reviewPrompt(test, disagreements)))
      .text,
  ).filter((p) => fresh.has(p.number));
  const reviewed = applyReview(test, problems);
  const checked = checkAnswers(reviewed.test);
  const droppedNow = [...reviewed.dropped, ...checked.dropped];
  test = renumber(checked.test);
  const notes = test.passages.flatMap((p, i) =>
    countOf(p) < (targets[i] ?? 0)
      ? [
          `${p.title ?? `${i + 1}`}: 보충 뒤에도 ${countOf(p)}/${targets[i]}문항`,
        ]
      : [],
  );
  return {
    test,
    fixed: reviewed.fixed,
    dropped: droppedNow,
    added: fresh.size - droppedNow.length,
    notes,
  };
}

/* ---------- Writing & speaking ----------
 *
 * Task 1 data size and the shape of the model answer follow O'Loughlin & Wigglesworth (2003, IELTS Research Reports 4):
 * a figure with twice the data (32 values against 16) made writers at every level less accurate and their prose less
 * complex, and fewer of them reached 150 words, while the kind of figure (bar, line, table) made no difference to
 * scores. Task 2 kinds follow Moore & Morton (1999, IELTS Research Reports 2): practice items were almost all
 * hortatory ("should X be done?") and all about real-world practices, where university essays evaluate, describe,
 * compare and explain and often weigh an attributed view; they recommended wider rhetorical range and attributed
 * propositions. See docs/writing-sources.md.
 */

/** Kinds of Task 2 question, each naming the rhetorical work it asks for. Only one is hortatory. */
export const TASK2_KINDS = [
  {
    id: "opinion",
    text: 'an attributed view to evaluate: the question states a position with a generic attribution ("Some educationists argue that …", "Many economists believe …"; never a named real person) and asks "To what extent do you agree or disagree?"',
  },
  {
    id: "discuss",
    text: 'two opposing views to compare and weigh: "Some people think … Others believe … Discuss both these views and give your own opinion."',
  },
  {
    id: "explain",
    text: 'a development to explain: the question states a trend or situation and asks for its causes and its effects ("Why is this happening? What effects does it have?"), inviting the writer\'s knowledge of their own country where helpful',
  },
  {
    id: "solve",
    text: 'a problem to analyse and solve: "What are the causes of this problem? What measures could be taken to deal with it?" (explanation, then recommendation)',
  },
  {
    id: "weigh",
    text: 'a development to assess: "Do the advantages of this development outweigh its disadvantages?"',
  },
  {
    id: "two-part",
    text: 'two direct questions on one topic, each answered in turn, such as "What do you think are the reasons for this? Is it a positive or a negative development?"',
  },
  {
    id: "hortatory",
    text: 'a policy or practice to judge: whether it should be adopted or required ("Should …? Give reasons.") — the one hortatory kind, so used only when drawn',
  },
] as const;
export type Task2Kind = (typeof TASK2_KINDS)[number]["id"];

export const randomTask2Kind = (): Task2Kind =>
  TASK2_KINDS[Math.floor(Math.random() * TASK2_KINDS.length)].id;

export function writingPrompt(o: GenOptions): {
  system: string;
  prompt: string;
} {
  const gt = o.module === "general";
  const tasks: GenOptions["writingTasks"] = o.writingTasks.length
    ? o.writingTasks
    : ["task2"];
  const kind =
    TASK2_KINDS.find((k) => k.id === (o.task2Kind ?? randomTask2Kind())) ??
    TASK2_KINDS[0];
  const lines = [
    `Write an original IELTS ${gt ? "General Training" : "Academic"} Writing set about: ${o.topic}.`,
    `Pitch the model answers at about band ${o.band.toFixed(1)}.`,
    "Topics must be of general interest and need no specialist knowledge; avoid religion, war, politics and culture-specific references. Model answers are written freshly for the task: no memorised or formulaic openings, and no sentences lifted from the task wording.",
  ];
  if (tasks.includes("task1") && !gt)
    lines.push(
      'Task 1 (title "Task 1"): a data description task. Add "chart": {"type": "bar" | "line" | "pie" | "table", "title": string, "unit": string, "categories": [string], "series": [{"name": string, "values": [number]}]} with realistic, internally consistent invented data of modest size: 3-6 categories and 1-3 series, 12-20 values in all (a figure with about 30 values made writers at every level less accurate and their prose simpler, so keep the data small); for a pie chart, each series is one pie, its values are percentages summing to 100, and categories name the slices. The data must offer four to six key features a reader would report: the overall pattern, the highest and the lowest, the largest change or a crossover, and one exception to the pattern. The body starts "You should spend about 20 minutes on this task.", then describes the figure in one sentence ("The bar chart below shows …", matching the chart type), then "Summarise the information by selecting and reporting the main features, and make comparisons where relevant." and "Write at least 150 words.", each on its own paragraph. Give a model answer of 170-200 words as "sample" that opens with a one-sentence paraphrase of what the figure shows, then gives a clear overview of the main trends or differences, then groups and compares the data in one or two paragraphs with selected figures, never listing every value.',
    );
  if (tasks.includes("task1") && gt)
    lines.push(
      'Task 1 (title "Task 1"): a letter task from everyday life (an accommodation problem, hours with a new employer, a letter to a local newspaper, a fault reported to an agency, a request to a friend). The body starts "You should spend about 20 minutes on this task." then the situation naming the reader, three bullet points that each ask for a different thing (explain / describe / request or suggest), "Write at least 150 words.", "You do NOT need to write any addresses." and how to begin the letter ("Dear Sir or Madam," for formal, "Dear Mr …," for semi-formal, "Dear …," for personal). Give a model letter of 170-200 words as "sample" in a tone that matches the reader and covers every bullet point.',
    );
  if (tasks.includes("task2") && gt)
    lines.push(
      "Task 2 in General Training concerns everyday social or practical life (family, the neighbourhood, work, leisure, money, transport, the education of children) rather than abstract or academic debate, and asks for the writer's own view and experience.",
    );
  if (tasks.includes("task2"))
    lines.push(
      `Task 2 (title "Task 2"): an essay question of this kind: ${kind.text}. Every part the answer must address is stated explicitly; the topic needs no specialist knowledge and can be answered from a candidate's general knowledge and experience of their own country; the writing it calls for is argued and evidenced (claims, reasons, examples), not just an opinion. The body starts "You should spend about 40 minutes on this task.", then the question in the usual IELTS form, "Give reasons for your answer and include any relevant examples from your own knowledge or experience." and "Write at least 250 words.". Give a model essay of 270-320 words as "sample", with a clear position kept throughout, every part of the question addressed, main ideas extended and supported with examples or evidence, and paragraphs separated by blank lines.`,
    );
  lines.push(
    "",
    'JSON shape: {"title": string, "passages": [{"title": "Task 1" | "Task 2", "body": string, "chart": object (Academic Task 1 only), "sample": string, "groups": []}]}',
  );
  return {
    system:
      "You write original IELTS Writing tasks with model answers. Do not reproduce published tests. Reply with a single JSON object and nothing else.",
    prompt: lines.join("\n"),
  };
}

/**
 * Speaking frames follow the materials-development guidelines quoted and the examiner evidence gathered in Inoue,
 * Khabbazbashi, Lam & Nakatsuhara (2021, IELTS Research Reports Online 2021/2): topics accessible to any age, gender
 * or background with religion, politics, distressing subjects and stereotypes excluded; a first Part 1 frame that fits
 * people neither working nor studying; open questions with "Tell me more"-style follow-ups rather than yes/no + why;
 * optional rounding-off questions; Part 3 in two sub-topics that push strong speakers and keep an easier question for
 * weak ones; and nothing that presupposes a lifestyle or world experience. See docs/speaking-sources.md.
 */
export function speakingPrompt(o: GenOptions): {
  system: string;
  prompt: string;
} {
  return {
    system:
      "You write original IELTS Speaking practice sets. Do not reproduce published tests. Reply with a single JSON object and nothing else.",
    prompt: [
      `Write an original IELTS Speaking set whose Part 2 and Part 3 are about: ${o.topic}.`,
      'Part 1 (title "Part 1"): three topic frames of 3-4 questions each, one question per line, each frame introduced by a line like "Let\'s talk about where you live.". The first frame asks about work, study or how the speaker spends their time, worded so that someone neither working nor studying can answer ("Do you work, study, or do something else at the moment?"); the other two are familiar everyday frames (home, free time, daily routines, food, the local area, weather, friends). Questions are open ("Tell me about …", "How often …", "What kind of …"), not yes/no followed by a bare "Why?", and each frame ends with a line "Follow-up: Tell me more about that. / When was that? / Why was that?" for the examiner to use. Avoid the stock questions candidates rehearse (hometown, favourite colour or food) unless given a fresh angle, and ask about where the speaker lives, not their "hometown" or "culture".',
      'Part 2 (title "Part 2"): a task card. Body: "Describe …" then "You should say:" and three prompts, then "and explain …", each on its own line, followed by "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say." The card asks for something everyone has an equivalent of (a person, a place, an event, an object, an activity, a decision) in plain, high-frequency words, with no key term the whole answer depends on; the prompts invite a specific personal account rather than a general topic a rehearsed speech could cover. After the card add "Rounding-off questions (optional):" with one or two short questions.',
      'Part 3 (title "Part 3"): two sub-topics thematically linked to Part 2, each introduced by a line like "Let\'s consider first …" and carrying 3-4 questions, moving from the personal to the general and abstract: ask the speaker to compare, evaluate, explain causes, justify a view or speculate about the future, so that a strong speaker can show complex language, opinion and argument. The questions need no specialist knowledge and no world experience a 17-year-old lacks. In each sub-topic mark one question "(easier)", conceptually simpler for a weaker speaker, and one "(challenging)".',
      'Topics are accessible and of interest to a wide international candidature of any age, gender or background: no religion, politics, distressing subjects (death, divorce, illness), stereotypes (sexist or racist framings, cultural clichés, "are boys better at …?"), nothing that presupposes a lifestyle or means (owning a car, boating, museums, travel abroad, television), nothing culture-bound to one country, and nothing that needs business, economics or international-relations knowledge.',
      `Give a natural model answer for each part as "sample", at about band ${o.band.toFixed(1)}, answering the question asked (never a rehearsed speech) with the features of that band.`,
      "",
      'JSON shape: {"title": string, "passages": [{"title": "Part 1" | "Part 2" | "Part 3", "body": string, "sample": string, "groups": []}]}',
    ].join("\n"),
  };
}

const wordsOf = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
/** Lines that ask a question, a trailing mark like "(easier)" allowed. */
const askedLines = (s: string | undefined) => (s ?? "").split("\n").filter((l) => /\?\s*(\([^)]*\))?\s*$/.test(l.trim())).length;
const bulletLines = (s: string | undefined) => (s ?? "").split("\n").filter((l) => /^\s*[-•*–]\s+\S/.test(l)).length;
const bodyOf = (p: ImportPassage) => passageText({ title: "", kind: "writing", module: "academic", passages: [p] });
const partTitled = (t: ImportTest, re: RegExp) => t.passages.find((p) => re.test(p.title ?? ""));

/**
 * What a Writing or Speaking draft must carry, checked mechanically after the prompt asked for it: the tasks or parts
 * asked for, the fixed rubric lines, a figure for Academic Task 1, three bullet points for a letter, the question
 * counts of the Speaking frames, and model answers of a plausible length. One rewrite follows when anything is off.
 */
export function taskProblems(t: ImportTest, o: GenOptions): Problem[] {
  const out: Problem[] = [];
  const problem = (kind: Problem["kind"], en: string, ko: string) => out.push({ kind, en, ko });
  if (t.kind === "writing") {
    const gt = o.module === "general";
    for (const task of o.writingTasks) {
      const n = task === "task1" ? 1 : 2;
      const p = partTitled(t, new RegExp(`^Task\\s*${n}\\b`, "i"));
      if (!p) {
        problem("count", `Task ${n} is missing; the set must contain it, titled "Task ${n}"`, `Task ${n}이(가) 없습니다`);
        continue;
      }
      const body = bodyOf(p);
      const min = n === 1 ? 150 : 250;
      if (!new RegExp(`at least ${min} words`, "i").test(body))
        problem("format", `Task ${n}'s rubric must end with "Write at least ${min} words."`, `Task ${n} 지시문에 "Write at least ${min} words."가 없습니다`);
      if (n === 1 && !gt && !p.paragraphs?.some((x) => x.image))
        problem("format", "Academic Task 1 must carry a \"chart\" object for the figure", "Academic Task 1에 그래프 데이터(chart)가 없습니다");
      if (n === 1 && gt && bulletLines(body) < 3)
        problem("format", "the letter task must list three bullet points, each on its own line starting with \"-\"", "편지 과제의 요구 사항 3개가 글머리표로 나뉘어 있지 않습니다");
      if (n === 2 && !/give reasons for your answer/i.test(body))
        problem("format", 'Task 2 must carry the line "Give reasons for your answer and include any relevant examples from your own knowledge or experience."', "Task 2 지시문에 \"Give reasons for your answer…\" 줄이 없습니다");
      const w = wordsOf(p.sample);
      const [lo, hi] = n === 1 ? [140, 280] : [230, 420];
      if (w < lo || w > hi)
        problem("sample", `Task ${n}'s model answer has ${w} words; write ${n === 1 ? "170-200" : "270-320"}`, `Task ${n} 모범 답안이 ${w}단어로 기준(${n === 1 ? "170-200" : "270-320"})을 벗어납니다`);
    }
  }
  if (t.kind === "speaking") {
    for (const n of [1, 2, 3]) {
      const p = partTitled(t, new RegExp(`^Part\\s*${n}\\b`, "i"));
      if (!p) {
        problem("count", `Part ${n} is missing; the set must contain Parts 1, 2 and 3`, `Part ${n}이(가) 없습니다`);
        continue;
      }
      const body = bodyOf(p);
      if (n === 1) {
        const q = askedLines(body);
        if (q < 9) problem("count", `Part 1 has ${q} questions; three frames of 3-4 questions each are required, one question per line`, `Part 1 질문이 ${q}개로 기준(3틀 × 3-4개)보다 적습니다`);
        if (!/follow-up/i.test(body)) problem("format", 'each Part 1 frame ends with a "Follow-up: …" line for the examiner', "Part 1 틀마다 \"Follow-up:\" 줄이 없습니다");
      }
      if (n === 2) {
        if (!/^\s*Describe\b/im.test(body) || !/you should say/i.test(body) || !/and explain/i.test(body))
          problem("format", 'the Part 2 card must read "Describe …", then "You should say:" with its prompts, then "and explain …"', "Part 2 카드가 Describe / You should say: / and explain 형식이 아닙니다");
        if (!/one to two minutes/i.test(body))
          problem("format", 'the Part 2 card ends with "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say."', "Part 2 카드에 발화 시간 안내 문장이 없습니다");
      }
      if (n === 3) {
        const q = askedLines(body);
        if (q < 6) problem("count", `Part 3 has ${q} questions; two sub-topics of 3-4 questions each are required`, `Part 3 질문이 ${q}개로 기준(2주제 × 3-4개)보다 적습니다`);
        if (!/\(easier\)/i.test(body) || !/\(challenging\)/i.test(body))
          problem("format", 'mark one question "(easier)" and one "(challenging)" in each Part 3 sub-topic', "Part 3에 (easier)·(challenging) 표시가 없습니다");
      }
      if (wordsOf(p.sample) < 40)
        problem("sample", `Part ${n} needs a model answer ("sample") of natural length`, `Part ${n} 모범 답안이 없거나 너무 짧습니다`);
    }
  }
  return out;
}

/* ---------- Listening ---------- */

/**
 * What each part is, with the fewest words its script may have. The word ranges are the IELTS Item Writer
 * Guidelines' as quoted in Field (2023:86): Part 1 650-750, Part 2 700-850, Part 3 800-950, Part 4 750-850; the
 * listening focus of each part is the guidelines' wording (Field 2023:64, 121); a recording runs about 41 seconds
 * a question (Field 2023:8). See docs/listening-field-2023.md.
 */
const PART_SPECS: Record<number, { text: string; minWords: number }> = {
  1: {
    minWords: 600,
    text: 'Part 1: a conversation between two people in an everyday social context away from any college or university (a booking, an enquiry, a registration, travel arrangements), 650-750 words. Listening focus: main idea and detail. Exactly 10 form, note or table completion questions (type "fill", instructions "Write ONE WORD AND/OR A NUMBER for each answer."): names, numbers, dates, prices, places, common everyday words. Question 1 is the easiest, usually a name that is spelled out.',
  },
  2: {
    minWords: 650,
    text: 'Part 2: a monologue in an everyday social context away from any college or university (a guide introducing a facility, a local announcement, a talk to new members), 700-850 words, one speaker. Listening focus: detail and stated opinion. Exactly 10 questions in at most two formats, each used for at least 3 items: multiple choice (type "mcq", three short options A-C), matching (type "matching"), or flow-chart or note completion (type "fill"). One multiple-choice item may be a "Choose TWO letters, A-E" or "Choose THREE letters, A-F" item: write it as two (or three) consecutive questions with the same prompt and the same answer list of the two (or three) correct letters, with no "options" of their own; the five (or six) options go in the group\'s "options" list.',
  },
  3: {
    minWords: 700,
    text: 'Part 3: a conversation between two people in an educational context (two students discussing a project or a lecture they attended, or a tutor and a student), 800-950 words, in which ideas are developed and opinions exchanged, meaning is negotiated between the speakers, the two hold different views on at least two points, and the talk is not purely factual. Listening focus: opinion, attitude and feeling, directly stated or implied; relationships between ideas; agreement and disagreement between the speakers. Exactly 10 questions in at most two formats, each used for at least 3 items: multiple choice (type "mcq", three short options A-C), matching (type "matching"), or sentence or flow-chart completion (type "fill"); a "Choose TWO or THREE letters" item is allowed as in Part 2.',
  },
  4: {
    minWords: 700,
    text: 'Part 4: a university lecture, one speaker, 750-850 words (a real lecture part runs about five minutes; count the words), on a neutral, self-contained topic that no discipline\'s students already know, with at most a few technical terms, each explained when first said. Vary the kind of argument from one set to the next: not only exposition but weighing evidence for and against, arguing one viewpoint, describing a process, or evaluating something. Listening focus: main idea, detail and stated opinion. Exactly 10 note completion questions (type "fill", instructions "Write ONE WORD ONLY for each answer.") laid out as an outline of the lecture with headings, where some gaps are the main point of a section rather than a detail.',
  },
};

const LECTURE_MAX_GRADE = 12;
const LECTURE_MAX_LONG = 0.3;
/** Spoken-register ceilings per part: a talk or a seminar may be a little denser than a lecture is allowed to be, never prose. */
const REGISTER_LIMITS: Record<number, { grade: number; long: number }> = {
  2: { grade: 13, long: 0.32 },
  3: { grade: 13, long: 0.32 },
  4: { grade: LECTURE_MAX_GRADE, long: LECTURE_MAX_LONG },
};
/** Rewrite rounds for the parts that fall short; lectures tend to come back as written prose the first time. */
const LISTENING_REWRITES = 2;
const SPOKEN_EXAMPLE =
  'Write the lecture as it would be spoken, not as an article. Not: "In today\'s session we are going to examine the growing phenomenon of urban apiculture from an ecological standpoint." But: "So today I want to look at what actually happens, ecologically, when people start keeping bees in cities … and there are a lot more of them than you might think." Short utterances, everyday words, one idea at a time, a pause marked with a dash or an ellipsis where the speaker gathers the next thought.';

const transcriptText = (p: ImportPassage) =>
  (p.body ?? "").replace(/^[^:\n]{1,40}:\s*/gm, "");

/** Per part: script length, question count and, for a lecture, spoken-register density. */
export function listeningProblems(t: ImportTest, parts: number[]): Problem[][] {
  return t.passages.map((p, i) => {
    const part = parts[i] ?? i + 1;
    const spec = PART_SPECS[part] ?? PART_SPECS[1];
    const r = readability(transcriptText(p));
    const n = p.groups.reduce((m, g) => m + g.questions.length, 0);
    const out: Problem[] = [];
    if (r.words < spec.minWords)
      out.push({
        kind: "length",
        en: `Part ${part}'s script has ${r.words} words; at least ${spec.minWords} are required`,
        ko: `Part ${part} 대본이 ${r.words}단어로 기준(${spec.minWords}단어 이상)보다 짧습니다`,
      });
    if (n !== 10)
      out.push({
        kind: "count",
        en: `Part ${part} has ${n} questions; exactly 10 are required`,
        ko: `Part ${part} 문항이 ${n}개로 기준(10개)과 다릅니다`,
      });
    const allowed = LISTENING_FORMATS[part] ?? ["fill", "mcq", "matching"];
    const used = [...new Set(p.groups.map((g) => g.type))];
    const bad = used.filter((ty) => !allowed.includes(ty));
    if (bad.length)
      out.push({
        kind: "types",
        en: `Part ${part} uses ${bad.join(", ")} items; this part takes only ${allowed.join(", ")}`,
        ko: `Part ${part}에 허용되지 않는 문항 유형(${bad.join(", ")})이 있습니다`,
      });
    if (used.length > 2)
      out.push({
        kind: "types",
        en: `Part ${part} uses ${used.length} formats (${used.join(", ")}); at most two per part`,
        ko: `Part ${part}의 문항 유형이 ${used.length}가지로 기준(2가지 이하)을 넘습니다`,
      });
    const thin = used.filter(
      (ty) =>
        p.groups
          .filter((g) => g.type === ty)
          .reduce((m, g) => m + g.questions.length, 0) < 3,
    );
    if (used.length > 1 && thin.length)
      out.push({
        kind: "types",
        en: `Part ${part}: the ${thin.join(", ")} format has fewer than 3 items; each format used carries at least 3`,
        ko: `Part ${part}: 유형(${thin.join(", ")})의 문항이 3개 미만입니다`,
      });
    const limit = REGISTER_LIMITS[part];
    if (limit && (r.fk > limit.grade || r.longShare > limit.long))
      out.push({
        kind: "register",
        en: `Part ${part} reads like a written article (Flesch-Kincaid grade ${r.fk.toFixed(1)}, ${Math.round(r.longShare * 100)}% long words); a speaker needs grade ${limit.grade} or lower and at most ${Math.round(limit.long * 100)}% long words`,
        ko: `Part ${part} 대본이 글말에 가깝습니다(읽기 난도 ${r.fk.toFixed(1)}, 긴 단어 ${Math.round(r.longShare * 100)}%)`,
      });
    out.push(...answerSpacing(p, part));
    return out;
  });
}

const OPENING_WORDS = 40;

/**
 * Where the gap answers are heard: not in the opening (listeners are still settling to the voices, Field 2023:96)
 * and never two in one turn (keys need spacing, Field 2023:116-117). Answers not found verbatim are left to checkAnswers.
 */
function answerSpacing(p: ImportPassage, part: number): Problem[] {
  const body = (p.body ?? "").toLowerCase();
  const turnAt = (i: number) => body.slice(0, i).split(/\n\s*\n/).length;
  const wordsBefore = (i: number) =>
    (body.slice(0, i).match(WORD_RE) ?? []).length;
  const hits: { number: number; at: number }[] = [];
  // Answers come in script order, so each is looked for after the previous one: a short answer such as "4" or
  // "May" would otherwise match an earlier, unrelated mention.
  let from = 0;
  for (const g of p.groups) {
    if (g.type !== "fill" && g.type !== "short") continue;
    for (const q of g.questions) {
      const a = q.answer[0]
        ? normalizeText(q.answer[0])
            .replace(/\([^)]*\)/g, "")
            .trim()
        : "";
      const at = a ? body.indexOf(a, from) : -1;
      if (at >= 0) {
        hits.push({ number: q.number, at });
        from = at + a.length;
      }
    }
  }
  const out: Problem[] = [];
  const first = hits.slice().sort((x, y) => x.at - y.at)[0];
  if (first && wordsBefore(first.at) < OPENING_WORDS)
    out.push({
      kind: "spacing",
      en: `Part ${part}: the answer to question ${first.number} is heard within the first ${OPENING_WORDS} words; the opening must carry no answer, so listeners can settle to the voices`,
      ko: `Part ${part}: ${first.number}번 정답이 대본 첫 ${OPENING_WORDS}단어 안에 나옵니다`,
    });
  const byTurn = new Map<number, number[]>();
  for (const h of hits)
    byTurn.set(turnAt(h.at), [...(byTurn.get(turnAt(h.at)) ?? []), h.number]);
  for (const nums of byTurn.values())
    if (nums.length > 1)
      out.push({
        kind: "spacing",
        en: `Part ${part}: questions ${nums.join(" and ")} are answered in the same turn; space the answers through the script`,
        ko: `Part ${part}: ${nums.join("·")}번 정답이 같은 발화에 몰려 있습니다`,
      });
  return out;
}

export function listeningPrompt(o: GenOptions): {
  system: string;
  prompt: string;
} {
  const parts = (o.parts.length ? o.parts : [1]).slice().sort();
  return {
    system: `You write original IELTS Listening practice material: recording scripts with questions.
Write everything yourself; do not reproduce any published IELTS test. Reply with a single JSON object and nothing else.`,
    prompt: [
      `Write ${parts.length === 1 ? "one Listening part" : `${parts.length} Listening parts`} (${parts.map((p) => `Part ${p}`).join(", ")}). Theme for the conversations and talks: ${o.topic}.`,
      difficultyGuide(o.band, "listening", parts.map((p) => ({ position: p, total: 10 }))),
      ...parts.map((p) => `- ${PART_SPECS[p].text}`),
      "Length and count are enforced by the app: a part under its minimum length or without exactly 10 questions is sent back, so count both before replying.",
      "",
      'Register: every part is spoken English, never a written text read aloud. Parts 1-3 use everyday conversational language. Part 4 is a lecturer talking to students the way real lecturers do: utterances of 8-20 words, first and second person ("Today I want to show you …"), some informal touches, casual signposting ("remember that …", "bear in mind", "so, moving on", "the thing is") rather than textbook markers ("The key point I want to stress is …"), terms explained in passing ("what we call …", "that is, …"), one new point at a time followed by an example or a restatement, never several facts packed into one sentence, no abstract nominalisation ("when they put it in place", not "the implementation of"), at most one word in four of seven or more letters (Flesch-Kincaid grade 11 or below). Put a dash or an ellipsis where the speaker would pause to plan, so the speech model pauses; the lecture is delivered at a measured pace, with shorter utterances than the conversations.',
      "",
      "Script rules (the scripts are read by a speech model, so these matter):",
      '- At most TWO speakers per part (a limit of the speech model; the real test allows up to four in Part 3). A third person in the scene is reported by one of the two ("She says the room is booked"), never given lines.',
      "- In a conversation the speakers strictly alternate; never two turns in a row by the same speaker; one speaker is female and the other male, so the voices are told apart. A monologue is one speaker, split into several turns of 2-4 sentences.",
      "- Sound natural: some fillers (um, well, right, you know), a few short reactions of 1-3 words mixed with longer turns.",
      '- When a name is spelled, say the name first and then spell it with hyphens: "It\'s Hartley. H-A-R-T-L-E-Y."',
      "- Plain ASCII, straight quotes, no stage directions, no speaker names inside the text, no sound effects.",
      "",
      "Questions:",
      "- 10 questions per part, numbered continuously across parts (Part 1: 1-10, next part 11-20, …), in the order the answers are heard and spaced evenly through the script, about one every 60-80 words (roughly 40 seconds of speech): the first answer comes only after the opening 40-60 words, and no two answers fall in the same turn.",
      "- Stems and options paraphrase the recording: apart from the gap word itself, no phrase of the script is repeated in an item, so a candidate cannot find the answer by listening out for the item's words. No key depends on understanding a low-frequency word.",
      "- In Parts 2, 3 and 4 at least 3 of the 10 items ask for more than a single fact: a speaker's opinion or attitude, agreement or disagreement between speakers, the reason behind a point, the main point of a stretch of talk, or the link between two points; multiple choice and matching carry these. Part 1 stays factual.",
      '- Each group\'s instructions begin with a context sentence, e.g. "You will hear a telephone conversation between a customer and a travel agent.", then the task rubric.',
      '- Every answer is said clearly, once, and the speaker signposts it ("So that\'s …", "The main thing is …"). Only one option is correct.',
      '- Distractors are heard in the recording: a self-correction ("the 7th — no, sorry, the 14th"), an option that is mentioned and rejected, or a figure that is later updated. The key is always the final, confirmed detail. Use two or three such distractors per part.',
      "- Gap answers are common words, not technical terms, and the words before a gap do not give the answer away through grammar. Listening MCQ has three short, propositionally distinct options (A-C): the difficulty lies in the recording, not in reading the options; distractors are heard but ruled out, no two of them mean the same thing, and keys are spread across A, B and C.",
      ...ITEM_WRITING.slice(1, 3),
      '- In the script, write numbers, prices and dates with digits ("07792 411835", "£48", "the 14th of October"); the speech model reads them out. Write times in words ("half past seven").',
      '- A gap answer is a run of words copied exactly from the script, digits included: if the script says "the 14th of October", the answer is "14th of October" (or the prompt carries "October" and the answer is "14th"). If the script says "£48", the answer is "£48".',
      '- Write each gap in a prompt as "________", never as a number in brackets.',
      '- Each group has IELTS-style instructions beginning with its question range, e.g. "Questions 1-6".',
      "",
      "JSON shape:",
      `{"title": string, "passages": [{"title": "Part 1", "speakers": {"A": {"role": string, "gender": "female"|"male", "accent": "british"|"american"}}, "turns": [{"speaker": "A", "text": string}], "groups": [{"type": string, "instructions": string, "options": [{"key": string, "text": string}], "questions": [{"number": 1, "prompt": string, "options": [{"key": "A", "text": string}], "answer": [string]}]}]}]}`,
      'Speaker ids are "A" and "B". Omit "options" where a type does not use them.',
    ].join("\n"),
  };
}

/**
 * A part that is only too short (or has crowded answers) is extended, not rewritten: a fresh draft tends to come back
 * the same length, while added turns can be placed where they are needed.
 */
export function listeningExtendPrompt(
  o: GenOptions,
  part: number,
  passage: ImportPassage,
  script: ListeningScript,
  problems: Problem[],
): { system: string; prompt: string } {
  const spec = PART_SPECS[part] ?? PART_SPECS[1];
  const words = readability(transcriptText(passage)).words;
  const add = Math.max(80, spec.minWords - words + 60);
  const groups = passage.groups.map((g) => ({
    type: g.type,
    instructions: g.instructions,
    options: g.options,
    questions: g.questions,
  }));
  return {
    system: listeningPrompt(o).system,
    prompt: [
      `Part ${part} of a Listening set, as written, fell short of the app's checks:`,
      ...problems.map((p) => `- ${p.en}`),
      `Extend it rather than rewriting it. Keep every question, option and answer exactly as given, keep the existing turns and their order, and add about ${add} words of natural spoken content so the script reaches at least ${spec.minWords} words: a worked example, a clarifying exchange, a self-correction that serves as a distractor, a point restated in other words, a short aside. Spread the additions through the part as new turns or extensions of existing turns, so that no two answers end up in the same turn and the opening 40-60 words carry no answer. The speakers, their alternation and the script rules stay as they were.`,
      "Return the whole part again in the same JSON shape as before, with the full script and all questions:",
      `{"title": string, "passages": [{"title": "Part ${part}", "speakers": ${JSON.stringify(script.speakers)}, "turns": [{"speaker": "A", "text": string}], "groups": [...]}]}`,
      "",
      "<part>",
      JSON.stringify({
        title: passage.title,
        speakers: script.speakers,
        turns: script.turns,
        groups,
      }),
      "</part>",
    ].join("\n"),
  };
}

export interface ListeningScript {
  speakers: Record<string, SpeakerInfo>;
  turns: SynthTurn[];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Splits the model's parts into the importable test (transcript as body) and the scripts to synthesize. */
export function splitListening(raw: unknown): {
  importable: unknown;
  scripts: ListeningScript[];
} {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const parts = Array.isArray(obj.passages)
    ? (obj.passages as Record<string, unknown>[])
    : [];
  const scripts: ListeningScript[] = [];
  const passages = parts.map((p, i) => {
    const turns = (Array.isArray(p.turns) ? p.turns : [])
      .filter(
        (t): t is { speaker: string; text: string } =>
          typeof t?.speaker === "string" &&
          typeof t?.text === "string" &&
          !!t.text.trim(),
      )
      .map((t) => ({ speaker: t.speaker.trim(), text: t.text.trim() }));
    if (!turns.length)
      throw new Error(
        `Part ${i + 1}의 대본이 비어 있습니다. 다시 만들어 주십시오.`,
      );
    const given = (
      typeof p.speakers === "object" && p.speakers ? p.speakers : {}
    ) as Record<string, Partial<SpeakerInfo>>;
    const speakers: Record<string, SpeakerInfo> = {};
    for (const id of new Set(turns.map((t) => t.speaker))) {
      const s = given[id] ?? {};
      speakers[id] = {
        role:
          typeof s.role === "string" && s.role.trim()
            ? s.role.trim()
            : `Speaker ${id}`,
        gender: s.gender === "male" ? "male" : "female",
        accent: s.accent === "american" ? "american" : "british",
      };
    }
    if (Object.keys(speakers).length > 2)
      throw new Error(
        `Part ${i + 1}에 화자가 셋 이상입니다. 다시 만들어 주십시오.`,
      );
    scripts.push({ speakers, turns });
    const body = turns
      .map((t) => `${capital(speakers[t.speaker].role)}: ${t.text}`)
      .join("\n\n");
    return {
      title: typeof p.title === "string" ? p.title : `Part ${i + 1}`,
      body,
      groups: p.groups,
    };
  });
  return { importable: { ...obj, passages }, scripts };
}

/* ---------- Charts (Academic Writing Task 1) ---------- */

/** Draws a spec and keeps it in the archive; returns the archive name. */
export async function renderChart(spec: ChartSpec): Promise<string> {
  const png = await svgToPng(chartSvg(spec));
  return invoke<string>("save_image", png);
}

/**
 * Replaces each passage's "chart" spec with a picture paragraph after the task text, so the figure shows inside the
 * task like an exam paper. `render` returns the archived picture's name.
 */
export async function attachCharts(
  raw: unknown,
  render: (spec: ChartSpec) => Promise<string> = renderChart,
): Promise<unknown> {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const passages = Array.isArray(obj.passages)
    ? (obj.passages as Record<string, unknown>[])
    : [];
  const out = [];
  for (const p of passages) {
    if (!p.chart) {
      out.push(p);
      continue;
    }
    const spec = validateChart(p.chart);
    const name = await render(spec);
    const text = typeof p.body === "string" ? p.body : "";
    const paras = text
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    // The figure goes after the sentence that introduces it ("The chart below shows …").
    const at =
      Math.max(
        0,
        paras.findIndex((t) => /below|shows?|gives?|illustrates?/i.test(t)) + 1,
      ) || paras.length;
    const paragraphs = [
      ...paras.slice(0, at).map((t) => ({ text: t })),
      { text: spec.title, image: name },
      ...paras.slice(at).map((t) => ({ text: t })),
    ];
    const rest = { ...p };
    delete rest.chart;
    out.push({ ...rest, paragraphs });
  }
  return { ...obj, passages: out };
}

/* ---------- Pipeline ---------- */

export type Step =
  "write" | "verify" | "review" | "check" | "topup" | "audio" | "done";

export interface GenResult {
  test: ImportTest;
  /** Reading and listening: what the self-review and the checks changed. */
  fixed: number;
  dropped: Dropped[];
  /** Listening: word timings per passage (JSON), in passage order. */
  timings: string[];
  /** Measured shortfalls that remained after one rewrite (length, density, question count), for the user. */
  notes: string[];
  /** Reading and listening: items written to make up the standard count after the checks, and kept. */
  added?: number;
  /** The request as it ran: a random topic resolved to the words the text was written on. */
  options?: GenOptions;
}

const MIN_READING_QUESTIONS = 8;
const countQuestions = (t: ImportTest) =>
  t.passages.reduce(
    (n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0),
    0,
  );

export async function generateSet(
  settings: AiSettings,
  o: GenOptions,
  onStep: (s: Step) => void = () => {},
  onAudio: (part: number, done: number, total: number) => void = () => {},
): Promise<GenResult> {
  const opts = {
    ...o,
    topic: o.topic.trim() || randomTopic(o.module, o.position, o.avoidTopics),
  };
  onStep("write");
  if (o.skill === "listening")
    return { ...(await generateListening(settings, opts, onStep, onAudio)), options: opts };
  if (o.skill !== "reading") {
    const { system, prompt } =
      o.skill === "writing" ? writingPrompt(opts) : speakingPrompt(opts);
    const draftOf = async (ask: string) => {
      const r = await complete(settings, system, ask);
      const raw =
        o.skill === "writing"
          ? await attachCharts(extractJson(r.text))
          : extractJson(r.text);
      return toTest(raw, opts, o.skill);
    };
    let test = await draftOf(prompt);
    let problems = taskProblems(test, opts);
    // One rewrite with the shortfalls listed; the draft with fewer problems goes on, a malformed one is ignored.
    if (problems.length) {
      try {
        const again = await draftOf(`${prompt}\n\n${rewriteNote(problems)}`);
        const againProblems = taskProblems(again, opts);
        if (againProblems.length <= problems.length) {
          test = again;
          problems = againProblems;
        }
      } catch {
        /* keep the first draft */
      }
    }
    onStep("done");
    return { test, fixed: 0, dropped: [], timings: [], notes: problems.map((p) => p.ko), options: opts };
  }

  const spec = readingSpec(opts.module, opts.position ?? 1);
  const askedTypes = opts.types.length ? opts.types : spec.types;
  const { system, prompt } = readingPrompt(opts);
  let draft = toTest(
    extractJson((await complete(settings, system, prompt)).text),
    opts,
    "reading",
  );
  let problems = readingProblems(draft, spec, askedTypes);
  // Up to two rewrites with the measurements and concrete levers; the better draft goes on, a malformed one is ignored.
  for (let round = 0; round < READING_REWRITES && problems.length; round++) {
    const levers = [
      problems.some((p) => p.kind === "easy") ? DENSIFY_NOTE : "",
      problems.some((p) => p.kind === "grade") ? SIMPLIFY_NOTE : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const again = toTest(
        extractJson(
          (
            await complete(
              settings,
              system,
              `${prompt}\n\n${rewriteNote(problems)}\n${levers}`,
            )
          ).text,
        ),
        opts,
        "reading",
      );
      const againProblems = readingProblems(again, spec, askedTypes);
      if (againProblems.length <= problems.length) {
        draft = again;
        problems = againProblems;
      }
    } catch {
      /* the earlier draft stands */
    }
  }

  onStep("verify");
  const disagreements = solverDisagreements(
    draft,
    parseSolver(
      (await complete(settings, SOLVER_SYSTEM, solverPrompt(draft))).text,
    ),
  );

  onStep("review");
  const review = await complete(
    settings,
    REVIEW_SYSTEM,
    reviewPrompt(draft, disagreements),
  );
  const reviewed = applyReview(draft, parseReview(review.text));
  const notes = [
    ...problems.map((p) => p.ko),
    ...parseReviewNotes(review.text).map((n) => `검수 의견(지문): ${n}`),
  ];

  onStep("check");
  const checked = checkAnswers(reviewed.test);
  const test = renumber(checked.test);
  if (countQuestions(test) < MIN_READING_QUESTIONS)
    throw new Error(
      "검수 후 남은 문항이 너무 적습니다. 다시 만들어 주십시오(다른 주제나 모델을 고르면 나아질 수 있습니다).",
    );
  const dropped = [...reviewed.dropped, ...checked.dropped];
  const topped = await topUp(settings, test, [spec.questions], dropped, onStep, { types: askedTypes });
  onStep("done");
  return {
    test: topped.test,
    fixed: reviewed.fixed + topped.fixed,
    dropped: [...dropped, ...topped.dropped],
    timings: [],
    notes: [...notes, ...topped.notes],
    added: topped.added,
    options: opts,
  };
}

const MIN_LISTENING_PER_PART = 6;

async function generateListening(
  settings: AiSettings,
  o: GenOptions,
  onStep: (s: Step) => void,
  onAudio: (part: number, done: number, total: number) => void,
): Promise<GenResult> {
  const parts = (o.parts.length ? o.parts : [1]).slice().sort();
  const { system, prompt } = listeningPrompt(o);
  const first = splitListening(
    extractJson((await complete(settings, system, prompt)).text),
  );
  let draft = toTest(first.importable, o, "listening");
  const scripts = first.scripts;
  const problems = listeningProblems(draft, parts);
  // Parts that fell short are mended (up to twice) and spliced in; renumbering restores 1-40. A part that is only
  // short or has crowded answers is extended in place; one with the wrong question count or a written-prose lecture
  // is written again.
  const needsRewrite = (ps: Problem[]) =>
    ps.some(
      (p) => p.kind === "count" || p.kind === "register" || p.kind === "types",
    );
  for (
    let round = 0;
    round < LISTENING_REWRITES && problems.some((p) => p.length);
    round++
  ) {
    const failing = parts.filter((_, i) => problems[i].length);
    const toRewrite = failing.filter((part) =>
      needsRewrite(problems[parts.indexOf(part)]),
    );
    const toExtend = failing.filter((part) => !toRewrite.includes(part));
    const passages = draft.passages.slice();
    const accept = (
      part: number,
      passage: ImportPassage | undefined,
      script: ListeningScript | undefined,
    ) => {
      const i = parts.indexOf(part);
      if (!passage || !script) return;
      const fresh = listeningProblems({ ...draft, passages: [passage] }, [
        part,
      ])[0];
      if (fresh.length <= problems[i].length) {
        passages[i] = passage;
        scripts[i] = script;
        problems[i] = fresh;
      }
    };
    if (toRewrite.length) {
      const again = listeningPrompt({ ...o, parts: toRewrite });
      const register = toRewrite.some((part) =>
        problems[parts.indexOf(part)].some((p) => p.kind === "register"),
      );
      const note = `${rewriteNote(toRewrite.flatMap((part) => problems[parts.indexOf(part)]))}\n${register ? SPOKEN_EXAMPLE : ""}`;
      try {
        const second = splitListening(
          extractJson(
            (
              await complete(
                settings,
                again.system,
                `${again.prompt}\n\n${note}`,
              )
            ).text,
          ),
        );
        const redo = toTest(second.importable, o, "listening");
        toRewrite.forEach((part, k) =>
          accept(part, redo.passages[k], second.scripts[k]),
        );
      } catch {
        /* a malformed rewrite is ignored; the earlier draft stands */
      }
    }
    await Promise.all(
      toExtend.map(async (part) => {
        const i = parts.indexOf(part);
        const ext = listeningExtendPrompt(
          o,
          part,
          draft.passages[i],
          scripts[i],
          problems[i],
        );
        try {
          const second = splitListening(
            extractJson(
              (await complete(settings, ext.system, ext.prompt)).text,
            ),
          );
          const redo = toTest(second.importable, o, "listening");
          accept(part, redo.passages[0], second.scripts[0]);
        } catch {
          /* a malformed extension is ignored */
        }
      }),
    );
    draft = renumber({ ...draft, passages });
  }
  const notes = problems.flat().map((p) => p.ko);

  onStep("verify");
  const disagreements = solverDisagreements(
    draft,
    parseSolver(
      (await complete(settings, SOLVER_SYSTEM, solverPrompt(draft))).text,
    ),
  );

  onStep("review");
  const reviewed = applyReview(
    draft,
    parseReview(
      (
        await complete(
          settings,
          REVIEW_SYSTEM,
          reviewPrompt(draft, disagreements),
        )
      ).text,
    ),
  );
  onStep("check");
  const checked = checkAnswers(reviewed.test);
  const afterChecks = renumber(checked.test);
  afterChecks.passages.forEach((p, i) => {
    const n = p.groups.reduce((m, g) => m + g.questions.length, 0);
    if (n < MIN_LISTENING_PER_PART)
      throw new Error(
        `검수 후 Part ${i + 1}의 문항이 너무 적습니다. 다시 만들어 주십시오.`,
      );
  });
  const dropped = [...reviewed.dropped, ...checked.dropped];
  const topped = await topUp(
    settings,
    afterChecks,
    parts.map(() => 10),
    dropped,
    onStep,
  );
  const test = topped.test;

  onStep("audio");
  const timings: string[] = [];
  const passages: ImportPassage[] = [];
  for (const [i, p] of test.passages.entries()) {
    const script = scripts[i];
    const audio = await geminiSynthesize(
      settings.ttsModel,
      script.turns,
      assignGeminiVoices(script.speakers),
    );
    onAudio(i, 1, 1);
    passages.push({ ...p, audio: audio.name });
    timings.push(audio.words);
  }
  onStep("done");
  return {
    test: { ...test, passages },
    fixed: reviewed.fixed + topped.fixed,
    dropped: [...dropped, ...topped.dropped],
    timings,
    notes: [...notes, ...topped.notes],
    added: topped.added,
  };
}
