import { Check, Loader2, Save, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText, geminiKeyStored, loadAiSettings } from "../lib/ai";
import { choiceCount, KEYS, paragraphsOf, validateImport } from "../lib/importFormat";
import { makeAudio, missingAudio } from "../lib/listenAudio";
import { partOfTitle } from "../lib/toeicSpec";
import type { ImportTest } from "../lib/types";

interface Props {
  test: ImportTest;
  /** Question numbers whose key the AI solved; shown for checking. */
  solved?: number[];
  saveLabel: string;
  busy?: boolean;
  onSave: (t: ImportTest) => void;
  onCancel: () => void;
}

/** Plain text of a passage for editing: paragraphs apart by a blank line. */
const bodyText = (p: ImportTest["passages"][number]) => paragraphsOf(p).map((x) => x.text).join("\n\n");

/**
 * Studio's set editor: the title, every passage's text or script, and each question's wording, choices and key. The
 * structure (parts, sets and questions) stays as it is, so attempts already made on a saved set stay valid. A Listening
 * set whose scripts have no recording can be given Gemini speech here.
 */
export default function SetEditor({ test, solved = [], saveLabel, busy, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ImportTest>(() => ({
    ...test,
    passages: test.passages.map((p) => ({ ...p, body: bodyText(p), paragraphs: undefined })),
  }));
  const [gemini, setGemini] = useState(false);
  const [voicing, setVoicing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = validateImport(draft);
  const silent = missingAudio(draft);

  useEffect(() => {
    if (test.kind === "listening") geminiKeyStored().then(setGemini, () => setGemini(false));
  }, [test.kind]);

  const voice = async () => {
    setError(null);
    try {
      setVoicing("0");
      const next = await makeAudio(loadAiSettings(), draft, (done, total) => setVoicing(`${done}/${total}`));
      setDraft(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setVoicing(null);
    }
  };

  const setPassage = (pi: number, patch: Partial<ImportTest["passages"][number]>) =>
    setDraft((d) => ({ ...d, passages: d.passages.map((p, i) => (i === pi ? { ...p, ...patch } : p)) }));
  const setQuestion = (pi: number, gi: number, qi: number, patch: Partial<ImportTest["passages"][number]["groups"][number]["questions"][number]>) =>
    setDraft((d) => ({
      ...d,
      passages: d.passages.map((p, i) =>
        i !== pi
          ? p
          : {
              ...p,
              groups: p.groups.map((g, j) => (j !== gi ? g : { ...g, questions: g.questions.map((q, k) => (k === qi ? { ...q, ...patch } : q)) })),
            },
      ),
    }));

  return (
    <div className="set-editor">
      <label className="se-title">
        제목
        <input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </label>
      {silent > 0 && (
        <div className="accent-row">
          <span className="muted small">
            음성이 없는 Listening 세트 {silent}개는 스크립트를 Windows 음성으로 읽습니다.
            {gemini ? "" : " 설정 › AI › 음성·사진에 Gemini 키를 넣으면 실제 음성을 만들 수 있습니다."}
          </span>
          {gemini && (
            <button className="btn small" disabled={busy || voicing !== null} onClick={() => void voice()}>
              {voicing !== null ? <Loader2 size={13} className="spin" /> : <Volume2 size={13} />}{" "}
              {voicing !== null ? `음성 만드는 중 ${voicing}` : "Gemini로 음성 만들기"}
            </button>
          )}
        </div>
      )}

      {draft.passages.map((p, pi) => {
        const keys = KEYS.slice(0, choiceCount(partOfTitle(p.title ?? null) ?? 0));
        return (
          <section key={pi} className="se-passage">
            <input className="field se-ptitle" value={p.title ?? ""} placeholder="Part 7 · Text 1" onChange={(e) => setPassage(pi, { title: e.target.value })} />
            <textarea
              className="field se-body"
              value={p.body ?? ""}
              placeholder={draft.kind === "listening" ? "스크립트 (한 줄에 한 사람: Woman: …)" : "지문 (Part 5는 비워 둡니다)"}
              rows={Math.min(14, Math.max(3, (p.body ?? "").split("\n").length + 1))}
              onChange={(e) => setPassage(pi, { body: e.target.value })}
            />
            {p.audio && <p className="muted small">음성 있음</p>}
            {p.groups.map((g, gi) =>
              g.questions.map((q, qi) => {
                const choices = q.options ?? keys.map((key) => ({ key, text: "" }));
                return (
                  <div key={q.number} className={`se-q${solved.includes(q.number) ? " solved" : ""}`}>
                    <div className="se-qhead">
                      <b>{q.number}.</b>
                      <input className="field" value={q.prompt ?? ""} placeholder="발문" onChange={(e) => setQuestion(pi, gi, qi, { prompt: e.target.value })} />
                    </div>
                    {solved.includes(q.number) && <p className="se-note">자료에 정답이 없어 AI가 풀어 정한 답입니다. 확인해 주세요.</p>}
                    {choices.map((o, oi) => (
                      <div key={o.key} className="se-choice">
                        <button
                          type="button"
                          className={`se-key${q.answer[0] === o.key ? " on" : ""}`}
                          title="정답으로 정하기"
                          onClick={() => setQuestion(pi, gi, qi, { answer: [o.key] })}
                        >
                          {q.answer[0] === o.key ? <Check size={13} /> : o.key}
                        </button>
                        <input
                          className="field"
                          value={o.text}
                          onChange={(e) => setQuestion(pi, gi, qi, { options: choices.map((c, ci) => (ci === oi ? { ...c, text: e.target.value } : c)) })}
                        />
                      </div>
                    ))}
                  </div>
                );
              }),
            )}
          </section>
        );
      })}

      {v.errors.length > 0 && (
        <ul className="error se-errors">
          {v.errors.slice(0, 6).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="toolbar se-actions">
        <button className="btn" disabled={busy || voicing !== null} onClick={onCancel}>
          <X size={14} /> 취소
        </button>
        <button className="btn primary" disabled={busy || voicing !== null || !v.test} onClick={() => v.test && onSave(v.test)}>
          <Save size={14} /> {saveLabel}
        </button>
      </div>
    </div>
  );
}
