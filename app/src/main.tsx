// SPDX-License-Identifier: GPL-2.0-or-later
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './lib/i18n';
import { applyInitialTheme, ThemeProvider } from './lib/theme';
import './fonts.css';
import './styles.css';
import './narrow.css';

applyInitialTheme();

// Production only: the service worker caches the app shell for offline use,
// and the Pyodide files once a non-DBC import has fetched them.
// The desktop app (Tauri) serves the build from inside the binary, so it is
// offline already and must not keep a second, possibly stale, copy.
const desktop = '__TAURI_INTERNALS__' in window;
if (import.meta.env.PROD && !desktop && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // Not available (e.g. file:// or a private window): the app works without it.
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
