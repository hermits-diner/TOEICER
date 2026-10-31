import { ChevronLeft, Flag, GraduationCap, Printer, RotateCcw, Save, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import AudioPlayer from "../components/AudioPlayer";
import SpeakButton from "../components/SpeakButton";
import HighlightToolbar from "../components/HighlightToolbar";
import ToeicPrintSheet, { type PrintMode } from "../components/ToeicPrintSheet";
import QuestionGroupView from "../components/QuestionGroupView";
import { useDraftSaver } from "../components/useDraftSaver";
import { bandFor, formatBand, type BandResult } from "../lib/bandTable";
import { BRAND } from "../lib/brand";
import { answeredIn, clockOf, DraftUnreadable, restoreDraft, savedAgo } from "../lib/draft";
import { loadDraft, loadTest, saveAttempt, setQuestionReported, updateAttemptScore, type Draft, type DraftInput } from "../lib/repo";
import { scoreTest, type ScoreResult } from "../lib/scoring";
import { passageTab } from "../lib/taskLabels";
import type { TestDetail } from "../lib/types";

/** Time allowed per question, from the exam (TOEIC Reading: 75 minutes for 100). */
const SECONDS_PER_ITEM = BRAND.secondsPerItem;
const MIN_SECONDS = 3 * 60;

/** Plain text of stored HTML, one line per paragraph (for reading a script aloud). */
const htmlText = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/g, "\n"), "text/html").body.textContent?.trim() ?? "";

