// SPDX-License-Identifier: GPL-2.0-or-later
// Crawl of the built documentation site in Chromium: visits every page that
// the site links to, opens the local search once, and fails on any request
// outside the site's origin, on a page or an asset that does not load, and on
// errors in the page. The web app under app/ is checked by network-check.mjs;
// here it is only loaded once, to prove the links to it work.
//
// As in network-check.mjs, Chromium starts with every hostname except
// localhost unresolvable, so a request to another host could not succeed even
// if the site tried one.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   node e2e/static-server.mjs <root-dir> 4174 &
//   node e2e/docs-crawl.mjs http://localhost:4174/CanViewer/ <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const [, , siteUrl, outDir] = process.argv;
if (!siteUrl || !outDir) {
  console.error('usage: node e2e/docs-crawl.mjs <site-url> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const start = new URL(siteUrl);
const origin = start.origin;
const base = start.pathname.endsWith('/') ? start.pathname : start.pathname + '/';
const appPath = `${base}app/`;

const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const requests = [];
const failures = [];
const pageErrors = [];
let current = '';
context.on('request', (r) => requests.push({ page: current, url: r.url(), type: r.resourceType() }));
context.on('requestfailed', (r) => failures.push(`${current}: request failed: ${r.url()} (${r.failure()?.errorText})`));
context.on('response', (r) => {
  if (r.status() >= 400) failures.push(`${current}: HTTP ${r.status()} for ${r.url()}`);
});

const page = await context.newPage();
page.on('pageerror', (e) => pageErrors.push(`${current}: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`${current}: console: ${m.text()}`);
});

/** Same-site documentation pages linked from the current page. */
const linksOnPage = () =>
  page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));

const normalize = (href) => {
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  return u.href;
};
const queue = [normalize(start.href)];
const seen = new Set(queue);
const visited = [];
let appLinked = false;

while (queue.length) {
  const url = queue.shift();
  current = new URL(url).pathname;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400) {
    failures.push(`${current}: page answered ${response?.status()}`);
    continue;
  }
  visited.push(current);
  for (const href of await linksOnPage()) {
    let u;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (u.origin !== origin || !u.pathname.startsWith(base)) continue;
    if (u.pathname.startsWith(appPath)) {
      appLinked = true;
      continue;
    }
    const next = normalize(href);
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}

// The local search: open it and search, which loads the search index.
current = `${base} (search)`;
await page.goto(start.href, { waitUntil: 'networkidle' });
await page.locator('.DocSearch-Button, .VPNavBarSearchButton, button[aria-label="Search"]').first().click();
await page.locator('input.search-input, #localsearch-input, .VPLocalSearchBox input').first().fill('ARXML');
const hits = await page
  .locator('.VPLocalSearchBox .result')
  .first()
  .waitFor({ timeout: 15_000 })
  .then(() => page.locator('.VPLocalSearchBox .result').count())
  .catch(() => 0);
if (hits === 0) failures.push(`${current}: the local search found nothing for "ARXML"`);
await page.keyboard.press('Escape');

// The app the site links to loads (its requests are checked by network-check.mjs).
current = appPath;
const app = await page.goto(origin + appPath, { waitUntil: 'load' });
if (!app || app.status() !== 200) failures.push(`${appPath}: answered ${app?.status()}`);
if (!appLinked) failures.push(`no page links to the app at ${appPath}`);

await browser.close();

const foreign = requests.filter((r) => !r.url.startsWith(origin + '/') && !/^(data|blob):/.test(r.url));
const log = [
  `pages visited: ${visited.length}`,
  `requests: ${requests.length}, search results for "ARXML": ${hits}`,
  `failed requests and HTTP errors: ${failures.length}`,
  ...failures.map((f) => `  FAILED ${f}`),
  `page errors: ${pageErrors.length}`,
  ...pageErrors.map((e) => `  ERROR ${e}`),
  `requests outside ${origin}: ${foreign.length}`,
  ...foreign.map((r) => `  FOREIGN ${r.page} ${r.type} ${r.url}`),
];
console.log(log.join('\n'));
writeFileSync(join(outDir, 'docs-crawl.log'), log.join('\n') + '\n');
writeFileSync(join(outDir, 'docs-pages.txt'), visited.join('\n') + '\n');
writeFileSync(join(outDir, 'docs-requests.json'), JSON.stringify(requests, null, 1) + '\n');
process.exitCode = foreign.length === 0 && failures.length === 0 && pageErrors.length === 0 ? 0 : 1;
