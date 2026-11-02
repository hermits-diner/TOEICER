// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRAND } from "./lib/brand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Tauri IPC and the start-up chores App runs once (backup, model list, samples) stay out of a DOM test.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: async () => {}, minimize: async () => {}, toggleMaximize: async () => {} }),
}));
vi.mock("./lib/backup", () => ({ autoBackupIfDue: async () => {} }));
vi.mock("./lib/modelCatalog", () => ({ refreshCatalog: async () => {} }));
vi.mock("./lib/appSettings", () => ({ getSetting: async () => "installed", setSetting: async () => {} }));
vi.mock("./lib/samples", () => ({ installSamples: async () => {}, SAMPLES_VERSION: "installed" }));
vi.mock("./components/WordLookup", () => ({ default: () => null }));
vi.mock("./pages/Home", () => ({
  default: () => {
    throw new Error("최근 기록을 읽지 못했습니다");
  },
}));

const { default: App } = await import("./App");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("a screen that fails to render leaves the title bar's close button and the sidebar working", async () => {
  await act(async () => root.render(<App />));

  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("최근 기록을 읽지 못했습니다");
  expect(host.querySelector('.titlebar button[aria-label="닫기"]')).not.toBeNull();

  const guide = [...host.querySelectorAll(".sidebar button")].find((b) => b.textContent === BRAND.guideLabel) as HTMLButtonElement;
  await act(async () => guide.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("main h1")?.textContent).toBe(BRAND.guideLabel);
});
