// End-to-end check of diff mode (the Compare destination) on a production build.
//
// Drives the app in Chromium through its own file inputs, the way a user does:
//   1. open examples/demo.dbc, go to Compare, open examples/demo-v2.dbc as the
//      other version, and check the counts, the listed messages, a message's
//      details, the filter chips, swapping the versions and the link from the
//      diff to the viewer;
//   2. compare a DBC file with an ARXML file read through canmatrix (Pyodide in
//      the import worker): canmatrix's own test.dbc against the test.arxml it
//      writes from it;
//   3. take screenshots: light and dark, English and German, desktop and phone width.
// Every request is recorded; any request outside the app's origin, a console
// error or a failed expectation fails the check.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node e2e/diff-check.mjs http://localhost:4173/ <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir] = process.argv;
if (!appUrl || !outDir) {
  console.error('usage: node e2e/diff-check.mjs <app-url> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const origin = new URL(appUrl).origin;
const repo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const DEMO = repo('examples/demo.dbc');
const DEMO_V2 = repo('examples/demo-v2.dbc');
const CM_DBC = repo('third_party/canmatrix/tests/files/dbc/test.dbc');
const CM_ARXML = repo('third_party/canmatrix/tests/reference/from_dbc/test.arxml');

const failures = [];
const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};
const expectEqual = (what, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  say(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const requests = [];
const consoleErrors = [];

async function newPage({ lang = 'en', theme = 'light', width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  context.on('request', (r) => requests.push(r.url()));
  await context.addInitScript(
    ([l, th]) => {
      localStorage.setItem('canviewer.lang', l);
      localStorage.setItem('canviewer.theme', th);
    },
    [lang, theme],
  );
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto(appUrl);
  return page;
}

/** Open a file as the main database and wait until the app shows it. */
async function openMain(page, path) {
  const name = path.split('/').pop();
  await page.setInputFiles('input[type=file]:not([data-testid])', path);
  await page.waitForFunction((n) => document.title.startsWith(n + ' '), name, { timeout: 120_000 });
}

/** Open a file as the other version on the Compare page and wait for the diff (or an error). */
async function openOther(page, path) {
  await page.setInputFiles('[data-testid=dif-file-input]', path);
  await page.waitForSelector('[data-testid=dif-counts], .dif-view [role=alert]', { timeout: 180_000 });
  // A second file replaces the first: wait until the shown name is the new one.
  const name = path.split('/').pop();
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('.dif-version-name')].some((e) => e.textContent.startsWith(n)) ||
      document.querySelector('.dif-view [role=alert]'),
    name,
    { timeout: 180_000 },
  );
}

const counts = (page) =>
  page.$$eval('[data-testid=dif-counts] .fact', (facts) =>
    Object.fromEntries(facts.map((f) => [f.querySelector('.k').textContent, Number(f.querySelector('.v').textContent)])),
  );
const rows = (page) =>
  page.$$eval('[data-testid=dif-message]', (trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].slice(1).map((td) => td.innerText.trim()).join(' | ')),
  );

// 1. demo.dbc against demo-v2.dbc
say(`# demo.dbc -> demo-v2.dbc (${appUrl})`);
let page = await newPage();
await openMain(page, DEMO);
await page.getByRole('button', { name: 'Compare', exact: true }).click();
expectEqual('empty state title', await page.locator('.dif-empty h2').innerText(), 'Compare demo.dbc with another version');
expectEqual('hash', await page.evaluate(() => location.hash), '#diff');
await page.screenshot({ path: join(outDir, 'compare-empty-light.png') });
await openOther(page, DEMO_V2);
expectEqual('versions', await page.$$eval('.dif-version-name', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim())), [
  'demo.dbc open file',
  'demo-v2.dbc',
]);
expectEqual('counts', await counts(page), {
  'Messages added': 1,
  'Messages removed': 1,
  'Messages changed': 4,
  'Signals added': 4,
  'Signals removed': 3,
  'Signals changed': 3,
});
expectEqual('listed messages', await rows(page), [
  'Changed | 0x100 | EngineData | +1 −0 ~2 | ',
  'Changed | 0x200 | GearboxData | +0 −1 ~1 | ',
  'Changed | 0x300 | BrakeData | +1 −0 ~0 | DLC, Attribute GenMsgCycleTime',
  'Changed | 0x500 | PowerData BatteryData | +0 −0 ~0 | Name',
  'Added | 0x700 | BodyStatus | 2 signals | ',
  'Removed | 0x0C000003 | J1939_TSC1 | 2 signals | ',
]);
expectEqual('unchanged note', await page.locator('.dif-note').innerText(), '4 unchanged messages are not listed.');
expectEqual(
  'database card',
  await page.$$eval('[data-testid=dif-database] h3', (h) => h.map((x) => x.textContent)),
  ['Database properties', 'Nodes', 'Value tables', 'Attribute definitions'],
);
await page.getByRole('button', { name: 'Show the changes of BrakeData' }).click();
expectEqual(
  'BrakeData details',
  await page.$$eval('.dif-detail .dif-changes tbody tr, .dif-detail .dif-item-head', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  ),
  ['DLC 6 8', 'Attribute GenMsgCycleTime 20 10', 'Added BrakeLightOn 44|1@0+ (1,0) [0|1] ""'],
);
await page.screenshot({ path: join(outDir, 'compare-light.png'), fullPage: true });
await page.locator('[data-testid=dif-database]').screenshot({ path: join(outDir, 'compare-database-light.png') });
await page.getByRole('radio', { name: 'Removed · 1' }).click();
expectEqual('filter: removed', await rows(page), ['Removed | 0x0C000003 | J1939_TSC1 | 2 signals | ']);
await page.getByRole('radio', { name: 'All changes · 6' }).click();
await page.getByRole('button', { name: 'Swap versions' }).click();
expectEqual('swapped versions', await page.$$eval('.dif-version-name', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim())), [
  'demo-v2.dbc',
  'demo.dbc open file',
]);
expectEqual('swapped counts', await counts(page), {
  'Messages added': 1,
  'Messages removed': 1,
  'Messages changed': 4,
  'Signals added': 3,
  'Signals removed': 4,
  'Signals changed': 3,
});
await page.getByRole('button', { name: 'Swap versions' }).click();
await page.getByRole('button', { name: 'EngineData', exact: true }).click();
expectEqual('link to the viewer', [await page.evaluate(() => location.hash), await page.locator('h1').innerText()], [
  '#msg=256',
  'EngineData',
]);
await page.getByRole('button', { name: 'Compare', exact: true }).click();
expectEqual('comparison kept', (await rows(page)).length, 6);
await page.getByRole('button', { name: 'Close comparison' }).click();
expectEqual('closed', await page.locator('.dif-empty h2').count(), 1);
await page.context().close();

