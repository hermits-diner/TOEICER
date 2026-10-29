// 문항 작성 지침.
// ETS 내부 출제 매뉴얼은 비공개다. 아래는 공개 자료인 "ETS Guidelines for Fair Tests and Communications",
// "ETS Standards for Quality and Fairness"의 공정성 원칙과 일반적인 선다형 문항 작성 원칙을 정리한 것이다.

export const FAIRNESS_GUIDELINES = [
  "Measure only English ability. Every answer must be recoverable from the text or audio itself; never require specialized, regional, religious, or cultural background knowledge.",
  "Avoid topics that are unnecessarily controversial, inflammatory, or upsetting: violence, death, serious illness, disasters with casualties, abuse, religion, partisan politics, sexuality, drugs, gambling.",
  "Avoid stereotypes and demeaning portrayals of any group (gender, age, nationality, ethnicity, disability, region, income). Use names from a variety of cultures and balance roles.",
  "Avoid content that assumes a particular lifestyle or wealth (e.g., luxury travel, owning a car or a house).",
  "Business and everyday workplace contexts (offices, stores, travel, hiring, events, maintenance, finance basics), realistic and self-contained; no real companies, brands or public figures.",
  "Situations should be ones that any working adult in any country would recognize; no culture-specific holidays or customs.",
  "Use standard North American English spelling and vocabulary; avoid slang that is regional or quickly dated.",
] as const;

export const ITEM_WRITING_GUIDELINES = [
  "Each multiple-choice question has exactly one defensible correct answer and the number of options the part uses (4, or 3 in Part 2).",
  "Distractors are plausible: they reuse words or ideas from the text but are wrong, incomplete, or unsupported. No joke or obviously absurd options.",
  "Options are parallel in grammar and similar in length; the correct answer must not be noticeably longer or more specific than the others.",
  "Never use 'all of the above', 'none of the above', or 'both A and B'.",
  "Avoid negative stems (NOT/EXCEPT) unless essential; never use double negatives.",
  "The stem must not give away the answer, and one question must not reveal the answer to another.",
  "Vary the position of the correct answer across the set so that each position is used roughly equally.",
  "Vocabulary-in-context questions target a word whose meaning is supported by context, and all four options are real single-word or short-phrase meanings of the same part of speech.",
  "Inference questions must be answerable from the text with a single reasonable step, not from outside knowledge.",
  "Listening questions must not be answerable from the options alone without hearing the audio.",
] as const;

export function guidelinesForPrompt(): string {
  return [
    "## Fairness and sensitivity (from ETS public fairness guidelines)",
    ...FAIRNESS_GUIDELINES.map((g) => `- ${g}`),
    "",
    "## Item-writing rules",
    ...ITEM_WRITING_GUIDELINES.map((g) => `- ${g}`),
  ].join("\n");
}

/** 선택지 지침 위반을 찾는다 (기계적으로 확인할 수 있는 것만). */
export function optionProblems(options: string[], answer: number, expected = 4): string[] {
  const problems: string[] = [];
  if (options.length !== expected) problems.push(`선택지가 ${options.length}개입니다 (${expected}개여야 함).`);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) problems.push("정답 번호가 범위를 벗어났습니다.");
  const normalized = options.map((o) => o.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) problems.push("같은 선택지가 중복되었습니다.");
  if (normalized.some((o) => /\b(all|none) of the above\b|\bboth [a-d] and [a-d]\b/.test(o))) {
    problems.push("'all/none of the above' 형태의 선택지가 있습니다.");
  }
  if (options.length === expected && answer >= 0 && answer < expected) {
    const lengths = options.map((o) => o.length);
    const others = lengths.filter((_, i) => i !== answer);
    const longestOther = Math.max(...others);
    if (lengths[answer] > longestOther * 1.6 && lengths[answer] - longestOther > 25) {
      problems.push("정답 선택지만 눈에 띄게 깁니다.");
    }
  }
  return problems;
}
