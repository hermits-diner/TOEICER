/** Short tab labels for a test's passages: TOEFL sets have many short tasks, which full titles would not fit. */
export function passageTab(title: string | null, index: number, count: number, fallback: string): string {
  const t = title ?? "";
  const repeat = t.match(/^listen and repeat (\d+)/i);
  if (repeat) return `따라 말하기 ${repeat[1]}`;
  const interview = t.match(/^interview (\d+)/i);
  if (interview) return `인터뷰 ${interview[1]}`;
  if (/^write an email/i.test(t)) return "이메일";
  if (/discussion/i.test(t)) return "토론";
  // TOEIC passages are titled "Part 3 · Conversation 2 (…)", "Part 6 · Memo (…)": the part, and the set within it.
  const part = t.match(/^Part (\d)(?:\s*·\s*(?:\w+\s+)?(\d+)\b)?/);
  if (part) return part[2] ? `P${part[1]}-${part[2]}` : `Part ${part[1]}`;
  if (count > 4) return String(index + 1);
  return t || `${fallback} ${index + 1}`;
}
