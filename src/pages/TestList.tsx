import { BookOpen, ChevronRight, FolderOpen, Headphones, PencilLine, Search, Share2, Sparkles, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Dropdown from "../components/Dropdown";
import { formatScore } from "../lib/brand";
import { STUDIO } from "../lib/edition";
import { EMPTY_FILTER, filterChoices, filterTests, genMetaLine, isFiltering, KIND_LABEL, ORIGIN_LABEL, type LibraryFilter } from "../lib/library";
import { exportTest, testToImport } from "../lib/package";
import { deleteTest, listTests, loadTest, saveEditedTest } from "../lib/repo";
import type { ImportTest, Origin, TestDetail, TestSummary } from "../lib/types";

// Studio-only: the editor is left out of a Reader build.
const SetEditor = __STUDIO__ ? lazy(() => import("../components/SetEditor")) : null;

function meta(t: TestSummary): string {
  const score = t.lastScore !== null ? ` · 최근 ${t.lastScore}/${t.questionCount}${t.lastBand !== null ? ` (예상 ${formatScore(t.lastBand)})` : ""}` : "";
  return `${KIND_LABEL[t.kind]} · ${t.questionCount}문항 · ${t.attempts}회${score}`;
}

/** Row click and Enter open; the buttons inside stop the click from reaching the row. */
const rowKey = (open: () => void) => (e: KeyboardEvent) => {
  if (e.target === e.currentTarget && e.key === "Enter") open();
};

/** Sets Studio may write to a file and edit: its own work. A bought set is the seller's, and stays as it was sold. */
const editable = (o: Origin) => o === "ai" || o === "mine";

interface Props {
  title: string;
  onOpen: (t: Pick<TestSummary, "id">) => void;
  onImport: () => void;
  /** Pins the origin filter (the AI-only page) and hides its control. */
  origin?: Origin;
}

export default function TestList({ title, onOpen, onImport, origin }: Props) {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ detail: TestDetail; test: ImportTest } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>({ ...EMPTY_FILTER, origin: origin ?? "all" });
  const choices = useMemo(() => filterChoices(tests ?? []), [tests]);
  const shown = useMemo(() => (tests ? filterTests(tests, filter) : null), [tests, filter]);
  const filtering = isFiltering({ ...filter, origin: origin ? "all" : filter.origin });
  const clear = () => setFilter({ ...EMPTY_FILTER, origin: origin ?? "all" });

  const refresh = useCallback(() => {
    listTests().then((rows) => setTests(origin ? filterTests(rows, { ...EMPTY_FILTER, origin }) : rows), (e) => setError(String(e)));
  }, [origin]);
  useEffect(refresh, [refresh]);

  const share = async (t: TestSummary) => {
    setNotice(null);
    try {
      const dest = await exportTest(t.id);
      if (dest) setNotice(`저장했습니다: ${dest}${t.origin === "mine" ? " · 내 자료이므로 마켓에는 올릴 수 없습니다" : ""}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const edit = async (t: TestSummary) => {
    setError(null);
    try {
      setEditing({ detail: await loadTest(t.id), test: await testToImport(t.id) });
    } catch (e) {
      setError(String(e));
    }
  };

  const saveEdit = async (next: ImportTest) => {
    if (!editing) return;
    setSaving(true);
    try {
      await saveEditedTest(editing.detail.id, next, editing.detail);
      setEditing(null);
      setNotice("고친 내용을 저장했습니다.");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    await deleteTest(id).catch((e) => setError(String(e)));
    refresh();
  };

  if (editing && SetEditor)
    return (
      <div className="content">
        <h1>세트 고치기</h1>
        <p className="muted">문구와 정답을 고칠 수 있습니다. 이미 푼 기록은 그대로 남습니다.</p>
        <Suspense fallback={<p className="muted">불러오는 중…</p>}>
          <SetEditor test={editing.test} saveLabel="저장" busy={saving} onSave={(t) => void saveEdit(t)} onCancel={() => setEditing(null)} />
        </Suspense>
        {error && <p className="error">{error}</p>}
      </div>
    );

  return (
    <div className="content">
      <div className="list-head">
        <h1>
          {title}
          <span className="h-count">{tests ? `${filtering && shown ? `${shown.length} / ` : ""}${tests.length}` : "…"}</span>
        </h1>
        <button className="btn primary" onClick={onImport}>
          {STUDIO ? <Sparkles size={14} /> : <FolderOpen size={14} />} {STUDIO ? "새 세트 만들기" : "세트 파일 열기"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {tests && tests.length > 0 && (
        <div className="lib-filter">
          <div className="segmented small">
            {(["all", "listening", "reading"] as const).map((k) => (
              <button key={k} className={filter.kind === k ? "on" : ""} onClick={() => setFilter({ ...filter, kind: k })}>
                {k === "all" ? "LC·RC" : KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {!origin && choices.origins.length > 1 && (
            <div className="segmented small">
              <button className={filter.origin === "all" ? "on" : ""} onClick={() => setFilter({ ...filter, origin: "all" })}>
                전체
              </button>
              {choices.origins.map((o) => (
                <button key={o} className={filter.origin === o ? "on" : ""} onClick={() => setFilter({ ...filter, origin: o })}>
                  {ORIGIN_LABEL[o]}
                </button>
              ))}
            </div>
          )}
          <label className="lib-search">
            <Search size={14} />
            <input className="field" placeholder="제목·주제 검색" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
          </label>
          {choices.bands.length > 0 && (
            <>
              <Dropdown
                placeholder="목표 전체"
                value={filter.band === null ? "" : String(filter.band)}
                options={[{ key: "", text: "목표 전체" }, ...choices.bands.map((b) => ({ key: String(b), text: `목표 ${b}점` }))]}
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

      {tests && tests.length === 0 && (
        <div className="empty">
          <p>{origin === "ai" ? "아직 AI로 만든 세트가 없습니다." : "아직 저장된 세트가 없습니다."}</p>
          <button className="btn primary" onClick={onImport}>
            {STUDIO ? "새 세트 만들기" : "세트 파일 열기"}
          </button>
        </div>
      )}

      {notice && <p className="success">{notice}</p>}
      {shown && tests && tests.length > 0 && shown.length === 0 && <p className="muted">조건에 맞는 세트가 없습니다.</p>}
      {shown && shown.length > 0 && (
        <div className="list">
          {shown.map((t) => (
            <div key={t.id} className="list-row clickable" tabIndex={0} onClick={() => onOpen(t)} onKeyDown={rowKey(() => onOpen(t))}>
              <span className="row-icon">
                {t.kind === "listening" ? <Headphones /> : <BookOpen />}
              </span>
              <div className="row-main">
                <div className="row-title">
                  <span className={`ai-badge origin-${t.origin}`}>{ORIGIN_LABEL[t.origin]}</span>
                  {t.title}
                </div>
                <div className="row-meta">
                  {meta(t)}
                  {t.gen && <span className="meta-chip">{genMetaLine(t.gen)}</span>}
                </div>
              </div>
              <div className="row-tools" onClick={(e) => e.stopPropagation()}>
                {STUDIO && editable(t.origin) && (
                  <>
                    <button className="btn ghost" title="고치기" onClick={() => void edit(t)}>
                      <PencilLine size={14} />
                    </button>
                    <button className="btn ghost" title="세트 파일로 내보내기" onClick={() => void share(t)}>
                      <Share2 size={14} />
                    </button>
                  </>
                )}
                <button className={`btn ghost${confirmId === t.id ? " danger" : ""}`} onClick={() => remove(t.id)} onBlur={() => setConfirmId(null)} title="삭제">
                  {confirmId === t.id ? "삭제 확인" : <Trash2 size={14} />}
                </button>
              </div>
              <ChevronRight size={16} className="row-open" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
