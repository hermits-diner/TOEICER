// The print window's page (print.html, opened by lib/print.ts): the sheets the app has ready, the webview's print preview
// over them, and the window closes when the preview does. The fonts are the ones main.tsx loads for the app.
import "@fontsource-variable/literata";
import "@fontsource/nanum-myeongjo/400.css";
import "@fontsource/nanum-myeongjo/700.css";
import "@fontsource/nanum-myeongjo/800.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/literata/wght-italic.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { takePrintJob } from "./lib/print";

const close = () => void getCurrentWindow().close();
const job = takePrintJob();
if (!job) {
  close();
} else {
  for (const [name, value] of Object.entries(job.attrs)) document.documentElement.setAttribute(name, value);
  document.body.innerHTML = job.html;
  window.addEventListener("afterprint", close);
  void document.fonts.ready.then(() => window.print());
}
