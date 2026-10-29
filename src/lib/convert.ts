/**
 * Studio › 붙여넣기·PDF: the user's own TOEIC questions (a handout, a workbook page, a PDF they own) turned into sets
 * of this app by the signed-in CLI. The AI only sorts what is there into parts, texts or scripts, questions, choices
 * and the key; it does not write new content. Listening items come along only when the material carries their script
 * (the audio can then be made with Gemini in the editor, or the script read by the Windows voice). Answers missing
 * from the text are solved by the AI and marked, so the user can check them in the editor before saving. A converted
 * set is the user's own material: it stays on this PC and is never offered on the market.
 */
import { complete, type AiSettings } from "./ai";
import { choiceCount, KEYS, validateImport } from "./importFormat";
import { extractJson } from "./json";
import { sectionOf, type ToeicPart } from "./toeicSpec";
import type { ImportPassage, ImportTest, TestKind } from "./types";

export const CONVERT_SYSTEM = [
  "You turn TOEIC Listening and Reading questions a teacher or learner already owns into structured data for a practice app.",
  "Copy the text faithfully: never rewrite, shorten, translate or add to texts, scripts, questions or choices; only fix obvious line-break and hyphenation damage from PDF extraction.",
  "Reply with one JSON object only, no Markdown fences and no commentary.",
].join(" ");

const SHAPE = `{"title": string, "sets": [{"part": 1|2|3|4|5|6|7, "passage": string, "graphic": string, "questions": [{"n": number, "stem": string, "options": [string, ...], "answer": 0|1|2|3|4}]}]}`;

export function convertPrompt(text: string): string {
  return [
    "Sort the material below into TOEIC sets, in the printed order. Each set has the TOEIC part it belongs to:",
    "- Part 1 (photographs): one set per item. Keep it only if the four spoken statements are written out; \"passage\" is that script and \"options\" are the four statements.",
    "- Part 2 (question-response): one set per item. Keep it only if the question and the three responses are written out; \"passage\" is that script (\"Speaker: …\" and \"Responder: (A) … (B) … (C) …\"), \"options\" are the three responses.",
    "- Parts 3 and 4 (conversations, talks): one set per conversation or talk with its questions. Keep it only if the script is written out; \"passage\" is the script, one turn per line as \"Woman: …\", \"Man: …\" or \"Speaker: …\". A table, schedule or chart printed with it goes in \"graphic\" as plain lines.",
    "- Part 5 (incomplete sentences): one set per sentence with an empty \"passage\"; the sentence with its blank is the \"stem\".",
    "- Part 6 (text completion): one set per text; \"passage\" is the text with its blanks as printed, each blank's \"stem\" is its number in brackets, e.g. \"(131)\".",
    "- Part 7 (reading): one set per text or group of related texts; \"passage\" holds the text(s), several texts one after another with their headings.",
    "If the material does not name the parts, decide from the form of each item.",
    "- \"n\" is the question's number as printed; \"stem\" is the question as printed without its number.",
    "- \"options\" are its choices in order, without the markers (A)–(D).",
    "- \"answer\" is the printed key (1 for A, 2 for B, 3 for C, 4 for D) when the material gives one, otherwise 0.",
    "- In passages, keep paragraphs apart with a blank line.",
    "- Leave out anything else (headers, page numbers, directions, listening items whose script is not in the material).",
    '- "title" is a short Korean title for the material, from the material when it has one.',
    "",
    "<material>",
    text.trim(),
    "</material>",
    "",
    `Reply format: ${SHAPE}`,
  ].join("\n");
}

export const SOLVE_SYSTEM =
  "You are a top TOEIC Listening and Reading candidate. Answer each item from the given text or script only. Reply with one JSON object only.";

