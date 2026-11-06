// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ signIn: vi.fn(), openUrl: vi.fn(async () => {}) }));
vi.mock("../lib/marketLock", () => ({
  signIn: h.signIn,
  marketUrl: () => "https://market.test",
  LOCK_TEXT: { login: "로그인하면 열립니다.", device_removed: "기기에서 빠졌습니다.", refunded: "환불된 구매입니다." },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));

const { default: MarketLogin } = await import("./MarketLogin");
const { default: LockedSet } = await import("./LockedSet");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const render = (ui: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(ui));
};
const fill = (type: string, value: string) => {
  const el = host.querySelector<HTMLInputElement>(`input[type=${type}]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const signInWith = async () => {
  fill("email", "me@example.com");
  fill("password", "pw");
  await click(button("로그인"));
};

beforeEach(() => {
  h.signIn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("signing in", () => {
  it("sends the purchase along, and finishes on success", async () => {
    h.signIn.mockResolvedValue({ status: "ok", email: "me@example.com" });
    const done = vi.fn();
    render(<MarketLogin purchase="K7QF-3M2A" onDone={done} />);
    await signInWith();
    expect(h.signIn).toHaveBeenCalledWith("me@example.com", "pw", { purchase: "K7QF-3M2A" });
    expect(done).toHaveBeenCalled();
  });

  it("shows the site's refusal and lets the person try again", async () => {
    h.signIn.mockResolvedValue({ status: "refused", code: "not_owner", message: "이 계정으로 구매한 세트가 아닙니다." });
    const done = vi.fn();
    render(<MarketLogin onDone={done} />);
    await signInWith();
    expect(host.textContent).toContain("이 계정으로 구매한 세트가 아닙니다.");
    expect(done).not.toHaveBeenCalled();
    expect(button("로그인").disabled).toBe(false);
  });

  it("no internet is said in words", async () => {
    h.signIn.mockRejectedValue(new Error("처음 여는 구매본은 인터넷이 필요합니다."));
    render(<MarketLogin onDone={vi.fn()} />);
    await signInWith();
    expect(host.textContent).toContain("인터넷이 필요합니다");
  });

  it("links to the reset guide for a forgotten password", async () => {
    render(<MarketLogin onDone={vi.fn()} />);
    await click(button("비밀번호를 잊었다면"));
    expect(h.openUrl).toHaveBeenCalledWith("https://market.test/reset");
  });
});

describe("a full account", () => {
  const devices = [
    { id: 11, name: "거실 PC", createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z" },
    { id: 12, name: "교실 PC", createdAt: "2026-02-01T00:00:00.000Z", lastSeenAt: "2026-10-02T00:00:00.000Z" },
  ];

  it("shows its PCs; taking one off signs this PC in", async () => {
    h.signIn.mockResolvedValueOnce({ status: "full", message: "3대까지 등록할 수 있습니다.", devices, canRemove: true, removableAt: null });
    h.signIn.mockResolvedValueOnce({ status: "ok", email: "me@example.com" });
    const done = vi.fn();
    render(<MarketLogin onDone={done} />);
    await signInWith();
    expect(host.textContent).toContain("거실 PC");
    expect(host.textContent).toContain("교실 PC");
    expect(button("고른 PC를 빼고").disabled).toBe(true);

    await click(host.querySelectorAll("input[type=radio]")[1]);
    await click(button("고른 PC를 빼고"));
    expect(h.signIn).toHaveBeenLastCalledWith("me@example.com", "pw", { removeDeviceId: 12 });
    expect(done).toHaveBeenCalled();
  });

  it("when removal must wait, says from when, and that help is at hand", async () => {
    h.signIn.mockResolvedValue({ status: "full", message: "3대까지", devices, canRemove: false, removableAt: "2026-12-01T00:00:00.000Z" });
    render(<MarketLogin onDone={vi.fn()} />);
    await signInWith();
    expect(button("고른 PC를 빼고")).toBeUndefined();
    expect(host.textContent).toContain("부터 뺄 수 있습니다");
    expect(host.textContent).toContain("고객센터");
    await click(button("내 기기"));
    expect(h.openUrl).toHaveBeenCalledWith("https://market.test/account#devices");
  });
});

describe("a locked set", () => {
  it("offers signing in when that opens it", () => {
    render(<LockedSet reason="device_removed" onUnlocked={vi.fn()} onExit={vi.fn()} />);
    expect(host.textContent).toContain("기기에서 빠졌습니다.");
    expect(host.textContent).toContain("풀이 기록은 지워지지 않고");
    expect(button("로그인")).toBeTruthy();
    expect(host.textContent).not.toContain("처음 여는 구매본");
  });

  it("signs in to the purchase that opens it, so another account takes no place", async () => {
    h.signIn.mockResolvedValue({ status: "refused", code: "not_owner", message: "이 계정으로 구매한 세트가 아닙니다." });
    const unlocked = vi.fn();
    render(<LockedSet reason="login" purchase="K7QF-3M2A" onUnlocked={unlocked} onExit={vi.fn()} />);
    await signInWith();
    expect(h.signIn).toHaveBeenCalledWith("me@example.com", "pw", { purchase: "K7QF-3M2A" });
    expect(host.textContent).toContain("이 계정으로 구매한 세트가 아닙니다.");
    expect(unlocked).not.toHaveBeenCalled();
  });

  it("does not offer it for a refund, which it would not open", () => {
    render(<LockedSet reason="refunded" onUnlocked={vi.fn()} onExit={vi.fn()} />);
    expect(host.textContent).toContain("환불된 구매입니다.");
    expect(button("로그인")).toBeUndefined();
  });
});
