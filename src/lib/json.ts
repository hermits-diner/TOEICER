/** The first JSON object in a reply, tolerating code fences and stray text. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI가 정해진 형식으로 답하지 않았습니다. 다시 시도해 주십시오.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("AI 응답을 읽지 못했습니다. 다시 시도하거나 다른 모델을 골라 주십시오.");
  }
}
