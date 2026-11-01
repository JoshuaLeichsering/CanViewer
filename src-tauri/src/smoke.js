// Injected by smoke.rs only when CANVIEWER_SMOKE_FILES is set: opens each
// file through the app's file input, then reports what the app showed.
(() => {
  if (window.top !== window || window.__canviewerSmoke) return;
  window.__canviewerSmoke = true;
  // Start from a clean profile: no restored file, default theme and language.
  localStorage.clear();

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
    const facts = [...document.querySelectorAll('.facts .fact')].map((f) => f.innerText.replace(/\s*\n\s*/, ' '));
    return {
      file: file.name,
      ms: Math.round(performance.now() - t0),
      opened: Boolean(shown) && !alert,
      info: alert ? alert.textContent.trim() : [document.title.split(' — ')[0], ...facts].join(' · '),
    };
  }

  async function run() {
    const ready = await until(() => document.querySelector('.welcome') && document.querySelector('input[type=file]'), 60_000);
    if (ready) for (const file of files) report.files.push(await open(file));
    else report.errors.push('the app did not render its welcome screen within 60 s');
    report.resources = performance.getEntriesByType('resource').map((e) => e.name);
    report.passed = report.files.length === files.length && report.files.every((f) => f.opened);
    await window.__TAURI_INTERNALS__.invoke('smoke_report', { report: JSON.stringify(report, null, 2), passed: report.passed });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
