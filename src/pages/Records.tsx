import { Check, FileDown, NotebookPen, Play } from "lucide-react";
import { BRAND, formatScore } from "../lib/brand";
import ExplainPanel from "../components/ExplainPanel";
import Hint from "../components/Hint";
import VocabBook from "../components/VocabBook";
import { useCallback, useEffect, useState } from "react";
import { KIND_LABEL } from "../lib/library";
import { TOEIC_PARTS } from "../lib/toeicSpec";
import {
  loadOverview,
  loadPartAccuracy,
  loadScoreHistory,
  loadSectionAccuracy,
  loadTargetAccuracy,
  loadWrongItems,
  markReviewed,
  saveMemo,
  type Accuracy,
  type Overview,
  type ScorePoint,
  type WrongItem,
} from "../lib/stats";
import type { TestKind } from "../lib/types";
import { exportResponsesCsv } from "../lib/recordsCsv";

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
    [`최근 평균 ${BRAND.scoreName}`, o.recentScore === null ? "—" : formatScore(o.recentScore), "최근 5회 · 영역별 5–495 추정"],
    ["정답률", rate === null ? "—" : `${rate}%`, `${o.correct.toLocaleString()} / ${o.answered.toLocaleString()}문항`],
    ["풀이 횟수", o.attempts.toLocaleString()],
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

const SERIES: TestKind[] = ["listening", "reading"];

/** Estimated section scores on the 5–495 scale, a line for Listening and one for Reading; crosshair tooltip. */
function ScoreChart({ points }: { points: ScorePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 640, H = 200, L = 34, R = 16, T = 14, B = 26;
  const lo = 0;
  const hi = 495;
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (b: number) => T + ((hi - b) * (H - T - B)) / (hi - lo);
  const ticks = [0, 100, 200, 300, 400, 495];
  const path = (kind: TestKind) =>
    points
      .map((p, i) => [p, i] as const)
      .filter(([p]) => p.kind === kind)
      .map(([p, i], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`)
      .join(" ");
  const last = points[points.length - 1];
  const hp = hover === null ? null : points[hover];

  return (
    <section className="chart-card">
      <div className="chart-head">
        <h3 className="section-title">
          예상 {BRAND.scoreName} 추이 <span className="muted">· 최근 30회 · 영역별 5–495</span>
        </h3>
        <span className="chart-legend">
          {SERIES.map((k) => (
            <span key={k} className={`legend-item ${k}`}>
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
        <button className="btn ghost small" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "차트" : "표"}
        </button>
      </div>
      {asTable ? (
        <table className="facts compact">
          <thead>
            <tr><th>날짜</th><th>세트</th><th>예상 {BRAND.scoreName}</th></tr>
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
            {SERIES.map((k) => (
              <path key={k} d={path(k)} className={`series-line ${k}`} />
            ))}
            {points.map((p, i) => (
              <g key={p.attemptId}>
                <circle cx={x(i)} cy={y(p.band)} r={hover === i ? 6 : 4.5} className={`series-dot ${p.kind}`} />
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

/** Accuracy over labelled slices (sections, parts, targets), in the order given, value at each bar tip. */
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
                  {w.testTitle} · {w.number}번
                  {w.part !== null ? ` · Part ${w.part} ${TOEIC_PARTS[w.part - 1].korean}` : ""}
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
                      placeholder="왜 틀렸는지 적어 두세요 (예: 질문의 의문사를 놓침)"
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
  const [scores, setScores] = useState<ScorePoint[]>([]);
  const [sections, setSections] = useState<Accuracy[]>([]);
  const [parts, setParts] = useState<Accuracy[]>([]);
  const [targets, setTargets] = useState<Accuracy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadOverview(), loadScoreHistory(), loadSectionAccuracy(), loadPartAccuracy(), loadTargetAccuracy()]).then(
      ([o, sc, se, pa, tg]) => {
        setOverview(o);
        setScores(sc);
        setSections(se);
        setParts(pa);
        setTargets(tg);
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
              {scores.length > 0 && <ScoreChart points={scores} />}
              {sections.length > 1 && <AccuracyBars title="영역별 정답률" note="Listening과 Reading 풀이 기록을 영역별로 모았습니다." rows={sections} />}
              {parts.length > 0 && (
                <AccuracyBars title="파트별 정답률" note="Part 1 사진 묘사부터 Part 7 독해까지, 시험 순서대로 모았습니다. 정답률이 낮은 파트부터 연습하면 점수가 가장 빨리 오릅니다." rows={parts} />
              )}
              {targets.length > 0 && (
                <AccuracyBars
                  title="목표 점수별 정답률 (AI 세트)"
                  note="세트를 만들 때 고른 목표 점수(600·750·900)별 정답률입니다. 70% 아래로 떨어지는 목표가 지금 연습할 난이도입니다."
                  rows={targets}
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
