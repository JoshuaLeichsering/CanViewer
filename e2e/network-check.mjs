// SPDX-License-Identifier: GPL-2.0-or-later
// Network and offline check for the Pyodide import worker.
//
// Drives a production build served by `vite preview` in Chromium and records
// every request three ways: Playwright's request events (page, dedicated
// worker and, with PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1, the
// service worker), a HAR file, and Chromium's own net-log. Chromium also
// starts with --host-resolver-rules that make every hostname except localhost
// unresolvable, so a request to any other host could not succeed even if the
// app tried one.
//
// Phases:
//   A online, cold   open the app, wait for the service worker, open an ARXML file
//   B online, warm   open a second ARXML file (runtime already loaded)
//   C offline        reload the app offline, open a DBC, then an ARXML file
//   D offline, never imported   a fresh profile visits once online, goes offline
//                    and opens an ARXML file: the runtime was never cached, so
//                    this must fail with a message and leave the app usable
//
// Usage (Playwright is a dev dependency; `npx playwright install chromium`
// fetches its browser):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 \
//     node e2e/network-check.mjs \
//     http://localhost:4173/ <out-dir> <first.arxml> <second.arxml> <file.dbc> dist
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outArg, arxml1, arxml2, dbc, distDir] = process.argv;
// Absolute, for Chromium's --log-net-log, which does not resolve ../ paths.
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const origin = new URL(appUrl).origin;

const browser = await chromium.launch({
  args: [
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    `--log-net-log=${join(outDir, 'netlog.json')}`,
  ],
});
const context = await browser.newContext({
  serviceWorkers: 'allow',
  recordHar: { path: join(outDir, 'requests.har'), content: 'omit' },
});

let phase = 'A';
const requests = [];
/** Playwright reports the import worker's requests as the page's. */
const rowOf = new WeakMap();
function watch(ctx) {
  ctx.on('request', (r) => {
    const source = r.serviceWorker() ? 'service-worker' : 'page/worker';
    const row = { phase, source, method: r.method(), url: r.url(), type: r.resourceType() };
    rowOf.set(r, row);
    requests.push(row);
  });
  ctx.on('requestfailed', (r) => {
    const row = rowOf.get(r);
    if (row) row.failure = r.failure()?.errorText;
  });
  ctx.on('response', (r) => {
    const row = rowOf.get(r.request());
    if (!row) return;
    row.status = r.status();
    row.fromServiceWorker = r.fromServiceWorker();
  });
}
watch(context);

