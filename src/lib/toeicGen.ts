// Writes original TOEIC Listening and Reading practice with the CLI the learner is signed in to, then checks it so
// that no human review is needed: measure against the real part sizes and the item-writing rules (including option
// give-aways) → rewrite once if they miss → an independent checker (a fresh conversation with the same CLI, so no
// other CLI is ever called) proofreads the language and the internal facts of every script and text → the checker
// solves blind with the key hidden (listening items from their scripts), flagging items it finds ambiguous → the
// editor keeps, rekeys or drops each item the checker answered differently or flagged → dropped items are written
// once more and checked again → keys spread over the letters → photos (Part 1) and speech (Parts 1–4) with Gemini →
// a Listening test (1–100) and a Reading test (101–200), stored with the verification record.
import { invoke } from "@tauri-apps/api/core";
import { CANCELLED, complete, providerLabel, type AiSettings } from "./ai";
import { extractJson } from "./json";
import { guidelinesForPrompt, optionProblems } from "./itemGuidelines";
import { BLUEPRINT, specForPrompt, TARGET_TEXT, type Target, type ToeicPart } from "./toeicSpec";
import { assignGeminiVoices, geminiSynthesize, type SpeakerInfo, type SynthTurn } from "./tts";
import type { ImportGroup, ImportPassage, ImportTest } from "./types";

/** One writer call; the parts it covers. */
export type ToeicUnit = "p12" | "p3" | "p4" | "p56" | "p7s" | "p7m";
export const UNIT_PARTS: Record<ToeicUnit, ToeicPart[]> = { p12: [1, 2], p3: [3], p4: [4], p56: [5, 6], p7s: [7], p7m: [7] };
export const UNIT_LABEL: Record<ToeicUnit, string> = {
  p12: "Part 1–2",
  p3: "Part 3",
  p4: "Part 4",
  p56: "Part 5–6",
  p7s: "Part 7 단일 지문",
  p7m: "Part 7 복수 지문",
};
const ORDER: ToeicUnit[] = ["p12", "p3", "p4", "p56", "p7s", "p7m"];

export interface ToeicGenOptions {
  units: ToeicUnit[];
  target: Target;
  topics: string;
  references?: string;
  /** Gemini speech for Parts 1–4. */
  speech: boolean;
  /** Gemini photographs for Part 1. */
  images: boolean;
  /** Lines from the official-site brief (trendSection), appended to every writer prompt. */
  trend?: string[];
}

export type ToeicStep = "write" | "check" | "rewrite" | "proof" | "solve" | "fix" | "refill" | "media" | "done";

export interface ToeicGenReport {
  unit: ToeicUnit;
  /** CLI that wrote and CLI that checked: always the same one now, so `cross` is false (sets made before were
   *  checked by another signed-in CLI and keep `cross: true` in their records). */
  writer: string;
  checker: string;
  cross: boolean;
  /** Items checked, and how many the blind checker answered as keyed. */
  total: number;
  agreed: number;
  /** Item ids the checker flagged as ambiguous even where it agreed. */
  flagged: string[];
  /** Language or consistency faults the proofreader found (and the writer then fixed). */
  proofed: number;
  rekeyed: number;
  /** Item ids dropped and successfully rewritten. */
  refilled: string[];
  /** Item ids left out of the test (a Part 6 text leaves with all its blanks). */
  dropped: string[];
  notes: string[];
}

/** Item ids as the learner reads them: 사진 1, 질의응답 3, 대화 2-1, 담화 4-3, 단문 7, 장문 1-(2), 지문 3-2. */
export function itemName(id: string): string {
  const m = /^([PQCTSXR])(\d+)(?:\.(\d+))?$/.exec(id);
  if (!m) return id;
  const [, k, a, b] = m;
  const name = { P: "사진", Q: "질의응답", C: "대화", T: "담화", S: "단문", X: "장문", R: "지문" }[k as "P"];
  return b ? `${name} ${a}-${k === "X" ? `(${b})` : b}` : `${name} ${a}`;
}

