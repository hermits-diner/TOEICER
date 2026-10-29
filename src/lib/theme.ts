import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeId = "office" | "system" | "light" | "dark" | "sepia" | "seojae" | "midnight";
export type FontId = "ebook" | "sans";
export type AccentId = "blue" | "purple" | "pink" | "red" | "orange" | "green" | "graphite";

export const THEMES: { id: ThemeId; label: string; desc: string; preview: [string, string, string] }[] = [
  { id: "office", label: "오피스", desc: "TOEICER 기본: 먹색 글씨와 에메랄드 포인트, 오렌지 강조. 깔끔한 업무용 느낌", preview: ["#eef1ef", "#fbfcfb", "#1f2a2e"] },
  { id: "system", label: "시스템", desc: "Windows 라이트/다크 설정을 따릅니다", preview: ["#f6f6f6", "#ffffff", "#1d1d1f"] },
  { id: "light", label: "라이트", desc: "밝은 기본 테마", preview: ["#f6f6f6", "#ffffff", "#1d1d1f"] },
  { id: "dark", label: "다크", desc: "어두운 기본 테마", preview: ["#2b2b2d", "#1e1e20", "#f5f5f7"] },
  { id: "sepia", label: "세피아", desc: "종이 느낌, 긴 지문 읽기용", preview: ["#ece2cc", "#f6efdf", "#433422"] },
  { id: "seojae", label: "서재", desc: "청자빛 종이와 명조 제목, 주홍 낙관", preview: ["#e3e9e1", "#eef2ec", "#1e2a22"] },
  { id: "midnight", label: "미드나이트", desc: "푸른빛이 도는 어두운 테마", preview: ["#141b2d", "#0f1524", "#e3e8f4"] },
];

export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: "blue", label: "파랑", color: "#007aff" },
  { id: "purple", label: "보라", color: "#af52de" },
  { id: "pink", label: "분홍", color: "#ff2d55" },
  { id: "red", label: "빨강", color: "#ff3b30" },
  { id: "orange", label: "주황", color: "#ff9500" },
  { id: "green", label: "초록", color: "#34c759" },
  { id: "graphite", label: "그래파이트", color: "#8e8e93" },
];

export interface Prefs {
  theme: ThemeId;
  accent: AccentId;
  /** Typeface for passages, questions and the guide. */
  font: FontId;
  /** Photos on the home screen and guide; off for a plainer, more focused look. */
  showPhotos: boolean;
  /** Webview zoom factor, adjusted with Ctrl+wheel / Ctrl +/- / Ctrl 0. */
  zoom: number;
}

const KEY = "toeicer.prefs";
const DEFAULT: Prefs = { theme: "office", accent: "blue", font: "ebook", showPhotos: true, zoom: 1 };

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: THEMES.some((t) => t.id === p.theme) ? (p.theme as ThemeId) : DEFAULT.theme,
      accent: ACCENTS.some((a) => a.id === p.accent) ? (p.accent as AccentId) : DEFAULT.accent,
      font: p.font === "sans" || p.font === "ebook" ? p.font : DEFAULT.font,
      showPhotos: typeof p.showPhotos === "boolean" ? p.showPhotos : DEFAULT.showPhotos,
      zoom: typeof p.zoom === "number" && Number.isFinite(p.zoom) ? clampZoom(p.zoom) : DEFAULT.zoom,
    };
  } catch {
    return DEFAULT;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

/** Applies CSS tokens and matches the native window theme so the Mica backdrop agrees with the palette. */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.accent = p.accent;
  root.dataset.font = p.font;
  const native =
    p.theme === "system" ? null : p.theme === "light" || p.theme === "sepia" || p.theme === "seojae" || p.theme === "office" ? "light" : "dark";
  getCurrentWindow()
    .setTheme(native)
    .catch(() => {});
  getCurrentWebview()
    .setZoom(p.zoom)
    .catch(() => {});
}
