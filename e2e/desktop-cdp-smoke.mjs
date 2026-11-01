// SPDX-License-Identifier: GPL-2.0-or-later
// Smoke test for the packaged desktop app (Tauri on Windows): request evidence.
//
// Drives the app's own WebView2 over the Chrome DevTools Protocol. The app
// must be started with --remote-debugging-port=9222 among WebView2's browser
// arguments: the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS variable that
// Playwright documents has no effect, because wry always passes its own
// arguments, so CI builds a variant with the flag in its window config
// (e2e/desktop-cdp.conf.json). Connect with --cdp. For a local dry run against
// a static server with the same CSP, --url launches Playwright's Chromium
// instead.
//
// It reloads the page so that every request is seen from the start, opens a
// DBC and an ARXML file through the app's file input, and records:
//   - every request of the page and its worker (URL, type, status);
//   - CSP violations (securitypolicyviolation events) and console errors;
//   - what the app shows for each file (title and the overview's facts).
// It fails unless both files open, the ARXML import went through canmatrix
// (the Pyodide worker), and no request left the app's origin.
//
// Usage:
//   node e2e/desktop-cdp-smoke.mjs --cdp http://127.0.0.1:9222 --out DIR --dbc FILE --arxml FILE
//   node e2e/desktop-cdp-smoke.mjs --url http://localhost:4175/ --out DIR --dbc FILE --arxml FILE
// Needs playwright-core (or playwright) resolvable, e.g. through NODE_PATH.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const load = (name) => {
  try {
    return require(name);
  } catch {
    return undefined;
  }
};
const { chromium } = load('playwright-core') ?? load('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const outDir = resolve(args.out ?? 'smoke');
mkdirSync(outDir, { recursive: true });

const report = { mode: args.cdp ? 'cdp' : 'launch', steps: [], requests: [], cspViolations: [], console: [] };
const say = (line) => {
  report.steps.push(line);
  console.log(line);
};
const fail = (why) => {
  report.failure = why;
  say(`FAIL: ${why}`);
};

let browser;
let page;
if (args.cdp) {
  // The app may still be starting: retry the connection, then wait for its page.
  const until = Date.now() + 90_000;
  for (;;) {
    try {
      browser = await chromium.connectOverCDP(args.cdp);
      break;
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const context = browser.contexts()[0];
  while (!(page = context.pages().find((p) => /^https?:\/\/tauri\.localhost|^tauri:/.test(p.url())))) {
    if (Date.now() > until) throw new Error(`no app page, pages: ${context.pages().map((p) => p.url()).join(', ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
} else {
  browser = await chromium.launch();
  page = await (await browser.newContext()).newPage();
  await page.goto(args.url);
}
const context = page.context();
const origin = new URL(page.url()).origin;
say(`app page: ${page.url()}`);

context.on('request', (r) => {
  report.requests.push({ url: r.url(), method: r.method(), type: r.resourceType() });
});
context.on('requestfailed', (r) => {
  const row = report.requests.findLast((q) => q.url === r.url());
  if (row) row.failure = r.failure()?.errorText;
});
context.on('response', (r) => {
  const row = report.requests.findLast((q) => q.url === r.url() && q.status === undefined);
  if (row) {
    row.status = r.status();
    row.contentType = r.headers()['content-type'];
  }
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') report.console.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => report.console.push(`pageerror: ${e.message}`));
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`),
  );
});

// Start from a clean profile (no restored file), and reload so that the page
// load itself is recorded and the init script runs.
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.welcome, .page-header', { timeout: 60_000 });
const env = await page.evaluate(() => ({
  userAgent: navigator.userAgent,
  serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
  tauri: '__TAURI_INTERNALS__' in window,
  csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
}));
Object.assign(report, env);
say(`user agent: ${env.userAgent}`);
say(`tauri: ${env.tauri}, service worker controls page: ${env.serviceWorkerController}`);

const shown = (name) =>
  page.waitForFunction(
    (n) => document.title.startsWith(n + ' ') || document.querySelector('[role=alert]'),
    name,
    { timeout: 240_000 },
  );
const summary = () =>
  page.evaluate(() => {
    const alert = document.querySelector('[role=alert]');
    if (alert) return { failed: true, info: alert.textContent.trim() };
    const facts = [...document.querySelectorAll('.facts .fact')].map((f) => f.innerText.trim().replace(/\s*\n\s*/g, ' '));
    return { failed: false, info: [document.title.split(' — ')[0], ...facts].join(' · ') };
  });

async function open(file, shot) {
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', resolve(file));
  await shown(basename(file));
  const r = { file: basename(file), ms: Date.now() - t0, ...(await summary()) };
  say(`open ${r.file}: ${r.ms} ms -> ${r.info}`);
  await page.screenshot({ path: join(outDir, shot) });
  if (r.failed) fail(`${r.file} did not open: ${r.info}`);
  return r;
}

report.dbc = await open(args.dbc, 'dbc.png');
const before = report.requests.length;
report.arxml = await open(args.arxml, 'arxml.png');
const pyodide = report.requests.slice(before).filter((r) => r.url.includes('/pyodide/'));
say(`ARXML import fetched ${pyodide.length} runtime files from ${origin}/pyodide/`);
if (!report.arxml.failed && pyodide.length === 0) fail('the ARXML import did not load the Pyodide runtime');

report.cspViolations = await page.evaluate(() => window.__cspViolations ?? []);
const foreign = report.requests.filter((r) => {
  if (/^(data|blob):/.test(r.url)) return false;
  return new URL(r.url).origin !== origin;
});
const hosts = [...new Set(report.requests.map((r) => (/^(data|blob):/.test(r.url) ? r.url.split(':')[0] + ':' : new URL(r.url).origin)))];
say(`requests: ${report.requests.length}, origins: ${hosts.join(', ')}`);
say(`CSP violations: ${report.cspViolations.length}`);
for (const v of report.cspViolations) say(`  ${v}`);
say(`console errors and warnings: ${report.console.length}`);
for (const c of report.console.slice(0, 20)) say(`  ${c}`);
if (foreign.length) fail(`requests outside ${origin}: ${foreign.map((r) => r.url).join(', ')}`);
const failedRequests = report.requests.filter((r) => r.failure || (r.status ?? 200) >= 400);
if (failedRequests.length) say(`failed requests: ${failedRequests.map((r) => `${r.url} ${r.status ?? r.failure}`).join(', ')}`);

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
say(report.failure ? 'smoke test FAILED' : 'smoke test passed');
await (args.cdp ? browser.close().catch(() => {}) : browser.close());
process.exit(report.failure ? 1 : 0);