/** One line of the record, for the result panel and the stored meta. */
export const reportLine = (r: ToeicGenReport): string =>
  [
    `일치 ${r.agreed}/${r.total}`,
    r.flagged.length ? `애매 표시 ${r.flagged.length}` : "",
    r.proofed ? `교정 ${r.proofed}` : "",
    r.rekeyed ? `정답 고침 ${r.rekeyed}` : "",
    r.refilled.length ? `다시 씀 ${r.refilled.map(itemName).join(", ")}` : "",
    r.dropped.length ? `제외 ${r.dropped.map(itemName).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

/* ---------- Raw shapes ---------- */

export interface RawMcq {
  prompt: string;
  options: string[];
  answer: string;
}
interface RawSpeaker {
  role: string;
  gender: "female" | "male";
}
export interface P12 {
  photos: { scene: string; statements: string[]; answer: string }[];
  qr: { question: string; responses: string[]; answer: string }[];
}
export interface P3 {
  sets: { title: string; speakers: Record<string, RawSpeaker>; turns: { speaker: string; text: string }[]; graphic: string; questions: RawMcq[] }[];
}
export interface P4 {
  sets: { title: string; genre: string; speaker: RawSpeaker; text: string; graphic: string; questions: RawMcq[] }[];
}
export interface P56 {
  part5: RawMcq[];
  part6: { title: string; genre: string; text: string; questions: RawMcq[] }[];
}
export interface P7 {
  sets: { title: string; texts: { genre: string; text: string }[]; questions: RawMcq[] }[];
}
type Draft = { p12: P12; p3: P3; p4: P4; p56: P56; p7s: P7; p7m: P7 };

/* ---------- Prompts ---------- */

export const WRITER_SYSTEM = [
  "You are a senior TOEIC Listening and Reading item writer. You write original practice items that match the real test's parts, lengths, vocabulary and difficulty, and you follow fairness and item-writing guidelines strictly.",
  "Every text, script and question is your own new writing: never copy or paraphrase ETS material or any reference text you are shown.",
  "Use standard North American business English. Reply with one JSON object only, no Markdown fences and no commentary.",
].join(" ");

const MCQ = `{"prompt": string, "options": [string, string, string, string], "answer": "A"|"B"|"C"|"D"}`;
const B = BLUEPRINT;
const singles = B[7].singles;

const RULES: Record<ToeicUnit, string[]> = {
  p12: [
    `photos: exactly ${B[1].items}. "scene" describes one realistic photograph for an image generator: who and what is visible, actions, positions, setting, lighting; no text or logos in the picture. Mix people-focused scenes (one person, several people) and object or place scenes.`,
    'Each photo has exactly 4 short spoken "statements"; one describes the picture correctly, the others use a word for something visible with the wrong action, a similar-sounding word, a wrong location, or an action not happening (e.g. "being" passive for a state). "answer" is the letter.',
    `qr: exactly ${B[2].items} items. A spoken "question" (wh-questions, yes/no, tag, choice, request, suggestion, statement) and exactly 3 spoken "responses"; the right one may answer directly or indirectly. As on recent tests, at least 30% of the items (8 or more of 25) have an indirect or evasive right response: a counter-question, "I haven't heard yet.", "Let me check the schedule.", a redirect to someone else. Distractors repeat or echo a word from the question, answer a different wh-word, or mismatch tense. Spread the answer across A, B and C.`,
  ],
  p3: [
    `sets: exactly ${B[3].sets} conversations in workplaces and services (offices, stores, hotels, travel, events, hiring, repairs), 6-10 turns, about 100-140 words, with exactly ${B[3].perSet} questions each in this order: a gist question (topic, purpose, where, who), a detail question, and a next-action or inference question.`,
    "Use exactly two speakers in every conversation (one female, one male): the app's voice engine reads two voices.",
    `Exactly ${B[3].graphics} sets have a "graphic": a short table, schedule, price list, floor plan or chart written as plain text lines, and one of their questions starts "Look at the graphic." and needs both the graphic and the audio. Other sets have "graphic": "".`,
    "Include two \"What does the man/woman mean when he/she says, '...'?\" implied-meaning questions across the sets.",
  ],
  p4: [
    `sets: exactly ${B[4].sets} talks by one speaker, 80-130 words each, of varied genres (announcement, voicemail, advertisement, tour, meeting excerpt, news report, speech, broadcast), with exactly ${B[4].perSet} questions each (purpose or speaker, detail, next action or implied meaning).`,
    `Exactly ${B[4].graphics} talks have a "graphic" as plain text lines with one "Look at the graphic." question; others have "graphic": "".`,
  ],
  p56: [
    `part5: exactly ${B[5].items} sentences with the blank written as "-------"; about half grammar (part of speech, verb form and tense, pronoun, preposition, conjunction, comparative, relative clause) and half vocabulary (collocation, close meanings). Four options; for grammar items the options are forms of one word or one category.`,
    `part6: exactly ${B[6].texts} texts (email, memo, notice, article, advertisement, letter) of 100-150 words, each with ${B[6].perText} blanks written ---(1)--- to ---(4)--- in order. Each blank's question "prompt" is "(1)" etc.; one blank in every text takes a whole sentence (the four options are sentences, only one fits the logic of the text), the others take a word or phrase that depends on context beyond the sentence (tense, connector, pronoun reference).`,
  ],
  p7s: [
    `sets: exactly ${singles.length} single passages with ${singles.join(", ")} questions respectively. Genres: email, advertisement, notice, article, form or invoice, web page, text-message chain and online chat discussion (with times and names, and one "At 10:42 A.M., what does X mean when they write, '...'?" question), letter, memo. 50-250 words each; longer texts get more questions. "texts" holds one item.`,
    "Question types across the sets: main purpose, detail, NOT true (\"What is NOT mentioned...?\") at most twice, inference, vocabulary (\"The word 'X' in paragraph 1, line 2, is closest in meaning to\"), and one sentence-insertion question (\"In which of the positions marked [1], [2], [3], and [4] does the following sentence best belong?\") with the markers placed in that text.",
  ],
  p7m: [
    `sets: ${B[7].doubles} double-passage sets (2 related texts) and ${B[7].triples} triple-passage sets (3 related texts), each with exactly ${B[7].perMulti} questions; at least one question per set needs information from two texts together (e.g. an email and the schedule it refers to). 80-200 words per text.`,
  ],
};

const SHAPE: Record<ToeicUnit, string> = {
  p12: `{"photos": [{"scene": string, "statements": [string, string, string, string], "answer": "A"|"B"|"C"|"D"}], "qr": [{"question": string, "responses": [string, string, string], "answer": "A"|"B"|"C"}]}`,
  p3: `{"sets": [{"title": string, "speakers": {"A": {"role": string, "gender": "female"|"male"}, "B": {...}}, "turns": [{"speaker": "A", "text": string}], "graphic": string, "questions": [${MCQ}]}]}`,
  p4: `{"sets": [{"title": string, "genre": string, "speaker": {"role": string, "gender": "female"|"male"}, "text": string, "graphic": string, "questions": [${MCQ}]}]}`,
  p56: `{"part5": [${MCQ}], "part6": [{"title": string, "genre": string, "text": string, "questions": [${MCQ}]}]}`,
  p7s: `{"sets": [{"title": string, "texts": [{"genre": string, "text": string}], "questions": [${MCQ}]}]}`,
  p7m: `{"sets": [{"title": string, "texts": [{"genre": string, "text": string}], "questions": [${MCQ}]}]}`,
};

export function writerPrompt(unit: ToeicUnit, o: ToeicGenOptions, fix?: string[]): string {
  const parts = [
    `Write ${UNIT_LABEL[unit].replace(/단일 지문/, "single passages").replace(/복수 지문/, "multiple passages")} of one TOEIC Listening and Reading practice test.`,
    "",
    "# Real test format",
    specForPrompt(UNIT_PARTS[unit]),
    "",
    "# What to write",
    ...RULES[unit].map((r) => `- ${r}`),
    "",
    "# Difficulty",
    TARGET_TEXT[o.target],
    "",
    guidelinesForPrompt(),
  ];
  if (o.trend?.length) parts.push(...o.trend);
  if (o.topics.trim()) parts.push("", "# Preferred settings", o.topics.trim());
  if (o.references?.trim()) {
    parts.push(
      "",
      "# Reference material the learner owns",
      "Study it to match format, length, vocabulary level and question and distractor style. Do NOT copy or paraphrase any of it; every item must be new.",
      "<reference_material>",
      o.references.trim(),
      "</reference_material>",
    );
  }
  if (fix?.length) parts.push("", "# Your previous draft had these problems; fix them and write it all again", ...fix.map((f) => `- ${f}`));
  parts.push("", "# Reply format", SHAPE[unit]);
  return parts.join("\n");
}

