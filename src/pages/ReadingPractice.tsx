import { ChevronLeft, Flag, GraduationCap, Printer, RotateCcw, Sparkles, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import AudioPlayer from "../components/AudioPlayer";
import CompleteWords from "../components/CompleteWords";
import SpeakButton from "../components/SpeakButton";
import HighlightToolbar from "../components/HighlightToolbar";
import PrintSheet, { type PrintMode } from "../components/PrintSheet";
import ToeicPrintSheet, { partOf } from "../components/ToeicPrintSheet";
import QuestionGroupView from "../components/QuestionGroupView";
import { errorText, loadAiSettings } from "../lib/ai";
import { bandFor, formatBand, type BandResult } from "../lib/bandTable";
import { BRAND } from "../lib/brand";
import { passageToHtml } from "../lib/importFormat";
import { loadTest, saveAttempt, setQuestionReported, updateAttemptScore, updatePassageBody } from "../lib/repo";
import { scoreTest, type ScoreResult } from "../lib/scoring";
import { transcribeListening } from "../lib/transcript";
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
  /** Passage HTML with the user's highlights, per passage, kept while the attempt lasts. */
  const [marked, setMarked] = useState<Record<number, string>>({});
  /** Exam conditions: no dictionary, like the real test. */
  const [examMode, setExamMode] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [textEl, setTextEl] = useState<HTMLDivElement | null>(null);
  /** Listening sets collected without a script: the recording is being transcribed by the AI. */
  const [scripting, setScripting] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const toggleFlag = (id: number) =>
    setFlagged((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  // Reading runs against the clock; a listening section lasts as long as its recording, so it only counts up.
  const listening = test?.kind === "listening";
  const itemCount = test?.passages.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0), 0) ?? 0;
  const limit = listening ? Infinity : Math.max(MIN_SECONDS, itemCount * SECONDS_PER_ITEM);

  const flatQuestions = useMemo(
    () =>
      test?.passages.flatMap((p) =>
        p.groups.flatMap((g) => g.questions.map((q) => ({ id: q.id, type: g.type, answer: q.answer }))),
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
      const band = bandFor(test.kind, test.module, score.correct, score.total);
      const byQuestion = Object.fromEntries(score.results.map((r) => [r.questionId, r.isCorrect]));
      return { score, band, elapsed: spent, byQuestion };
    },
    [test, flatQuestions, answers],
  );

  const submit = useCallback(() => {
    if (!test || outcome) return;
    const o = grade(reported, elapsed);
    if (!o) return;
    setOutcome(o);
    setConfirmSubmit(false);
    // Every answer is kept, reported or not, so withdrawing a report later restores it in the statistics.
    const saving = saveAttempt(test.id, elapsed, o.score.correct, o.band.band, scoreTest(flatQuestions, answers).results);
    attemptId.current = saving;
    saving.catch((e) => setSaveError(`기록 저장 실패: ${String(e)}`));
  }, [test, outcome, grade, reported, elapsed, flatQuestions, answers]);

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
    if (!test || outcome) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [test, outcome]);

  useEffect(() => {
    if (test && !outcome && elapsed >= limit) submitRef.current();
  }, [elapsed, limit, test, outcome]);

  const restart = () => {
    setAnswers({});
    setElapsed(0);
    setOutcome(null);
    setSaveError(null);
    setPassageIdx(0);
    setFlagged(new Set());
    setMarked({});
    attemptId.current = null;
  };

  if (error) return <div className="content"><p className="error">{error}</p></div>;
  if (!test) return <div className="content"><p className="sub">불러오는 중…</p></div>;

  const passage = test.passages[passageIdx];
  /** "Complete the Words": the blanks sit inside the paragraph, so there is no separate question column. */
  const cwordPassage = passage.groups.length > 0 && passage.groups.every((g) => g.type === "cword");
  /** "Build a Sentence": short instructions and many items, read top to bottom in one column. */
  const buildPassage = passage.groups.length > 0 && passage.groups.every((g) => g.type === "build");
  const remaining = limit - elapsed;

  /** Transcribes this section's recording and stores it as the section's script. */
  const makeScript = async () => {
    if (!passage.audio) return;
    setScripting(true);
    setScriptError(null);
    try {
      const body = await transcribeListening(loadAiSettings(), passage.audio);
      const html = passageToHtml({ body, groups: [] });
      await updatePassageBody(passage.id, html);
      setTest((t) => t && { ...t, passages: t.passages.map((p) => (p.id === passage.id ? { ...p, bodyHtml: html } : p)) });
    } catch (e) {
      setScriptError(errorText(e));
    } finally {
      setScripting(false);
    }
  };
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
                {passageTab(p.title, i, test.passages.length, listening ? "Section" : "Passage")}
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

      {confirmSubmit && !outcome && (
        <div className="submit-confirm">
          <span>
            아직 답하지 않은 문항이 {unanswered}개 있습니다. 실제 시험에서는 빈칸도 오답 감점이 없으니 무엇이든 적어 두는 편이
            유리합니다.
          </span>
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

      <div className={`split lookup-zone${cwordPassage || buildPassage ? " single" : ""}`} data-test-id={test.id}>
        {!buildPassage && (
        <article className="passage">
          {passage.title && <h2>{passage.title}</h2>}
          {listening &&
            (passage.audio ? (
              <AudioPlayer key={passage.id} source={passage.audio} />
            ) : passage.bodyHtml ? (
              <div className="accent-row">
                <SpeakButton key={passage.id} text={htmlText(passage.bodyHtml)} label="듣기 (Windows 음성)" />
              </div>
            ) : (
              <p className="muted">이 섹션에는 음성이 없습니다.</p>
            ))}
          {listening && passage.bodyHtml && !outcome && <p className="muted">스크립트는 제출한 뒤에 볼 수 있습니다.</p>}
          {listening && passage.audio && (!passage.bodyHtml || outcome) && (
            <div className="script-tools">
              {!passage.bodyHtml && <span className="muted">이 섹션에는 스크립트가 없습니다.</span>}
              <button className="btn small" disabled={scripting} onClick={makeScript}>
                <Sparkles size={13} /> {scripting ? "받아쓰는 중…" : passage.bodyHtml ? "AI로 스크립트 다시 만들기" : "AI로 스크립트 만들기"}
              </button>
              {scriptError && <span className="error">{scriptError}</span>}
            </div>
          )}
          {/* body_html is built from escaped text in passageToHtml; for listening it is the transcript, shown after submission */}
          {cwordPassage && (
            <CompleteWords
              key={passage.id}
              bodyHtml={passage.bodyHtml}
              questions={passage.groups.flatMap((g) => g.questions)}
              answers={answers}
              onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
              results={outcome?.byQuestion}
            />
          )}
          {!cwordPassage && (!listening || outcome) && (
            <div
              ref={setTextEl}
              key={passage.id}
              className="passage-text"
              dangerouslySetInnerHTML={{ __html: marked[passage.id] ?? passage.bodyHtml }}
            />
          )}
        </article>
        )}
        {!cwordPassage && (
        <div className={`questions${buildPassage ? " single-col" : ""}`}>
          {buildPassage && (
            /* body_html is built from escaped text in passageToHtml */
            <div className="build-intro" dangerouslySetInnerHTML={{ __html: passage.bodyHtml }} />
          )}
          {passage.groups.map((g) => (
            <QuestionGroupView
              key={g.id}
              group={g}
              answers={answers}
              onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
              results={outcome?.byQuestion}
              flagged={flagged}
              onToggleFlag={toggleFlag}
              reported={reported}
              onToggleReport={test.ai ? toggleReport : undefined}
            />
          ))}
        </div>
        )}
      </div>

      <HighlightToolbar container={textEl} onChange={(html) => setMarked((m) => ({ ...m, [passage.id]: html }))} />

      <nav className="qnav" aria-label="문항 이동">
        {test.passages.map((p, pi) => (
          <div key={p.id} className={`qnav-part${pi === passageIdx ? " current" : ""}`}>
            <span className="qnav-label">{passageTab(p.title, pi, test.passages.length, listening ? "Part" : "Passage")}</span>
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

      {test.passages.length > 0 && test.passages.every((p) => partOf(p)) ? (
        <ToeicPrintSheet test={test} mode={printMode} responses={outcome ? answers : undefined} results={outcome?.byQuestion} />
      ) : (
        <PrintSheet test={test} mode={printMode} responses={outcome ? answers : undefined} results={outcome?.byQuestion} />
      )}
    </div>
  );
}
