// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PageBoundary from "./PageBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let broken = true;
function Screen() {
  if (broken) throw new Error("문항 묶음이 비어 있습니다");
  return <p>세트 목록</p>;
}

let root: Root;
let host: HTMLDivElement;
const onHome = vi.fn();
const render = (resetKey: string) =>
  act(() =>
    root.render(
      <PageBoundary resetKey={resetKey} onHome={onHome}>
        <Screen />
      </PageBoundary>,
    ),
  );
const alert = () => host.querySelector('[role="alert"]');
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

beforeEach(() => {
  broken = true;
  onHome.mockReset();
  // React reports every caught render error on the console; the fallback is what these tests check.
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

describe("PageBoundary", () => {
  it("shows the error in place of a screen that throws while rendering", () => {
    render("library");
    expect(alert()?.textContent).toContain("문항 묶음이 비어 있습니다");
    expect(host.textContent).not.toContain("세트 목록");
  });

  it("다시 시도 renders the screen again", () => {
    render("library");
    broken = false;
    act(() => button("다시 시도").click());
    expect(alert()).toBeNull();
    expect(host.textContent).toContain("세트 목록");
  });

  it("홈으로 asks for the home screen and renders again, even when the broken screen was home", () => {
    render("home");
    broken = false;
    act(() => button("홈으로").click());
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(alert()).toBeNull();
    expect(host.textContent).toContain("세트 목록");
  });

  it("clears the error when the app moves to another screen", () => {
    render("library");
    broken = false;
    render("guide");
    expect(alert()).toBeNull();
    expect(host.textContent).toContain("세트 목록");
  });

  it("keeps the error while the app stays on the same screen", () => {
    render("library");
    broken = false;
    render("library");
    expect(alert()).not.toBeNull();
  });
});
