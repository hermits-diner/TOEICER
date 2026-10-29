import { invoke } from "@tauri-apps/api/core";
import { ClipboardPaste, FileUp, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { errorText, loadAiSettings } from "../lib/ai";
import { convertMaterial, type Converted } from "../lib/convert";
import { saveImportedTest } from "../lib/repo";
import type { ImportTest } from "../lib/types";
import Hint from "./Hint";
import SetEditor from "./SetEditor";

/**
 * Studio › 붙여넣기·PDF: paste TOEIC questions or open a PDF the user owns; the AI sorts them into a Listening and/or a
 * Reading set, the user checks each in the editor and saves it as "내 자료".
 */
export default function PasteImport({ onSaved }: { onSaved: (testId: number) => void }) {
  const [text, setText] = useState("");
  const [step, setStep] = useState<"sort" | "solve" | "save" | null>(null);
  const [result, setResult] = useState<Converted | null>(null);
  /** Which of the converted sets is in the editor, and the ids of those already saved. */
  const [at, setAt] = useState(0);
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      setText(
        f.name.toLowerCase().endsWith(".pdf")
          ? await invoke<string>("extract_pdf_bytes", { bytes: Array.from(new Uint8Array(await f.arrayBuffer())) })
          : await f.text(),
      );
    } catch (e) {
      setError(errorText(e));
    }
  };

  const convert = async () => {
    setError(null);
    setResult(null);
    setAt(0);
    setSavedIds([]);
    try {
      const r = await convertMaterial(loadAiSettings(), text, setStep);
      if (!r.tests.length)
        throw new Error("TOEIC 문항을 찾지 못했습니다. 문항과 선택지가 들어 있는지, Listening이라면 스크립트가 함께 있는지 확인해 주세요.");
      setResult(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStep(null);
    }
  };

  const save = async (t: ImportTest) => {
    setStep("save");
    setError(null);
    try {
      const id = await saveImportedTest(t, "mine");
      const ids = [...savedIds, id];
      setSavedIds(ids);
      if (result && at + 1 < result.tests.length) setAt(at + 1);
      else onSaved(ids[0]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStep(null);
    }
  };

  if (result)
    return (
      <>
        <p className="muted">
          AI가 나눈 결과입니다{result.tests.length > 1 ? ` (${at + 1}/${result.tests.length}: ${result.tests[at].kind === "listening" ? "Listening" : "Reading"})` : ""}.
          지문·스크립트·발문·선택지·정답을 확인하고 저장하세요.
          {result.solved.length > 0 && ` 정답이 없던 ${result.solved.join(", ")}번은 AI가 풀어 정했습니다.`}
        </p>
        <SetEditor
          key={at}
          test={result.tests[at]}
          solved={result.solved}
          saveLabel={at + 1 < result.tests.length ? "내 자료로 저장하고 다음 세트" : "내 자료로 저장"}
          busy={step === "save"}
          onSave={save}
          onCancel={() => (savedIds.length ? onSaved(savedIds[0]) : setResult(null))}
        />
        {error && <p className="error">{error}</p>}
      </>
    );

  return (
    <div className="paste-import">
      <div className="accent-row">
        <span className="muted">
          가진 TOEIC 문제(학원 프린트, 교재, PDF)를 붙여넣으면 AI가 파트·지문·문항·선택지·정답으로 나눕니다.
          <Hint text="AI는 내용을 고치거나 새로 쓰지 않고 나누기만 합니다. 정답표가 없으면 AI가 풀어 정하고 표시합니다. Listening 문항은 스크립트가 함께 있을 때만 들어오며, 편집기에서 Gemini로 음성을 만들거나 Windows 음성으로 들을 수 있습니다. 이렇게 넣은 세트는 '내 자료'로 이 PC에만 저장되며 마켓에 올릴 수 없습니다." />
        </span>
        <span className="spacer" />
        <button className="btn small" disabled={step !== null} onClick={() => fileRef.current?.click()}>
          <FileUp size={13} /> PDF·텍스트 파일 열기
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={(e) => void readFile(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      </div>
      <textarea
        className="field paste-area"
        value={text}
        disabled={step !== null}
        placeholder={"예)\n101. The manager gave final ------- to the budget plan.\n(A) approve (B) approval (C) approving (D) approved\n\n102. …\n\n정답: 101-B"}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="toolbar">
        <button className="btn primary" disabled={step !== null || !text.trim()} onClick={() => void convert()}>
          {step ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{" "}
          {step === "sort" ? "문항으로 나누는 중…" : step === "solve" ? "정답이 없는 문항을 푸는 중…" : "세트로 만들기"}
        </button>
        {!text && (
          <span className="muted small">
            <ClipboardPaste size={12} /> Ctrl+V로 붙여넣기
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
