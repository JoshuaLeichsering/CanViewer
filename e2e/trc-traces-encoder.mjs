// End-to-end check of the Traces view and the frame encoder (W10), against a
// production build served by `vite preview`, in Chromium.
//
// It opens examples/demo.dbc, encodes frames in the message view (multiplexing
// and value descriptions included) and hands them to the decoder, then replays
// examples/demo-candump.log and examples/demo.asc in the Traces view: facts,
// decoded rows, the frame detail, filters, keyboard selection, the way back from
// a message, and German, dark and narrow layouts with screenshots. A generated
// log of many frames (200,000 by default) times opening, scrolling and filtering.
//
// Every request is recorded, and Chromium resolves no hostname except
// localhost, so the check also shows that reading and decoding logs stays in
// the tab: it fails on any request outside the app's origin.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node e2e/trc-traces-encoder.mjs http://localhost:4173/ <out-dir> [frames]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir, bigFrameCount = '200000'] = process.argv;
if (!appUrl || !outDir) {
  console.error('usage: node e2e/trc-traces-encoder.mjs <app-url> <out-dir> [frames]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const origin = new URL(appUrl).origin;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  if (!sessionStorage.getItem('trc-init')) {
    sessionStorage.setItem('trc-init', '1');
    localStorage.clear();
    localStorage.setItem('canviewer.lang', 'en');
    localStorage.setItem('canviewer.theme', 'light');
  }
});
let phase = 'load';
const requests = [];
context.on('request', (r) => requests.push({ phase, method: r.method(), type: r.resourceType(), url: r.url() }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const mainInput = 'input[type=file]:not([data-testid=trc-file-input])';
const text = (selector) => page.locator(selector).first().innerText();
// textContent ignores CSS text-transform (the card overlines are upper case on screen).
const content = (selector) => page.locator(selector).first().evaluate((el) => el.textContent);
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });

await page.goto(appUrl);
await page.setInputFiles(mainInput, join(examples, 'demo.dbc'));
await page.waitForFunction(() => document.title.startsWith('demo.dbc '));
check('demo.dbc opens', true, await page.title());

// ---------- the frame encoder ----------
phase = 'encoder';
await page.getByRole('button', { name: 'Messages' }).click();
await page.waitForSelector('[data-testid=trc-encoder]');
check('the encoder shows on the message view', (await text('.page-header h1')) === 'EngineData');
const enc = (signal) => `[data-testid=trc-encoder] [data-signal="${signal}"]`;
check(
  'an empty encoder gives the zero frame, with the physical value of raw 0 in grey',
  (await text('[data-testid=trc-enc-hex]')) === '00 00 00 00 00 00 00 00' &&
    (await page.getAttribute(`${enc('EngineTemp')} input`, 'placeholder')) === '-40',
);
for (const [signal, value] of [
  ['EngineSpeed', '2000'],
  ['EngineTemp', '90'],
  ['ThrottlePosition', '20'],
  ['EngineTorque', '150,0'],
  ['TorqueRequest', '-10'],
  ['EngineRunning', '1'],
]) {
  await page.fill(`${enc(signal)} input`, value);
}
let hex = await text('[data-testid=trc-enc-hex]');
check('EngineData encodes as computed by hand (decimal comma accepted)', hex === '40 1F 82 32 2C C1 FE 01', hex);
check('the encoder marks the selected signal', (await page.getAttribute(enc('EngineRunning'), 'class')).includes('selected'));
await page.fill(`${enc('EngineTemp')} input`, '300');
const rangeNote = await text(`${enc('EngineTemp')} .trc-enc-note`);
check('a value out of range is reported, not clamped', rangeNote === 'Out of range: -40 … 215' && (await text('[data-testid=trc-enc-hex]')) === '40 1F 00 32 2C C1 FE 01', rangeNote);
await page.fill(`${enc('EngineTemp')} input`, '90');
await page.fill(`${enc('ThrottlePosition')} input`, '20.1');
check('a value between steps shows what the frame holds', (await text(`${enc('ThrottlePosition')} .trc-enc-note`)) === 'encodes as 20 %');
await page.fill(`${enc('ThrottlePosition')} input`, '20');
await page.getByRole('button', { name: 'Decode', exact: true }).click();
const decoderValue = await page.inputValue('label.text-field input');
const decodedRows = await page.locator('.decoded .decoded-row').allInnerTexts();
check(
  'Decode puts the frame into the decoder, which reads the values back',
  decoderValue === '40 1F 82 32 2C C1 FE 01' && decodedRows.some((r) => r.includes('EngineSpeed') && r.includes('2000 rpm')),
  decoderValue,
);
await page.fill('label.text-field input', '40 1F 82 32 2C C1 FE 01');
await page.getByRole('button', { name: 'From decoder' }).click();
await page.fill(`${enc('EngineTemp')} input`, '100');
hex = await text('[data-testid=trc-enc-hex]');
check('From decoder keeps the decoder’s bits for signals without a value', hex === '40 1F 8C 32 2C C1 FE 01', hex);
await shot('encoder-light-en');

