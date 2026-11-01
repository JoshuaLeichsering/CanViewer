// SPDX-License-Identifier: GPL-2.0-or-later
// Does the desktop app's Content Security Policy reach the Pyodide import
// worker? Checked in Chromium, with dist/ served the way the Tauri shell
// serves it.
//
// The Tauri shell sends the policy from desktop/tauri.conf.json as a header,
// and only with HTML responses (tauri 2.12.5, src/manager/mod.rs, `is_html`).
// A dedicated worker loaded from its own URL takes its policy from its own
// response, so it would run with none. A worker created from a blob: URL
// inherits the policy of the page that created it, which is what the app does
// in the desktop app (app/src/lib/canmatrix/client.ts). This check serves
// dist/ with exactly that header rule, marks the page as the desktop app (the
// global the Tauri shell defines), and:
//   - opens a DBC and an ARXML file (the ARXML through Pyodide, in the worker,
//     under the policy), and fails on any CSP violation or error;
//   - finds the app's import worker, checks that it runs from a blob: URL, and
//     has it fetch a data: URL, which connect-src 'self' forbids: the fetch
//     must be blocked, by connect-src;
//   - as a control, starts the same worker script from its own URL, which
//     runs with no policy at all, and has it fetch the same data: URL;
//   - records every request: none may leave the origin;
//   - then runs the desktop self-test script (desktop/src/smoke.js) in a fresh
//     page under the same policy, with the shell's side of it stubbed, and
//     fails unless its report says it passed.
// The probe needs no network: a data: URL is read in memory, so only the
// policy can make that fetch fail. Chromium also resolves no hostname but
// localhost.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build
//   node e2e/desktop-csp-check.mjs dist <out-dir> <file.dbc> <file.arxml>
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join, resolve, sep } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const [, , distArg, outDir, dbc, arxml] = process.argv;
if (!distArg || !outDir || !dbc || !arxml) {
  console.error('usage: node e2e/desktop-csp-check.mjs <dist> <out-dir> <file.dbc> <file.arxml>');
  process.exit(2);
}
const dist = resolve(distArg);
mkdirSync(outDir, { recursive: true });

/** The policy as the Tauri shell sends it: tauri.conf.json's directives, joined. */
const conf = JSON.parse(readFileSync(new URL('../desktop/tauri.conf.json', import.meta.url), 'utf8'));
const csp = conf.app.security.csp;
const policy = typeof csp === 'string' ? csp : Object.entries(csp).map(([k, v]) => `${k} ${v}`).join('; ');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(dist, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Content-Length': statSync(file).size };
  // Like the Tauri shell: the policy goes with HTML only.
  if (type === 'text/html') headers['Content-Security-Policy'] = policy;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${server.address().port}`;

const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};
say(`serving ${dist} at ${origin}, with this policy on HTML responses only:`);
say(`  ${policy}`);

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const context = await browser.newContext({ serviceWorkers: 'block' });
const requests = [];
context.on('request', (r) => requests.push(r.url()));
// The global the Tauri shell defines: the app then behaves as the desktop app
// (no service worker, the import worker from a blob: URL). It is defined with
// a value that has no IPC: the app calls no Tauri API.
await context.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {};
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`),
  );
});

const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
});
const workers = [];
page.on('worker', (w) => {
  workers.push(w);
  w.on('console', (m) => {
    if (m.type() === 'error') problems.push(`worker console error (${w.url()}): ${m.text()}`);
  });
});

const shown = (name) =>
  page.waitForFunction(
    (n) => document.title.startsWith(n + ' ') || document.querySelector('[role=alert]'),
    name,
    { timeout: 180_000 },
  );
async function open(path) {
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', path);
  await shown(basename(path));
  const info = await page.evaluate(() => {
    const alert = document.querySelector('[role=alert]');
    if (alert) return { opened: false, text: alert.textContent.trim() };
    const facts = [...document.querySelectorAll('.facts .fact')].map((f) => f.innerText.trim().replace(/\s*\n\s*/g, ' '));
    return { opened: true, text: [document.title.split(' — ')[0], ...facts].join(' · ') };
  });
  say(`open ${basename(path)}: ${Date.now() - t0} ms -> ${info.text}`);
  return info.opened;
}

/**
 * Runs in a worker: fetch a data: URL, which connect-src 'self' forbids, and
 * say whether the policy stopped it (the same probe as desktop/src/smoke.js).
 */
const probe = () =>
  new Promise((done) => {
    let directive = '';
    self.addEventListener('securitypolicyviolation', (e) => (directive = e.effectiveDirective));
    fetch('data:text/plain,csp-probe').then(
      (r) => r.text().then((t) => done(`not blocked (read "${t}")`)),
      (e) => setTimeout(() => done(`blocked${directive ? ` by ${directive}` : ''} (${e.message})`), 200),
    );
  });

