import { ChevronLeft, ClipboardPaste, Code2, RotateCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deleteJob, getJobDetail, publishDraft, reextract, saveDraft, type JobDetail } from "../lib/crawl";
import { IMAGE_RE, parseAnswerKey } from "../lib/extract";
import { ARCHIVED_IMAGE_RE, validateImport } from "../lib/importFormat";
import { readImage } from "../lib/repo";
import type { ImportPassage, ImportTest, QuestionType } from "../lib/types";

const TYPES: [QuestionType, string][] = [
  ["mcq", "객관식"],
  ["tfng", "True / False / Not Given"],
  ["ynng", "Yes / No / Not Given"],
  ["heading", "제목 매칭"],
  ["matching", "매칭"],
  ["fill", "빈칸 완성"],
  ["short", "단답형"],
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Passage text for editing: paragraphs separated by blank lines, labels shown as "[A] ", pictures as "![description](file)". */
const bodyText = (p: ImportPassage) =>
  p.paragraphs?.length
    ? p.paragraphs.map((x) => (x.image !== undefined ? `![${x.text}](${x.image})` : (x.label ? `[${x.label}] ` : "") + x.text)).join("\n\n")
    : (p.body ?? "");

/** Thumbnail of an archived picture; a picture that was never collected shows its address instead. */
function ArchivedImage({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (ARCHIVED_IMAGE_RE.test(name)) readImage(name).then(setSrc, () => {});
  }, [name]);
  return src ? <img src={src} alt="" /> : <span className="muted">받지 못한 그림: {name}</span>;
}

function setBody(p: ImportPassage, text: string) {
  p.body = undefined;
  p.paragraphs = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const picture = s.match(IMAGE_RE);
      if (picture) return { text: picture[1], image: picture[2] };
      const m = s.match(/^\[([A-Za-z])\]\s*([\s\S]*)$/);
      return m ? { label: m[1].toUpperCase(), text: m[2] } : { text: s };
    });
}

const splitAnswers = (s: string) =>
  s
    .split(/\s+\/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);

