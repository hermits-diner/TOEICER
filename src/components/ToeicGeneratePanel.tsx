import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, FileUp, Globe, Loader2, Play, RefreshCw, ShieldCheck, Sparkles, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, geminiKeyStored, loadAiSettings, PROVIDERS } from "../lib/ai";
import { BUSY, elapsedText, isBusy } from "../lib/jobStore";
import { addReferenceDoc, deleteReferenceDoc, listReferenceDocs, referenceMaterial, setReferenceDocEnabled, type ReferenceDoc } from "../lib/repo";
import { reportLine, UNIT_LABEL, UNIT_PARTS, type ToeicStep, type ToeicUnit } from "../lib/toeicGen";
import { cancelGenJob, dismissGenJob, sectionLabel, startGenJob, useGenJob, type GenSection } from "../lib/toeicJob";
import { loadTrendBrief, officialBrief, trendAgeDays, type TrendBrief } from "../lib/trend";
import type { Target } from "../lib/toeicSpec";
import Hint from "./Hint";

const UNITS: { id: ToeicUnit; note: string }[] = [
  { id: "p12", note: "사진 묘사 6 · 질의응답 25" },
  { id: "p3", note: "짧은 대화 13세트 · 39문항" },
  { id: "p4", note: "짧은 담화 10세트 · 30문항" },
  { id: "p56", note: "단문 빈칸 30 · 장문 빈칸 4지문 16문항" },
  { id: "p7s", note: "단일 지문 10세트 · 29문항" },
  { id: "p7m", note: "이중·삼중 지문 5세트 · 25문항" },
];

const TARGETS: { id: Target; label: string; note: string }[] = [
  { id: "600", label: "600+", note: "직접 묻는 문항 중심, 기본 비즈니스 어휘" },
  { id: "750", label: "750+", note: "실제 시험의 보통 난이도 구성" },
  { id: "900", label: "900+", note: "어려운 문법·근접 어휘·추론·복수 지문 연계" },
];

const STEP_LABEL: Record<ToeicStep, string> = {
  write: "문제 쓰는 중",
  check: "실제 시험 형식과 출제 지침으로 측정",
  rewrite: "어긋난 부분을 고쳐 다시 쓰는 중",
  proof: "다른 AI가 문법·사실 오류 교정",
  reproof: "지적된 문항·지문만 고쳐 쓰고 다시 교정",
  solve: "다른 AI가 정답을 가린 채 풀어 보는 중",
  fix: "풀이가 엇갈리거나 애매한 문항 검토",
  refill: "뺀 문항을 다시 쓰고 다시 검증",
  media: "사진·음성 만드는 중",
  done: "완료",
};

const isUnit = (s: GenSection): s is ToeicUnit => s !== "media";

/**
 * Studio › AI로 만들기: a whole Listening and Reading test (or chosen parts) written and checked by the signed-in CLI.
 * A full test is saved as two sets, Listening (1–100) and Reading (101–200), each scored on its own 5–495 scale.
 * The work runs as an app-wide job (src/lib/toeicJob.ts), so leaving this screen neither stops nor hides it.
 */
