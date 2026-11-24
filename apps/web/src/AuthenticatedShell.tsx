import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import ShellEntry from "./ShellEntry.js";

export function mountShell(root: HTMLElement) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ShellEntry />
    </React.StrictMode>,
  );
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}