function fmt(sec: number): string {
  const s = Math.max(0, sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

interface Outcome {
  score: ScoreResult;
  band: BandResult;
  elapsed: number;
  byQuestion: Record<number, boolean>;
}

export default function ReadingPractice({ testId, onExit }: { testId: number; onExit: () => void }) {
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passageIdx, setPassageIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>("questions");
  const [printMenu, setPrintMenu] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  /** Questions reported as flawed (AI-written sets); left out of scoring. */
  const [reported, setReported] = useState<Set<number>>(new Set());
  const attemptId = useRef<Promise<number> | null>(null);
  /** Passage HTML with the user's highlights, per passage, kept while the attempt lasts (and in its draft). */
  const [marked, setMarked] = useState<Record<number, string>>({});
  /** Exam conditions: no dictionary, like the real test. */
  const [examMode, setExamMode] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [textEl, setTextEl] = useState<HTMLDivElement | null>(null);
  /** An attempt left before submitting, offered before the clock starts; the clock runs once `started`. */
  const [offer, setOffer] = useState<Draft | null>(null);
  const [started, setStarted] = useState(false);
  /** Resumed after the time had run out: the clock stays at zero and the set waits to be submitted. */
  const [overtime, setOvertime] = useState(false);
  /** A stored draft that could not be read and was removed: said once, the set starts afresh. */
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  /** The draft could not be looked up (a database error): the set waits, so nothing overwrites a draft that may be fine. */
  const [draftBlocked, setDraftBlocked] = useState<string | null>(null);
  const [draftTry, setDraftTry] = useState(0);
  /** Something worth keeping was done (or a draft resumed); until then leaving keeps no draft. */
  const touched = useRef(false);

  const draft = useDraftSaver(
    testId,
    (): DraftInput | undefined =>
      started && !outcome && touched.current
        ? { answers, flagged: [...flagged], marked: Object.keys(marked).length ? marked : null, passageIdx, elapsedSec: elapsed }
        : undefined,
  );
  const { flush: flushDraft, discard: discardDraft, discardOnceSaved } = draft;
  const changed = () => {
    touched.current = true;
    draft.schedule();
  };
  const answer = (id: number, v: string) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    changed();
  };

  const toggleFlag = (id: number) => {
    setFlagged((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    changed();
  };

  /** Shows a question from the navigator: switches passage if needed, then scrolls it into view. */
  const goTo = (passageIndex: number, questionId: number) => {
    setPassageIdx(passageIndex);
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-${questionId}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.querySelector<HTMLElement>("input, button.choice, button.dropdown-btn")?.focus({ preventScroll: true });
    });
  };

  const print = (mode: PrintMode) => {
    // Render the chosen sheet synchronously before the print dialog snapshots the DOM.
    flushSync(() => {
      setPrintMode(mode);
      setPrintMenu(false);
    });
    window.print();
  };

  useEffect(() => {
    loadTest(testId).then(
      (t) => {
        setTest(t);
        setReported(new Set(t.reported));
      },
      (e) => setError(String(e)),
    );
  }, [testId]);

  // A draft whose text cannot be read is removed (else the list keeps showing it) and the set starts afresh. A
  // database error removes nothing: the set waits until the draft can be read, so no new save overwrites it.
  useEffect(() => {
    let live = true;
    loadDraft(testId).then(
      (d) => {
        if (!live) return;
        setDraftBlocked(null);
        if (d) setOffer(d);
        else setStarted(true);
      },
      (e: unknown) => {
        if (!live) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof DraftUnreadable) {
          setDraftLoadError(`${msg} · 처음부터 시작합니다 (읽지 못한 임시저장은 지웠습니다).`);
          void discardDraft();
          setStarted(true);
        } else setDraftBlocked(msg);
      },
    );
    return () => {
      live = false;
    };
  }, [testId, draftTry, discardDraft]);

  // Reading runs against the clock; a Listening set lasts as long as its recordings, so it only counts up.
  const listening = test?.kind === "listening";
  const itemCount = test?.passages.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0), 0) ?? 0;
  const limit = listening ? Infinity : Math.max(MIN_SECONDS, itemCount * SECONDS_PER_ITEM);

  const flatQuestions = useMemo(
    () =>
      test?.passages.flatMap((p) =>
        p.groups.flatMap((g) => g.questions.map((q) => ({ id: q.id, answer: q.answer }))),
      ) ?? [],
    [test],
  );

  const grade = useCallback(
    (skip: Set<number>, spent: number): Outcome | null => {
      if (!test) return null;
      const score = scoreTest(
        flatQuestions.filter((q) => !skip.has(q.id)),
        answers,
      );
      const band = bandFor(test.kind, score.correct, score.total);
      const byQuestion = Object.fromEntries(score.results.map((r) => [r.questionId, r.isCorrect]));
      return { score, band, elapsed: spent, byQuestion };
    },
    [test, flatQuestions, answers],
  );

  const submit = useCallback(() => {
    if (!test || outcome) return;
    const o = grade(reported, elapsed);
    if (!o) return;
    // The draft gets the latest answers first, so it still holds them if the attempt cannot be saved.
    void flushDraft();
    setOutcome(o);
    setConfirmSubmit(false);
    setOvertime(false);
    // Every answer is kept, reported or not, so withdrawing a report later restores it in the statistics.
    const saving = saveAttempt(test.id, elapsed, o.score.correct, o.band.band, scoreTest(flatQuestions, answers).results);
    attemptId.current = saving;
    saving.catch((e) => setSaveError(`기록 저장 실패: ${String(e)}`));
    void discardOnceSaved(saving);
  }, [test, outcome, grade, reported, elapsed, flatQuestions, answers, flushDraft, discardOnceSaved]);

  /** Reports a flawed question or withdraws the report; after submission the attempt is rescored. */
  const toggleReport = (id: number) => {
    const next = new Set(reported);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setReported(next);
    setQuestionReported(id, next.has(id)).catch((e) => setSaveError(`신고 저장 실패: ${String(e)}`));
    if (!outcome) return;
    const o = grade(next, outcome.elapsed);
    if (!o) return;
    setOutcome(o);
    attemptId.current
      ?.then((aid) => updateAttemptScore(aid, o.score.correct, o.band.band))
      .catch((e) => setSaveError(`점수 갱신 실패: ${String(e)}`));
  };

  // Keep the latest submit for the timer without restarting the interval.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!test || outcome || !started || overtime) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [test, outcome, started, overtime]);

  useEffect(() => {
    if (test && started && !outcome && !overtime && elapsed >= limit) submitRef.current();
  }, [elapsed, limit, test, outcome, started, overtime]);

  // Moving to another passage is kept straight away (it is also where the set reopens).
  useEffect(() => {
    void flushDraft();
  }, [passageIdx, flushDraft]);

  const resume = () => {
    if (!test || !offer) return;
    const r = restoreDraft(test, offer);
    setAnswers(r.answers);
    setFlagged(new Set(r.flagged));
    setMarked(r.marked);
    setPassageIdx(r.passageIdx);
    setElapsed(r.elapsedSec);
    const late = r.elapsedSec >= limit;
    setOvertime(late);
    setConfirmSubmit(late);
    touched.current = true;
    setOffer(null);
    setStarted(true);
  };

  const startOver = () => {
    setOffer(null);
    setStarted(true);
    void discardDraft();
  };

  const saveNow = () => {
    touched.current = true;
    void draft.saveNow();
  };

  const restart = () => {
    setAnswers({});
    setElapsed(0);
    setOutcome(null);
    setSaveError(null);
    setPassageIdx(0);
    setFlagged(new Set());
    setMarked({});
    setOvertime(false);
    attemptId.current = null;
    touched.current = false;
  };

  if (error) return <div className="content"><p className="error">{error}</p></div>;
  if (!test || (!started && !offer && !draftBlocked)) return <div className="content"><p className="sub">불러오는 중…</p></div>;

  if (draftBlocked) {
    return (
      <div className="content">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
        <h1>{test.title}</h1>
        <p className="error">임시저장을 확인하지 못했습니다: {draftBlocked} · 임시저장은 그대로 두었습니다.</p>
        <div className="draft-choice">
          <button className="btn primary" onClick={() => setDraftTry((n) => n + 1)}>
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }

  if (offer) {
    const kept = restoreDraft(test, offer);
    return (
      <div className="content">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
        <h1>{test.title}</h1>
        <p className="sub">제출하지 않고 나간 풀이가 있습니다.</p>
        <div className="draft-choice">
          <button className="btn primary draft-option" onClick={resume}>
            <span className="draft-option-title">이어 풀기</span>
            <span className="draft-option-meta">
              {answeredIn(kept.answers)}/{flatQuestions.length}문항 답함 · {kept.elapsedSec >= limit ? "제한 시간 끝남 · " : ""}
              {savedAgo(offer.updatedAt)} 저장
            </span>
          </button>
          <button className="btn draft-option" onClick={startOver}>
            <span className="draft-option-title">처음부터</span>
            <span className="draft-option-meta">임시저장을 지우고 새로 풉니다</span>
          </button>
        </div>
      </div>
    );
  }

  const passage = test.passages[passageIdx];
  const remaining = limit - elapsed;

  const answeredCount = flatQuestions.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
  const unanswered = flatQuestions.length - answeredCount;
  const askSubmit = () => (unanswered > 0 ? setConfirmSubmit(true) : submit());

  return (
    <div className="practice" data-exam={examMode ? "on" : undefined}>
      <header className="practice-bar">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
        <div className="practice-title">{test.title}</div>
        {test.passages.length > 1 && (
          <div className="segmented small">
            {test.passages.map((p, i) => (
              <button key={p.id} className={i === passageIdx ? "on" : ""} title={p.title ?? undefined} onClick={() => setPassageIdx(i)}>
                {passageTab(p.title, i)}
              </button>
            ))}
          </div>
        )}
        <span className="muted">
          {answeredCount}/{flatQuestions.length} 응답
        </span>
        {!outcome && (
          <button
            className={`btn ghost${examMode ? " exam-on" : ""}`}
            title={examMode ? "실전 모드: 사전을 쓸 수 없습니다" : "실전 모드로 바꾸기 (사전 끄기)"}
            onClick={() => setExamMode((v) => !v)}
          >
            <GraduationCap size={15} /> {examMode ? "실전 모드" : "연습 모드"}
          </button>
        )}
        <div className="menu-anchor">
          <button className="btn ghost" title="인쇄" onClick={() => setPrintMenu((v) => !v)}>
            <Printer size={15} />
          </button>
          {printMenu && (
            <div className="menu" onMouseLeave={() => setPrintMenu(false)}>
              <button onClick={() => print("questions")}>문제지 인쇄</button>
              <button onClick={() => print("answers")}>
                {outcome ? "문제지 + 정답·채점 결과 인쇄" : "문제지 + 정답 인쇄"}
              </button>
            </div>
          )}
        </div>
        <span className={`timer${!outcome && remaining <= 300 ? " urgent" : ""}`}>
          <Timer size={14} /> {outcome ? fmt(outcome.elapsed) : fmt(listening ? elapsed : remaining)}
        </span>
        {!outcome && (
          <button className="btn ghost" title="지금까지 푼 내용을 저장합니다. 목록으로 나갔다가 이어 풀 수 있습니다." onClick={saveNow}>
            <Save size={14} /> {draft.savedAt ? `임시저장됨 · ${clockOf(draft.savedAt)}` : "임시저장"}
          </button>
        )}
        {outcome ? (
          <button className="btn" onClick={restart}>
            <RotateCcw size={14} /> 다시 풀기
          </button>
        ) : (
          <button className="btn primary" onClick={askSubmit}>
            제출
          </button>
        )}
      </header>

      {/* A failed delete after submitting shows on the result screen too. */}
      {(draft.error || (draftLoadError && !outcome)) && <p className="error draft-error">{draft.error ?? draftLoadError}</p>}

      {confirmSubmit && !outcome && (
        <div className="submit-confirm">
          {overtime ? (
            <span>제한 시간이 끝난 풀이입니다. 답을 확인한 뒤 제출해 주십시오.</span>
          ) : (
            <span>
              아직 답하지 않은 문항이 {unanswered}개 있습니다. 실제 시험에서는 빈칸도 오답 감점이 없으니 무엇이든 적어 두는 편이
              유리합니다.
            </span>
          )}
          <button className="btn" onClick={() => setConfirmSubmit(false)}>돌아가기</button>
          <button className="btn primary" onClick={submit}>그대로 제출</button>
        </div>
      )}

      {outcome && (
        <div className="result-banner">
          <div>
            <span className="result-big">
              {outcome.score.correct}/{outcome.score.total}
            </span>
            <span className="muted">정답</span>
          </div>
          <div>
            <span className="result-big">{formatBand(outcome.band)}</span>
            <span className="muted">{test.kind === "listening" ? "Listening" : "Reading"} 예상 {BRAND.scoreName} · 정답률 {outcome.band.scaled}%</span>
          </div>
          <div>
            <span className="result-big">{fmt(outcome.elapsed)}</span>
            <span className="muted">소요 시간</span>
          </div>
          {saveError && <p className="error">{saveError}</p>}
        </div>
      )}

      <div className="split lookup-zone" data-test-id={test.id}>
        {/* Keyed by passage so each Part opens at its top, not where the previous one was scrolled to. */}
        <article key={`text-${passage.id}`} className="passage">
          {passage.title && <h2>{passage.title}</h2>}
          {listening &&
            (passage.audio ? (
              <AudioPlayer key={passage.id} source={passage.audio} />
            ) : passage.bodyHtml ? (
              <div className="accent-row">
                <SpeakButton key={passage.id} text={htmlText(passage.bodyHtml)} label="듣기 (Windows 음성)" />
              </div>
            ) : (
              <p className="muted">이 세트에는 음성이 없습니다.</p>
            ))}
          {listening && passage.bodyHtml && !outcome && <p className="muted">스크립트는 제출한 뒤에 볼 수 있습니다.</p>}
          {/* body_html is built from escaped text in passageToHtml; for Listening it is the script, shown after submission */}
          {(!listening || outcome) && (
            <div
              ref={setTextEl}
              key={passage.id}
              className="passage-text"
              dangerouslySetInnerHTML={{ __html: marked[passage.id] ?? passage.bodyHtml }}
            />
          )}
        </article>
        <div key={`questions-${passage.id}`} className="questions">
          {passage.groups.map((g) => (
            <QuestionGroupView
              key={g.id}
              group={g}
              answers={answers}
              onAnswer={answer}
              results={outcome?.byQuestion}
              flagged={flagged}
              onToggleFlag={toggleFlag}
              reported={reported}
              onToggleReport={test.ai ? toggleReport : undefined}
            />
          ))}
        </div>
      </div>

      <HighlightToolbar
        container={textEl}
        onChange={(html) => {
          setMarked((m) => ({ ...m, [passage.id]: html }));
          changed();
        }}
      />

      <nav className="qnav" aria-label="문항 이동">
        {test.passages.map((p, pi) => (
          <div key={p.id} className={`qnav-part${pi === passageIdx ? " current" : ""}`}>
            <span className="qnav-label">{passageTab(p.title, pi)}</span>
            {p.groups.flatMap((g) => g.questions).map((q) => {
              const state = reported.has(q.id)
                ? " reported"
                : outcome
                ? outcome.byQuestion[q.id]
                  ? " correct"
                  : " wrong"
                : (answers[q.id] ?? "").trim()
                  ? " answered"
                  : "";
              return (
                <button
                  key={q.id}
                  className={`qnav-btn${state}${flagged.has(q.id) ? " flagged" : ""}`}
                  title={flagged.has(q.id) ? `${q.number}번 · 나중에 보기` : `${q.number}번`}
                  onClick={() => goTo(pi, q.id)}
                >
                  {q.number}
                </button>
              );
            })}
          </div>
        ))}
        {!outcome && flagged.size > 0 && (
          <span className="qnav-legend">
            <Flag size={11} /> 나중에 보기 {flagged.size}
          </span>
        )}
      </nav>

      <ToeicPrintSheet test={test} mode={printMode} responses={outcome ? answers : undefined} results={outcome?.byQuestion} />
    </div>
  );
}