const page = await context.newPage();
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${phase}] ${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[${phase}] pageerror: ${e.message}`));

const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};

// Hooks that survive restyling: the document title names the open file, an
// import error is the [role=alert] snackbar, the overview's facts strip holds
// the counts.
const shown = (p, n) =>
  p.waitForFunction(
    (name) => document.title.startsWith(name + ' ') || document.querySelector('[role=alert]'),
    n,
    { timeout: 120_000 },
  );
const summary = (p) =>
  p.evaluate(() => {
    const alert = document.querySelector('[role=alert]');
    if (alert) return { failed: true, info: alert.textContent.trim() };
    const facts = [...document.querySelectorAll('.facts .fact')].map((f) => f.innerText.replace(/\s*\n\s*/, ' '));
    return { failed: false, info: [document.title.split(' — ')[0], ...facts].join(' · ') };
  });

/** Open a file through the app's own file input and wait until it is shown. */
async function open(path) {
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', path);
  await shown(page, basename(path));
  const ms = Date.now() - t0;
  return { ms, ...(await summary(page)) };
}

say(`# phase A: online, cold (${appUrl})`);
await page.goto(appUrl);
await page.evaluate(() => navigator.serviceWorker.ready);
// Reload once so the page itself is controlled by the service worker (it only
// controls pages loaded after it activated).
await page.reload();
await page.evaluate(() => navigator.serviceWorker.ready);
say(`service worker controls page: ${await page.evaluate(() => Boolean(navigator.serviceWorker.controller))}`);
let r = await open(arxml1);
say(`open ${basename(arxml1)}: ${r.ms} ms -> ${r.info}`);
await page.screenshot({ path: join(outDir, 'A-online-arxml.png') });

phase = 'B';
say(`# phase B: online, warm`);
r = await open(arxml2);
say(`open ${basename(arxml2)}: ${r.ms} ms -> ${r.info}`);

phase = 'C';
say(`# phase C: offline`);
await context.setOffline(true);
// Same-origin probe for a file that is not cached: proves the network is gone
// without the check itself contacting another host.
const probe = await page.evaluate(async () => {
  try {
    const r = await fetch('/offline-probe', { cache: 'no-store' });
    return `reachable (HTTP ${r.status})`;
  } catch (e) {
    return `unreachable (${e})`;
  }
});
say(`offline probe of ${origin}/offline-probe: ${probe}`);
await page.reload().catch((e) => say(`reload error: ${e.message.split('\n')[0]}`));
try {
  await page.waitForSelector('.welcome, .page-header', { timeout: 15_000 });
} catch (e) {
  await page.screenshot({ path: join(outDir, 'C-offline-failed.png') });
  say(`offline reload did not render the app: ${(await page.content()).slice(0, 300)}`);
  writeFileSync(join(outDir, 'console.log'), consoleLines.join('\n') + '\n');
  throw e;
}
say(`reloaded offline, page title: ${await page.title()}`);
r = await open(dbc);
say(`open ${basename(dbc)}: ${r.ms} ms -> ${r.info}`);
r = await open(arxml1);
say(`open ${basename(arxml1)}: ${r.ms} ms -> ${r.info}`);
await page.screenshot({ path: join(outDir, 'C-offline-arxml.png') });

await context.close();

phase = 'D';
say(`# phase D: fresh profile, offline before any import`);
const fresh = await browser.newContext({ serviceWorkers: 'allow' });
watch(fresh);
const page2 = await fresh.newPage();
await page2.goto(appUrl);
await page2.evaluate(() => navigator.serviceWorker.ready);
await fresh.setOffline(true);
await page2.reload();
await page2.waitForSelector('.welcome');
await page2.setInputFiles('input[type=file]', arxml1);
await page2.waitForSelector('[role=alert]', { timeout: 60_000 });
say(`open ${basename(arxml1)}: ${(await page2.locator('[role=alert]').textContent())?.trim()}`);
await page2.screenshot({ path: join(outDir, 'D-offline-import-error.png') });
await page2.setInputFiles('input[type=file]', dbc);
await shown(page2, basename(dbc));
say(`then open ${basename(dbc)}: ${(await summary(page2)).info}`);
await fresh.close();
await browser.close();

// ---- evidence ----
const foreign = requests.filter((x) => !x.url.startsWith(origin + '/') && !x.url.startsWith('data:') && !x.url.startsWith('blob:'));
say(`# requests`);
const sizeOf = (url) => {
  try {
    return statSync(join(distDir, new URL(url).pathname)).size;
  } catch {
    return 0;
  }
};
for (const p of ['A', 'B', 'C', 'D']) {
  const rows = requests.filter((x) => x.phase === p);
  const bySource = {};
  for (const x of rows) bySource[x.source] = (bySource[x.source] ?? 0) + 1;
  // What went over the wire: page/worker requests the service worker did not
  // answer, plus the service worker's own fetches.
  const network = rows.filter((x) => x.status && !x.failure && !x.fromServiceWorker);
  const failed = rows.filter((x) => x.failure);
  const py = network.filter((x) => x.url.includes('/pyodide/'));
  say(
    `phase ${p}: ${rows.length} requests ${JSON.stringify(bySource)}; ${network.length} answered by the server, ` +
      `${failed.length} failed; /pyodide/ files from the server: ${py.length}, ` +
      `${py.reduce((n, x) => n + sizeOf(x.url), 0)} bytes`,
  );
  for (const x of py) say(`  ${x.url.replace(origin, '')} ${sizeOf(x.url)}`);
}
say(`requests outside ${origin}: ${foreign.length}`);
for (const x of foreign) say(`  FOREIGN ${x.phase} ${x.source} ${x.url}`);

const har = JSON.parse(readFileSync(join(outDir, 'requests.har'), 'utf8'));
const harOrigins = [...new Set(har.log.entries.map((e) => new URL(e.request.url).origin))];
say(`HAR: ${har.log.entries.length} entries, origins ${JSON.stringify(harOrigins)}`);

// net-log: every URL Chromium's network stack saw, from any context.
const netlog = readFileSync(join(outDir, 'netlog.json'), 'utf8');
const urls = [...netlog.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
const netOrigins = [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return u.slice(0, 40); } }))];
say(`net-log: ${urls.length} url entries, origins ${JSON.stringify(netOrigins)}`);

writeFileSync(join(outDir, 'requests.json'), JSON.stringify(requests, null, 1) + '\n');
writeFileSync(join(outDir, 'console.log'), consoleLines.join('\n') + '\n');
writeFileSync(join(outDir, 'network-check.log'), log.join('\n') + '\n');
process.exitCode = foreign.length === 0 ? 0 : 1;
