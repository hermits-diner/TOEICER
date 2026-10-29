import { Download, FolderOpen } from "lucide-react";
import { useState } from "react";
import { importOpened, openPackage, type OpenedPackage } from "../lib/package";
import Hint from "./Hint";

const KIND: Record<string, string> = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };

/** 가져오기 › 세트 파일: reads a shared .toeicset package and saves it to the library. */
export default function PackageImport({ onImported, onImportedExam }: { onImported: (testId: number) => void; onImportedExam: (examId: number) => void }) {
  const [opened, setOpened] = useState<OpenedPackage | null>(null);
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (key: "open" | "save", job: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = () =>
    run("open", async () => {
      const o = await openPackage();
      if (o) setOpened(o);
    });

  const save = () =>
    run("save", async () => {
      if (!opened) return;
      const r = await importOpened(opened);
      setOpened(null);
      // Everything was already here: say so before the page changes.
      if (r.reused === opened.tests.length) setNotice("이미 라이브러리에 있는 세트라 새로 저장하지 않고 그대로 엽니다.");
      if (r.examId !== null) onImportedExam(r.examId);
      else onImported(r.testIds[0]);
    });

  const m = opened?.manifest;
  const details = opened
    ? [
        m?.exam ? `시험 한 부 · ${opened.tests.map((t) => KIND[t.kind] ?? t.kind).join(" · ")}` : (KIND[opened.tests[0].kind] ?? opened.tests[0].kind),
        (m?.module ?? opened.tests[0].module) === "general" ? "General Training" : "Academic",
        `문항 ${m?.tests?.length ? m.tests.reduce((n, t) => n + t.questions, 0) : "?"}개`,
        m?.author ? `만든 사람 ${m.author}` : "",
        m?.createdAt ? new Date(m.createdAt).toLocaleDateString() : "",
        opened.media.length ? `음성·그림 ${opened.media.length}개` : "",
      ].filter(Boolean)
    : [];

  return (
    <>
      <div className="accent-row wrap">
        <button className="btn" disabled={busy !== null} onClick={() => void pick()}>
          <FolderOpen size={14} /> {busy === "open" ? "읽는 중…" : "세트 파일 열기 (.toeicset)"}
        </button>
        <span className="muted">
          다른 사용자가 내보낸 세트나 시험 한 부
          <Hint text="음성과 그림도 함께 들어오고, 이미 있는 세트는 다시 저장하지 않습니다. 내 세트는 목록의 공유 단추로 내보냅니다." />
        </span>
      </div>
      {opened && (
        <div className="task-card">
          <h3 className="section-title">{m?.title || opened.tests[0].title}</h3>
          <p className="muted">{details.join(" · ")}</p>
          {opened.warnings.map((w) => (
            <p key={w} className="muted">
              주의: {w}
            </p>
          ))}
          <button className="btn primary" disabled={busy !== null} onClick={() => void save()}>
            <Download size={14} /> {busy === "save" ? "저장 중…" : "라이브러리에 저장"}
          </button>
        </div>
      )}
      {notice && <p className="success">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}
