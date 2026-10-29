import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { BRAND } from "./lib/brand";
import Sidebar, { type PageId } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import WordLookup from "./components/WordLookup";
import { loadAiSettings } from "./lib/ai";
import { getSetting, setSetting } from "./lib/appSettings";
import { autoBackupIfDue } from "./lib/backup";
import { STUDIO } from "./lib/edition";
import { refreshCatalog } from "./lib/modelCatalog";
import { installSamples } from "./lib/samples";
import { applyPrefs, clampZoom, loadPrefs, savePrefs, ZOOM_STEP, type Prefs } from "./lib/theme";
import Guide from "./pages/Guide";
import Home from "./pages/Home";
import Import from "./pages/Import";
import ReadingPractice from "./pages/ReadingPractice";
import Records, { type RecordsTab } from "./pages/Records";
import Settings from "./pages/Settings";
import TestList from "./pages/TestList";

function App() {
  const [page, setPage] = useState<PageId>("home");
  const [reviewTab, setReviewTab] = useState<RecordsTab>("stats");
  const [practiceId, setPracticeId] = useState<number | null>(null);
  /** A set file handed to the app by a double-click, shown on the import page until saved. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  const navigate = (id: PageId) => {
    setPracticeId(null);
    setPage(id);
    setReviewTab("stats"); // the home screen's wrong-answer tile overrides this right after
    if (id !== "import") setOpenPath(null);
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
    // The model pickers show what the CLIs (and, with a key, Gemini) offer today; a CLI that is missing keeps its last list.
    refreshCatalog(loadAiSettings()).catch((e) => console.warn("model catalog refresh failed", e));
    if (__STUDIO__) void import("./lib/license").then((m) => m.refreshLicense());
    // The built-in sets go into the library once, so there is something to try right away.
    void getSetting("samples_installed").then(async (done) => {
      if (done) return;
      await installSamples().catch((e) => console.warn("samples", e));
      await setSetting("samples_installed", "1");
    });
    // Set files double-clicked in Explorer: at start, and later ones handed over by a second launch.
    const show = (paths: string[]) => {
      if (!paths.length) return;
      setPracticeId(null);
      setPage("import");
      setOpenPath(paths[0]);
    };
    invoke<string[]>("take_opened_files").then(show, () => {});
    const off = listen<string[]>("open-set-files", (e) => show(e.payload));
    return () => void off.then((f) => f());
  }, []);

  const openTest = (id: number) => setPracticeId(id);

  let main;
  if (practiceId !== null) {
    main = <ReadingPractice key={practiceId} testId={practiceId} onExit={() => setPracticeId(null)} />;
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
    main = <TestList title="문제 세트" onOpen={(t) => openTest(t.id)} onImport={() => navigate("import")} />;
  } else if (page === "ai" && STUDIO) {
    main = <TestList key="ai" title="AI 생성 세트" origin="ai" onOpen={(t) => openTest(t.id)} onImport={() => navigate("import")} />;
  } else if (page === "import") {
    main = (
      <Import
        openPath={openPath}
        onImported={(id) => {
          setOpenPath(null);
          openTest(id);
        }}
      />
    );
  } else if (page === "review") {
    main = <Records key={reviewTab} onOpenTest={openTest} initialTab={reviewTab} />;
  } else if (page === "guide") {
    main = <Guide showPhotos={prefs.showPhotos} />;
  } else {
    main = <Settings prefs={prefs} onChange={updatePrefs} />;
  }

  return (
    <div className="window">
      <TitleBar title={STUDIO ? `${BRAND.appName} Studio` : BRAND.appName} />
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