/* ---------- Parse ---------- */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const mcq = (v: unknown): RawMcq => ({ prompt: str(obj(v).prompt), options: arr<string>(obj(v).options).map(str), answer: str(obj(v).answer).toUpperCase().slice(0, 1) });
const speaker = (v: unknown): RawSpeaker => ({ role: str(obj(v).role) || "Speaker", gender: obj(v).gender === "male" ? "male" : "female" });

export const PARSE: { [U in ToeicUnit]: (raw: unknown) => Draft[U] } = {
  p12: (raw) => ({
    photos: arr(obj(raw).photos).map((p) => ({ scene: str(obj(p).scene), statements: arr<string>(obj(p).statements).map(str), answer: str(obj(p).answer).toUpperCase().slice(0, 1) })),
    qr: arr(obj(raw).qr).map((q) => ({ question: str(obj(q).question), responses: arr<string>(obj(q).responses).map(str), answer: str(obj(q).answer).toUpperCase().slice(0, 1) })),
  }),
  p3: (raw) => ({
    sets: arr(obj(raw).sets).map((s) => {
      const speakers: Record<string, RawSpeaker> = {};
      for (const [k, v] of Object.entries(obj(obj(s).speakers))) speakers[k] = speaker(v);
      const turns = arr(obj(s).turns)
        .map((t) => ({ speaker: str(obj(t).speaker) || "A", text: str(obj(t).text) }))
        .filter((t) => t.text);
      for (const t of turns) speakers[t.speaker] ??= { role: `Speaker ${t.speaker}`, gender: "female" };
      return { title: str(obj(s).title), speakers, turns, graphic: str(obj(s).graphic), questions: arr(obj(s).questions).map(mcq) };
    }),
  }),
  p4: (raw) => ({
    sets: arr(obj(raw).sets).map((s) => ({
      title: str(obj(s).title),
      genre: str(obj(s).genre),
      speaker: speaker(obj(s).speaker),
      text: str(obj(s).text),
      graphic: str(obj(s).graphic),
      questions: arr(obj(s).questions).map(mcq),
    })),
  }),
  p56: (raw) => ({
    part5: arr(obj(raw).part5).map(mcq),
    part6: arr(obj(raw).part6).map((t) => ({ title: str(obj(t).title), genre: str(obj(t).genre), text: str(obj(t).text), questions: arr(obj(t).questions).map(mcq) })),
  }),
  p7s: (raw) => ({ sets: arr(obj(raw).sets).map(set7) }),
  p7m: (raw) => ({ sets: arr(obj(raw).sets).map(set7) }),
};

function set7(s: unknown): P7["sets"][number] {
  return {
    title: str(obj(s).title),
    texts: arr(obj(s).texts).map((t) => ({ genre: str(obj(t).genre), text: str(obj(t).text) })),
    questions: arr(obj(s).questions).map(mcq),
  };
}

/* ---------- Measure ---------- */

