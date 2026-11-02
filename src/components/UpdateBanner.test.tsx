// @vitest-environment jsdom
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));

const { default: UpdateBanner } = await import("./UpdateBanner");

function fakeUpdate(download: (onEvent: (e: DownloadEvent) => void) => Promise<void> = async () => {}) {
  return { version: "0.2.1", currentVersion: "0.2.0", download: vi.fn(download), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}

let root: Root;
let host: HTMLDivElement;
const banner = () => host.querySelector(".update-banner");
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;
const render = () => act(async () => root.render(<UpdateBanner />));

beforeEach(() => {
  check.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("UpdateBanner", () => {
  it("shows nothing when this is the latest version", async () => {
    check.mockResolvedValue(null);
    await render();
    expect(host.innerHTML).toBe("");
  });

  it("shows nothing when the check fails (offline)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    check.mockRejectedValue(new Error("error sending request"));
    await render();
    expect(host.innerHTML).toBe("");
  });

  it("offers the new version over the one installed and installs it when asked", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    await render();
    expect(banner()?.textContent).toContain("0.2.1");
    expect(banner()?.textContent).toContain("0.2.0");
    await act(async () => button("설치하고 다시 시작").click());
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("shows the download's progress and keeps the buttons off meanwhile", async () => {
    let finish!: () => void;
    const update = fakeUpdate(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      await new Promise<void>((r) => (finish = r));
    });
    check.mockResolvedValue(update);
    await render();
    await act(async () => button("설치하고 다시 시작").click());
    expect(banner()?.textContent).toContain("내려받는 중 25%");
    expect([...host.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
    await act(async () => finish());
  });

  it("says why the install failed and lets the learner try again", async () => {
    const update = fakeUpdate(async () => {
      throw new Error("연결이 끊겼습니다");
    });
    check.mockResolvedValue(update);
    await render();
    await act(async () => button("설치하고 다시 시작").click());
    expect(banner()?.textContent).toContain("연결이 끊겼습니다");
    expect(button("설치하고 다시 시작").disabled).toBe(false);
    expect(update.install).not.toHaveBeenCalled();
  });

  it("나중에 puts it away until the next start", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    await render();
    await act(async () => button("나중에").click());
    expect(banner()).toBeNull();
    expect(update.close).toHaveBeenCalledTimes(1);
  });
});
