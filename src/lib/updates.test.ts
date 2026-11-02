import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => void calls.push(`invoke ${cmd}`) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => void calls.push("relaunch") }));

const { installUpdate, UPDATE_BUSY } = await import("./updates");
const { onWindowClose } = await import("./closeGuard");

const SIZED: DownloadEvent[] = [
  { event: "Started", data: { contentLength: 200 } },
  { event: "Progress", data: { chunkLength: 50 } },
  { event: "Progress", data: { chunkLength: 150 } },
  { event: "Finished" },
];

function fakeUpdate(events: DownloadEvent[] = SIZED) {
  return {
    download: vi.fn(async (onEvent?: (e: DownloadEvent) => void) => {
      calls.push("download");
      events.forEach((e) => onEvent?.(e));
    }),
    install: vi.fn(async () => void calls.push("install")),
  };
}

let unregister: () => void;
beforeEach(() => {
  calls.length = 0;
  // What an unfinished attempt registers (useDraftSaver): the window's close would run it, an installer's exit does not.
  unregister = onWindowClose(async () => void calls.push("save draft"));
});
afterEach(() => unregister());

describe("installUpdate", () => {
  it("saves what closing the window would save and ends the CLIs, then hands over to the installer", async () => {
    await installUpdate(fakeUpdate(), () => {}, async () => false);
    expect(calls).toEqual(["download", "save draft", "invoke ai_end_all_jobs", "install", "relaunch"]);
  });

  it("refuses while an AI generation runs, before downloading anything", async () => {
    await expect(installUpdate(fakeUpdate(), () => {}, async () => true)).rejects.toThrow(UPDATE_BUSY);
    expect(UPDATE_BUSY).not.toBe("");
    expect(calls).toEqual([]);
  });

  it("refuses when a generation started during the download, leaving its CLI running", async () => {
    const busy = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(installUpdate(fakeUpdate(), () => {}, busy)).rejects.toThrow(UPDATE_BUSY);
    expect(calls).toEqual(["download"]);
  });

  it("reports the download as a percent of the installer's size", async () => {
    const seen: (number | null)[] = [];
    await installUpdate(fakeUpdate(), (p) => seen.push(p), async () => false);
    expect(seen).toEqual([0, 25, 100]);
  });

  it("by default asks every job store whether its job is still running (the app's generation)", async () => {
    const { createJobStore, anyJobBusy } = await import("./jobStore");
    let finish!: () => void;
    const store = createJobStore<"s", "w" | "done", null, null, null>({
      describe: () => ({ label: "job", sections: ["s"], planOf: () => [["w"]] }),
      doneStep: "done",
      share: 95,
      stepText: () => "",
      run: () => new Promise((ok) => (finish = () => ok({ reports: [], result: null }))),
      cancel: async () => {},
      end: async () => {},
    });
    expect(anyJobBusy()).toBe(false);
    const ended = store.start(null);
    expect(anyJobBusy()).toBe(true);
    finish();
    await ended;
    expect(anyJobBusy()).toBe(false);
  });

  it("reports no percent when the server did not give the size", async () => {
    const seen: (number | null)[] = [];
    const events: DownloadEvent[] = [{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 10 } }, { event: "Finished" }];
    await installUpdate(fakeUpdate(events), (p) => seen.push(p), async () => false);
    expect(seen).toEqual([null, null]);
  });
});
