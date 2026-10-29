import { complete, type AiSettings } from "./ai";
import { getDb } from "./db";
import type { Option, QuestionType, TestKind } from "./types";
import { BRAND } from "./brand";

/** Why an answer was wrong, pointing at the evidence in the passage. */
export interface Explanation {
  /** The passage sentence(s) the answer rests on, quoted exactly; empty when there is no passage text. */
  evidence: string;
  /** How the question's wording maps onto the passage's wording. */
  paraphrases: { question: string; passage: string }[];
  explanation: string;
  /** Why the learner's answer does not fit. */
  whyNot: string;
  tip: string;
}

export interface QuestionContext {
  kind: TestKind;
  passageTitle: string | null;
  passageText: string;
  type: QuestionType;
  instructions: string | null;
  options: Option[];
  number: number;
  prompt: string | null;
  answer: string[];
}

const textOf = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/g, "\n"), "text/html").body.textContent?.trim() ?? "";

export async function loadQuestionContext(questionId: number): Promise<QuestionContext> {
  const db = await getDb();
  const [r] = await db.select<
    {
      kind: TestKind;
      ptitle: string | null;
      body_html: string;
      type: QuestionType;
      instructions: string | null;
      gopts: string | null;
      number: number;
      prompt: string | null;
      qopts: string | null;
      answer_json: string;
    }[]
  >(
    `SELECT t.kind, p.title AS ptitle, p.body_html, g.type, g.instructions, g.options_json AS gopts,
            q.number, q.prompt, q.options_json AS qopts, q.answer_json
       FROM question q JOIN question_group g ON g.id = q.group_id
       JOIN passage p ON p.id = g.passage_id JOIN test t ON t.id = p.test_id
      WHERE q.id = $1`,
    [questionId],
  );
  if (!r) throw new Error("문항을 찾을 수 없습니다.");
  const parse = (s: string | null) => (s ? (JSON.parse(s) as Option[]) : []);
  const qopts = parse(r.qopts);
  return {
    kind: r.kind,
    passageTitle: r.ptitle,
    passageText: textOf(r.body_html),
    type: r.type,
    instructions: r.instructions,
    options: qopts.length ? qopts : parse(r.gopts),
    number: r.number,
    prompt: r.prompt,
    answer: JSON.parse(r.answer_json) as string[],
  };
}

export const EXPLAIN_SYSTEM = `You are an experienced ${BRAND.examName} teacher explaining a wrong answer to a Korean learner.
Find the exact place in the text (or, for Listening, the script) the correct answer comes from and explain it.
Reply with a single JSON object and nothing else:
{"evidence": string, "paraphrases": [{"question": string, "passage": string}], "explanation": string, "whyNot": string, "tip": string}
- evidence: the sentence(s) from the passage that decide the answer, quoted exactly in English. Use "" if no passage text is given.
- paraphrases: 1-4 pairs showing how words in the question are expressed differently in the passage (English).
- explanation: in Korean (polite 합니다체), why the correct answer is right. For a Part 5 or 6 blank, name the grammar point or the collocation that decides it.
- whyNot: in Korean, why the learner's answer is wrong (or that it was left blank).
- tip: in Korean, one short strategy for this kind of TOEIC question.
Never invent passage text. Trust the given answer key.`;

export function explainPrompt(c: QuestionContext, userAnswer: string): string {
  const options = c.options.length ? c.options.map((o) => `${o.key}. ${o.text}`).join("\n") : "";
  return [
    `${BRAND.examName} ${c.kind === "listening" ? "Listening" : "Reading"}${c.passageTitle ? ` · ${c.passageTitle.split(" · ")[0]}` : ""} · ${c.type === "lmcq" ? "choices heard, not printed" : "printed choices"}`,
    c.instructions ? `Instructions: ${c.instructions}` : "",
    options ? `Options:\n${options}` : "",
    `Question ${c.number}: ${c.prompt ?? "(see instructions)"}`,
    `Correct answer: ${c.answer.join(" / ")}`,
    `Learner's answer: ${userAnswer.trim() || "(blank)"}`,
    "",
    c.passageText
      ? `<passage${c.passageTitle ? ` title="${c.passageTitle}"` : ""}>\n${c.passageText}\n</passage>`
      : "(No text or script is available.)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function parseExplanation(text: string): Explanation {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let raw: Record<string, unknown>;
  try {
    if (start < 0 || end <= start) throw new Error();
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("AI 해설을 읽지 못했습니다. 다시 시도하거나 다른 모델을 골라 주십시오.");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const paraphrases = (Array.isArray(raw.paraphrases) ? raw.paraphrases : [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({ question: str(p.question), passage: str(p.passage) }))
    .filter((p) => p.question && p.passage)
    .slice(0, 4);
  const out = { evidence: str(raw.evidence), paraphrases, explanation: str(raw.explanation), whyNot: str(raw.whyNot), tip: str(raw.tip) };
  if (!out.explanation) throw new Error("AI 해설이 비어 있습니다. 다시 시도해 주십시오.");
  return out;
}

export async function cachedExplanation(questionId: number, userAnswer: string): Promise<Explanation | null> {
  const db = await getDb();
  const [r] = await db.select<{ json: string }[]>(
    "SELECT json FROM ai_explanation WHERE question_id = $1 AND user_answer = $2",
    [questionId, userAnswer.trim()],
  );
  return r ? (JSON.parse(r.json) as Explanation) : null;
}

/** Asks the configured model and keeps the answer, so the same mistake is explained once. */
export async function explainWrongAnswer(settings: AiSettings, questionId: number, userAnswer: string): Promise<Explanation> {
  const ctx = await loadQuestionContext(questionId);
  const r = await complete(settings, EXPLAIN_SYSTEM, explainPrompt(ctx, userAnswer));
  const exp = parseExplanation(r.text);
  const db = await getDb();
  await db.execute(
    `INSERT INTO ai_explanation (question_id, user_answer, provider, model, json) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(question_id, user_answer) DO UPDATE SET provider = excluded.provider, model = excluded.model,
       json = excluded.json, created_at = datetime('now')`,
    [questionId, userAnswer.trim(), settings.provider, r.model, JSON.stringify(exp)],
  );
  return exp;
}
