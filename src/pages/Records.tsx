import { Check, FileDown, NotebookPen, Play } from "lucide-react";
import { BRAND, formatScore } from "../lib/brand";
import ExplainPanel from "../components/ExplainPanel";
import Hint from "../components/Hint";
import VocabBook from "../components/VocabBook";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadBandAccuracy,
  loadBandHistory,
  loadKindAccuracy,
  loadOverview,
  loadTypeAccuracy,
  loadWrongItems,
  markReviewed,
  saveMemo,
  TYPE_LABELS,
  type Accuracy,
  type BandPoint,
  type Overview,
  type TypeAccuracy,
  type WrongItem,
} from "../lib/stats";
import { exportEntriesCsv, exportResponsesCsv } from "../lib/recordsCsv";

const KIND_LABEL = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };

function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

const shortDate = (s: string) => {
  const d = new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? s.slice(5, 10) : `${d.getMonth() + 1}/${d.getDate()}`;
};

function Tiles({ o }: { o: Overview }) {
  const rate = o.answered ? Math.round((o.correct / o.answered) * 100) : null;
  const tiles: [string, string, string?][] = [
    [`최근 평균 ${BRAND.scoreName}`, o.recentBand === null ? "—" : formatScore(o.recentBand), "최근 5회"],
    ["정답률", rate === null ? "—" : `${rate}%`, `${o.correct.toLocaleString()} / ${o.answered.toLocaleString()}문항`],
    ["풀이 횟수", o.attempts.toLocaleString(), o.entries ? `Writing·Speaking 기록 ${o.entries}개` : undefined],
    ["학습 시간", duration(o.seconds)],
  ];
  return (
    <div className="tiles">
      {tiles.map(([label, value, note]) => (
        <div key={label} className="tile">
          <div className="tile-label">{label}</div>
          <div className="tile-value">{value}</div>
          {note && <div className="tile-note">{note}</div>}
        </div>
      ))}
    </div>
  );
}

/** Single-series band trend: 2px line, ringed 8px dots, crosshair tooltip. */
function BandChart({ points }: { points: BandPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 640, H = 200, L = 34, R = 16, T = 14, B = 26;
  const lo = Math.max(0, Math.floor(Math.min(...points.map((p) => p.band)) - 1));
  const hi = 9;
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (b: number) => T + ((hi - b) * (H - T - B)) / (hi - lo);
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const hp = hover === null ? null : points[hover];

  return (
    <section className="chart-card">
      <div className="chart-head">
        <h3 className="section-title">
          {BRAND.scoreName} 추이 <span className="muted">· Reading·Listening 최근 30회</span>
        </h3>
        <button className="btn ghost small" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "차트" : "표"}
        </button>
      </div>
      {asTable ? (
        <table className="facts compact">
          <thead>
            <tr><th>날짜</th><th>시험</th><th>{BRAND.scoreName}</th></tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.attemptId}>
                <td>{shortDate(p.date)}</td>
                <td>{KIND_LABEL[p.kind]} · {p.title}</td>
                <td>{formatScore(p.band)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
                <text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{t}</text>
              </g>
            ))}
            {hp && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="crosshair" />}
            <path d={path} className="series-line" />
            {points.map((p, i) => (
              <g key={p.attemptId}>
                <circle cx={x(i)} cy={y(p.band)} r={hover === i ? 6 : 4.5} className="series-dot" />
                {/* Hit target wider than the mark. */}
                <rect
                  x={x(i) - Math.max(8, (W - L - R) / Math.max(1, points.length - 1) / 2)}
                  width={Math.max(16, (W - L - R) / Math.max(1, points.length - 1))}
                  y={T}
                  height={H - T - B}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            ))}
            {last && (
              <text x={x(points.length - 1)} y={y(last.band) - 12} className="end-label" textAnchor="end">
                {formatScore(last.band)}
              </text>
            )}
            {points.length > 1 && (
              <>
                <text x={x(0)} y={H - 6} className="axis" textAnchor="start">{shortDate(points[0].date)}</text>
                <text x={x(points.length - 1)} y={H - 6} className="axis" textAnchor="end">{shortDate(last.date)}</text>
              </>
            )}
          </svg>
          {hp && (
            <div
              className="chart-tip"
              style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.band) / H) * 100}%` }}
            >
              <b>{formatScore(hp.band)}</b>
              <span>{shortDate(hp.date)} · {KIND_LABEL[hp.kind]}</span>
              <span>{hp.title}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Accuracy by question type, weakest first, value at each bar tip. */
function TypeBars({ rows }: { rows: TypeAccuracy[] }) {
  const sorted = useMemo(
    () => [...rows].map((r) => ({ ...r, rate: r.answered ? (r.correct ?? 0) / r.answered : 0 })).sort((a, b) => a.rate - b.rate),
    [rows],
  );
  return (
    <section className="chart-card">
      <h3 className="section-title">
        문제 유형별 정답률 <span className="muted">· 낮은 순</span>
      </h3>
      <div className="bars">
        {sorted.map((r) => (
          <div
            key={r.type}
            className="bar-row"
            title={`${TYPE_LABELS[r.type]}: ${r.correct ?? 0}/${r.answered}문항 정답 (${Math.round(r.rate * 100)}%)`}
          >
            <span className="bar-label">{TYPE_LABELS[r.type]}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(r.rate * 100, 1)}%` }} />
            </span>
            <span className="bar-value">
              {Math.round(r.rate * 100)}% <span className="muted">· {r.answered}문항</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Accuracy over labelled slices (skills, target bands), in the order given, value at each bar tip. */