export default function ToeicGeneratePanel({ onCreated }: { onCreated: (testId: number) => void }) {
  const job = useGenJob();
  const busy = isBusy(job);
  const [units, setUnits] = useState<ToeicUnit[]>(job.status !== "idle" ? job.sections.filter(isUnit) : UNITS.map((u) => u.id));
  const [target, setTarget] = useState<Target>("750");
  const [topics, setTopics] = useState("");
  const [useRefs, setUseRefs] = useState(true);
  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [refInfo, setRefInfo] = useState<{ tests: number; chars: number } | null>(null);
  const [geminiKey, setGeminiKey] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<TrendBrief | null>(loadTrendBrief());
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const settings = loadAiSettings();
  const provider = PROVIDERS.find((p) => p.id === settings.provider)?.label ?? settings.provider;
  const model = settings.models[settings.provider] || "기본 모델";

  const refresh = () => {
    listReferenceDocs().then(setDocs, () => setDocs([]));
    referenceMaterial().then(
      (r) => setRefInfo({ tests: r.tests, chars: r.text.length }),
      () => setRefInfo(null),
    );
  };
  useEffect(() => {
    refresh();
    geminiKeyStored().then(setGeminiKey, () => setGeminiKey(null));
  }, []);

  // The elapsed time ticks while the job runs.
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  // The job reads the official-site brief (and refreshes it when it is old); show the one it used.
  useEffect(() => {
    if (job.status !== "running") setBrief(loadTrendBrief());
  }, [job.status]);

  const toggle = (u: ToeicUnit) =>
    setUnits((x) => (x.includes(u) ? x.filter((y) => y !== u) : UNITS.map((t) => t.id).filter((t) => x.includes(t) || t === u)));

  const addFiles = async (files: FileList | null) => {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const text = f.name.toLowerCase().endsWith(".pdf")
          ? await invoke<string>("extract_pdf_bytes", { bytes: Array.from(new Uint8Array(await f.arrayBuffer())) })
          : await f.text();
        await addReferenceDoc(f.name, text);
      } catch (e) {
        setError(errorText(e));
      }
    }
    refresh();
  };

  const checkTrend = async (force: boolean) => {
    setChecking(true);
    try {
      setBrief(await officialBrief(loadAiSettings(), force));
    } finally {
      setChecking(false);
    }
  };

  const run = () => {
    setError(null);
    try {
      void startGenJob({ settings: loadAiSettings(), units, target, topics, useRefs, geminiKey: geminiKey === true });
    } catch (e) {
      setError(errorText(e));
    }
  };

  /** Opens a set the job made; only when the user asks, so a finished job never pulls them off another screen. */
  const open = (testId: number) => {
    dismissGenJob();
    onCreated(testId);
  };

  // write, proofread, blind solve, editor, and a rewrite or refill when needed; plus one read of the official sites.
  const calls = units.length * 5 + 1;
  const needsVoice = units.some((u) => UNIT_PARTS[u][0] <= 4);
  const shown = busy || job.status === "done";
  const sets = job.status === "done" ? (job.result?.sets ?? []) : [];

  return (
    <div className="gen">
      <div className="gen-head">
        <span className="muted">
          {provider} · {model}
          <Hint text="설정 › AI에서 고른 구독 CLI가 TOEIC Listening & Reading 형식의 오리지널 문제를 새로 씁니다. 만든 세트는 'AI 생성' 표시와 검증 기록과 함께 라이브러리에 저장되고, 세트 파일로 내보낼 수 있습니다." />
        </span>
      </div>

      <div className="gen-grid">
        <div className="gen-field span3">
          파트
          <div className="model-chips">
            {UNITS.map((u) => (
              <button key={u.id} className={`chip section-chip${units.includes(u.id) ? " on" : ""}`} disabled={busy} title={u.note} onClick={() => toggle(u.id)}>
                {UNIT_LABEL[u.id]}
              </button>
            ))}
          </div>
          <span className="muted small">모든 파트를 고르면 200문항 한 회분을 Listening(1–100)과 Reading(101–200) 두 세트로 저장합니다.</span>
        </div>

        <label>
          목표 점수
          <div className="segmented small">
            {TARGETS.map((d) => (
              <button key={d.id} className={target === d.id ? "on" : ""} disabled={busy} title={d.note} onClick={() => setTarget(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
        </label>

        <label className="span2">
          상황·업종 (선택)
          <input
            className="field"
            value={topics}
            disabled={busy}
            placeholder="비우면 AI가 고릅니다. 예: 호텔, 채용, 사무실 이전, 출장"
            onChange={(e) => setTopics(e.target.value)}
          />
        </label>

        <div className="gen-field span3">
          <div className="accent-row">
            <label className="check">
              <input type="checkbox" checked={useRefs} disabled={busy} onChange={(e) => setUseRefs(e.target.checked)} /> 참고자료로 형식·난이도 맞추기
            </label>
            <Hint text="ETS 공식 샘플이나 직접 구매한 교재처럼 가지고 있는 공식 자료를 넣어 두면, AI가 형식과 난이도의 기준으로 참고합니다. 자료는 이 PC에만 저장되고, 문장을 베끼지 않고 새 문제를 씁니다. 붙여넣기로 넣은 내 자료도 함께 참고합니다." />
            <span className="spacer" />
            <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp size={13} /> 공식 자료 추가 (PDF·텍스트)
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md" multiple hidden onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ""))} />
          </div>
          {docs.length > 0 && (
            <ul className="ref-docs">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className="check">
                    <input type="checkbox" checked={d.enabled} disabled={busy} onChange={(e) => void setReferenceDocEnabled(d.id, e.target.checked).then(refresh)} />
                    {d.name}
                  </label>
                  <span className="muted small">{Math.round(d.chars / 1000)}천 자</span>
                  <button className="btn ghost small" title="자료 삭제" disabled={busy} onClick={() => void deleteReferenceDoc(d.id).then(refresh)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {useRefs && refInfo && (
            <span className="muted small">
              {refInfo.tests ? `참고자료 ${refInfo.tests}개 · ${Math.round(refInfo.chars / 1000)}천 자를 프롬프트에 넣습니다.` : "아직 참고자료가 없습니다. 없어도 공식 형식 사양만으로 만듭니다."}
            </span>
          )}
        </div>
      </div>

      <div className={`trend-box${brief?.mismatch.length ? " warn" : ""}`}>
        <div className="accent-row">
          <Globe size={14} />
          <b>최신 출제 동향</b>
          <span className="muted small">
            {brief ? `공식 사이트 ${brief.checkedAt.slice(0, 10)} 확인${trendAgeDays(brief) >= 7 ? " · 만들 때 다시 확인합니다" : ""}` : "아직 확인하지 않았습니다. 만들 때 공식 사이트를 먼저 읽습니다."}
          </span>
          <span className="spacer" />
          <button className="btn small" disabled={busy || checking} onClick={() => void checkTrend(true).catch((e) => setError(errorText(e)))}>
            {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 지금 확인
          </button>
        </div>
        {brief && (
          <>
            <p className="small">{brief.summary}</p>
            {brief.trends.length > 0 && (
              <ul className="small">
                {brief.trends.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {brief.changes.length > 0 && <p className="small">공고된 변경: {brief.changes.join(" · ")}</p>}
            {brief.mismatch.length > 0 && (
              <p className="small warn-line">
                <AlertTriangle size={13} /> 공식 사이트 내용이 앱의 시험 형식과 다릅니다: {brief.mismatch.join(" · ")} 앱 업데이트를 확인하세요.
              </p>
            )}
          </>
        )}
      </div>

      <div className="toolbar gen-go">
        <button className="btn primary" disabled={busy || checking || units.length === 0} title={busy ? BUSY : undefined} onClick={run}>
          {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {units.length === UNITS.length ? "200문항 한 회분 만들기" : "만들기"}
        </button>
        {job.status === "running" && (
          <button className="btn" title="실행 중인 AI를 끄고, 이번에 만든 것은 저장하지 않습니다." onClick={() => cancelGenJob()}>
            <Square size={12} /> 취소
          </button>
        )}
        {job.status === "saving" && (
          <button className="btn" disabled title="저장은 곧 끝납니다. 반쯤 저장된 세트가 남지 않도록 이때는 취소할 수 없습니다.">
            <Loader2 size={12} className="spin" /> 저장 중
          </button>
        )}
        {job.status === "cancelling" && (
          <button className="btn" disabled title="실행 중인 AI가 끝나기를 기다립니다. 끝나면 새로 만들 수 있습니다.">
            <Loader2 size={12} className="spin" /> 취소하는 중…
          </button>
        )}
        <span className="muted">
          AI 약 {calls}회{needsVoice && geminiKey ? " · Gemini 사진·음성" : ""} · {units.length * 2}–{units.length * 5}분
        </span>
        {needsVoice && geminiKey === false && (
          <span className="warning">Gemini 키가 없어 Part 1 사진은 장면 설명으로, 음성은 Windows 음성으로 대신합니다 (설정 › AI › 음성·사진에서 키를 넣으면 실제 사진·음성).</span>
        )}
      </div>

      {shown && (
        <div className="gen-progress">
          <div className="gen-bar" role="progressbar" aria-label="AI 생성 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent}>
            <span className={`gen-bar-fill${job.status === "running" || job.status === "saving" ? " live" : ""}`} style={{ width: `${job.percent}%` }} />
          </div>
          <span className="muted gen-progress-text">
            {job.percent}% · {job.step} · {elapsedText(job, now)}
          </span>
        </div>
      )}

      {shown && (
        <ol className="gen-steps">
          {job.sections.map((s) => {
            const step = job.progress[s];
            const done = step === "done";
            return (
              <li key={s} className={done ? "done" : step ? "now" : ""}>
                {done ? <Check size={13} /> : step ? <Loader2 size={13} className="spin" /> : <span className="dot" />} {sectionLabel(s)}
                {step && !done && <span className="muted"> · {STEP_LABEL[step]}</span>}
              </li>
            );
          })}
        </ol>
      )}

      {job.status === "done" && (
        <div className="gen-report">
          {job.reports?.[0] && (
            <p className="small">
              <ShieldCheck size={13} /> 검증: {job.reports[0].writer}가 쓰고 같은 AI가 새 대화에서 교정하고 정답을 가린 채 풀었습니다.
            </p>
          )}
          {job.reports?.map((r) => (
            <p key={r.unit} className="muted">
              {UNIT_LABEL[r.unit]}: {reportLine(r)}
              {r.notes.length ? ` · 기준 미달: ${r.notes.join(" · ")}` : " · 형식 기준 통과"}
            </p>
          ))}
          <div className="toolbar gen-result">
            {sets.length > 1 && <span className="success">두 세트를 저장했습니다. 'AI 생성 세트'에서도 열 수 있습니다.</span>}
            {sets.map((t) => (
              <button key={t.testId} className="btn primary small" onClick={() => open(t.testId)}>
                <Play size={13} /> {sets.length === 1 ? "세트 열기" : t.kind === "listening" ? "Listening 풀기" : "Reading 풀기"}
              </button>
            ))}
            <button className="btn ghost small" onClick={dismissGenJob}>
              닫기
            </button>
          </div>
        </div>
      )}
      {job.status === "failed" && (
        <div className="gen-report">
          <p className="error">{job.error}</p>
          <button className="btn ghost small" onClick={dismissGenJob}>
            닫기
          </button>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="gen-report">
          <p className="muted">생성을 취소했습니다. 저장한 것은 없습니다.</p>
          {job.error && <p className="error">{job.error}</p>}
          <button className="btn ghost small" onClick={dismissGenJob}>
            닫기
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