await page.goto(`${origin}/`);
await page.waitForSelector('.welcome');
say(`desktop mode: ${await page.evaluate(() => '__TAURI_INTERNALS__' in window)}, service worker: ${await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))}`);

const opened = [await open(dbc), await open(arxml)];
const appViolations = await page.evaluate(() => window.__cspViolations.slice());
const appProblems = problems.slice();

// The app starts one worker, on the first non-DBC import.
const appWorker = workers[0];
say(`workers: ${workers.map((w) => w.url()).join(', ') || '(none)'}`);
const appWorkerUrl = appWorker?.url() ?? '';
const appProbe = appWorker ? await appWorker.evaluate(probe) : 'no import worker found';
say(`import worker ${appWorkerUrl}: fetch of a data: URL ${appProbe}`);

// Control: the same worker script, started from its own URL.
const script = readdirSync(join(dist, 'assets')).find((f) => /^worker-.*\.js$/.test(f));
let controlProbe = 'no worker script in dist/assets';
if (script) {
  const [control] = await Promise.all([
    page.waitForEvent('worker', (w) => w.url().endsWith(`/assets/${script}`)),
    page.evaluate((url) => {
      window.__controlWorker = new Worker(url, { type: 'module' });
    }, `${origin}/assets/${script}`),
  ]);
  controlProbe = await control.evaluate(probe);
}
say(`control, assets/${script} started from its own URL: fetch of a data: URL ${controlProbe}`);

// The self-test script, injected as the shell injects it (smoke.rs: the
// files' bytes replace __FILES__), with the shell's one command stubbed. It
// runs as the install guide's self-test does, without the export
// (CANVIEWER_SMOKE_EXPORT unset), which needs the shell's download handler.
say('# the self-test script (desktop/src/smoke.js) under the same policy');
const smoke = readFileSync(new URL('../desktop/src/smoke.js', import.meta.url), 'utf8')
  .replace(
    '__FILES__',
    JSON.stringify([dbc, arxml].map((p) => ({ name: basename(p), data: readFileSync(p).toString('base64') }))),
  )
  .replace('__EXPORT__', 'false');
const selfTest = await browser.newContext({ serviceWorkers: 'block' });
selfTest.on('request', (r) => requests.push(r.url()));
const smokePage = await selfTest.newPage();
const reported = new Promise((done) => smokePage.exposeFunction('__smokeReport', (args) => done(args)));
await selfTest.addInitScript(() => {
  window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => (cmd === 'smoke_report' ? window.__smokeReport(args) : Promise.reject(cmd)) };
});
await selfTest.addInitScript({ content: smoke });
await smokePage.goto(`${origin}/`);
const smokeResult = await Promise.race([reported, new Promise((r) => setTimeout(() => r(undefined), 300_000))]);
const smokeReport = smokeResult ? JSON.parse(smokeResult.report) : undefined;
if (smokeReport) {
  for (const f of smokeReport.files) say(`self-test ${f.file}: ${f.ms} ms, opened: ${f.opened} -> ${f.info}`);
  say(`self-test blob: worker policy: ${smokeReport.blobWorkerPolicy}`);
  say(`self-test CSP violations: ${smokeReport.cspViolations.length}, errors: ${smokeReport.errors.length}, passed: ${smokeResult.passed}`);
} else say('self-test: no report within 300 s');
writeFileSync(join(outDir, 'self-test.json'), (smokeResult?.report ?? 'null') + '\n');

await browser.close();
server.close();

const foreign = requests.filter((u) => !u.startsWith(origin + '/') && !u.startsWith('blob:') && !u.startsWith('data:'));
say(`requests: ${requests.length}, outside ${origin}: ${foreign.length}`);
for (const u of foreign) say(`  FOREIGN ${u}`);
say(`CSP violations while opening the files: ${appViolations.length}`);
for (const v of appViolations) say(`  ${v}`);
say(`errors while opening the files: ${appProblems.length}`);
for (const p of appProblems) say(`  ${p}`);

const failures = [];
if (!opened.every(Boolean)) failures.push('a file did not open');
if (appViolations.length) failures.push('CSP violations while opening the files');
if (appProblems.length) failures.push('errors while opening the files');
if (!appWorkerUrl.startsWith('blob:')) failures.push(`the import worker does not run from a blob: URL (${appWorkerUrl || 'none'})`);
if (!appProbe.startsWith('blocked by connect-src')) failures.push(`the import worker is not held to the policy (${appProbe})`);
if (foreign.length) failures.push('requests outside the origin');
if (!smokeResult?.passed || !smokeReport?.passed) failures.push('the self-test script did not pass');
say(failures.length ? `FAILED: ${failures.join('; ')}` : 'desktop CSP check passed: the import worker runs under the page policy');

writeFileSync(join(outDir, 'desktop-csp-check.log'), log.join('\n') + '\n');
writeFileSync(join(outDir, 'requests.json'), JSON.stringify(requests, null, 1) + '\n');
process.exitCode = failures.length ? 1 : 0;
