// SPDX-License-Identifier: GPL-2.0-or-later
// Injected by smoke.rs only when CANVIEWER_SMOKE_FILES is set: opens each
// file through the app's file input, then reports what the app showed. With
// CANVIEWER_SMOKE_EXPORT=1 as well (CI sets it), it also saves the first
// file's message list through the export menu, and smoke.rs adds the check
// of the saved file to the report. Without it, the self-test that the install
// guide offers saves nothing in the user's Downloads folder.
(() => {
  if (window.top !== window || window.__canviewerSmoke) return;
  window.__canviewerSmoke = true;
  // Start from a clean profile: no restored file, default theme and language.
  // A stored DBC is in localStorage, a stored import in IndexedDB.
  localStorage.clear();
  indexedDB.deleteDatabase('canviewer-import');

  const files = __FILES__;
  const exportFirst = __EXPORT__;
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

  // Whether a worker the page starts from a blob: URL, as the app starts its
  // import worker (app/src/lib/canmatrix/start-worker.ts), is held to the
  // page's Content Security Policy: it fetches a data: URL, which
  // connect-src 'self' forbids. The fetch needs no network, so only the policy
  // can make it fail. The same probe as e2e/desktop-csp-check.mjs.
  function workerPolicy() {
    const source = [
      "let directive = '';",
      "self.addEventListener('securitypolicyviolation', (e) => (directive = e.effectiveDirective));",
      "fetch('data:text/plain,csp-probe').then(",
      "  (r) => r.text().then((t) => postMessage('not blocked (read ' + t + ')')),",
      "  (e) => setTimeout(() => postMessage('blocked' + (directive ? ' by ' + directive : '') + ' (' + e + ')'), 200),",
      ');',
    ].join('\n');
    return new Promise((resolve) => {
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
      const timer = setTimeout(() => resolve('no answer from the probe worker within 10 s'), 10_000);
      worker.onmessage = (e) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(String(e.data));
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        resolve(`the probe worker did not start: ${e.message || 'error'}`);
      };
    });
  }

  async function run() {
    const ready = await until(() => document.querySelector('.welcome') && document.querySelector('input[type=file]'), 60_000);
    if (ready) {
      for (const file of files) {
        report.files.push(await open(file));
        if (exportFirst && report.files.length === 1 && report.files[0].opened) report.export = await exportMessages(file);
      }
    } else report.errors.push('the app did not render its welcome screen within 60 s');
    report.resources = performance.getEntriesByType('resource').map((e) => e.name);
    // Taken before the probe, whose blocked fetch is a violation on purpose.
    const violations = report.cspViolations.length;
    report.blobWorkerPolicy = await workerPolicy();
    report.cspViolations = report.cspViolations.slice(0, violations);
    // With the export, smoke.rs also requires the exported file to be saved.
    report.passed =
      report.files.length === files.length &&
      report.files.every((f) => f.opened) &&
      (!exportFirst || Boolean(report.export?.clicked)) &&
      report.cspViolations.length === 0 &&
      report.blobWorkerPolicy.startsWith('blocked');
    await window.__TAURI_INTERNALS__.invoke('smoke_report', { report: JSON.stringify(report, null, 2), passed: report.passed });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