// 2. a DBC file against an ARXML file read through canmatrix
say('# canmatrix test.dbc -> test.arxml (through canmatrix)');
page = await newPage();
await openMain(page, CM_DBC);
await page.getByRole('button', { name: 'Compare', exact: true }).click();
const t0 = Date.now();
await openOther(page, CM_ARXML);
const alert = await page.locator('.dif-view [role=alert]').count();
expectEqual('ARXML read without error', alert, 0);
say(`     ARXML read and compared in ${Date.now() - t0} ms`);
if (!alert) {
  const c = await counts(page);
  say(`     counts: ${JSON.stringify(c)}`);
  expectEqual('ARXML side listed', (await page.$$eval('.dif-version-name', (e) => e.map((x) => x.innerText)))[1].startsWith('test.arxml'), true);
}
await page.screenshot({ path: join(outDir, 'compare-arxml-light.png'), fullPage: true });
await page.context().close();

// 3. screenshots: dark German desktop, light phone width
for (const [name, options] of [
  ['compare-de-dark.png', { lang: 'de', theme: 'dark' }],
  ['compare-narrow-light.png', { width: 390, height: 844 }],
]) {
  page = await newPage(options);
  await openMain(page, DEMO);
  await page.getByRole('button', { name: options.lang === 'de' ? 'Vergleich' : 'Compare', exact: true }).click();
  await openOther(page, DEMO_V2);
  await page.locator('.dif-toggle').first().click();
  // Wide tables scroll inside their card; the page and the main area must not.
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('.main');
    return [
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main.scrollWidth - main.clientWidth,
    ];
  });
  expectEqual(`${name}: no horizontal scroll of the page and the main area`, overflow, [0, 0]);
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  await page.context().close();
}

await browser.close();

const foreign = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
say(`requests: ${requests.length}, outside ${origin}: ${foreign.length}`);
for (const url of foreign) say(`  ${url}`);
expectEqual('console errors', consoleErrors, []);
if (foreign.length) failures.push('requests outside the origin');
writeFileSync(join(outDir, 'diff-check.log'), log.join('\n') + '\n');
if (failures.length) {
  console.error(`\n${failures.length} failure(s): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\ndiff mode works end to end, with no request outside the origin');