export default function Review({ jobId, onDone }: { jobId: number; onDone: () => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [draft, setDraft] = useState<ImportTest | null>(null);
  // Text fields commit on blur; bumping `rev` remounts them when the draft is replaced wholesale.
  const [rev, setRev] = useState(0);
  const [panel, setPanel] = useState<"none" | "paste" | "json">("none");
  const [panelText, setPanelText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  useEffect(() => {
    getJobDetail(jobId).then(
      (d) => {
        setDetail(d);
        setDraft(d.draft);
      },
      (e) => setError(errorText(e)),
    );
  }, [jobId]);

  const validation = useMemo(() => (draft ? validateImport(draft) : null), [draft]);

  if (!detail || !draft || !validation) {
    return (
      <div className="content">
        <p className={error ? "error" : "sub"}>{error ?? "불러오는 중…"}</p>
        {error && (
          <button className="btn" onClick={onDone}>
            목록으로
          </button>
        )}
      </div>
    );
  }

  const update = (fn: (d: ImportTest) => void) =>
    setDraft((d) => {
      const copy = structuredClone(d!);
      fn(copy);
      return copy;
    });

  const questions = draft.passages.flatMap((p) => p.groups.flatMap((g) => g.questions));
  const unanswered = questions.filter((q) => q.answer.length === 0).map((q) => q.number);
  // Empty answers are summarised in one line instead of one technical message per question.
  const otherErrors = validation.errors.filter((e) => !/\.answer: /.test(e) || !/비어 있지 않은/.test(e));

  const back = async () => {
    await saveDraft(jobId, draft).catch(() => {});
    onDone();
  };

  const publish = async () => {
    if (!validation.test) return;
    setBusy(true);
    setError(null);
    try {
      await publishDraft(jobId, validation.test);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    await deleteJob(jobId).catch(() => {});
    onDone();
  };

  // Rebuilds the draft from the archived original; edits made here are replaced, hence the second click.
  const rebuild = async () => {
    if (!confirmRebuild) return setConfirmRebuild(true);
    setConfirmRebuild(false);
    setBusy(true);
    setError(null);
    try {
      await reextract(jobId);
      const d = await getJobDetail(jobId);
      setDetail(d);
      setDraft(d.draft);
      setRev((r) => r + 1);
      setPanel("none");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const openPanel = (which: "paste" | "json") => {
    setPanel(panel === which ? "none" : which);
    setPanelText(which === "json" ? JSON.stringify(draft, null, 2) : "");
    setError(null);
  };

  const applyPanel = () => {
    if (panel === "paste") {
      const key = parseAnswerKey(panelText);
      if (key.size === 0) return setError("붙여넣은 내용에서 '번호 정답' 형식의 줄을 찾지 못했습니다.");
      update((d) => {
        for (const p of d.passages) for (const g of p.groups) for (const q of g.questions) q.answer = key.get(q.number) ?? q.answer;
      });
    } else {
      try {
        setDraft(JSON.parse(panelText) as ImportTest);
      } catch (e) {
        return setError(`JSON 구문 오류: ${errorText(e)}`);
      }
    }
    setRev((r) => r + 1);
    setPanel("none");
    setError(null);
  };

  return (
    <div className="practice">
      <header className="practice-bar">
        <button className="btn ghost" onClick={() => void back()}>
          <ChevronLeft size={16} /> 목록
        </button>
        <div className="practice-title">검수: {draft.title}</div>
        {detail.confidence !== null && <span className="muted">추출 신뢰도 {Math.round(detail.confidence * 100)}%</span>}
        <button className={`btn${panel === "paste" ? " active" : ""}`} onClick={() => openPanel("paste")}>
          <ClipboardPaste size={14} /> 정답 붙여넣기
        </button>
        <button className={`btn${panel === "json" ? " active" : ""}`} onClick={() => openPanel("json")}>
          <Code2 size={14} /> JSON
        </button>
        {detail.archived && (
          <button
            className={`btn ghost${confirmRebuild ? " danger" : ""}`}
            title="보관된 원본에서 다시 추출 (여기서 고친 내용은 사라집니다)"
            disabled={busy}
            onClick={() => void rebuild()}
            onBlur={() => setConfirmRebuild(false)}
          >
            {confirmRebuild ? "다시 추출 확인" : <RotateCw size={14} />}
          </button>
        )}
        <button
          className={`btn ghost${confirmDelete ? " danger" : ""}`}
          title="이 초안 버리기"
          onClick={() => void discard()}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? "버리기 확인" : <Trash2 size={14} />}
        </button>
        <button className="btn primary" disabled={busy || !validation.test} onClick={() => void publish()}>
          <Save size={14} /> 라이브러리에 저장
        </button>
      </header>

      <div className="split">
        <article className="source-pane">
          <div className="pane-head">원문 · {detail.url}</div>
          <pre>{detail.sourceText}</pre>
        </article>

        <div className="questions review-form">
          {error && <p className="error">{error}</p>}

          <div className={`review-status ${validation.test ? "ok" : "todo"}`}>
            {validation.test ? (
              <p className="success">저장할 수 있습니다 · 문항 {questions.length}개</p>
            ) : (
              <p className="warning">저장하려면 아래 항목을 채워 주십시오.</p>
            )}
            {unanswered.length > 0 && <p className="error">정답이 비어 있는 문항: {unanswered.join(", ")}</p>}
            {otherErrors.map((e) => (
              <p key={e} className="error">
                {e}
              </p>
            ))}
            {validation.warnings.map((w) => (
              <p key={w} className="warning">
                {w}
              </p>
            ))}
            {detail.issues.length > 0 && (
              <details>
                <summary className="muted">추출할 때 확인된 사항 {detail.issues.length}건</summary>
                {detail.issues.map((i) => (
                  <p key={i} className="muted">
                    {i}
                  </p>
                ))}
              </details>
            )}
          </div>

          {panel !== "none" && (
            <div className="panel">
              <p className="muted">
                {panel === "paste"
                  ? "정답표를 붙여넣어 주십시오. '1 TRUE', '2. B', '3) river / stream'처럼 한 줄에 번호와 정답이 있으면 됩니다."
                  : "초안 전체를 JSON으로 고칩니다. 선택지 추가처럼 아래 양식에 없는 수정에 쓰십시오."}
              </p>
              <textarea className="code" value={panelText} spellCheck={false} onChange={(e) => setPanelText(e.target.value)} />
              <div className="toolbar">
                <span className="spacer" />
                <button className="btn" onClick={() => setPanel("none")}>
                  취소
                </button>
                <button className="btn primary" disabled={!panelText.trim()} onClick={applyPanel}>
                  적용
                </button>
              </div>
            </div>
          )}

          <div className="form-grid" key={`meta-${rev}`}>
            <label>제목</label>
            <input
              className="field"
              defaultValue={draft.title}
              onBlur={(e) => update((d) => void (d.title = e.target.value.trim()))}
            />
            <label>종류</label>
            <div className="toolbar">
              <select className="field narrow" value={draft.kind} onChange={(e) => update((d) => void (d.kind = e.target.value as ImportTest["kind"]))}>
                <option value="reading">Reading</option>
                <option value="listening">Listening</option>
                <option value="writing">Writing</option>
                <option value="speaking">Speaking</option>
              </select>
              <select
                className="field narrow"
                value={draft.module}
                onChange={(e) => update((d) => void (d.module = e.target.value as ImportTest["module"]))}
              >
                <option value="academic">Academic</option>
                <option value="general">General Training</option>
              </select>
            </div>
          </div>

          {draft.passages.map((p, pi) => (
            <section key={`${rev}-${pi}`} className="review-passage">
              <h3 className="section-title">지문 {draft.passages.length > 1 ? pi + 1 : ""}</h3>
              <input
                className="field wide"
                placeholder="지문 제목 (선택)"
                defaultValue={p.title ?? ""}
                onBlur={(e) => update((d) => void (d.passages[pi].title = e.target.value.trim() || undefined))}
              />
              <textarea
                className="code body"
                defaultValue={bodyText(p)}
                spellCheck={false}
                placeholder="지문 본문. 문단은 빈 줄로 구분하고, 문단 기호는 [A] 형식으로 적습니다. 그림은 ![설명](파일) 줄로 표시됩니다."
                onBlur={(e) => update((d) => setBody(d.passages[pi], e.target.value))}
              />
              {draft.kind === "listening" && (
                <input
                  className="field wide"
                  placeholder="음성 파일 주소"
                  spellCheck={false}
                  defaultValue={p.audio ?? ""}
                  onBlur={(e) => update((d) => void (d.passages[pi].audio = e.target.value.trim() || undefined))}
                />
              )}
              {(draft.kind === "writing" || draft.kind === "speaking") && (
                <textarea
                  className="code body"
                  defaultValue={p.sample ?? ""}
                  spellCheck={false}
                  placeholder="모범 답안 (선택). 문단은 빈 줄로 구분합니다."
                  onBlur={(e) => update((d) => void (d.passages[pi].sample = e.target.value.trim() || undefined))}
                />
              )}
              {p.paragraphs?.some((x) => x.image) && (
                <div className="review-figures">
                  {p.paragraphs.map((x, i) => x.image && <ArchivedImage key={`${i}-${x.image}`} name={x.image} />)}
                </div>
              )}

              {p.groups.map((g, gi) => (
                <div key={gi} className="review-group">
                  <div className="toolbar">
                    <select
                      className="field narrow"
                      value={g.type}
                      onChange={(e) => update((d) => void (d.passages[pi].groups[gi].type = e.target.value as QuestionType))}
                    >
                      {TYPES.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span className="muted">
                      {g.options?.length ? `공통 선택지 ${g.options.length}개 (${g.options.map((o) => o.key).join(", ")})` : ""}
                    </span>
                  </div>
                  <textarea
                    className="field area"
                    rows={2}
                    placeholder="지시문"
                    defaultValue={g.instructions ?? ""}
                    onBlur={(e) =>
                      update((d) => void (d.passages[pi].groups[gi].instructions = e.target.value.trim() || undefined))
                    }
                  />
                  {g.image && (
                    <div className="review-figures">
                      <ArchivedImage name={g.image} />
                      <button className="btn ghost" onClick={() => update((d) => void (d.passages[pi].groups[gi].image = undefined))}>
                        그림 빼기
                      </button>
                    </div>
                  )}
                  {g.questions.map((q, qi) => (
                    <div key={q.number} className={`review-q${q.answer.length ? "" : " missing"}`}>
                      <span className="qnum">{q.number}</span>
                      <input
                        className="field"
                        placeholder="문항 내용"
                        defaultValue={q.prompt ?? ""}
                        onBlur={(e) =>
                          update((d) => void (d.passages[pi].groups[gi].questions[qi].prompt = e.target.value.trim() || undefined))
                        }
                      />
                      <input
                        className="field answer"
                        placeholder="정답 (여러 개는 ' / '로 구분)"
                        defaultValue={q.answer.join(" / ")}
                        onBlur={(e) =>
                          update((d) => void (d.passages[pi].groups[gi].questions[qi].answer = splitAnswers(e.target.value)))
                        }
                      />
                      {q.options?.length ? <span className="muted">선택지 {q.options.length}개</span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
