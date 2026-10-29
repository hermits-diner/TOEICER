import { ChevronLeft, Eye, EyeOff, Pause, Play, Printer, RotateCcw, Save, Sparkles, Timer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import AudioPlayer from "../components/AudioPlayer";
import PromptPrintSheet from "../components/PromptPrintSheet";
import FeedbackView from "../components/FeedbackView";
import SpeakButton from "../components/SpeakButton";
import SpeakingRecorder, { isInterview, isRepeat } from "../components/SpeakingRecorder";
import { complete, errorText, FEEDBACK_SYSTEM, feedbackPrompt, loadAiSettings, parseFeedback } from "../lib/ai";
import {
  deleteEntry,
  listEntries,
  loadTest,
  saveEntry,
  saveFeedback,
  setEntryAudio,
  updateEntryBody,
  type PracticeEntry,
} from "../lib/repo";
import { evaluateRecording, saveRecording } from "../lib/speaking";
import { passageTab } from "../lib/taskLabels";
import type { Passage, TestDetail } from "../lib/types";

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const plain = (html: string) => html.replace(/<[^>]+>/g, " ");
/** Task text as the model should read it: tags dropped, entities decoded, paragraphs kept. */
const taskText = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/p>|<br\s*\/?>/g, "\n"), "text/html").body.textContent?.trim() ?? "";

/** What the exam allows for a task or part, as shown beside the timer. */
function allowance(test: TestDetail, p: Passage): string {
  const title = p.title ?? "";
  if (/email/i.test(title)) return "7분 · 요구 사항 3가지 모두 쓰기";
  if (/discussion/i.test(title)) return "10분 · 100단어 이상 권장";
  if (isInterview(title)) return "준비 없음 · 45초 답변";
  if (isRepeat(title)) return "한 번 듣고 그대로 따라 말하기";
  if (test.kind === "writing") {
    const minutes = plain(p.bodyHtml).match(/about (\d+) minutes/i)?.[1] ?? (p.title === "Task 2" ? "40" : "20");
    const words = plain(p.bodyHtml).match(/at least (\d+) words/i)?.[1];
    return `권장 ${minutes}분${words ? ` · ${words}단어 이상` : ""}`;
  }
  if (p.title === "Part 2") return "준비 1분 · 말하기 1–2분";
  return p.title === "Part 3" ? "4–5분" : "4–5분 · 짧게 답하기";
}

