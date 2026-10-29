/** An answer is right when it is the keyed letter (case does not matter). */
export const isCorrect = (user: string | undefined, accepted: string[]): boolean =>
  !!user?.trim() && accepted.some((a) => a.trim().toUpperCase() === user.trim().toUpperCase());

export interface ScorableQuestion {
  id: number;
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
    return { questionId: q.id, userAnswer, isCorrect: isCorrect(userAnswer, q.answer) };
  });
  return { correct: results.filter((r) => r.isCorrect).length, total: questions.length, results };
}
