import { BookOpen, ChevronRight, Headphones, Layers, Mic, PenLine, Search, Share2, Sparkles, Trash2, X } from "lucide-react";
import { formatScore } from "../lib/brand";
import Dropdown from "../components/Dropdown";
import MockPanel from "../components/MockPanel";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { EMPTY_FILTER, filterChoices, filterTests, genMetaLine, isFiltering, type LibraryFilter, type Origin } from "../lib/library";
import { exportTest } from "../lib/package";
import { deleteTest, listExams, listTests } from "../lib/repo";
import type { ExamSummary, TestKind, TestSummary } from "../lib/types";

const ICONS = { reading: BookOpen, listening: Headphones, writing: PenLine, speaking: Mic };
const EMPTY: Record<TestKind, string> = {
  reading: "아직 저장된 Reading 시험이 없습니다.",
  listening: "아직 저장된 Listening 시험이 없습니다.",
  writing: "아직 저장된 Writing 과제가 없습니다.",
  speaking: "아직 저장된 Speaking 과제가 없습니다.",
};

/** One line under the title: questions and attempts for scored sets, tasks and saved answers for writing and speaking. */
function meta(t: TestSummary): string {
  if ((t.kind === "writing" || t.kind === "speaking") && t.questionCount === 0) return `과제 ${t.passageCount} · 기록 ${t.entries}`;
  const score =
    t.lastScore !== null ? ` · 최근 ${t.lastScore}/${t.questionCount}${t.lastBand !== null ? ` (${formatScore(t.lastBand)}점)` : ""}` : "";
  return `${t.questionCount}문항 · ${t.attempts}회${score}`;
}

/** Row click and Enter open; the buttons inside stop the click from reaching the row. */
const rowKey = (open: () => void) => (e: KeyboardEvent) => {
  if (e.target === e.currentTarget && e.key === "Enter") open();
};

const ORIGINS: { id: Origin; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "ai", label: "AI 생성" },
  { id: "collected", label: "수집·가져옴" },
  { id: "shared", label: "공유 파일" },
];

interface Props {
  title: string;
  kind?: TestKind;
  onOpen: (t: Pick<TestSummary, "id">) => void;
  onImport: () => void;
  /** Opens "AI로 만들기" for this list's skill; absent where generation is not offered. */
  onGenerate?: () => void;
  /** Whole exams, listed on the all-tests page only. */
  onOpenExam?: (examId: number) => void;
  /** Pins the origin filter (the AI-only page) and hides its control. */
  origin?: Origin;
}

