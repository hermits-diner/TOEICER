import { ClipboardPaste, FolderOpen, Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import PackageImport from "../components/PackageImport";

// Studio's making tools; a Reader build leaves them out.
const StudioMake = __STUDIO__ ? lazy(() => import("../components/StudioMake")) : null;

type Tab = "ai" | "paste" | "file";

/**
 * Reader: open a set file. Studio: write a paper with the AI, turn one's own material into a set, or open a set file.
 * `openPath` is a set file the app was asked to open (double-click); it opens on the file tab.
 */
export default function Import({ onImported, openPath }: { onImported: (testId: number) => void; openPath?: string | null }) {
  const [tab, setTab] = useState<Tab>(StudioMake ? "ai" : "file");
  useEffect(() => {
    if (openPath) setTab("file");
  }, [openPath]);

  if (!StudioMake)
    return (
      <div className="content">
        <h1>세트 파일 열기</h1>
        <PackageImport onImported={onImported} path={openPath} />
      </div>
    );

  return (
    <div className="content">
      <h1>만들기·가져오기</h1>
      <div className="segmented tabs">
        <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>
          <Sparkles size={13} /> AI로 만들기
        </button>
        <button className={tab === "paste" ? "on" : ""} onClick={() => setTab("paste")}>
          <ClipboardPaste size={13} /> 붙여넣기·PDF
        </button>
        <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
          <FolderOpen size={13} /> 세트 파일
        </button>
      </div>
      {tab === "file" ? (
        <PackageImport onImported={onImported} path={openPath} />
      ) : (
        <Suspense fallback={<p className="muted">불러오는 중…</p>}>
          <StudioMake tab={tab} onCreated={onImported} />
        </Suspense>
      )}
    </div>
  );
}