interface RawQ {
  n: number;
  stem: string;
  options: string[];
  answer: number;
}
interface RawSet {
  part: ToeicPart;
  passage: string;
  graphic: string;
  questions: RawQ[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function parseConverted(raw: unknown): { title: string; sets: RawSet[] } {
  const o = obj(raw);
  return {
    title: str(o.title),
    sets: arr(o.sets)
      .map((s) => ({
        part: Number(obj(s).part) as ToeicPart,
        passage: str(obj(s).passage),
        graphic: str(obj(s).graphic),
        questions: arr(obj(s).questions).map((q) => ({
          n: Number(obj(q).n) || 0,
          stem: str(obj(q).stem),
          options: arr(obj(q).options).map(str),
          answer: Number(obj(q).answer) || 0,
        })),
      }))
      .filter((s) => s.part >= 1 && s.part <= 7 && s.questions.length > 0),
  };
}

export interface Converted {
  /** The sorted sets (a Listening set and/or a Reading set), to be checked in the editor; `errors` lists what is wrong. */
  tests: ImportTest[];
  /** Question numbers whose key the AI solved because the material had none. */
  solved: number[];
  /** What kept the result from being valid sets, for the user. */
  errors: string[];
}

const DIRECTIONS: Partial<Record<ToeicPart, string>> = {
  1: "Look at the picture in your material. Select the statement that best describes it.",
  2: "Listen to the question or statement and the three responses. Select the best response.",
};

const range = (qs: RawQ[]) => (qs.length > 1 ? `${qs[0].n}–${qs[qs.length - 1].n}` : `${qs[0].n}`);

/** Sets as the app titles them ("Part 3 · Conversation 2"); Part 2 items five to a set and Part 5 in one, as the writer does. */
export function toImport(title: string, sets: RawSet[]): ImportTest[] {
  const merged: RawSet[] = [];
  for (const s of sets) {
    const last = merged[merged.length - 1];
    const joins = last && last.part === s.part && ((s.part === 2 && last.questions.length < 5) || s.part === 5);
    if (joins) {
      last.questions.push(...s.questions);
      if (s.passage) last.passage = [last.passage, s.passage].filter(Boolean).join("\n\n");
    } else merged.push({ ...s, questions: [...s.questions] });
  }
  const count: Partial<Record<ToeicPart, number>> = {};
  const passage = (s: RawSet): ImportPassage => {
    const k = (count[s.part] = (count[s.part] ?? 0) + 1);
    const name = {
      1: `Photograph ${k}`,
      2: range(s.questions),
      3: `Conversation ${k}`,
      4: `Talk ${k}`,
      5: "Incomplete Sentences",
      6: `Text ${k}`,
      7: `Text ${k}`,
    }[s.part];
    const keys = KEYS.slice(0, choiceCount(s.part));
    const instructions = s.graphic ? `Graphic\n${s.graphic}` : DIRECTIONS[s.part];
    return {
      title: `Part ${s.part} · ${name}`,
      body: s.passage,
      groups: [
        {
          type: s.part <= 2 ? "lmcq" : "mcq",
          instructions,
          questions: s.questions.map((q) => ({
            number: q.n,
            prompt: q.stem || (s.part <= 2 ? `Number ${q.n}` : undefined),
            options: q.options.slice(0, keys.length).map((text, i) => ({ key: keys[i], text })),
            answer: q.answer >= 1 && q.answer <= keys.length ? [keys[q.answer - 1]] : [],
          })),
        },
      ],
    };
  };
  const name = title || "내 자료";
  const out: ImportTest[] = [];
  for (const kind of ["listening", "reading"] as TestKind[]) {
    const mine = merged.filter((s) => sectionOf(s.part) === kind);
    if (!mine.length) continue;
    out.push({ title: name, kind, passages: mine.map(passage) });
  }
  // Material with both sections becomes two sets; their titles say which is which.
  if (out.length > 1) for (const t of out) t.title = `${name} · ${t.kind === "listening" ? "Listening" : "Reading"}`;
  return out;
}

/** Converts pasted or extracted text into sets; solves the keys the material lacks. */
export async function convertMaterial(settings: AiSettings, text: string, onStep: (s: "sort" | "solve") => void = () => {}): Promise<Converted> {
  onStep("sort");
  const { title, sets } = parseConverted(extractJson((await complete(settings, CONVERT_SYSTEM, convertPrompt(text))).text));
  const missing = sets.flatMap((s) => s.questions.filter((q) => !(q.answer >= 1 && q.answer <= choiceCount(s.part))).map((q) => ({ s, q })));
  if (missing.length) {
    onStep("solve");
    const items = missing.map(
      ({ s, q }) =>
        `### ${q.n} (Part ${s.part}${s.part <= 4 ? ", listening script" : ""})\n${[s.passage, s.graphic].filter(Boolean).join("\n\n")}\n\nQ: ${q.stem}\n${q.options.map((x, i) => `${i + 1}. ${x}`).join("\n")}`,
    );
    const reply = obj(extractJson((await complete(settings, SOLVE_SYSTEM, [...items, "", 'Reply format: {"answers": {"<item number>": <choice number>}}'].join("\n\n"))).text));
    const answers = obj(reply.answers);
    for (const { q } of missing) q.answer = Number(answers[q.n]) || 0;
  }
  const tests = toImport(title, sets);
  const keyed = (n: number) => tests.some((t) => t.passages.some((p) => p.groups.some((g) => g.questions.some((x) => x.number === n && x.answer.length))));
  return {
    tests,
    solved: missing.map(({ q }) => q.n).filter(keyed),
    errors: tests.flatMap((t) => validateImport(t).errors),
  };
}
