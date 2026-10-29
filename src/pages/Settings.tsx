import { Check, Minus, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import AiSettingsPanel from "../components/AiSettingsPanel";
import DataSettings from "../components/DataSettings";
import Hint from "../components/Hint";
import PhotoSettings from "../components/PhotoSettings";
import { ACCENTS, clampZoom, THEMES, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type Prefs } from "../lib/theme";

// Studio only; a Reader build leaves it out.
const LicensePanel = __STUDIO__ ? lazy(() => import("../components/LicensePanel")) : null;

export default function Settings({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const [tab, setTab] = useState<"display" | "ai" | "data" | "license">("display");
  return (
    <div className="content settings">
      <h1>설정</h1>
      <div className="segmented tabs">
        <button className={tab === "display" ? "on" : ""} onClick={() => setTab("display")}>화면</button>
        <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>AI</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>데이터</button>
        {LicensePanel && (
          <button className={tab === "license" ? "on" : ""} onClick={() => setTab("license")}>
            Studio 구독
          </button>
        )}
      </div>
      {tab === "ai" ? <AiSettingsPanel /> : tab === "data" ? <DataSettings /> : tab === "license" && LicensePanel ? <Suspense fallback={null}><LicensePanel /></Suspense> : <>
      <h3 className="section-title">테마</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-card${prefs.theme === t.id ? " on" : ""}`}
            title={t.desc}
            onClick={() => onChange({ ...prefs, theme: t.id })}
          >
            <span
              className={`theme-preview${t.id === "system" ? " split-preview" : ""}`}
              style={{ background: t.preview[1], color: t.preview[2] }}
            >
              <span className="tp-side" style={{ background: t.preview[0] }} />
              <span className="tp-lines">
                <i style={{ background: t.preview[2] }} />
                <i style={{ background: t.preview[2] }} />
                <i className="tp-accent" />
              </span>
            </span>
            <span className="theme-label">
              {t.label} {prefs.theme === t.id && <Check size={13} />}
            </span>
          </button>
        ))}
      </div>

      <h3 className="section-title">강조색</h3>
      <div className="accent-row">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            className={`swatch${prefs.accent === a.id ? " on" : ""}`}
            style={{ background: a.color }}
            title={a.label}
            aria-label={a.label}
            onClick={() => onChange({ ...prefs, accent: a.id })}
          >
            {prefs.accent === a.id && <Check size={12} color="#fff" strokeWidth={3} />}
          </button>
        ))}
        <span className="muted">{ACCENTS.find((a) => a.id === prefs.accent)?.label}</span>
      </div>

      <h3 className="section-title">
        본문 글꼴
        <Hint text="지문·문항·가이드 본문에 쓰입니다. 전자책 글꼴은 Literata와 리디바탕이며, PC에 Bookerly가 있으면 그것을 먼저 씁니다. 메뉴와 버튼은 고딕 그대로입니다." />
      </h3>
      <div className="settings-row">
        <div className="segmented">
          <button className={prefs.font === "ebook" ? "on" : ""} onClick={() => onChange({ ...prefs, font: "ebook" })}>
            전자책
          </button>
          <button className={prefs.font === "sans" ? "on" : ""} onClick={() => onChange({ ...prefs, font: "sans" })}>
            고딕
          </button>
        </div>
        <span className="font-sample passage-sample">The quick brown fox jumps over the lazy dog. 지문과 문항은 이 글꼴로.</span>
      </div>

      <PhotoSettings show={prefs.showPhotos} onToggle={(showPhotos) => onChange({ ...prefs, showPhotos })} />

      <h3 className="section-title">
        화면 크기
        <Hint text="어느 화면에서나 Ctrl + 마우스 휠, Ctrl + / −로 조절하고 Ctrl + 0으로 되돌립니다." />
      </h3>
      <div className="accent-row">
        <button
          className="btn"
          aria-label="작게"
          disabled={prefs.zoom <= ZOOM_MIN}
          onClick={() => onChange({ ...prefs, zoom: clampZoom(prefs.zoom - ZOOM_STEP) })}
        >
          <Minus size={14} />
        </button>
        <span className="zoom-value">{Math.round(prefs.zoom * 100)}%</span>
        <button
          className="btn"
          aria-label="크게"
          disabled={prefs.zoom >= ZOOM_MAX}
          onClick={() => onChange({ ...prefs, zoom: clampZoom(prefs.zoom + ZOOM_STEP) })}
        >
          <Plus size={14} />
        </button>
        <button className="btn ghost" disabled={prefs.zoom === 1} onClick={() => onChange({ ...prefs, zoom: 1 })}>
          기본 크기
        </button>
        <span className="muted">Ctrl + 휠 · Ctrl + / − · Ctrl 0</span>
      </div>
      </>}
    </div>
  );
}
