import { BookOpen, ChevronLeft, Headphones, Mic, PenLine, Play, Share2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "../lib/ai";
import { exportExam } from "../lib/package";
import { deleteExam, loadExam } from "../lib/repo";
import type { ExamSummary, TestKind } from "../lib/types";

const ICONS = { reading: BookOpen, listening: Headphones, writing: PenLine, speaking: Mic };
const LABEL: Record<TestKind, string> = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };
const TIME: Record<TestKind, string> = { listening: "약 30분", reading: "20분", writing: "60분", speaking: "11–14분" };

/** Strips the generator's prefix from a set title so the exam page reads like a contents list. */
const bare = (title: string) => title.replace(/^AI · /, "").replace(/^IELTS (Academic |General Training )?/, "");

/** One exam: its six sets in paper order, each openable on its own; the whole exam exports as one package. */
export default function ExamView({ examId, onOpenTest, onExit, onDeleted }: { examId: number; onOpenTest: (testId: number) => void; onExit: () => void; onDeleted: () => void }) {
  const [exam, setExam] = useState<ExamSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadExam(examId).then(setExam, (e) => setError(errorText(e)));
  }, [examId]);

  const share = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const dest = await exportExam(examId);
      if (dest) setNotice(`시험 한 부를 저장했습니다: ${dest}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    try {
      await deleteExam(examId);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (error && !exam) return <div className="content"><p className="error">{error}</p></div>;
  if (!exam) return <div className="content"><p className="sub">불러오는 중…</p></div>;

  const questions = exam.tests.reduce((n, t) => n + t.questionCount, 0);
  const readingNo = (() => {
    let n = 0;
    return () => ++n;
  })();

  return (
    <div className="content">
      <div className="toolbar">
        <button className="btn ghost" onClick={onExit}>
          <ChevronLeft size={16} /> 목록
        </button>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={() => void share()} title="시험 한 부를 .toeicset 파일로 내보내기">
          <Share2 size={14} /> {busy ? "저장 중…" : "한 부 내보내기"}
        </button>
        <button className={`btn ghost${confirm ? " danger" : ""}`} onClick={() => void remove()} onBlur={() => setConfirm(false)} title="이 시험의 세트 6개를 모두 삭제">
          {confirm ? "삭제 확인" : <Trash2 size={14} />}
        </button>
      </div>

      <h1>{exam.title}</h1>
      <p className="sub">
        {exam.module === "general" ? "General Training" : "Academic"}
        {exam.band !== null ? ` · 목표 Band ${exam.band.toFixed(1)}` : ""} · 세트 {exam.tests.length}개 · {questions}문항 · 만든 날 {exam.createdAt.slice(0, 10)}
      </p>
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="list">
        {exam.tests.map((t) => {
          const Icon = ICONS[t.kind];
          const label = t.kind === "reading" ? `Reading · Passage ${readingNo()}` : LABEL[t.kind];
          const score = t.lastScore !== null ? ` · 최근 ${t.lastScore}/${t.questionCount}${t.lastBand !== null ? ` (Band ${t.lastBand.toFixed(1)})` : ""}` : "";
          const meta = t.kind === "writing" || t.kind === "speaking" ? `${TIME[t.kind]} · 작성 기록 ${t.entries}개` : `${t.questionCount}문항 · ${TIME[t.kind]} · 풀이 ${t.attempts}회${score}`;
          return (
            <div key={t.id} className="list-row" onDoubleClick={() => onOpenTest(t.id)}>
              <span className="row-icon"><Icon /></span>
              <div className="row-main">
                <div className="row-title">
                  <span className="ai-badge">{label}</span>
                  {bare(t.title)}
                </div>
                <div className="row-meta">{meta}</div>
              </div>
              <button className="btn primary" onClick={() => onOpenTest(t.id)}>
                <Play size={14} /> {t.kind === "writing" || t.kind === "speaking" ? "연습" : "풀기"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