/** Writing and speaking practice: the task on the left, the user's own answer on the right, the model answer on request. */
export default function PromptPractice({ testId, onExit }: { testId: number; onExit: () => void }) {
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [entries, setEntries] = useState<PracticeEntry[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<Set<number>>(new Set());
  const [reviewErrors, setReviewErrors] = useState<Record<number, string>>({});
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  /** Listen and Repeat hides the sentence, as the test does, until the learner asks to see it. */
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const refresh = useCallback(() => {
    listEntries(testId).then(setEntries, (e) => setError(String(e)));
  }, [testId]);

  useEffect(() => {
    loadTest(testId).then(setTest, (e) => setError(String(e)));
    refresh();
  }, [testId, refresh]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (error) return <div className="content"><p className="error">{error}</p></div>;
  if (!test) return <div className="content"><p className="sub">불러오는 중…</p></div>;

  const writing = test.kind === "writing";
  const passage = test.passages[idx];
  const text = texts[passage.id] ?? "";
  const words = countWords(text);
  const mine = entries.filter((e) => e.passageId === passage.id);

  const choose = (i: number) => {
    setIdx(i);
    setElapsed(0);
    setRunning(false);
    setShowSample(false);
    setOpen(null);
  };

  const type = (value: string) => {
    setTexts((t) => ({ ...t, [passage.id]: value }));
    if (!running && value) setRunning(true); // the clock starts with the first keystroke
  };

  /** Asks the configured model for feedback on a saved entry and stores it with the entry. */
  const review = async (entry: Pick<PracticeEntry, "id" | "body" | "wordCount" | "audio">, p: Passage) => {
    const entryId = entry.id;
    const settings = loadAiSettings();
    setReviewing((r) => new Set(r).add(entryId));
    setReviewErrors((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });
    setOpen(entryId);
    try {
      if (entry.audio) {
        // A spoken answer: the transcript replaces the placeholder text, then the feedback is stored as usual.
        const r = await evaluateRecording(settings, entry.audio, p.title, taskText(p.bodyHtml));
        if (r.transcript) await updateEntryBody(entryId, r.transcript);
        await saveFeedback(entryId, r.provider, r.model, r.feedback);
      } else {
        const kind = test.kind === "speaking" ? "speaking" : "writing";
        const prompt = feedbackPrompt(kind, p.title, taskText(p.bodyHtml), entry.body, entry.wordCount);
        const r = await complete(settings, FEEDBACK_SYSTEM, prompt);
        await saveFeedback(entryId, settings.provider, r.model, parseFeedback(r.text));
      }
      refresh();
    } catch (e) {
      setReviewErrors((m) => ({ ...m, [entryId]: errorText(e) }));
    } finally {
      setReviewing((r) => {
        const next = new Set(r);
        next.delete(entryId);
        return next;
      });
    }
  };

  const save = async (withReview: boolean) => {
    const body = text.trim();
    let id = 0;
    try {
      id = await saveEntry(passage.id, body, words, elapsed);
    } catch (e) {
      setError(String(e));
      return;
    }
    setTexts((t) => ({ ...t, [passage.id]: "" }));
    setElapsed(0);
    setRunning(false);
    refresh();
    if (withReview && id) void review({ id, body, wordCount: words, audio: null }, passage);
  };

  /** Keeps the recording with a new entry, then has it transcribed and assessed. */
  const submitRecording = async ({ wav, seconds }: { wav: Uint8Array; seconds: number }) => {
    setRecBusy(true);
    setRecError(null);
    try {
      const name = await saveRecording(wav);
      const id = await saveEntry(passage.id, "(녹음 답변 · 받아쓰기 전)", 0, seconds);
      await setEntryAudio(id, name, seconds);
      refresh();
      await review({ id, body: "", wordCount: 0, audio: name }, passage);
    } catch (e) {
      setRecError(errorText(e));
    } finally {
      setRecBusy(false);
    }
  };

  /** Prints every task with its model answer; the sheet is mounted synchronously so the print dialog sees it. */
  const print = () => {
    flushSync(() => setPrinting(true));
    window.print();
    setPrinting(false);
  };

  const remove = async (id: number) => {
    await deleteEntry(id).catch((e) => setError(String(e)));
    refresh();
  };

  return (
    <div className="practice">
      {printing && <PromptPrintSheet test={test} draft={{ index: idx, text }} />}
      <header className="practice-bar">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
        <div className="practice-title">{test.title}</div>
        {test.passages.length > 1 && (
          <div className="segmented small">
            {test.passages.map((p, i) => (
              <button key={p.id} className={i === idx ? "on" : ""} title={p.title ?? undefined} onClick={() => choose(i)}>
                {passageTab(p.title, i, test.passages.length, writing ? "Task" : "Part")}
              </button>
            ))}
          </div>
        )}
        <span className="muted">{allowance(test, passage)}</span>
        <span className="timer">
          <Timer size={14} /> {fmt(elapsed)}
        </span>
        <button className="btn ghost" title={running ? "시계 멈춤" : "시계 시작"} onClick={() => setRunning((r) => !r)}>
          {running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="btn ghost" title="시계 처음으로" onClick={() => (setElapsed(0), setRunning(false))}>
          <RotateCcw size={14} />
        </button>
        <button className="btn ghost" title="과제와 모범 답안 인쇄 (쓰던 답안이 있으면 함께)" onClick={print}>
          <Printer size={14} />
        </button>
      </header>

      <div className="split lookup-zone" data-test-id={test.id}>
        <article className="passage">
          {passage.title && <h2>{passage.title}</h2>}
          {!writing && (
            <div className="accent-row">
              {passage.audio ? (
                <AudioPlayer key={passage.id} source={passage.audio} />
              ) : (
                <SpeakButton key={passage.id} text={taskText(passage.bodyHtml)} label={isRepeat(passage.title) ? "문장 듣기" : "질문 듣기"} />
              )}
            </div>
          )}
          {isRepeat(passage.title) && !revealed.has(passage.id) ? (
            <div className="task-card hidden-sentence">
              <p className="muted">실제 시험처럼 문장은 보이지 않습니다. 듣고 녹음한 뒤 확인하세요.</p>
              <button className="btn" onClick={() => setRevealed((r) => new Set(r).add(passage.id))}>
                <Eye size={14} /> 문장 보기
              </button>
            </div>
          ) : (
            /* body_html is built from escaped text in passageToHtml */
            <div className="task-card" dangerouslySetInnerHTML={{ __html: passage.bodyHtml }} />
          )}
          {passage.sampleHtml && (
            <>
              <button className="btn" onClick={() => setShowSample((s) => !s)}>
                {showSample ? <EyeOff size={14} /> : <Eye size={14} />} 모범 답안 {showSample ? "숨기기" : "보기"}
              </button>
              {showSample && <div className="sample-answer" dangerouslySetInnerHTML={{ __html: passage.sampleHtml }} />}
            </>
          )}
        </article>

        <div className="questions prompt-answer">
          {!writing && (
            <>
              <SpeakingRecorder key={passage.id} part={passage.title} busy={recBusy} onSubmit={(b) => void submitRecording(b)} />
              {recError && <p className="error">{recError}</p>}
            </>
          )}
          <textarea
            className="code body answer-area"
            value={text}
            spellCheck={false}
            placeholder={
              writing
                ? "여기에 답안을 작성해 주십시오. 첫 글자를 입력하면 시계가 시작됩니다."
                : "말할 내용을 메모하거나, 답변을 글로 적어 보십시오. 실제 시험처럼 소리 내어 말한 뒤 기록해도 좋습니다."
            }
            onChange={(e) => type(e.target.value)}
          />
          <div className="toolbar">
            <span className="muted">{words}단어</span>
            <span className="spacer" />
            <button className="btn" disabled={!text.trim()} onClick={() => void save(false)}>
              <Save size={14} /> 기록 저장
            </button>
            <button
              className="btn primary"
              disabled={!text.trim()}
              onClick={() => void save(true)}
              title="저장한 뒤 설정에서 고른 AI로 첨삭합니다"
            >
              <Sparkles size={14} /> 저장하고 AI 첨삭
            </button>
          </div>

          {mine.length > 0 && (
            <>
              <h3 className="section-title">지난 기록</h3>
              <div className="list">
                {mine.map((e) => (
                  <div key={e.id} className="job">
                    <div className="list-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <div className="row-main">
                        <div className="row-title">{new Date(e.createdAt.replace(" ", "T") + "Z").toLocaleString("ko-KR")}</div>
                        <div className="row-meta">
                          {e.wordCount}단어{e.durationSec ? ` · ${fmt(e.durationSec)}` : ""}
                          {e.feedback?.feedback.overall != null && ` · AI 예상 Band ${e.feedback.feedback.overall.toFixed(1)}`} ·{" "}
                          {open === e.id ? "접기" : "눌러서 펼치기"}
                        </div>
                      </div>
                      <button
                        className="btn"
                        disabled={reviewing.has(e.id)}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void review(e, passage);
                        }}
                      >
                        <Sparkles size={13} /> {reviewing.has(e.id) ? "첨삭 중…" : e.feedback ? "다시 첨삭" : "AI 첨삭"}
                      </button>
                      <button
                        className="btn ghost"
                        title="이 기록 삭제"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void remove(e.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {open === e.id && (
                      <>
                        {e.audio && (
                          <div className="entry-audio">
                            <AudioPlayer source={e.audio} />
                          </div>
                        )}
                        <pre className="entry-body">{e.body}</pre>
                        {reviewing.has(e.id) && (
                          <p className="muted entry-note">AI가 답안을 읽고 있습니다. 모델에 따라 1–3분 걸릴 수 있습니다.</p>
                        )}
                        {reviewErrors[e.id] && <p className="error entry-note">{reviewErrors[e.id]}</p>}
                        {e.feedback && !reviewing.has(e.id) && <FeedbackView data={e.feedback} />}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
