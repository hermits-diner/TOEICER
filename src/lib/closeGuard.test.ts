import { afterEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  handler: null as null | ((e: unknown) => Promise<void>),
  onCloseRequested: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (h: (e: unknown) => Promise<void>) => {
      win.onCloseRequested(h);
      win.handler = h;
      return Promise.resolve(() => {});
    },
  }),
}));
const { CLOSE_WAIT_MS, onWindowClose } = await import("./closeGuard");

const off: (() => void)[] = [];
const register = (f: () => Promise<unknown>) => off.push(onWindowClose(f));
afterEach(() => {
  off.splice(0).forEach((u) => u());
  vi.useRealTimers();
});

describe("closeGuard", () => {
  it("watches the window closing once, however many screens register", async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    register(a);
    register(b);
    expect(win.onCloseRequested).toHaveBeenCalledTimes(1);
    await win.handler!({});
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("no longer runs a flusher once it is unregistered", async () => {
    const a = vi.fn(async () => {});
    onWindowClose(a)();
    await win.handler!({});
    expect(a).not.toHaveBeenCalled();
  });

  it("lets the window close when a flusher fails", async () => {
    register(async () => {
      throw new Error("disk full");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(win.handler!({})).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("stops waiting for a flusher that hangs", async () => {
    vi.useFakeTimers();
    register(() => new Promise(() => {}));
    let closed = false;
    void win.handler!({}).then(() => (closed = true));
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
  });
});
