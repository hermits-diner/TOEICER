import { useState } from "react";
import type { Option, Question } from "../lib/types";

/** Rebuilds which chunks make up a stored answer, so a sentence typed in an earlier visit shows its tiles again. */
export function picksFromAnswer(answer: string, chunks: Option[]): string[] {
  const picks: string[] = [];
  let rest = answer.trim();
  while (rest) {
    const next = chunks.find((c) => !picks.includes(c.key) && (rest === c.text || rest.startsWith(c.text + " ")));
    if (!next) return [];
    picks.push(next.key);
    rest = rest.slice(next.text.length).trim();
  }
  return picks;
}

export const sentenceOf = (picks: string[], chunks: Option[]) =>
  picks.map((k) => chunks.find((c) => c.key === k)?.text ?? "").join(" ");

/**
 * "Build a Sentence": tap the chunks in order to answer the other speaker; tap a placed chunk to take it back.
 * The other speaker's line is shown in the question head.
 */
export default function BuildSentence({
  question,
  value,
  onChange,
  locked,
}: {
  question: Question;
  value: string;
  onChange: (sentence: string) => void;
  locked: boolean;
}) {
  const chunks = question.options;
  const [picks, setPicks] = useState<string[]>(() => picksFromAnswer(value, chunks));
  const update = (next: string[]) => {
    setPicks(next);
    onChange(sentenceOf(next, chunks));
  };
  const sentence = sentenceOf(picks, chunks);

  return (
    <div className="build">
      <div className="build-turn reply">
        <span className="build-avatar me">B</span>
        <div className={`build-slots${picks.length ? " filled" : ""}`} aria-label="내 답">
          {picks.length === 0 && <span className="muted">{locked ? "응답하지 않았습니다." : "아래 단어 덩어리를 순서대로 눌러 문장을 만드세요."}</span>}
          {picks.map((k, i) => (
            <button key={k} className="build-chip placed" disabled={locked} onClick={() => update(picks.filter((p) => p !== k))}>
              {i === 0 ? capitalise(chunks.find((c) => c.key === k)?.text ?? "") : chunks.find((c) => c.key === k)?.text}
            </button>
          ))}
          {sentence && <span className="build-end">{/\?$/.test(question.answer[0] ?? "") ? "?" : "."}</span>}
        </div>
      </div>
      {!locked && (
        <div className="build-bank">
          {chunks
            .filter((c) => !picks.includes(c.key))
            .map((c) => (
              <button key={c.key} className="build-chip" onClick={() => update([...picks, c.key])}>
                {c.text}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
