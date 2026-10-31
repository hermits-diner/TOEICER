// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounts = vi.hoisted(() => ({ paste: 0, panel: 0 }));
vi.mock("./StudioGate", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("./PasteImport", async () => {
  const { useEffect } = await import("react");
  return {
    default: function Paste() {
      useEffect(() => void mounts.paste++, []);
      return <p className="paste">paste draft</p>;
    },
  };
});
vi.mock("./ToeicGeneratePanel", async () => {
  const { useEffect } = await import("react");
  return {
    default: function Panel() {
      useEffect(() => void mounts.panel++, []);
      return <p className="panel">generation</p>;
    },
  };
});

const { default: StudioMake } = await import("./StudioMake");

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("StudioMake", () => {
  it("keeps a tab's work mounted while another tab is shown", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onCreated = vi.fn();
    await act(async () => root.render(<StudioMake tab="paste" shown={["paste"]} onCreated={onCreated} />));
    expect(mounts).toEqual({ paste: 1, panel: 0 });

    // the sidebar's generation indicator switches to the AI tab
    await act(async () => root.render(<StudioMake tab="ai" shown={["paste", "ai"]} onCreated={onCreated} />));
    expect(mounts).toEqual({ paste: 1, panel: 1 });
    expect((host.querySelector(".paste")!.parentElement as HTMLElement).hidden).toBe(true);

    await act(async () => root.render(<StudioMake tab="paste" shown={["paste", "ai"]} onCreated={onCreated} />));
    expect(mounts).toEqual({ paste: 1, panel: 1 });
    expect((host.querySelector(".paste")!.parentElement as HTMLElement).hidden).toBe(false);
    expect((host.querySelector(".panel")!.parentElement as HTMLElement).hidden).toBe(true);
  });
});
