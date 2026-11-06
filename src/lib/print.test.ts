// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as { label: string; options: Record<string, unknown> }[],
  open: null as null | { destroy: ReturnType<typeof vi.fn> },
  fail: false,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = async () => h.open;
    constructor(label: string, options: Record<string, unknown>) {
      h.created.push({ label, options });
    }
    once(event: string, run: (e: { payload: string }) => void) {
      if (event === (h.fail ? "tauri://error" : "tauri://created")) setTimeout(() => run({ payload: "no window" }));
      return Promise.resolve(() => {});
    }
  },
}));

const { printPage, takePrintJob } = await import("./print");

beforeEach(() => {
  h.created = [];
  h.open = null;
  h.fail = false;
  localStorage.clear();
  document.body.innerHTML = '<div id="root"><p>the app</p></div><div class="print-sheet">시험지</div><div class="print-sheet">둘째</div><div class="ps-foot">구매 번호 K7QF-3M2A</div>';
  document.documentElement.dataset.font = "ebook";
  window.print = vi.fn();
});

describe("printing", () => {
  it("opens its own window, smaller than the app, with the sheets and the page's settings", async () => {
    await printPage();
    expect(h.created).toHaveLength(1);
    expect(h.created[0].label).toBe("print");
    expect(h.created[0].options).toMatchObject({ url: "print.html", title: "인쇄", parent: "main" });
    expect(h.created[0].options.width as number).toBeLessThan(1100);
    expect(window.print).not.toHaveBeenCalled();
    const job = takePrintJob()!;
    expect(job.html).toContain("시험지");
    expect(job.html).toContain("둘째");
    expect(job.html).toContain("구매 번호 K7QF-3M2A");
    expect(job.html).not.toContain("the app");
    expect(job.attrs["data-font"]).toBe("ebook");
  });

  it("takes the job once", async () => {
    await printPage();
    expect(takePrintJob()).not.toBeNull();
    expect(takePrintJob()).toBeNull();
  });

  it("copies the sheets at once, so the caller may take them away right after", async () => {
    const printing = printPage();
    document.querySelectorAll(".print-sheet").forEach((n) => n.remove());
    await printing;
    expect(takePrintJob()!.html).toContain("시험지");
  });

  it("replaces a print window still open", async () => {
    h.open = { destroy: vi.fn(async () => {}) };
    await printPage();
    expect(h.open.destroy).toHaveBeenCalled();
    expect(h.created).toHaveLength(1);
  });

  it("falls back to the page's own print when the window cannot open, and leaves no job behind", async () => {
    h.fail = true;
    await printPage();
    expect(window.print).toHaveBeenCalled();
    expect(takePrintJob()).toBeNull();
  });
});