// Multiplexing: DiagData.
await page.fill('.list-pane input[type=search]', 'DiagData');
await page.locator('.list-item', { hasText: 'DiagData' }).first().click();
await page.waitForFunction(() => document.querySelector('.page-header h1')?.textContent === 'DiagData');
await page.fill(`${enc('MuxSelector')} input`, '1');
await page.fill(`${enc('SensorVoltage')} input`, '12');
await page.fill(`${enc('SensorCurrent')} input`, '2.5');
hex = await text('[data-testid=trc-enc-hex]');
check(
  'only the multiplexed signal the multiplexor selects is written',
  hex === '01 FA 00 00 00 00 00 00' && (await page.getAttribute(enc('SensorVoltage'), 'class')).includes('inactive'),
  hex,
);
await page.fill(`${enc('MuxSelector')} input`, '2');
await page.selectOption(`${enc('ErrorCode')} select`, '3');
hex = await text('[data-testid=trc-enc-hex]');
check('a value description can be picked for a signal', hex === '02 03 00 00 00 00 00 00' && (await page.inputValue(`${enc('ErrorCode')} input`)) === '3', hex);
await page.fill('.list-pane input[type=search]', '');

// ---------- the Traces view ----------
phase = 'traces';
await page.getByRole('button', { name: 'Traces' }).click();
await page.waitForSelector('[data-testid=trc-view]');
check('the Traces view starts empty, saying the log stays in the tab', (await text('[data-testid=trc-view]')).includes('never uploaded'));
await shot('traces-empty-light-en');
await page.setInputFiles('[data-testid=trc-file-input]', join(examples, 'demo-candump.log'));
await page.waitForSelector('[data-testid=trc-facts]');
const facts = (await text('[data-testid=trc-facts]')).replace(/\s+/g, ' ');
check('the candump log replays: 17 frames, 14 decoded, 11 ids, 2 unknown', facts === 'Frames 17 Duration 0.034 s IDs 11 Decoded 14 of 17 Unknown IDs 2', facts);
const rows = await page.locator('[data-testid=trc-row]').allInnerTexts();
check('every frame is a row', rows.length === 17, `${rows.length} rows`);
check(
  'rows show time, id, data, message and decoded signals',
  rows[0].includes('0.000000') && rows[0].includes('100') && rows[0].includes('40 1F 82 32 2C C1 FE 01') && rows[0].includes('EngineData') && rows[0].includes('EngineSpeed 2000 rpm'),
  rows[0].replace(/\s+/g, ' '),
);
check('a J1939 frame from another source address is matched by PGN', rows[10].includes('J1939_CCVS1') && rows[10].includes('by PGN'));
check('unknown ids, remote and error frames are shown as such', rows[13].includes('remote frame') && rows[14].includes('not in the database') && rows[15].includes('error frame'));
await page.locator('[data-testid=trc-row]').nth(4).click();
const detail = await text('[data-testid=trc-detail]');
check('the frame detail decodes all signals, inactive multiplexed ones included', detail.includes('DiagData') && detail.includes('2.5 A') && detail.includes('mux inactive'));
await shot('traces-light-en');
await page.locator('[data-testid=trc-viewport]').focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
check('↓ moves the selection', (await content('[data-testid=trc-detail]')).includes('Frame 7 · line 7'));
await page.getByRole('button', { name: 'Open message' }).click();
check('Open message shows the message', (await text('.page-header h1')) === 'DiagData');
await page.getByRole('button', { name: 'Traces' }).click();
check('coming back keeps the log and the selected frame', (await content('[data-testid=trc-detail]')).includes('Frame 7 · line 7'));
await page.fill('.trc-search input', 'diag');
check('the filter finds messages by name', (await text('[data-testid=trc-count]')) === '3 of 17 frames');
await page.fill('.trc-search input', '');
await page.getByRole('radio', { name: 'Unknown ID' }).click();
check('the Unknown ID chip keeps frames the database does not know', (await page.locator('[data-testid=trc-row]').count()) === 2);
await page.getByRole('radio', { name: 'All' }).click();

// A log opened like any file goes to the Traces view and keeps the database.
await page.setInputFiles(mainInput, join(examples, 'demo.asc'));
await page.waitForFunction(() => document.querySelector('.page-header h1')?.textContent === 'demo.asc');
const ascFacts = (await text('[data-testid=trc-facts]')).replace(/\s+/g, ' ');
check(
  'an .asc opened through the main file input replays against the open database',
  (await page.title()).startsWith('demo.dbc ') && ascFacts === 'Frames 17 Duration 0.034 s IDs 11 Decoded 14 of 17 Unknown IDs 2',
  ascFacts,
);
check('lines that are not frames are counted, not dropped', (await text('[data-testid=trc-skipped]')) === 'Read but not shown: 5 header lines · 1 comments · 1 other events · 1 bus statistics');
await page.locator('[data-testid=trc-row]').nth(12).click();
await shot('traces-asc-light-en');

