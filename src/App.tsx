import { useEffect, useRef, useState } from "react";
import "./App.css";
import { BRAND } from "./lib/brand";
import Sidebar, { pageLabels, type PageId } from "./components/Sidebar";
import ExamView from "./pages/ExamView";
import TitleBar from "./components/TitleBar";
import WordLookup from "./components/WordLookup";
import { loadAiSettings } from "./lib/ai";
import { autoBackupIfDue } from "./lib/backup";
import { refreshCatalog } from "./lib/modelCatalog";
import { applyPrefs, clampZoom, loadPrefs, savePrefs, ZOOM_STEP, type Prefs } from "./lib/theme";
import Guide from "./pages/Guide";
import Home from "./pages/Home";
import type { GenSkill } from "./lib/generate";
import { getTestShape } from "./lib/repo";
import type { TestKind } from "./lib/types";
import Import from "./pages/Import";
import PromptPractice from "./pages/PromptPractice";
import ReadingPractice from "./pages/ReadingPractice";
import Records, { type RecordsTab } from "./pages/Records";
import Settings from "./pages/Settings";
import TestList from "./pages/TestList";

/** Opens a test in the screen that suits its kind: questions to answer, or a task to respond to. */
function Practice({ testId, onExit }: { testId: number; onExit: () => void }) {
  const [shape, setShape] = useState<{ kind: TestKind; questions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getTestShape(testId).then(setShape, (e) => setError(String(e)));
  }, [testId]);
  if (error) return <div className="content"><p className="error">{error}</p></div>;
  if (!shape) return <div className="content"><p className="sub">불러오는 중…</p></div>;
  // Writing and speaking tasks are answered in your own words; a set with keyed questions (Build a Sentence) is scored.
  return (shape.kind === "writing" || shape.kind === "speaking") && shape.questions === 0 ? (
    <PromptPractice testId={testId} onExit={onExit} />
  ) : (
    <ReadingPractice testId={testId} onExit={onExit} />
  );
}

const KIND_PAGES: Partial<Record<PageId, { title: string; kind: TestKind }>> = {
  reading: { title: "Reading", kind: "reading" },
  listening: { title: "Listening", kind: "listening" },
  writing: { title: "Writing", kind: "writing" },
  speaking: { title: "Speaking", kind: "speaking" },
};

function App() {
  const [page, setPage] = useState<PageId>("home");
  const [reviewTab, setReviewTab] = useState<RecordsTab>("stats");
  const [genSkill, setGenSkill] = useState<GenSkill | undefined>(undefined);
  const [practiceId, setPracticeId] = useState<number | null>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  const navigate = (id: PageId) => {
    setPracticeId(null);
    setExamId(null);
    setPage(id);
    setReviewTab("stats"); // the home screen's wrong-answer tile overrides this right after
    setGenSkill(undefined); // likewise for a list's "AI로 새 문제"
  };

  const [zoomToast, setZoomToast] = useState<number | null>(null);
  const prefsRef = useRef(prefs);
  const toastTimer = useRef<number | undefined>(undefined);

  const updatePrefs = (p: Prefs) => {
    prefsRef.current = p;
    setPrefs(p);
    savePrefs(p);
    applyPrefs(p);
  };

  // Ctrl + wheel, Ctrl +/-, Ctrl 0 scale the whole UI (text included) and remember the size.
  const updateRef = useRef(updatePrefs);
  updateRef.current = updatePrefs;
  useEffect(() => {
    const setZoom = (z: number) => {
      const zoom = clampZoom(z);
      if (zoom === prefsRef.current.zoom) return;
      updateRef.current({ ...prefsRef.current, zoom });
      setZoomToast(zoom);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setZoomToast(null), 1200);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(prefsRef.current.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      if (e.key === "=" || e.key === "+") setZoom(prefsRef.current.zoom + ZOOM_STEP);
      else if (e.key === "-") setZoom(prefsRef.current.zoom - ZOOM_STEP);
      else if (e.key === "0") setZoom(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    // A failed daily copy must never get in the way of studying; it is retried on the next start.
    autoBackupIfDue().catch((e) => console.warn("auto backup failed", e));
    // The model pickers show what the CLIs and Gemini offer today; a CLI that is missing just keeps its last list.
    refreshCatalog(loadAiSettings()).catch((e) => console.warn("model catalog refresh failed", e));
  }, []);

  const openTest = (id: number) => setPracticeId(id);

  let main;
  if (practiceId !== null) {
    main = <Practice key={practiceId} testId={practiceId} onExit={() => setPracticeId(null)} />;
  } else if (examId !== null) {
    main = <ExamView key={examId} examId={examId} onOpenTest={openTest} onExit={() => setExamId(null)} onDeleted={() => setExamId(null)} />;
  } else if (page === "home") {
    main = (
      <Home
        showPhotos={prefs.showPhotos}
        onNavigate={navigate}
        onOpenTest={openTest}
        onOpenReview={(tab) => {
          navigate("review");
          setReviewTab(tab);
        }}
      />
    );
  } else if (page === "library") {
    main = <TestList title="전체 시험" onOpen={(t) => openTest(t.id)} onImport={() => navigate("import")} onOpenExam={setExamId} />;
  } else if (page === "ai") {
    main = (
      <TestList
        key="ai"
        title="AI 생성 세트"
        origin="ai"
        onOpen={(t) => openTest(t.id)}
        onImport={() => navigate("import")}
        onGenerate={() => navigate("import")}
        onOpenExam={setExamId}
      />
    );
  } else if (KIND_PAGES[page]) {
    const { title, kind } = KIND_PAGES[page];
    const generatable = kind === "reading" || kind === "listening" || kind === "writing" || kind === "speaking";
    main = (
      <TestList
        key={kind}
        title={title}
        kind={kind}
        onOpen={(t) => openTest(t.id)}
        onImport={() => navigate("import")}
        onGenerate={
          generatable
            ? () => {
                navigate("import");
                setGenSkill(kind);
              }
            : undefined
        }
      />
    );
  } else if (page === "import") {
    main = <Import onImported={openTest} onImportedExam={setExamId} initialSkill={genSkill} />;
  } else if (page === "review") {
    main = <Records key={reviewTab} onOpenTest={openTest} initialTab={reviewTab} />;
  } else if (page === "guide") {
    main = <Guide showPhotos={prefs.showPhotos} />;
  } else if (page === "settings") {
    main = <Settings prefs={prefs} onChange={updatePrefs} />;
  } else {
    main = (
      <div className="content">
        <h1>{pageLabels[page]}</h1>
        <p className="sub">이후 단계에서 구현될 화면입니다.</p>
      </div>
    );
  }

  return (
    <div className="window">
      <TitleBar title={BRAND.appName} />
      <div className="body">
        <Sidebar active={page} onSelect={navigate} />
        <main className="main">{main}</main>
      </div>
      <WordLookup />
      {zoomToast !== null && <div className="zoom-toast">{Math.round(zoomToast * 100)}%</div>}
    </div>
  );
}

export default App;