export default function TestList({ title, kind, onOpen, onImport, onGenerate, onOpenExam, origin }: Props) {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>({ ...EMPTY_FILTER, origin: origin ?? "all" });
  const choices = useMemo(() => filterChoices(tests ?? []), [tests]);
  const shown = useMemo(() => (tests ? filterTests(tests, filter) : null), [tests, filter]);
  const filtering = isFiltering({ ...filter, origin: origin ? "all" : filter.origin });
  const clear = () => setFilter({ ...EMPTY_FILTER, origin: origin ?? "all" });
  useEffect(() => {
    if (!kind && onOpenExam) listExams().then(setExams, () => setExams([]));
  }, [kind, onOpenExam]);

  /** Writes the set to a .toeicset file the user picks a place for. */
  const share = async (t: TestSummary) => {
    setNotice(null);
    try {
      const dest = await exportTest(t.id);
      if (dest) setNotice(`저장함: ${dest}${t.ai || t.shared ? "" : " · 수집한 원본이니 배포 시 저작권에 유의"}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const refresh = useCallback(() => {
    listTests(kind).then((rows) => setTests(origin ? filterTests(rows, { ...EMPTY_FILTER, origin }) : rows), (e) => setError(String(e)));
  }, [kind, origin]);

  useEffect(refresh, [refresh]);

  const remove = async (id: number) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    await deleteTest(id).catch((e) => setError(String(e)));
    refresh();
  };

  return (
    <div className="content">
      <div className="list-head">
        <h1>
          {title}
          <span className="h-count">{tests ? `${filtering && shown ? `${shown.length} / ` : ""}${tests.length}` : "…"}</span>
        </h1>
        {onGenerate && (
          <button className="btn primary" onClick={onGenerate}>
            <Sparkles size={14} /> AI로 새 문제
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tests && tests.length > 0 && (
        <div className="lib-filter">
          {!origin && (
            <div className="segmented small">
              {ORIGINS.map((o) => (
                <button key={o.id} className={filter.origin === o.id ? "on" : ""} onClick={() => setFilter({ ...filter, origin: o.id })}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <label className="lib-search">
            <Search size={14} />
            <input
              className="field"
              placeholder="제목·주제 검색"
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            />
          </label>
          {choices.hasAi && (
            <>
              <Dropdown
                placeholder="목표 전체"
                value={filter.band === null ? "" : String(filter.band)}
                options={[{ key: "", text: "목표 전체" }, ...choices.bands.map((b) => ({ key: String(b), text: `목표 ${b}` }))]}
                onChange={(v) => setFilter({ ...filter, band: v === "" ? null : Number(v) })}
              />
              <Dropdown
                placeholder="모델 전체"
                value={filter.model}
                options={[{ key: "", text: "모델 전체" }, ...choices.models.map((m) => ({ key: m, text: m }))]}
                onChange={(v) => setFilter({ ...filter, model: v })}
              />
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={filter.unattempted} onChange={(e) => setFilter({ ...filter, unattempted: e.target.checked })} />
            안 푼 것만
          </label>
          {filtering && (
            <button className="btn ghost" title="필터 지우기" onClick={clear}>
              <X size={14} /> 지우기
            </button>
          )}
        </div>
      )}
      {(kind === "reading" || kind === "listening") && (
        <MockPanel kind={kind} onOpen={(id) => onOpen({ id })} onCreated={refresh} />
      )}

      {tests && tests.length === 0 && (
        <div className="empty">
          <p>{origin === "ai" ? "아직 AI로 만든 세트가 없습니다." : kind ? EMPTY[kind] : "아직 저장된 시험이 없습니다."}</p>
          {origin === "ai" && onGenerate ? (
            <button className="btn primary" onClick={onGenerate}>
              <Sparkles size={14} /> AI로 새 문제
            </button>
          ) : (
            <button className="btn primary" onClick={onImport}>
              시험 가져오기
            </button>
          )}
        </div>
      )}

      {exams.length > 0 && onOpenExam && (
        <>
          <h3 className="section-title">시험 한 부 (4영역)</h3>
          <div className="list">
            {exams.map((e) => (
              <div key={e.id} className="list-row clickable" tabIndex={0} onClick={() => onOpenExam(e.id)} onKeyDown={rowKey(() => onOpenExam(e.id))}>
                <span className="row-icon"><Layers /></span>
                <div className="row-main">
                  <div className="row-title">
                    <span className="ai-badge">한 부</span>
                    {e.title}
                  </div>
                  <div className="row-meta">
                    {e.module === "general" ? "General" : "Academic"} · 세트 {e.tests.length} · {e.tests.reduce((n, t) => n + t.questionCount, 0)}문항 · {e.createdAt.slice(0, 10)}
                  </div>
                </div>
                <ChevronRight size={16} className="row-open" />
              </div>
            ))}
          </div>
        </>
      )}
      {notice && <p className="success">{notice}</p>}
      {shown && tests && tests.length > 0 && shown.length === 0 && <p className="muted">조건에 맞는 세트가 없습니다.</p>}
      {shown && shown.length > 0 && (
        <div className="list">
          {shown.map((t) => {
            const Icon = ICONS[t.kind];
            return (
            <div key={t.id} className="list-row clickable" tabIndex={0} onClick={() => onOpen(t)} onKeyDown={rowKey(() => onOpen(t))}>
              <span className="row-icon"><Icon /></span>
              <div className="row-main">
                <div className="row-title">
                  {t.ai && <span className="ai-badge">AI</span>}
                  {t.shared && <span className="ai-badge shared">공유</span>}
                  {t.title}
                </div>
                <div className="row-meta">
                  {meta(t)}
                  {t.gen && <span className="meta-chip">{genMetaLine(t.gen)}</span>}
                </div>
              </div>
              <div className="row-tools" onClick={(e) => e.stopPropagation()}>
                <button className="btn ghost" title="세트 파일로 내보내기" onClick={() => void share(t)}>
                  <Share2 size={14} />
                </button>
                <button
                  className={`btn ghost${confirmId === t.id ? " danger" : ""}`}
                  onClick={() => remove(t.id)}
                  onBlur={() => setConfirmId(null)}
                  title="삭제"
                >
                  {confirmId === t.id ? "삭제 확인" : <Trash2 size={14} />}
                </button>
              </div>
              <ChevronRight size={16} className="row-open" />
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
