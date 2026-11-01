import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { applyInitialTheme, ThemeProvider } from './lib/theme';
import './fonts.css';
import './styles.css';

applyInitialTheme();

// Production only: the service worker caches the app shell for offline use,
// and the Pyodide files once a non-DBC import has fetched them.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // Not available (e.g. file:// or a private window): the app works without it.
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
