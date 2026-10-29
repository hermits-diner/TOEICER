import { FileUp, Globe, Link2, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoReviewOn,
  autoReviewPending,
  clearFinished,
  deleteJob,
  enqueue,
  getJobLinks,
  importLocalFile,
  isRunning,
  listJobs,
  listSources,
  resumeInterrupted,
  runQueue,
  setAutoReview,
  stopQueue,
  subscribe,
  type Job,
  type JobState,
  type Source,
} from "../lib/crawl";
import type { PageLink } from "../lib/html";
import Hint from "../components/Hint";

const STATE_LABEL: Record<JobState, string> = {
  queued: "대기",
  running: "수집 중",
  review: "검수 대기",
  saved: "저장됨",
  links: "링크 목록",
  skipped: "건너뜀",
  failed: "실패",
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  onReview: (jobId: number) => void;
  onOpenTest: (testId: number) => void;
}

export default function Collect({ onReview, onOpenTest }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(isRunning());
  const [auto, setAuto] = useState(autoReviewOn());
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [linksOf, setLinksOf] = useState<number | null>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => setMessage({ kind: "error", text: errorText(e) });

  const refresh = useCallback(() => {
    setRunning(isRunning());
    setAuto(autoReviewOn());
    listJobs().then(setJobs, fail);
  }, []);

  useEffect(() => {
    listSources().then(setSources, fail);
    resumeInterrupted().then(refresh, fail);
    return subscribe(refresh);
  }, [refresh]);

  const start = () => void runQueue().catch(fail);

  const addUrl = async () => {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
      return setMessage({ kind: "error", text: "http:// 또는 https://로 시작하는 주소를 입력해 주십시오." });
    }
    setMessage(null);
    await enqueue([{ url: parsed.toString() }], null).catch(fail);
    setUrl("");
    start();
  };

  const addSource = async (s: Source) => {
    setMessage(null);
    await enqueue([{ url: s.settings.startUrl, title: s.name }], s.id).catch(fail);
    start();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage(null);
    let drafts = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        drafts += await importLocalFile(f);
      } catch (e) {
        errors.push(`${f.name}: ${errorText(e)}`);
      }
    }
    if (errors.length) setMessage({ kind: "error", text: errors.join(" / ") });
    else setMessage({ kind: "ok", text: `초안 ${drafts}개를 검수 목록에 추가했습니다.` });
    refresh();
  };

  const toggleLinks = async (job: Job) => {
    if (linksOf === job.id) return setLinksOf(null);
    setLinks(await getJobLinks(job.id).catch(() => []));
    setPicked(new Set());
    setLinksOf(job.id);
  };

  const collectPicked = async (job: Job) => {
    const items = links.filter((l) => picked.has(l.url)).map((l) => ({ url: l.url, title: l.text || undefined }));
    await enqueue(items, job.sourceId).catch(fail);
    setLinksOf(null);
    start();
  };

  const reviewPending = async () => {
    setMessage(null);
    try {
      const r = await autoReviewPending();
      const parts = [`${r.saved}개 저장`, `${r.skipped}개 제외`, r.review > 0 ? `${r.review}개는 확인이 필요해 남겨 두었습니다` : ""];
      setMessage({ kind: "ok", text: `자동 검수: ${parts.filter(Boolean).join(", ")}.` });
    } catch (e) {
      fail(e);
    }
  };

  const retry = async (job: Job) => {
    await enqueue([{ url: job.url, title: job.title ?? undefined }], job.sourceId).catch(fail);
    start();
  };

  const queued = jobs.filter((j) => j.state === "queued").length;
  const reviewCount = jobs.filter((j) => j.state === "review").length;
  const finished = jobs.some((j) => ["saved", "skipped", "failed", "links"].includes(j.state));

  return (
    <>
      <div className="toolbar">
        <input
          className="field grow"
          value={url}
          placeholder="문제가 있는 웹페이지 또는 PDF 주소 (https://…)"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addUrl()}
        />
        <button
          className="btn primary"
          disabled={!url.trim()}
          title="같은 사이트에는 3초 이상 간격을 두고 요청하며, robots.txt가 막은 경로는 수집하지 않습니다."
          onClick={() => void addUrl()}
        >
          <Globe size={14} /> 수집
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> 파일 열기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.html,.htm,.txt"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <label className="check auto-review">
        <input type="checkbox" checked={auto} onChange={(e) => setAutoReview(e.target.checked)} />
        자동 검수
        <Hint text="문항·정답·선택지·지문을 점검해 이상이 없는 초안은 바로 저장하고, 문항이 없는 초안은 제외합니다. 확인이 필요한 초안만 검수 대기에 남습니다." />
      </label>
      {message && <p className={message.kind === "ok" ? "success" : "error"}>{message.text}</p>}

      <h3 className="section-title">기본 소스</h3>
      <div className="list">
        {sources.map((s) => (
          <div key={s.id} className="list-row">
            <div className="row-main">
              <div className="row-title">{s.name}</div>
              <div className="row-meta">{s.settings.note}</div>
            </div>
            <button className="btn" onClick={() => void addSource(s)}>
              목록 불러오기
            </button>
          </div>
        ))}
      </div>

      <div className="toolbar jobs-head">
        <h3 className="section-title">작업 {jobs.length > 0 && <span className="muted">· 검수 대기 {reviewCount}개</span>}</h3>
        <span className="spacer" />
        {running ? (
          <>
            <span className="muted">수집 중… 남은 작업 {queued}개</span>
            <button className="btn" onClick={stopQueue}>
              <Square size={12} /> 중지
            </button>
          </>
        ) : (
          queued > 0 && (
            <button className="btn" onClick={start}>
              <Play size={13} /> 대기 중인 {queued}개 수집
            </button>
          )
        )}
        {reviewCount > 0 && !running && (
          <button className="btn" onClick={() => void reviewPending()}>
            검수 대기 {reviewCount}개 자동 검수
          </button>
        )}
        {finished && !running && (
          <button className="btn ghost" onClick={() => void clearFinished().catch(fail)}>
            완료 항목 정리
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <p className="muted">아직 수집한 항목이 없습니다.</p>
      ) : (
        <div className="list">
          {jobs.map((j) => (
            <div key={j.id} className="job">
              <div className="list-row">
                <span className={`chip ${j.state}`}>{STATE_LABEL[j.state]}</span>
                <div className="row-main">
                  <div className="row-title">{j.title || j.url}</div>
                  <div className="row-meta">
                    {j.state === "review" && j.confidence !== null && `신뢰도 ${Math.round(j.confidence * 100)}% · `}
                    {j.state === "review" && j.issues.length > 0 && `확인 필요 ${j.issues.length}건: ${j.issues[0]} · `}
                    {j.state === "links" && `수집할 수 있는 링크 ${j.linkCount}개 · `}
                    {j.message ? `${j.message} · ` : ""}
                    <span className="url">{j.url}</span>
                  </div>
                </div>
                {j.state === "review" && (
                  <button className="btn primary" onClick={() => onReview(j.id)}>
                    검수
                  </button>
                )}
                {j.state === "saved" && j.testId !== null && (
                  <button className="btn" onClick={() => onOpenTest(j.testId!)}>
                    <Play size={13} /> 풀기
                  </button>
                )}
                {j.state === "links" && (
                  <button className="btn" onClick={() => void toggleLinks(j)}>
                    <Link2 size={13} /> {linksOf === j.id ? "닫기" : "링크 보기"}
                  </button>
                )}
                {(j.state === "failed" || j.state === "skipped") && (
                  <button className="btn" onClick={() => void retry(j)}>
                    <RotateCw size={13} /> 다시 시도
                  </button>
                )}
                {j.state !== "running" && (
                  <button className="btn ghost" title="목록에서 삭제" onClick={() => void deleteJob(j.id).catch(fail)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {linksOf === j.id && (
                <div className="links-panel">
                  <div className="toolbar">
                    <button
                      className="btn"
                      onClick={() => setPicked(picked.size === links.length ? new Set() : new Set(links.map((l) => l.url)))}
                    >
                      {picked.size === links.length ? "모두 해제" : "모두 선택"}
                    </button>
                    <span className="muted">
                      {picked.size > 0 && `선택 ${picked.size}개 · 예상 소요 약 ${Math.ceil((picked.size * 4) / 60)}분`}
                    </span>
                    <span className="spacer" />
                    <button className="btn primary" disabled={picked.size === 0} onClick={() => void collectPicked(j)}>
                      선택한 링크 수집
                    </button>
                  </div>
                  <div className="links-scroll">
                    {links.map((l) => (
                      <label key={l.url} className="link-check">
                        <input
                          type="checkbox"
                          checked={picked.has(l.url)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(l.url);
                            else next.delete(l.url);
                            setPicked(next);
                          }}
                        />
                        <span>
                          {l.text || decodeURIComponent(l.url.split("/").pop() ?? l.url)}
                          <span className="url">{l.url}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
