import { Check, Flag, MessageSquareWarning, X } from "lucide-react";
import { groupItems, picksOf, togglePick } from "../lib/multiSelect";
import type { Question, QuestionGroup } from "../lib/types";
import BuildSentence from "./BuildSentence";
import Dropdown from "./Dropdown";
import ExplainPanel from "./ExplainPanel";

const JUDGEMENTS = {
  tfng: ["TRUE", "FALSE", "NOT GIVEN"],
  ynng: ["YES", "NO", "NOT GIVEN"],
} as const;

interface Props {
  group: QuestionGroup;
  answers: Record<number, string>;
  onAnswer: (questionId: number, value: string) => void;
  /** Present after submission: per-question correctness. */
  results?: Record<number, boolean>;
  /** Questions marked "나중에 보기", as in the computer-delivered test. */
  flagged?: Set<number>;
  onToggleFlag?: (questionId: number) => void;
  /** AI-written sets: questions reported as flawed, which are not scored. */
  reported?: Set<number>;
  onToggleReport?: (questionId: number) => void;
}

export default function QuestionGroupView({ group, answers, onAnswer, results, flagged, onToggleFlag, reported, onToggleReport }: Props) {
  const locked = results !== undefined;
  // Bare letters (paragraphs A–H) are listed by the answer control itself; only worded options need the box.
  const showGroupOptions = (group.type === "heading" || group.type === "matching") && group.options.some((o) => o.text);

  const headButtons = (ids: number[], isReported: boolean) => {
    const id = ids[0];
    const isFlagged = flagged?.has(id) ?? false;
    return (
      <>
        {onToggleFlag && !results && (
          <button
            className={`flag-btn${isFlagged ? " on" : ""}`}
            title={isFlagged ? "나중에 보기 해제" : "나중에 보기"}
            onClick={() => ids.forEach((i) => onToggleFlag(i))}
          >
            <Flag size={13} />
          </button>
        )}
        {onToggleReport && (
          <button
            className={`flag-btn report-btn${isReported ? " on" : ""}`}
            title={isReported ? "신고 취소 (다시 채점에 넣기)" : "문제가 이상해요: 신고하면 채점에서 뺍니다"}
            onClick={() => ids.forEach((i) => onToggleReport(i))}
          >
            <MessageSquareWarning size={13} />
          </button>
        )}
      </>
    );
  };

  const renderSingle = (q: Question) => {
    const value = answers[q.id] ?? "";
    const isReported = reported?.has(q.id) ?? false;
    const state = isReported ? "reported" : results ? (results[q.id] ? "correct" : "wrong") : "";
    const choices = q.options.length ? q.options : group.options;
    // Clicking the selected answer again clears it.
    const pick = (v: string) => onAnswer(q.id, value === v ? "" : v);
    const judgement = group.type === "tfng" || group.type === "ynng";
    const lettered = group.type === "heading" || group.type === "matching";

    return (
      <div key={q.id} id={`q-${q.id}`} className={`question ${state}${flagged?.has(q.id) ? " flagged" : ""}`}>
        <div className="question-head">
          <span className="qnum">{q.number}</span>
          {q.prompt && group.type !== "build" && <span className="qprompt">{q.prompt}</span>}
          {group.type === "build" && (
            <span className="qprompt">
              <span className="build-line">{q.prompt}</span>
            </span>
          )}
          {headButtons([q.id], isReported)}
          {results && !isReported && (results[q.id] ? <Check className="mark ok" /> : <X className="mark bad" />)}
        </div>
        {isReported && <p className="reported-note">신고한 문항 · 채점과 학습 통계에서 뺍니다</p>}

        {judgement && (
          <div className="choices inline">
            {JUDGEMENTS[group.type as "tfng" | "ynng"].map((j) => (
              <button key={j} disabled={locked} className={`choice${value === j ? " on" : ""}`} onClick={() => pick(j)}>
                {j}
              </button>
            ))}
          </div>
        )}

        {group.type === "lmcq" && (
          <div className="choices letters">
            {choices.map((o) => (
              <button key={o.key} disabled={locked} className={`choice${value === o.key ? " on" : ""}`} onClick={() => pick(o.key)}>
                <b>{o.key}</b>
                {/* The choices are heard in the test; their words appear once the answer is graded. */}
                {results && <span>{o.text}</span>}
              </button>
            ))}
          </div>
        )}

        {group.type === "mcq" && (
          <div className="choices">
            {choices.map((o) => (
              <button
                key={o.key}
                disabled={locked}
                className={`choice${value === o.key ? " on" : ""}`}
                onClick={() => pick(o.key)}
              >
                <b>{o.key}</b>
                <span>{o.text}</span>
              </button>
            ))}
          </div>
        )}

        {group.type === "build" && (
          <BuildSentence question={q} value={value} locked={locked} onChange={(v) => onAnswer(q.id, v)} />
        )}

        {lettered && (
          <Dropdown options={choices} value={value} disabled={locked} onChange={(v) => onAnswer(q.id, v)} />
        )}

        {(group.type === "fill" || group.type === "short") && (
          <input
            className="field"
            disabled={locked}
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder="답 입력"
            onChange={(e) => onAnswer(q.id, e.target.value)}
          />
        )}

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

  /* "Choose THREE letters": one question per mark in storage, one item with three picks on screen. */
  const renderMulti = (qs: Question[]) => {
    const first = qs[0];
    const ids = qs.map((q) => q.id);
    const n = qs.length;
    const picks = picksOf(answers, qs);
    const full = picks.length >= n;
    const pool = new Set(first.answer.map((a) => a.trim().toUpperCase()));
    const isReported = ids.some((id) => reported?.has(id));
    const correct = results ? ids.filter((id) => results[id]).length : 0;
    const state = isReported ? "reported" : results ? (correct === n ? "correct" : "wrong") : "";
    const numbers = `${first.number}–${qs[n - 1].number}`;
    const keyText = group.options.filter((o) => pool.has(o.key.toUpperCase())).map((o) => o.key).join(", ");

    const pick = (key: string) => {
      for (const [id, v] of togglePick(answers, qs, group.options, key)) onAnswer(id, v);
    };

    return (
      <div key={first.id} id={`q-${first.id}`} className={`question multi ${state}${flagged?.has(first.id) ? " flagged" : ""}`}>
        {ids.slice(1).map((id) => (
          <span key={id} id={`q-${id}`} />
        ))}
        <div className="question-head">
          <span className="qnum">{numbers}</span>
          <span className="qprompt">
            {first.prompt}
            <span className="pick-hint">
              {" "}
              ({n}개 선택{!locked && picks.length > 0 ? ` · ${picks.length}/${n}` : ""})
            </span>
          </span>
          {headButtons(ids, isReported)}
          {results && !isReported && (
            <span className={`mark-count ${correct === n ? "ok" : "bad"}`}>
              {correct}/{n}
            </span>
          )}
        </div>
        {isReported && <p className="reported-note">신고한 문항 · 채점과 학습 통계에서 뺍니다</p>}

        <div className="choices">
          {group.options.map((o) => {
            const on = picks.includes(o.key);
            const verdict = results && on ? (pool.has(o.key.toUpperCase()) ? " ok" : " bad") : "";
            return (
              <button
                key={o.key}
                disabled={locked || (full && !on)}
                className={`choice${on ? " on" : ""}${verdict}`}
                onClick={() => pick(o.key)}
              >
                <b>{o.key}</b>
                <span>{o.text}</span>
              </button>
            );
          })}
        </div>

        {results && isReported && <p className="answer-key">AI가 정한 답: {keyText}</p>}
        {results && !isReported && correct < n && (
          <>
            <p className="answer-key">정답: {keyText}</p>
            <ExplainPanel questionId={first.id} userAnswer={picks.join(", ")} />
          </>
        )}
      </div>
    );
  };

  return (
    <section className="qgroup">
      {group.instructions && <p className="qgroup-instructions">{group.instructions}</p>}
      {group.image && <img className="qgroup-figure" src={group.image} alt="" />}

      {showGroupOptions && (
        <ul className="option-list">
          {group.options.map((o) => (
            <li key={o.key}>
              <b>{o.key}</b> {o.text}
            </li>
          ))}
        </ul>
      )}

      {groupItems(group).map((item) => (item.kind === "multi" ? renderMulti(item.questions) : renderSingle(item.question)))}
    </section>
  );
}