const LETTERS = ["A", "B", "C", "D"];
const words = (s: string) => (s.trim().match(/[A-Za-z0-9'’-]+/g) ?? []).length;

/** Give-aways a test-wise candidate uses without reading or listening: a key much longer than every distractor,
 *  and "all/none of the above" choices. */
export function cues(label: string, options: string[], answer: string): string[] {
  const out: string[] = [];
  const k = LETTERS.indexOf(answer);
  if (k >= 0 && k < options.length) {
    const len = options.map((x) => x.length);
    const others = len.filter((_, i) => i !== k);
    if (len[k] >= 12 && others.length && others.every((l) => len[k] > l * 1.5)) out.push(`${label}: the key is much longer than every distractor; balance the option lengths`);
  }
  if (options.some((x) => /\b(all|none) of the above\b|\bboth [a-d] and [a-d]\b/i.test(x))) out.push(`${label}: no "all/none of the above" options`);
  return out;
}

/** Format faults first; the give-aways only once the options are well formed (all/none is already a format fault). */
const optionCheck = (label: string, options: string[], answer: string, n = 4): string[] => {
  const faults = optionProblems(options, LETTERS.indexOf(answer), n).map((x) => `${label}: ${x}`);
  return faults.length ? faults : cues(label, options, answer);
};

function mcqProblems(label: string, qs: RawMcq[], n: number, options = 4): string[] {
  const out: string[] = [];
  if (qs.length !== n) out.push(`${label}: ${qs.length} questions (need ${n})`);
  qs.forEach((q, i) => {
    if (!q.prompt) out.push(`${label} Q${i + 1}: empty question`);
    out.push(...optionCheck(`${label} Q${i + 1}`, q.options, q.answer, options));
  });
  return out;
}
const count = (label: string, have: number, need: number) => (have === need ? [] : [`${label}: ${have} (need ${need})`]);

export const MEASURE: { [U in ToeicUnit]: (d: Draft[U]) => string[] } = {
  p12: (d) => [
    ...count("photos", d.photos.length, B[1].items),
    ...d.photos.flatMap((p, i) => [...(p.scene ? [] : [`photo ${i + 1}: no scene`]), ...optionCheck(`photo ${i + 1}`, p.statements, p.answer)]),
    ...count("qr", d.qr.length, B[2].items),
    ...d.qr.flatMap((q, i) => [...(q.question ? [] : [`qr ${i + 1}: no question`]), ...optionCheck(`qr ${i + 1}`, q.responses, q.answer, 3)]),
  ],
  p3: (d) => [
    ...count("conversations", d.sets.length, B[3].sets),
    ...count("conversations with a graphic", d.sets.filter((s) => s.graphic).length, B[3].graphics),
    ...d.sets.flatMap((s, i) => [
      ...(s.turns.length < 5 || s.turns.length > 12 ? [`conversation ${i + 1}: ${s.turns.length} turns (need 6-10)`] : []),
      ...(Object.keys(s.speakers).length > 2 ? [`conversation ${i + 1}: more than two speakers`] : []),
      ...mcqProblems(`conversation ${i + 1}`, s.questions, B[3].perSet),
    ]),
  ],
  p4: (d) => [
    ...count("talks", d.sets.length, B[4].sets),
    ...count("talks with a graphic", d.sets.filter((s) => s.graphic).length, B[4].graphics),
    ...d.sets.flatMap((s, i) => [
      ...(words(s.text) < 65 || words(s.text) > 150 ? [`talk ${i + 1}: ${words(s.text)} words (need 80-130)`] : []),
      ...mcqProblems(`talk ${i + 1}`, s.questions, B[4].perSet),
    ]),
  ],
  p56: (d) => [
    ...mcqProblems("part5", d.part5, B[5].items),
    ...d.part5.flatMap((q, i) => (q.prompt.includes("-------") ? [] : [`part5 Q${i + 1}: no ------- blank`])),
    ...count("part6 texts", d.part6.length, B[6].texts),
    ...d.part6.flatMap((t, i) => [
      ...mcqProblems(`part6 text ${i + 1}`, t.questions, B[6].perText),
      ...[1, 2, 3, 4].filter((k) => !t.text.includes(`---(${k})---`)).map((k) => `part6 text ${i + 1}: blank ---(${k})--- missing`),
    ]),
  ],
  p7s: (d) => [
    ...count("single passages", d.sets.length, singles.length),
    ...d.sets.flatMap((s, i) => [
      ...(s.texts.length !== 1 ? [`single ${i + 1}: ${s.texts.length} texts (need 1)`] : []),
      ...mcqProblems(`single ${i + 1}`, s.questions, singles[i] ?? s.questions.length),
    ]),
  ],
  p7m: (d) => {
    const sizes = d.sets.map((s) => s.texts.length);
    return [
      ...count("double-passage sets", sizes.filter((n) => n === 2).length, B[7].doubles),
      ...count("triple-passage sets", sizes.filter((n) => n === 3).length, B[7].triples),
      ...d.sets.flatMap((s, i) => mcqProblems(`multi ${i + 1}`, s.questions, B[7].perMulti)),
    ];
  },
};

/* ---------- Independent check: proofread, blind solve, editor, refill ---------- */

type Photo = P12["photos"][number];
type Qr = P12["qr"][number];
/** One checked item as it sits in a draft. */
type Slot = Photo | Qr | RawMcq;
type Kind = "photo" | "qr" | "mcq" | "blank";

export interface Keyed {
  id: string;
  kind: Kind;
  /** The script, passage or text the item stands on; photos and Part 2 items carry their own. */
  context: string;
  item: Slot;
}

const PHOTO_Q = "Which statement describes the photograph?";
const QR_Q = "Best response?";

const asMcq = (k: Keyed): RawMcq =>
  k.kind === "photo"
    ? { prompt: PHOTO_Q, options: (k.item as Photo).statements, answer: k.item.answer }
    : k.kind === "qr"
      ? { prompt: QR_Q, options: (k.item as Qr).responses, answer: k.item.answer }
      : (k.item as RawMcq);

const show = (context: string, q: RawMcq) => `${context}\n\nQ: ${q.prompt}\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n")}`;

/** The item as the checker reads it, key hidden. Listening items are read from their scripts. */
function view(k: Keyed): string {
  const q = asMcq(k);
  if (k.kind === "photo") return show(`Photograph: ${(k.item as Photo).scene}`, q);
  if (k.kind === "qr") return show(`Spoken: ${(k.item as Qr).question}`, q);
  if (k.kind === "blank") return show(k.context, { ...q, prompt: `Blank ${q.prompt}` });
  return show(k.context, q);
}

const script = (s: P3["sets"][number]) => s.turns.map((t) => `${s.speakers[t.speaker]?.role ?? t.speaker}: ${t.text}`).join("\n");
const withGraphic = (text: string, graphic: string) => `${text}${graphic ? `\nGraphic:\n${graphic}` : ""}`;

/** Every item of a draft with a stable id: P/Q (Part 1/2), C (Part 3), T (Part 4), S/X (Part 5/6), R (Part 7). */
export function slots(unit: ToeicUnit, d: Draft[ToeicUnit]): Keyed[] {
  switch (unit) {
    case "p12": {
      const x = d as P12;
      return [
        ...x.photos.map((p, i): Keyed => ({ id: `P${i + 1}`, kind: "photo", context: "", item: p })),
        ...x.qr.map((q, i): Keyed => ({ id: `Q${i + 1}`, kind: "qr", context: "", item: q })),
      ];
    }
    case "p3":
      return (d as P3).sets.flatMap((s, i) => s.questions.map((q, j): Keyed => ({ id: `C${i + 1}.${j + 1}`, kind: "mcq", context: withGraphic(script(s), s.graphic), item: q })));
    case "p4":
      return (d as P4).sets.flatMap((s, i) => s.questions.map((q, j): Keyed => ({ id: `T${i + 1}.${j + 1}`, kind: "mcq", context: withGraphic(s.text, s.graphic), item: q })));
    case "p56": {
      const x = d as P56;
      return [
        ...x.part5.map((q, i): Keyed => ({ id: `S${i + 1}`, kind: "mcq", context: "", item: q })),
        ...x.part6.flatMap((t, i) => t.questions.map((q, j): Keyed => ({ id: `X${i + 1}.${j + 1}`, kind: "blank", context: t.text, item: q }))),
      ];
    }
    default:
      return (d as P7).sets.flatMap((s, i) =>
        s.questions.map((q, j): Keyed => ({ id: `R${i + 1}.${j + 1}`, kind: "mcq", context: s.texts.map((t) => `[${t.genre}]\n${t.text}`).join("\n\n"), item: q })),
      );
  }
}

/** Maps every item of a draft in place: return the item (or a new one) to keep it, null to drop it. A Part 6 blank
 *  cannot be left out of its text, so a dropped blank takes the whole text with it. Returns the ids removed. */
function edit(unit: ToeicUnit, d: Draft[ToeicUnit], fn: (id: string, item: Slot) => Slot | null): string[] {
  const removed: string[] = [];
  const map = <T extends Slot>(xs: T[], id: (i: number) => string): T[] =>
    xs.flatMap((x, i) => {
      const r = fn(id(i), x);
      if (r === null) removed.push(id(i));
      return r === null ? [] : [r as T];
    });
  if (unit === "p12") {
    const x = d as P12;
    x.photos = map(x.photos, (i) => `P${i + 1}`);
    x.qr = map(x.qr, (i) => `Q${i + 1}`);
  } else if (unit === "p3" || unit === "p4") {
    const prefix = unit === "p3" ? "C" : "T";
    for (const [i, s] of (d as P3 | P4).sets.entries()) s.questions = map(s.questions, (j) => `${prefix}${i + 1}.${j + 1}`);
  } else if (unit === "p56") {
    const x = d as P56;
    x.part5 = map(x.part5, (i) => `S${i + 1}`);
    x.part6 = x.part6.filter((t, i) => {
      const next = t.questions.map((q, j) => fn(`X${i + 1}.${j + 1}`, q) as RawMcq | null);
      if (next.some((q) => q === null)) {
        removed.push(...t.questions.map((_, j) => `X${i + 1}.${j + 1}`));
        return false;
      }
      t.questions = next as RawMcq[];
      return true;
    });
  } else {
    for (const [i, s] of (d as P7).sets.entries()) s.questions = map(s.questions, (j) => `R${i + 1}.${j + 1}`);
  }
  return removed;
}

/** The id in the words the writer's draft uses (measure labels), for faults sent back to it. */
function writerLabel(unit: ToeicUnit, id: string): string {
  const m = /^([PQCTSXR])(\d+)(?:\.(\d+))?$/.exec(id);
  if (!m) return id;
  const [, k, a, b] = m;
  switch (k) {
    case "P":
      return `photo ${a}`;
    case "Q":
      return `qr ${a}`;
    case "C":
      return `conversation ${a} Q${b}`;
    case "T":
      return `talk ${a} Q${b}`;
    case "S":
      return `part5 Q${a}`;
    case "X":
      return `part6 text ${a} blank (${b})`;
    default:
      return `${unit === "p7s" ? "single" : "multi"} ${a} Q${b}`;
  }
}

export const SOLVER_SYSTEM =
  "You are a strong TOEIC test taker, sitting a test someone else wrote. Answer every item from the given text or script only. Reply with one JSON object only.";
export const FIX_SYSTEM =
  "You are the TOEIC item editor. For each item a blind solver answered differently from the key or flagged as ambiguous, decide whether the key is right. An item with two defensible answers, or none, must be dropped. Reply with one JSON object only.";
export const PROOF_SYSTEM =
  "You are the proofreader for a TOEIC Listening and Reading practice test. You report only real faults; fine style is not a fault, and the wrong options of a Part 5 or Part 6 blank are not faults. Reply with one JSON object only.";

export function solverPrompt(items: Keyed[]): string {
  return [
    'Answer each item with its letter. Also list under "unsure" every item where a second option is defensible or the text does not settle one answer.',
    "",
    ...items.map((i) => `### ${i.id}\n${view(i)}`),
    "",
    'Reply format: {"answers": {"<id>": "<letter>"}, "unsure": [ids]}',
  ].join("\n");
}

export function fixPrompt(items: Keyed[], solved: Record<string, string>, flagged: string[]): string {
  return [
    "For each item: keep it if the key is the only right answer; rekey it if another option is the only right answer; drop it if two answers are defensible or none is.",
    "",
    ...items.map((i) => `### ${i.id}\n${view(i)}\nKey: ${i.item.answer}\nSolver: ${solved[i.id] || "(no answer)"}${flagged.includes(i.id) ? " (flagged as ambiguous)" : ""}`),
    "",
    'Reply format: {"decisions": [{"id": string, "action": "keep"|"rekey"|"drop", "answer": string}]}',
  ].join("\n");
}

export function proofPrompt(items: Keyed[]): string {
  return [
    "List every real fault in these items: a grammar, spelling or usage error in a script, text, question or right answer; facts inside a script or passage that contradict each other, the graphic or the options; or wording that leaves the question unclear. An item without a fault is not listed.",
    "",
    ...items.map((i) => `### ${i.id}\n${view(i)}`),
    "",
    'Reply format: {"faults": [{"id": string, "fault": string}]}',
  ].join("\n");
}

type Verdict = { action: "keep" | "rekey" | "drop"; answer: string };

/** Which generation job a run belongs to (src/lib/toeicJob.ts) and the signal its cancel raises. */
export interface ToeicGenControl {
  job?: string;
  signal?: AbortSignal;
}

/** How a run calls the CLI: every call carries the job id, so cancelling the job ends the CLI it is waiting on, and
 *  no call starts (or is used) once the job is cancelled. */
interface Run {
  ask: (s: AiSettings, system: string, prompt: string) => Promise<string>;
  /** Throws the cancellation once the job is cancelled. */
  stop: () => void;
}

function runOf(c: ToeicGenControl): Run {
  const stop = () => {
    if (c.signal?.aborted) throw new Error(CANCELLED);
  };
  return {
    stop,
    ask: async (s, system, prompt) => {
      stop();
      const r = await complete(s, system, prompt, { job: c.job, signal: c.signal });
      stop();
      return r.text;
    },
  };
}

/** Blind solve, then the editor on every disagreement or flag. Every item gets a verdict. */
async function check(run: Run, checker: AiSettings, items: Keyed[], step: (s: ToeicStep) => void) {
  const verdicts = new Map<string, Verdict>(items.map((i) => [i.id, { action: "keep", answer: i.item.answer }]));
  if (!items.length) return { verdicts, flagged: [] as string[], agreed: 0 };
  step("solve");
  const raw = obj(extractJson(await run.ask(checker, SOLVER_SYSTEM, solverPrompt(items))));
  const solved = Object.fromEntries(Object.entries(obj(raw.answers)).map(([k, v]) => [k, str(v).toUpperCase().slice(0, 1)]));
  const flagged = arr(raw.unsure)
    .map((x) => str(typeof x === "number" ? String(x) : x))
    .filter((id) => items.some((i) => i.id === id));
  const off = new Set(items.filter((i) => solved[i.id] !== i.item.answer).map((i) => i.id));
  const agreed = items.length - off.size;
  const review = items.filter((i) => off.has(i.id) || flagged.includes(i.id));
  if (!review.length) return { verdicts, flagged, agreed };
  step("fix");
  const decided = new Map(
    arr(obj(extractJson(await run.ask(checker, FIX_SYSTEM, fixPrompt(review, solved, flagged)))).decisions).map((d) => [
      str(obj(d).id),
      { action: str(obj(d).action), answer: str(obj(d).answer).toUpperCase().slice(0, 1) },
    ]),
  );
  for (const i of review) {
    // A flagged item the editor confirms stands; a disagreement it did not rule on is not a defensible item.
    const d = decided.get(i.id) ?? { action: off.has(i.id) ? "drop" : "keep", answer: "" };
    const n = asMcq(i).options.length;
    if (d.action === "keep") continue;
    if (d.action === "rekey" && LETTERS.slice(0, n).includes(d.answer)) verdicts.set(i.id, { action: "rekey", answer: d.answer });
    else verdicts.set(i.id, { action: "drop", answer: "" });
  }
  return { verdicts, flagged, agreed };
}

/** The checker reads every script and text for language faults and internal contradictions; faults send the unit
 *  back to the writer once, and the rewrite stands if it meets the format at least as well. */
async function proofUnit<U extends ToeicUnit>(
  run: Run,
  writer: AiSettings,
  checker: AiSettings,
  unit: U,
  o: ToeicGenOptions,
  w: { draft: Draft[U]; notes: string[] },
  step: (s: ToeicStep) => void,
) {
  step("proof");
  const faults = arr(obj(extractJson(await run.ask(checker, PROOF_SYSTEM, proofPrompt(slots(unit, w.draft))))).faults)
    .map((f) => ({ id: str(obj(f).id), fault: str(obj(f).fault) }))
    .filter((f) => f.fault);
  if (!faults.length) return { ...w, proofed: 0 };
  try {
    const parse = PARSE[unit] as (r: unknown) => Draft[U];
    const measure = MEASURE[unit] as (d: Draft[U]) => string[];
    const again = parse(extractJson(await run.ask(writer, WRITER_SYSTEM, writerPrompt(unit, o, faults.map((f) => `${writerLabel(unit, f.id)}: ${f.fault}`)))));
    const notes = measure(again);
    if (notes.length <= w.notes.length) return { draft: again, notes, proofed: faults.length };
  } catch {
    run.stop();
    /* the draft stands; the blind solve still guards the keys */
  }
  return { ...w, proofed: faults.length };
}

/** Blind solve and editor over a whole unit: rekeys apply at once, drops are returned for the refill. */
async function verify(run: Run, checker: AiSettings, unit: ToeicUnit, draft: Draft[ToeicUnit], step: (s: ToeicStep) => void) {
  const items = slots(unit, draft);
  const { verdicts, flagged, agreed } = await check(run, checker, items, step);
  let rekeyed = 0;
  edit(unit, draft, (id, item) => {
    const v = verdicts.get(id);
    if (v?.action !== "rekey" || v.answer === item.answer) return item;
    rekeyed++;
    return { ...item, answer: v.answer };
  });
  const dropped = items.filter((i) => verdicts.get(i.id)?.action === "drop").map((i) => i.id);
  return { total: items.length, agreed, flagged, rekeyed, dropped };
}

const REFILL_SHAPE: Record<Kind, string> = {
  photo: `{"id": string, "scene": string, "statements": [string, string, string, string], "answer": "A"|"B"|"C"|"D"}`,
  qr: `{"id": string, "question": string, "responses": [string, string, string], "answer": "A"|"B"|"C"}`,
  mcq: `{"id": string, ${MCQ.slice(1)}`,
  blank: `{"id": string, ${MCQ.slice(1)}`,
};

export function refillPrompt(unit: ToeicUnit, items: Keyed[], o: ToeicGenOptions): string {
  const parts = [
    "The items below were dropped from a TOEIC practice test for having no single defensible answer. Write one stronger replacement for each id.",
    "- A Part 1 photograph: a new scene and four statements. A Part 2 item: a new question and three responses.",
    "- Any other item: keep its script, passage or text exactly as shown and write a new question on it with new options. For a Part 6 blank, keep the blank's place and its \"(n)\" prompt and write options that fit it.",
    "- The key must be the only defensible answer.",
    "",
    "# What these items follow",
    ...RULES[unit].map((r) => `- ${r}`),
    "",
    "# Difficulty",
    TARGET_TEXT[o.target],
    "",
    guidelinesForPrompt(),
  ];
  if (o.trend?.length) parts.push(...o.trend);
  parts.push("", "# Dropped items", ...items.map((i) => `### ${i.id}\n${view(i)}\nDropped key: ${i.item.answer}`));
  const kinds = [...new Set(items.map((i) => i.kind))];
  parts.push("", "# Reply format", `{"items": [${kinds.map((k) => REFILL_SHAPE[k]).join(" | ")}]}`);
  return parts.join("\n");
}

/** Dropped items are written once more and checked again; what fails twice stays out of the test. */
async function refill(
  run: Run,
  writer: AiSettings,
  checker: AiSettings,
  unit: ToeicUnit,
  o: ToeicGenOptions,
  draft: Draft[ToeicUnit],
  dropped: string[],
  step: (s: ToeicStep) => void,
): Promise<{ replaced: Map<string, Slot>; refilled: string[] }> {
  const replaced = new Map<string, Slot>();
  const old = slots(unit, draft).filter((i) => dropped.includes(i.id));
  if (!old.length) return { replaced, refilled: [] };
  step("refill");
  try {
    const raw = arr(obj(extractJson(await run.ask(writer, WRITER_SYSTEM, refillPrompt(unit, old, o)))).items);
    const fresh: Keyed[] = [];
    for (const r of raw) {
      const was = old.find((i) => i.id === str(obj(r).id));
      if (!was || fresh.some((f) => f.id === was.id)) continue;
      const answer = str(obj(r).answer).toUpperCase().slice(0, 1);
      let item: Slot;
      let faults: string[];
      if (was.kind === "photo") {
        const p: Photo = { scene: str(obj(r).scene), statements: arr<string>(obj(r).statements).map(str), answer };
        item = p;
        faults = [...(p.scene ? [] : ["no scene"]), ...optionCheck(was.id, p.statements, answer)];
      } else if (was.kind === "qr") {
        const q: Qr = { question: str(obj(r).question), responses: arr<string>(obj(r).responses).map(str), answer };
        item = q;
        faults = [...(q.question ? [] : ["no question"]), ...optionCheck(was.id, q.responses, answer, 3)];
      } else {
        const q = mcq(r);
        // A Part 6 blank keeps its place in the text.
        if (was.kind === "blank") q.prompt = (was.item as RawMcq).prompt;
        item = q;
        faults = [...(q.prompt ? [] : ["empty question"]), ...(was.id.startsWith("S") && !q.prompt.includes("-------") ? ["no blank"] : []), ...optionCheck(was.id, q.options, q.answer)];
      }
      if (!faults.length) fresh.push({ ...was, item });
    }
    if (!fresh.length) return { replaced, refilled: [] };
    const { verdicts } = await check(run, checker, fresh, () => {});
    for (const f of fresh) {
      const v = verdicts.get(f.id);
      if (!v || v.action === "drop") continue;
      replaced.set(f.id, v.action === "rekey" ? { ...f.item, answer: v.answer } : f.item);
    }
  } catch {
    run.stop();
    /* the drops stand */
  }
  return { replaced, refilled: [...replaced.keys()] };
}

/* ---------- Build tests ---------- */

/** Rotates options so keys land on each letter in turn across a part. */
export function balance<T extends { options: string[]; answer: string }>(items: T[], start = 0): T[] {
  return items.map((q, i) => {
    const n = q.options.length;
    const key = LETTERS.indexOf(q.answer);
    if (key < 0 || key >= n) return q;
    const target = (start + i) % n;
    const options = [...q.options];
    [options[key], options[target]] = [options[target], options[key]];
    return { ...q, options, answer: LETTERS[target] };
  });
}

const opts = (texts: string[]) => texts.map((text, i) => ({ key: LETTERS[i], text }));
const numbered = (from: number) => {
  let n = from - 1;
  return () => ++n;
};

const mcqGroup = (qs: RawMcq[], next: () => number, instructions?: string): ImportGroup => ({
  type: "mcq",
  instructions,
  questions: balance(qs).map((q) => ({ number: next(), prompt: q.prompt, options: opts(q.options), answer: [q.answer] })),
});

export interface AudioJob {
  passage: number;
  turns: SynthTurn[];
  speakers: Record<string, SpeakerInfo>;
}
export interface ImageJob {
  passage: number;
  prompt: string;
  /** The scene in words, shown in place of the photograph when there is none. */
  scene: string;
}

const info = (s: RawSpeaker): SpeakerInfo => ({ role: s.role, gender: s.gender, accent: "american" });
const NARRATOR: SpeakerInfo = { role: "Narrator", gender: "male", accent: "american" };

/** Listening (Parts 1–4, numbered from 1) with the speech and photo jobs that go with its passages. */
export function listeningTest(d: Partial<Draft>, title: string): { test: ImportTest; audio: AudioJob[]; images: ImageJob[] } {
  const next = numbered(1);
  const passages: ImportPassage[] = [];
  const audio: AudioJob[] = [];
  const images: ImageJob[] = [];

  balance(d.p12?.photos.map((p) => ({ ...p, options: p.statements })) ?? []).forEach((p, i) => {
    const n = next();
    images.push({
      passage: passages.length,
      prompt: `A realistic, natural-looking photograph for an English test: ${p.scene} No text, signs with words, or logos.`,
      scene: p.scene,
    });
    audio.push({ passage: passages.length, turns: [{ speaker: "N", text: `Number ${n}. Look at the picture. ${p.options.map((s, k) => `(${LETTERS[k]}) ${s}`).join(" ")}` }], speakers: { N: NARRATOR } });
    passages.push({
      title: `Part 1 · Photograph ${i + 1}`,
      body: p.options.map((s, k) => `Narrator: (${LETTERS[k]}) ${s}`).join("\n\n"),
      groups: [{ type: "lmcq", instructions: "Look at the picture. Select the statement that best describes it.", questions: [{ number: n, prompt: `Number ${n}`, options: opts(p.options), answer: [p.answer] }] }],
    });
  });

  const qr = balance(d.p12?.qr.map((q) => ({ ...q, options: q.responses })) ?? []);
  for (let start = 0; start < qr.length; start += 5) {
    const chunk = qr.slice(start, start + 5);
    const numbers = chunk.map(() => next());
    audio.push({
      passage: passages.length,
      turns: chunk.flatMap((q, k) => [
        { speaker: "Q", text: `Number ${numbers[k]}. ${q.question}` },
        { speaker: "R", text: q.options.map((r, j) => `(${LETTERS[j]}) ${r}`).join(" ") },
      ]),
      speakers: { Q: { role: "Speaker", gender: "female", accent: "american" }, R: { role: "Responder", gender: "male", accent: "american" } },
    });
    passages.push({
      title: `Part 2 · ${numbers[0]}–${numbers[numbers.length - 1]}`,
      body: chunk.map((q, k) => `Speaker: Number ${numbers[k]}. ${q.question}\n\nResponder: ${q.options.map((r, j) => `(${LETTERS[j]}) ${r}`).join(" ")}`).join("\n\n"),
      groups: [
        {
          type: "lmcq",
          instructions: "Listen to the question or statement and the three responses. Select the best response.",
          questions: chunk.map((q, k) => ({ number: numbers[k], prompt: `Number ${numbers[k]}`, options: opts(q.options), answer: [q.answer] })),
        },
      ],
    });
  }

  d.p3?.sets.forEach((s, i) => {
    audio.push({ passage: passages.length, turns: s.turns, speakers: Object.fromEntries(Object.entries(s.speakers).map(([k, v]) => [k, info(v)])) });
    passages.push({
      title: `Part 3 · Conversation ${i + 1}${s.title ? ` (${s.title})` : ""}`,
      body: s.turns.map((t) => `${s.speakers[t.speaker]?.role ?? t.speaker}: ${t.text}`).join("\n\n"),
      groups: [mcqGroup(s.questions, next, s.graphic ? `Graphic\n${s.graphic}` : undefined)],
    });
  });

  d.p4?.sets.forEach((s, i) => {
    audio.push({ passage: passages.length, turns: [{ speaker: "S", text: s.text }], speakers: { S: info(s.speaker) } });
    passages.push({
      title: `Part 4 · Talk ${i + 1}${s.genre ? ` (${s.genre})` : ""}`,
      body: `${s.speaker.role}: ${s.text}`,
      groups: [mcqGroup(s.questions, next, s.graphic ? `Graphic\n${s.graphic}` : undefined)],
    });
  });

  return { test: { title, kind: "listening", passages }, audio, images };
}

/** Reading (Parts 5–7, numbered from 101 as on the test). */
export function readingTest(d: Partial<Draft>, title: string): ImportTest {
  const next = numbered(101);
  const passages: ImportPassage[] = [];
  if (d.p56?.part5.length) {
    passages.push({
      title: "Part 5 · Incomplete Sentences",
      body: "A word or phrase is missing in each of the sentences below. Select the best answer to complete the sentence.",
      groups: [mcqGroup(d.p56.part5, next)],
    });
  }
  d.p56?.part6.forEach((t, i) => {
    const qs = balance(t.questions);
    const numbers = qs.map(() => next());
    // The writer marks blanks ---(1)--- to ---(4)---; on the page they carry the question numbers.
    const body = t.text.replace(/---\((\d)\)---/g, (_m, k: string) => `---(${numbers[Number(k) - 1] ?? k})---`);
    passages.push({
      title: `Part 6 · ${t.title || `Text ${i + 1}`}${t.genre ? ` (${t.genre})` : ""}`,
      body,
      groups: [
        {
          type: "mcq",
          instructions: "Read the text. Select the best answer for each blank.",
          questions: qs.map((q, k) => ({ number: numbers[k], prompt: `(${numbers[k]})`, options: opts(q.options), answer: [q.answer] })),
        },
      ],
    });
  });
  for (const [label, sets] of [["단일", d.p7s?.sets ?? []], ["복수", d.p7m?.sets ?? []]] as const) {
    sets.forEach((s, i) => {
      if (!s.questions.length) return;
      passages.push({
        title: `Part 7 · ${label === "단일" ? "Single" : s.texts.length === 3 ? "Triple" : "Double"} ${i + 1}${s.title ? ` (${s.title})` : ""}`,
        body: s.texts.map((t) => `[${t.genre || "Text"}]\n${t.text}`).join("\n\n"),
        groups: [mcqGroup(s.questions, next)],
      });
    });
  }
  return { title, kind: "reading", passages };
}

/* ---------- Pipeline ---------- */

async function writeUnit<U extends ToeicUnit>(run: Run, settings: AiSettings, unit: U, o: ToeicGenOptions, step: (s: ToeicStep) => void) {
  step("write");
  const parse = PARSE[unit] as (r: unknown) => Draft[U];
  const measure = MEASURE[unit] as (d: Draft[U]) => string[];
  let draft = parse(extractJson(await run.ask(settings, WRITER_SYSTEM, writerPrompt(unit, o))));
  step("check");
  let notes = measure(draft);
  if (notes.length) {
    step("rewrite");
    try {
      const again = parse(extractJson(await run.ask(settings, WRITER_SYSTEM, writerPrompt(unit, o, notes))));
      const againNotes = measure(again);
      if (againNotes.length <= notes.length) {
        draft = again;
        notes = againNotes;
      }
    } catch {
      run.stop();
      /* a malformed rewrite is ignored; the first draft stands */
    }
  }
  return { draft, notes };
}

export const geminiImage = (model: string, prompt: string) => invoke<string>("ai_image", { req: { model, prompt } });

/** Writes and checks the chosen units, then returns a Listening test and/or a Reading test. With `control`, every
 *  CLI call belongs to that job, and the run stops with the cancellation once the job's signal is raised (also
 *  between photographs and speech clips, which are Gemini calls the CLI registry does not see). */
export async function generateToeic(
  settings: AiSettings,
  o: ToeicGenOptions,
  onProgress: (unit: ToeicUnit | "media", step: ToeicStep) => void = () => {},
  control: ToeicGenControl = {},
): Promise<{ tests: ImportTest[]; reports: ToeicGenReport[] }> {
  const run = runOf(control);
  const writer = providerLabel(settings.provider);
  const names = { writer, checker: writer, cross: false };
  const drafts: Partial<Draft> = {};
  const reports: ToeicGenReport[] = [];
  for (const unit of ORDER.filter((u) => o.units.includes(u))) {
    const step = (s: ToeicStep) => onProgress(unit, s);
    const written = await writeUnit(run, settings, unit, o, step);
    const { draft, notes, proofed } = await proofUnit(run, settings, settings, unit, o, written, step);
    const checked = await verify(run, settings, unit, draft, step);
    const { replaced, refilled } = await refill(run, settings, settings, unit, o, draft, checked.dropped, step);
    const dropped = edit(unit, draft, (id, item) => replaced.get(id) ?? (checked.dropped.includes(id) ? null : item));
    (drafts as Record<ToeicUnit, unknown>)[unit] = draft;
    reports.push({
      unit,
      ...names,
      total: checked.total,
      agreed: checked.agreed,
      flagged: checked.flagged,
      proofed,
      rekeyed: checked.rekeyed,
      refilled,
      dropped,
      notes,
    });
    step("done");
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const tests: ImportTest[] = [];
  if (drafts.p12 || drafts.p3 || drafts.p4) {
    const { test, audio, images } = listeningTest(drafts, `AI · TOEIC Listening ${stamp}`);
    if (!o.images) {
      // Without photographs the scene is described in words, so Part 1 can still be practised.
      for (const job of images) {
        const g = test.passages[job.passage].groups[0];
        g.instructions = `${g.instructions}\n[사진 대신 장면 설명] ${job.scene}`;
      }
    }
    if (o.speech || o.images) {
      onProgress("media", "media");
      for (const job of o.images ? images : []) {
        run.stop();
        const name = await geminiImage(settings.imageModel, job.prompt);
        test.passages[job.passage].groups[0].image = name;
      }
      for (const job of o.speech ? audio : []) {
        run.stop();
        const r = await geminiSynthesize(settings.ttsModel, job.turns, assignGeminiVoices(job.speakers));
        test.passages[job.passage].audio = r.name;
      }
      run.stop();
      onProgress("media", "done");
    }
    tests.push(test);
  }
  if (drafts.p56 || drafts.p7s || drafts.p7m) tests.push(readingTest(drafts, `AI · TOEIC Reading ${stamp}`));
  return { tests, reports };
}
