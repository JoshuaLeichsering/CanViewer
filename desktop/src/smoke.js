// SPDX-License-Identifier: GPL-2.0-or-later
// Injected by smoke.rs only when CANVIEWER_SMOKE_FILES is set: opens each
// file through the app's file input, saves the first file's message list
// through the export menu, then reports what the app showed. smoke.rs adds
// the check of the saved file to the report.
(() => {
  if (window.top !== window || window.__canviewerSmoke) return;
  window.__canviewerSmoke = true;
  // Start from a clean profile: no restored file, default theme and language.
  // A stored DBC is in localStorage, a stored import in IndexedDB.
  localStorage.clear();
  indexedDB.deleteDatabase('canviewer-import');

  const files = __FILES__;
  const report = { origin: location.origin, userAgent: navigator.userAgent, files: [], cspViolations: [], errors: [] };
  document.addEventListener('securitypolicyviolation', (e) =>
    report.cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`),
  );
  window.addEventListener('error', (e) => report.errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => report.errors.push(`unhandled rejection: ${e.reason}`));
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    report.errors.push(`console.error: ${args.map(String).join(' ')}`);
    consoleError(...args);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms) => {
    const t0 = Date.now();
    for (;;) {
      const value = test();
      if (value || Date.now() - t0 > ms) return value;
      await sleep(100);
    }
  };
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function open(file) {
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes(file.data)], file.name));
    input.files = transfer.files;
    const t0 = performance.now();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = await until(
      () => document.title.startsWith(file.name + ' ') || document.querySelector('[role=alert]'),
      240_000,
    );
    const alert = document.querySelector('[role=alert]');
    const facts = [...document.querySelectorAll('.facts .fact')].map((f) => f.innerText.trim().replace(/\s*\n\s*/g, ' '));
    return {
      file: file.name,
      ms: Math.round(performance.now() - t0),
      opened: Boolean(shown) && !alert,
      info: alert ? alert.textContent.trim() : [document.title.split(' — ')[0], ...facts].join(' · '),
    };
  }

  // Export, then Messages as CSV, as a user saves the list; then wait until
  // the download handler has seen the download finish.
  async function exportMessages(file) {
    const result = { expected: file.name.replace(/\.[^.]*$/, '') + '.messages.csv', clicked: false, finished: false };
    const button = document.querySelector('[data-testid=exp-export-button]');
    if (!button) return { ...result, problem: 'the overview shows no export menu' };
    button.click();
    const item = await until(() => document.querySelector('[data-testid=exp-export-messagesCsv]'), 10_000);
    if (!item) return { ...result, problem: 'the export menu did not open' };
    item.click();
    result.clicked = true;
    const t0 = Date.now();
    while (!result.finished && Date.now() - t0 < 30_000) {
      result.finished = await window.__TAURI_INTERNALS__.invoke('smoke_download_finished');
      if (!result.finished) await sleep(200);
    }
    result.status = button.title;
    return result;
  }

  async function run() {
    const ready = await until(() => document.querySelector('.welcome') && document.querySelector('input[type=file]'), 60_000);
    if (ready) {
      for (const file of files) {
        report.files.push(await open(file));
        if (report.files.length === 1 && report.files[0].opened) report.export = await exportMessages(file);
      }
    } else report.errors.push('the app did not render its welcome screen within 60 s');
    report.resources = performance.getEntriesByType('resource').map((e) => e.name);
    // smoke.rs also requires the exported file to be saved.
    report.passed = report.files.length === files.length && report.files.every((f) => f.opened) && Boolean(report.export?.clicked);
    await window.__TAURI_INTERNALS__.invoke('smoke_report', { report: JSON.stringify(report, null, 2), passed: report.passed });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