function AccuracyBars({ title, note, rows }: { title: string; note: string; rows: Accuracy[] }) {
  return (
    <section className="chart-card">
      <h3 className="section-title">
        {title}
        <Hint text={note} />
      </h3>
      <div className="bars">
        {rows.map((r) => {
          const rate = r.answered ? (r.correct ?? 0) / r.answered : 0;
          return (
            <div key={r.label} className="bar-row" title={`${r.label}: ${r.correct ?? 0}/${r.answered}문항 정답 (${Math.round(rate * 100)}%)`}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(rate * 100, 1)}%` }} />
              </span>
              <span className="bar-value">
                {Math.round(rate * 100)}% <span className="muted">· {r.answered}문항</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** CSV files of the practice records, for a spreadsheet or a teacher's gradebook. */
function ExportRow() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (job: () => Promise<string | null>) => {
    setNotice(null);
    setError(null);
    try {
      const dest = await job();
      if (dest) setNotice(`저장했습니다: ${dest}`);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="chart-card">
      <h3 className="section-title">
        기록 내보내기 <span className="muted">· CSV</span>
      </h3>
      <div className="accent-row">
        <button className="btn" title="문항 한 줄씩: 세트·날짜·점수·내 답·정답" onClick={() => void run(exportResponsesCsv)}>
          <FileDown size={14} /> 풀이 기록
        </button>
        <button className="btn" title="작성 한 편씩: 과제·단어 수·시간·AI 평가 band" onClick={() => void run(exportEntriesCsv)}>
          <FileDown size={14} /> 쓰기·말하기 기록
        </button>
      </div>
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function WrongNote({ onOpenTest }: { onOpenTest: (id: number) => void }) {
  const [items, setItems] = useState<WrongItem[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadWrongItems(showAll).then(setItems);
  }, [showAll]);
  useEffect(refresh, [refresh]);

  const reviewed = async (id: number) => {
    const days = await markReviewed(id);
    setToast(`${days}일 뒤에 다시 보여 드립니다.`);
    window.setTimeout(() => setToast(null), 2000);
    refresh();
  };

  const commitMemo = async (id: number) => {
    await saveMemo(id, draft);
    setEditing(null);
    refresh();
  };

  return (
    <section>
      <div className="chart-head">
        <h3 className="section-title">
          오답 노트
          <Hint text='가장 최근 풀이에서 틀린 문항입니다. "익혔음"을 누르면 1·3·7·15·30일 간격으로 다시 나타나고, 다시 풀어 맞히면 사라집니다.' />
        </h3>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 복습 예정도 보기
        </label>
      </div>
      {toast && <p className="success">{toast}</p>}
      {items && items.length === 0 && <div className="empty"><p>지금 복습할 오답이 없습니다.</p></div>}
      {items && items.length > 0 && (
        <div className="list">
          {items.map((w) => (
            <div key={w.questionId} className="wrong-row">
              <div className="row-main">
                <div className="row-meta">
                  {w.testTitle} · {w.number}번 · {TYPE_LABELS[w.type]}
                  {w.misses > 1 && <span className="badge">{w.misses}회 틀림</span>}
                </div>
                {w.prompt && <div className="wrong-prompt">{w.prompt}</div>}
                <div className="wrong-answers">
                  <span>내 답 <s>{w.userAnswer || "(빈칸)"}</s></span>
                  <span>정답 <b>{w.answer.join(" / ")}</b></span>
                </div>
                <ExplainPanel questionId={w.questionId} userAnswer={w.userAnswer} />
                {editing === w.questionId ? (
                  <div className="memo-edit">
                    <input
                      className="field"
                      autoFocus
                      value={draft}
                      placeholder="왜 틀렸는지 적어 두세요 (예: 패러프레이즈를 못 알아챔)"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitMemo(w.questionId);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button className="btn" onClick={() => commitMemo(w.questionId)}>저장</button>
                  </div>
                ) : (
                  w.memo && <div className="memo">메모: {w.memo}</div>
                )}
              </div>
              <div className="row-actions">
                <button
                  className="btn ghost"
                  title="메모"
                  onClick={() => {
                    setEditing(w.questionId);
                    setDraft(w.memo ?? "");
                  }}
                >
                  <NotebookPen size={14} />
                </button>
                <button className="btn" onClick={() => onOpenTest(w.testId)}>
                  <Play size={13} /> 다시 풀기
                </button>
                <button className="btn" onClick={() => reviewed(w.questionId)}>
                  <Check size={13} /> 익혔음
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export type RecordsTab = "stats" | "notes" | "words";

export default function Records({
  onOpenTest,
  initialTab = "stats",
}: {
  onOpenTest: (id: number) => void;
  initialTab?: RecordsTab;
}) {
  const [tab, setTab] = useState<RecordsTab>(initialTab);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [bands, setBands] = useState<BandPoint[]>([]);
  const [types, setTypes] = useState<TypeAccuracy[]>([]);
  const [kinds, setKinds] = useState<Accuracy[]>([]);
  const [targetBands, setTargetBands] = useState<Accuracy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadOverview(), loadBandHistory(), loadTypeAccuracy(), loadKindAccuracy(), loadBandAccuracy()]).then(
      ([o, b, t, k, tb]) => {
        setOverview(o);
        setBands(b);
        setTypes(t);
        setKinds(k);
        setTargetBands(tb);
      },
      (e) => setError(String(e)),
    );
  }, []);

  return (
    <div className="content records">
      <h1>학습 기록</h1>
      <div className="segmented tabs">
        <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>통계</button>
        <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>오답 노트</button>
        <button className={tab === "words" ? "on" : ""} onClick={() => setTab("words")}>단어장</button>
      </div>
      {error && <p className="error">{error}</p>}

      {tab === "stats" && overview && (
        <>
          <Tiles o={overview} />
          {overview.attempts === 0 ? (
            <div className="empty"><p>아직 풀이 기록이 없습니다.</p></div>
          ) : (
            <>
              {bands.length > 0 && <BandChart points={bands} />}
              {kinds.length > 1 && <AccuracyBars title="영역별 정답률" note="Reading과 Listening 풀이 기록을 영역별로 모았습니다." rows={kinds} />}
              {types.length > 0 && <TypeBars rows={types} />}
              {targetBands.length > 0 && (
                <AccuracyBars
                  title="목표 Band별 정답률 (AI 세트)"
                  note="세트를 만들 때 고른 목표 Band별 정답률입니다. 70% 아래로 떨어지는 Band가 지금 연습할 난이도입니다."
                  rows={targetBands}
                />
              )}
              <ExportRow />
            </>
          )}
        </>
      )}
      {tab === "notes" && <WrongNote onOpenTest={onOpenTest} />}
      {tab === "words" && <VocabBook onOpenTest={onOpenTest} />}
    </div>
  );
}
