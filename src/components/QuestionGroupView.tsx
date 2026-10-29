import { Check, Flag, MessageSquareWarning, X } from "lucide-react";
import type { Question, QuestionGroup } from "../lib/types";
import ExplainPanel from "./ExplainPanel";

interface Props {
  group: QuestionGroup;
  answers: Record<number, string>;
  onAnswer: (questionId: number, value: string) => void;
  /** Present after submission: per-question correctness. */
  results?: Record<number, boolean>;
  /** Questions marked "나중에 보기". */
  flagged?: Set<number>;
  onToggleFlag?: (questionId: number) => void;
  /** AI-written sets: questions reported as flawed, which are not scored. */
  reported?: Set<number>;
  onToggleReport?: (questionId: number) => void;
}

/**
 * A group of TOEIC questions; a question's choices are its own, or the group's when it shares them. Parts 1 and 2
 * (`lmcq`) show only the letters while the choices are heard; their words appear once the answer is graded.
 */
export default function QuestionGroupView({ group, answers, onAnswer, results, flagged, onToggleFlag, reported, onToggleReport }: Props) {
  const locked = results !== undefined;
  const heard = group.type === "lmcq";

  const renderQuestion = (q: Question) => {
    const value = answers[q.id] ?? "";
    const isReported = reported?.has(q.id) ?? false;
    const isFlagged = flagged?.has(q.id) ?? false;
    const state = isReported ? "reported" : results ? (results[q.id] ? "correct" : "wrong") : "";
    const choices = q.options.length ? q.options : group.options;
    // Clicking the selected answer again clears it.
    const pick = (v: string) => onAnswer(q.id, value === v ? "" : v);

    return (
      <div key={q.id} id={`q-${q.id}`} className={`question ${state}${isFlagged ? " flagged" : ""}`}>
        <div className="question-head">
          <span className="qnum">{q.number}</span>
          {q.prompt && <span className="qprompt">{q.prompt}</span>}
          {onToggleFlag && !results && (
            <button className={`flag-btn${isFlagged ? " on" : ""}`} title={isFlagged ? "나중에 보기 해제" : "나중에 보기"} onClick={() => onToggleFlag(q.id)}>
              <Flag size={13} />
            </button>
          )}
          {onToggleReport && (
            <button
              className={`flag-btn report-btn${isReported ? " on" : ""}`}
              title={isReported ? "신고 취소 (다시 채점에 넣기)" : "문제가 이상해요: 신고하면 채점에서 뺍니다"}
              onClick={() => onToggleReport(q.id)}
            >
              <MessageSquareWarning size={13} />
            </button>
          )}
          {results && !isReported && (results[q.id] ? <Check className="mark ok" /> : <X className="mark bad" />)}
        </div>
        {isReported && <p className="reported-note">신고한 문항 · 채점과 학습 통계에서 뺍니다</p>}

        <div className={`choices${heard ? " letters" : ""}`}>
          {choices.map((o) => (
            <button key={o.key} disabled={locked} className={`choice${value === o.key ? " on" : ""}`} onClick={() => pick(o.key)}>
              <b>{o.key}</b>
              {(!heard || results) && <span>{o.text}</span>}
            </button>
          ))}
        </div>

        {results && isReported && <p className="answer-key">AI가 정한 답: {q.answer.join(" / ")}</p>}
        {results && !isReported && !results[q.id] && (
          <>
            <p className="answer-key">정답: {q.answer.join(" / ")}</p>
            <ExplainPanel questionId={q.id} userAnswer={value} />
          </>
        )}
      </div>
    );
  };

  return (
    <section className="qgroup">
      {group.instructions && <p className="qgroup-instructions">{group.instructions}</p>}
      {group.image && <img className="qgroup-figure" src={group.image} alt="" />}
      {group.questions.map(renderQuestion)}
    </section>
  );
}
