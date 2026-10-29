import { FileJson, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { parseImportText } from "../lib/importFormat";
import { findSavedTest, saveImportedTest } from "../lib/repo";
import { toeicSampleTests } from "../lib/toeicSamples";
import ToeicGeneratePanel from "../components/ToeicGeneratePanel";
import PackageImport from "../components/PackageImport";
import type { GenSkill } from "../lib/generate";
import Collect from "./Collect";
import Review from "./Review";

const EXAMPLE = `{
  "title": "Practice Test 1",
  "kind": "listening",
  "passages": [
    {
      "title": "Part 2 · Question-Response",
      "body": "Speaker: Number 1. When is the report due?\\n\\nResponder: (A) By Friday. (B) On the desk. (C) Yes, it is.",
      "groups": [
        { "type": "lmcq",
          "questions": [ { "number": 1, "prompt": "Number 1",
            "options": [ { "key": "A", "text": "By Friday." }, { "key": "B", "text": "On the desk." }, { "key": "C", "text": "Yes, it is." } ],
            "answer": "A" } ] }
      ]
    }
  ]
}`;

function JsonImport({ onImported }: { onImported: (testId: number) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => (text.trim() ? parseImportText(text) : null), [text]);

  const save = async (source: Parameters<typeof saveImportedTest>[0]) => {
    setBusy(true);
    setMessage(null);
    try {
      const id = await saveImportedTest(source);
      setMessage({ kind: "ok", text: `"${source.title}"을(를) 저장했습니다.` });
      setText("");
      onImported(id);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Saves the built-in practice sets that are not in the library yet. */
  const addSamples = async () => {
    setBusy(true);
    setMessage(null);
    try {
      let added = 0;
      let last = 0;
      for (const t of toeicSampleTests()) {
        if ((await findSavedTest(t)) !== null) continue;
        last = await saveImportedTest(t);
        added++;
      }
      setMessage({ kind: "ok", text: added ? `샘플 세트 ${added}개를 추가했습니다.` : "샘플 세트가 이미 모두 들어 있습니다." });
      if (last) onImported(last);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    setMessage(null);
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <FileJson size={14} /> JSON 파일 열기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button className="btn" disabled={busy} onClick={() => void addSamples()}>
          <Sparkles size={14} /> TOEIC 샘플 세트 추가
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={busy || !validation?.test}
          onClick={() => validation?.test && save(validation.test)}
        >
          저장
        </button>
      </div>

      <textarea
        className="code"
        value={text}
        spellCheck={false}
        placeholder={EXAMPLE}
        onChange={(e) => setText(e.target.value)}
      />

      {message && <p className={message.kind === "ok" ? "success" : "error"}>{message.text}</p>}

      {validation && (
        <div className="validation">
          {validation.test && (
            <p className="success">
              형식 확인 완료 · 지문 {validation.test.passages.length}개 · 문항{" "}
              {validation.test.passages.reduce(
                (n, p) => n + p.groups.reduce((m, g) => m + g.questions.length, 0),
                0,
              )}
              개
            </p>
          )}
          {validation.errors.map((e) => (
            <p key={e} className="error">
              {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} className="warning">
              {w}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

export default function Import({
  onImported,
  onImportedExam,
  initialSkill,
}: {
  onImported: (testId: number) => void;
  /** Opens a whole exam just made or imported. */
  onImportedExam: (examId: number) => void;
  /** Opens the AI tab on this skill (from a list screen's "AI로 새 문제"). */
  initialSkill?: GenSkill;
}) {
  const [tab, setTab] = useState<"ai" | "package" | "collect" | "json">("ai");
  const [reviewId, setReviewId] = useState<number | null>(null);

  if (reviewId !== null) return <Review key={reviewId} jobId={reviewId} onDone={() => setReviewId(null)} />;

  return (
    <div className="content">
      <h1>가져오기</h1>
      <div className="segmented tabs">
        <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>
          AI로 만들기
        </button>
        <button className={tab === "package" ? "on" : ""} onClick={() => setTab("package")}>
          세트 파일
        </button>
        <button className={tab === "collect" ? "on" : ""} onClick={() => setTab("collect")}>
          웹·파일 수집
        </button>
        <button className={tab === "json" ? "on" : ""} onClick={() => setTab("json")}>
          JSON
        </button>
      </div>
      {tab === "ai" && <ToeicGeneratePanel key={initialSkill} initialSection={initialSkill} onCreated={onImported} onCreatedExam={onImportedExam} />}
      {tab === "package" && <PackageImport onImported={onImported} onImportedExam={onImportedExam} />}
      {tab === "collect" && <Collect onReview={setReviewId} onOpenTest={onImported} />}
      {tab === "json" && <JsonImport onImported={onImported} />}
    </div>
  );
}
