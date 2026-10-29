import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Question } from "../lib/types";

/** `[[n]]` marks where question n's blank sits in the stored paragraph. */
export const BLANK_RE = /\[\[(\d+)\]\]/g;

/** The paragraph HTML with each blank replaced by an empty slot an input is portalled into. */
export function slotHtml(bodyHtml: string): string {
  return bodyHtml.replace(BLANK_RE, '<span class="cword-slot" data-n="$1"></span>');
}

/**
 * "Complete the Words": the paragraph with the second half of some words missing, typed in place.
 * The paragraph is stored as escaped HTML; inputs are mounted into its slots so the text is never re-parsed by React.
 */
export default function CompleteWords({
  bodyHtml,
  questions,
  answers,
  onAnswer,
  results,
}: {
  bodyHtml: string;
  questions: Question[];
  answers: Record<number, string>;
  onAnswer: (questionId: number, value: string) => void;
  results?: Record<number, boolean>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ el: HTMLElement; q: Question }[]>([]);

  useLayoutEffect(() => {
    const byNumber = new Map(questions.map((q) => [q.number, q]));
    const found: { el: HTMLElement; q: Question }[] = [];
    box.current?.querySelectorAll<HTMLElement>(".cword-slot").forEach((el) => {
      const q = byNumber.get(Number(el.dataset.n));
      if (q) found.push({ el, q });
    });
    setSlots(found);
  }, [bodyHtml, questions]);

  const focusNext = (from: number) => {
    const inputs = box.current?.querySelectorAll<HTMLInputElement>("input.cword-input");
    inputs?.[from + 1]?.focus();
  };

  return (
    <>
      {/* body_html is built from escaped text in passageToHtml */}
      <div ref={box} className="passage-text cword-text" dangerouslySetInnerHTML={{ __html: slotHtml(bodyHtml) }} />
      {slots.map(({ el, q }, i) => {
        const value = answers[q.id] ?? "";
        const missing = q.answer[0] ?? "";
        const state = results ? (results[q.id] ? " correct" : " wrong") : "";
        return createPortal(
          <span className="cword-word" id={`q-${q.id}`}>
            <span className="cword-shown">{q.prompt}</span>
            <input
              className={`cword-input${state}`}
              value={value}
              disabled={results !== undefined}
              spellCheck={false}
              autoComplete="off"
              aria-label={`${q.number}번 빈칸`}
              placeholder={"_".repeat(missing.length)}
              style={{ width: `${Math.max(missing.length, value.length, 2) + 1.2}ch` }}
              onChange={(e) => onAnswer(q.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === " " && value)) {
                  e.preventDefault();
                  focusNext(i);
                }
              }}
            />
            {results && !results[q.id] && <span className="cword-fix">{missing}</span>}
          </span>,
          el,
          q.id,
        );
      })}
    </>
  );
}
