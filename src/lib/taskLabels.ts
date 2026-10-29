/** Short tab labels for a set's passages: "Part 3 · Conversation 2 (…)" reads "P3-2", "Part 5 · …" reads "Part 5". */
export function passageTab(title: string | null, index: number): string {
  const part = (title ?? "").match(/^Part (\d)(?:\s*·\s*(?:\w+\s+)?(\d+)\b)?/);
  if (part) return part[2] ? `P${part[1]}-${part[2]}` : `Part ${part[1]}`;
  return String(index + 1);
}
