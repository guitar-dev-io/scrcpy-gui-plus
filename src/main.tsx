import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import MirrorWindowApp from "./components/mirror-window";
import { I18nProvider } from "./i18n";
import { parseMirrorWindowHash } from "./windows/mirrorWindow";

// A detached mirror window loads this same bundle at `#/mirror/<serial>`. It
// mounts only the device surface — the full app shell belongs to the main
// window, and rendering a second copy of it here would duplicate its polling,
// listeners and device registry work.
const mirrorTarget = parseMirrorWindowHash(window.location.hash);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {mirrorTarget ? <MirrorWindowApp target={mirrorTarget} /> : <App />}
    </I18nProvider>
  </React.StrictMode>,
);