// German, then dark, then narrow.
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();
const deFacts = (await text('[data-testid=trc-facts]')).replace(/\s+/g, ' ');
check('the Traces view is in German', deFacts === 'Frames 17 Dauer 0.034 s IDs 11 Dekodiert 14 von 17 Unbekannte IDs 2', deFacts);
await shot('traces-light-de');
await page.getByRole('button', { name: 'Dunkles Design' }).click();
await shot('traces-dark-de');
await page.getByRole('button', { name: 'Botschaften' }).click();
await page.waitForSelector('[data-testid=trc-encoder]');
check('the encoder is in German', (await text('[data-testid=trc-encoder] h2')) === 'Frame kodieren');
await page.locator('[data-testid=trc-encoder]').scrollIntoViewIfNeeded();
await shot('encoder-dark-de');
await page.getByRole('button', { name: 'Einstellungen' }).click();
await page.getByRole('menuitemradio', { name: 'English' }).click();
// The message view (and with it the encoder) has no narrow layout yet: its list pane keeps its
// width. The Traces view has no list pane, so it is checked narrow.
await page.getByRole('button', { name: 'Traces' }).click();
await page.setViewportSize({ width: 412, height: 900 });
await shot('traces-dark-en-narrow');
const pageFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
check('the Traces view does not widen a narrow page (the table scrolls in its card)', pageFits);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole('button', { name: 'Switch to light theme' }).click();

// ---------- a large log ----------
phase = 'large';
const count = Number(bigFrameCount);
const lines = [];
const payloads = [
  ['100', '401F82322CC1FE01'],
  ['200', '037801401F000000'],
  ['300', '138813BA3220'],
  ['400', '01FA000000000000'],
  ['500', '000048414B000000'],
  ['18FEF117', '0400500100000000'],
];
for (let i = 0; i < count; i++) {
  const [id, data] = payloads[i % payloads.length];
  lines.push(`(${(1793520000 + i * 0.001).toFixed(6)}) can0 ${id}#${data}`);
}
// The generated log is not evidence worth keeping; it goes to a temporary directory.
const bigDir = mkdtempSync(join(tmpdir(), 'trc-'));
const bigPath = join(bigDir, 'large-candump.log');
writeFileSync(bigPath, lines.join('\n') + '\n');
let t0 = Date.now();
await page.setInputFiles('[data-testid=trc-file-input]', bigPath);
await page.waitForFunction((n) => document.querySelector('[data-testid=trc-facts]')?.textContent.includes(`Frames${n}`), count, { timeout: 120_000 });
const openMs = Date.now() - t0;
const rendered = await page.locator('[data-testid=trc-row]').count();
check(`a log of ${count} frames opens and renders only the rows in view`, rendered > 0 && rendered < 200, `${openMs} ms to open, ${rendered} rows in the DOM`);
const scrollMs = await page.evaluate(async () => {
  const el = document.querySelector('[data-testid=trc-viewport]');
  const t = performance.now();
  el.scrollTop = el.scrollHeight / 2;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t;
});
const middle = await page.locator('[data-testid=trc-row]').first().getAttribute('data-row');
check('scrolling to the middle renders the rows there', Number(middle) > count / 2 - 1000 && Number(middle) < count / 2 + 1000, `${scrollMs.toFixed(1)} ms, first row in the DOM #${Number(middle) + 1}`);
t0 = Date.now();
await page.fill('.trc-search input', 'GearboxData');
await page.waitForFunction((n) => document.querySelector('[data-testid=trc-count]')?.textContent.startsWith(`${n} of`), Math.ceil(count / 6));
const filterMs = Date.now() - t0;
check('filtering the large log stays quick', filterMs < 5000, `${filterMs} ms`);
await page.locator('[data-testid=trc-viewport]').focus();
t0 = Date.now();
await page.keyboard.press('End');
await page.waitForFunction(() => document.querySelector('[data-testid=trc-detail]')?.textContent.includes('Frame'));
check('End selects the last matching frame', (await text('[data-testid=trc-detail]')).includes('GearboxData'), `${Date.now() - t0} ms`);

// ---------- requests ----------
const foreign = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
const byPhase = {};
for (const r of requests) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1;
check(`requests outside ${origin}: ${foreign.length}`, foreign.length === 0, `requests per phase: ${JSON.stringify(byPhase)}`);
// After the app has loaded, the only requests allowed are the app's own static files (a font weight
// is fetched the first time some text needs it); nothing is sent, and nothing is fetched or posted.
const work = requests.filter((r) => r.phase !== 'load');
const staticAsset = (r) => r.url.startsWith(`${origin}/assets/`) && r.method === 'GET' && ['font', 'stylesheet', 'image', 'script'].includes(r.type);
check(
  'encoding, replaying and decoding send nothing: after loading, only the app’s own static files are fetched',
  work.every(staticAsset),
  work.map((r) => `${r.method} ${r.type} ${r.url.slice(origin.length)}`).join(', ') || 'no requests',
);
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
rmSync(bigDir, { recursive: true, force: true });
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ results, requests }, null, 2) + '\n');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
