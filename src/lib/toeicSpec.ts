// TOEIC Listening and Reading: 200 questions, about 2 hours (Listening 45 minutes, Reading 75 minutes), scored
// 5–495 per section and 10–990 in total. Part sizes follow ETS's published test format; the score conversion is
// not published, so the app estimates it (see bandTable.ts).

export type ToeicPart = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PartSpec {
  part: ToeicPart;
  section: "listening" | "reading";
  name: string;
  korean: string;
  questions: number;
  description: string;
}

export const TOEIC_PARTS: PartSpec[] = [
  {
    part: 1,
    section: "listening",
    name: "Photographs",
    korean: "사진 묘사",
    questions: 6,
    description: "A photograph in the test book; four spoken statements (A)-(D) that are not printed. Choose the one that best describes the picture.",
  },
  {
    part: 2,
    section: "listening",
    name: "Question-Response",
    korean: "질의응답",
    questions: 25,
    description: "A spoken question or statement and three spoken responses (A)-(C), none printed. Choose the best response.",
  },
  {
    part: 3,
    section: "listening",
    name: "Conversations",
    korean: "짧은 대화",
    questions: 39,
    description: "13 workplace or everyday conversations between two or three people, each with 3 printed questions with 4 options; some sets refer to a printed graphic (table, schedule, map, chart).",
  },
  {
    part: 4,
    section: "listening",
    name: "Talks",
    korean: "짧은 담화",
    questions: 30,
    description: "10 short talks by one speaker (announcement, voicemail, advertisement, tour, meeting excerpt, news report), each with 3 printed questions; some with a graphic.",
  },
  {
    part: 5,
    section: "reading",
    name: "Incomplete Sentences",
    korean: "단문 빈칸 채우기",
    questions: 30,
    description: "A sentence with one blank; choose the word or phrase (grammar: parts of speech, verb forms, pronouns, prepositions, conjunctions; vocabulary: collocation and meaning).",
  },
  {
    part: 6,
    section: "reading",
    name: "Text Completion",
    korean: "장문 빈칸 채우기",
    questions: 16,
    description: "4 business texts (email, memo, notice, article) with 4 blanks each; three blanks take a word or phrase and one takes a whole sentence that fits the context.",
  },
  {
    part: 7,
    section: "reading",
    name: "Reading Comprehension",
    korean: "독해",
    questions: 54,
    description: "Single passages (29 questions in sets of 2-4: emails, ads, text-message chains, online chats, articles, forms) and multiple passages (25 questions: 2 double-passage and 3 triple-passage sets of 5).",
  },
];

export const LISTENING_MINUTES = 45;
export const READING_MINUTES = 75;

/** How many of each kind a generated full test holds: the real test, unshortened. */
export const BLUEPRINT = {
  1: { items: 6 },
  2: { items: 25 },
  3: { sets: 13, perSet: 3, graphics: 3, threeSpeakers: 2 },
  4: { sets: 10, perSet: 3, graphics: 2 },
  5: { items: 30 },
  6: { texts: 4, perText: 4 },
  7: { singles: [2, 2, 2, 3, 3, 3, 4, 4, 4, 2], doubles: 2, triples: 3, perMulti: 5 },
} as const;

/** Target score: TOEIC learners aim at a total score, and the item mix shifts with it. */
export type Target = "600" | "750" | "900";

export const TARGET_TEXT: Record<Target, string> = {
  "600": "Pitch it for a learner aiming at about 600 overall: mostly direct questions, common business vocabulary, short sentences; few inference items and few traps.",
  "750": "Match the real test's usual mix for about 750: about a third easy, half medium and a sixth hard items, with paraphrase, distractors that reuse words from the audio or text, and some inference.",
  "900": "Pitch it at the hard end of the real test for 900+: dense paraphrase, subtle grammar (reduced clauses, inversion, subjunctive), close-meaning vocabulary choices, implied meaning and cross-passage questions.",
};

export function specForPrompt(parts: ToeicPart[]): string {
  return TOEIC_PARTS.filter((p) => parts.includes(p.part))
    .map((p) => `- Part ${p.part} ${p.name} (${p.questions} questions in the real test): ${p.description}`)
    .join("\n");
}
