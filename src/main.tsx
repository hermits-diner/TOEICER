import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/literata";
import "@fontsource/nanum-myeongjo/400.css";
import "@fontsource/nanum-myeongjo/700.css";
import "@fontsource/nanum-myeongjo/800.css";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/literata/wght-italic.css";
import App from "./App";
import { applyPrefs, loadPrefs } from "./lib/theme";

// Apply the saved theme before the first paint to avoid a flash of the default palette.
applyPrefs(loadPrefs());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
