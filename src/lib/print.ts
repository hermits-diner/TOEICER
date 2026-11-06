import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const JOB = "print.job";
const LABEL = "print";

/** What the print window shows: the sheets as the page has them, and the page's theme and font settings. */
export interface PrintJob {
  html: string;
  attrs: Record<string, string>;
}

/** The print window's side: the job it was opened for, once. */
export function takePrintJob(): PrintJob | null {
  const raw = localStorage.getItem(JOB);
  localStorage.removeItem(JOB);
  return raw ? (JSON.parse(raw) as PrintJob) : null;
}

/**
 * Prints the sheets the page has ready, in a window of its own: the webview's print preview fills the window it opens in,
 * and that should not be the whole app. The sheets are copied before the first await, so the caller may take them away
 * right after calling this. If the window cannot be opened, the preview opens over the app as before.
 */
export async function printPage(): Promise<void> {
  const html = [...document.querySelectorAll<HTMLElement>(".print-sheet, .ps-foot")].map((n) => n.outerHTML).join("");
  const attrs = Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value]));
  try {
    localStorage.setItem(JOB, JSON.stringify({ html, attrs } satisfies PrintJob));
    const open = await WebviewWindow.getByLabel(LABEL);
    if (open) {
      await open.destroy();
      await new Promise((r) => setTimeout(r, 150));
    }
    const w = new WebviewWindow(LABEL, { url: "print.html", title: "인쇄", width: 980, height: 780, center: true, parent: "main" });
    await new Promise<void>((resolve, reject) => {
      void w.once("tauri://created", () => resolve());
      void w.once("tauri://error", (e) => reject(new Error(String(e.payload))));
    });
  } catch (e) {
    console.warn("could not open the print window", e);
    localStorage.removeItem(JOB);
    window.print();
  }
}
