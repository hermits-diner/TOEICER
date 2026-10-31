import { ClipboardPaste, FolderOpen, Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import PackageImport from "../components/PackageImport";

// Studio's making tools; a Reader build leaves them out.
const StudioMake = __STUDIO__ ? lazy(() => import("../components/StudioMake")) : null;

type Tab = "ai" | "paste" | "file";

interface Props {
  onImported: (testId: number) => void;
  /** A set file the app was asked to open (double-click); it opens on the file tab. */
  openPath?: string | null;
  /** Studio: show the AI tab (the sidebar's generation indicator); onAiTabShown clears the request. */
  showAiTab?: boolean;
  onAiTabShown?: () => void;
}

/**
 * Reader: open a set file. Studio: write a paper with the AI, turn one's own material into a set, or open a set file.
 */
export default function Import({ onImported, openPath, showAiTab, onAiTabShown }: Props) {
  const first: Tab = StudioMake ? "ai" : "file";
  const [tab, setTab] = useState<Tab>(first);
  // A tab once shown stays mounted (hidden behind the others), so switching keeps a paste/PDF draft or an opened set file.
  const [shown, setShown] = useState<Tab[]>([first]);
  const show = (t: Tab) => {
    setTab(t);
    setShown((s) => (s.includes(t) ? s : [...s, t]));
  };
  useEffect(() => {
    if (openPath) show("file");
  }, [openPath]);
  useEffect(() => {
    if (!showAiTab) return;
    if (StudioMake) show("ai");
    onAiTabShown?.();
  }, [showAiTab]);

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
        <button className={tab === "ai" ? "on" : ""} onClick={() => show("ai")}>
          <Sparkles size={13} /> AI로 만들기
        </button>
        <button className={tab === "paste" ? "on" : ""} onClick={() => show("paste")}>
          <ClipboardPaste size={13} /> 붙여넣기·PDF
        </button>
        <button className={tab === "file" ? "on" : ""} onClick={() => show("file")}>
          <FolderOpen size={13} /> 세트 파일
        </button>
      </div>
      {shown.includes("file") && (
        <div hidden={tab !== "file"}>
          <PackageImport onImported={onImported} path={openPath} />
        </div>
      )}
      {(shown.includes("ai") || shown.includes("paste")) && (
        <div hidden={tab === "file"}>
          <Suspense fallback={<p className="muted">불러오는 중…</p>}>
            <StudioMake tab={tab === "paste" ? "paste" : "ai"} shown={shown} onCreated={onImported} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
