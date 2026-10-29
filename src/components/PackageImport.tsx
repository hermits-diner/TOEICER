import { Download, FolderOpen, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "../lib/ai";
import { KIND_LABEL, ORIGIN_LABEL } from "../lib/library";
import { importOpened, openPackage, PACKAGE_EXT, readPackage, type OpenedPackage } from "../lib/package";
import Hint from "./Hint";

interface Props {
  onImported: (testId: number) => void;
  /** A set file the app was asked to open (double-clicked in Explorer). */
  path?: string | null;
}

/** Reads a set file (.toic) and saves it to the library: picked here, or handed over by a double-click. */
export default function PackageImport({ onImported, path }: Props) {
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
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (path) void run("open", async () => setOpened(await readPackage(path)));
  }, [path]);

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
      if (r.reused === opened.tests.length) setNotice("이미 라이브러리에 있는 세트라 새로 저장하지 않고 그대로 엽니다.");
      onImported(r.testIds[0]);
    });

  const m = opened?.manifest;
  const verification = Array.isArray(m?.verification) ? (m.verification as { line?: string; checker?: string; cross?: boolean }[]) : [];

  return (
    <>
      <div className="accent-row wrap">
        <button className="btn primary" disabled={busy !== null} onClick={() => void pick()}>
          <FolderOpen size={14} /> {busy === "open" ? "읽는 중…" : `세트 파일 열기 (.${PACKAGE_EXT})`}
        </button>
        <span className="muted">
          마켓에서 산 세트나 선생님·친구가 보낸 세트
          <Hint text="파일 탐색기에서 세트 파일을 두 번 눌러도 이 앱에서 열립니다. Listening 음성과 Part 1 사진도 함께 들어옵니다. 마켓에서 산 세트는 구매한 계정 정보가 함께 들어 있습니다." />
        </span>
      </div>
      {opened && m && (
        <div className="task-card">
          <h3 className="section-title">{m.title || opened.tests[0].title}</h3>
          <p className="muted">
            {[
              `${KIND_LABEL[m.kind] ?? m.kind} · 문항 ${m.questions}개`,
              m.market ? "마켓 구매" : `출처: ${ORIGIN_LABEL[m.origin] ?? m.origin}`,
              m.author ? `만든 사람 ${m.author}` : "",
              m.createdAt ? new Date(m.createdAt).toLocaleDateString("ko-KR") : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {verification.length > 0 && (
            <div className="verify-box">
              <ShieldCheck size={14} />
              <div>
                <b>{verification[0].cross ? `교차 검증 (${verification[0].checker})` : "독립 검증"}</b>
                {verification.map((v, i) => v.line && <p key={i}>{v.line}</p>)}
              </div>
            </div>
          )}
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
