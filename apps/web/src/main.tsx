import React from "react";
import ReactDOM from "react-dom/client";
import { initializeI18n } from "./i18n";
import App from "./App";
import { LanguageProvider } from "./i18n/LanguageProvider";
import "./app.css";

function renderApp(): void {
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <LanguageProvider><App /></LanguageProvider>
    </React.StrictMode>,
  );
}

void initializeI18n().catch(() => undefined).finally(renderApp);
