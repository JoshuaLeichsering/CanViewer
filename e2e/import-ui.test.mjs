// End-to-end checks of the import UI (handover task 5): opening and dropping
// every format in app/src/lib/canmatrix/formats.ts, the cluster picker, the
// source format with its lossy-conversion note, restoring an imported file on
// reload, and the loading stages of a cold start, in English and German.
//
// Drives a production build served by `vite preview` in Chromium. Every test
// starts from a fresh browser profile, so the first import of each pays the
// cold start (no cached runtime, no running worker). Like the network check,
// Chromium cannot resolve any host but localhost, and any request outside the
// app's origin fails the run.
//
// Needs the corpus submodules (third_party/) and Playwright (not a dependency
// of the app; require() finds a global install through NODE_PATH):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   CANVIEWER_URL=http://localhost:4173/ NODE_PATH=$(npm root -g) \
//     node --test --test-reporter=spec e2e/import-ui.test.mjs
// CANVIEWER_E2E_OUT=<dir> also saves a screenshot of each state.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// formats.ts holds only erasable TypeScript, so Node imports it as it is: the
// formats checked here are the app's own list, not a copy.
import { CANMATRIX_FORMATS, FILE_INPUT_ACCEPT } from '../app/src/lib/canmatrix/formats.ts';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_URL = process.env.CANVIEWER_URL ?? 'http://localhost:4173/';
const ORIGIN = new URL(APP_URL).origin;
const OUT = process.env.CANVIEWER_E2E_OUT;
if (OUT) mkdirSync(OUT, { recursive: true });
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'app/src/lib/canmatrix/import-corpus-baseline.json'), 'utf8')).reads;
const IMPORT_TIMEOUT = 180_000;

/**
 * One file per extension in formats.ts: from the corpus where it has one,
 * with the result pinned in import-corpus-baseline.json. The corpus has no
 * .odx and no .yml file; the ODX reader gets a minimal document (it always
 * adds a diagnostic request and response frame), and .yml reuses a YAML file
 * under that name.
 */
const MINIMAL_ODX =
  '<?xml version="1.0" encoding="UTF-8"?>\n<ODX VERSION="2.2.0"><DIAG-LAYER-CONTAINER ID="DLC"><SHORT-NAME>Demo</SHORT-NAME></DIAG-LAYER-CONTAINER></ODX>\n';
const SAMPLES = {
  arxml: { corpus: 'canmatrix/tests/files/arxml/test.arxml' },
  kcd: { corpus: 'cantools/tests/files/kcd/the_homer.kcd' },
  xml: { corpus: 'canmatrix/tests/reference/from_dbc/test.xml' },
  odx: { name: 'minimal.odx', text: MINIMAL_ODX, expect: { clusters: [{ name: '', messages: 2 }], error: null } },
  sym: { corpus: 'canmatrix/tests/files/sym/test.sym' },
  dbf: { corpus: 'canmatrix/tests/files/dbf/test.dbf' },
  json: { corpus: 'canmatrix/tests/files/json/test.json' },
  yaml: { corpus: 'canmatrix/tests/reference/from_dbc/test.yaml' },
  yml: { corpus: 'canmatrix/tests/reference/from_dbc/test.yaml', name: 'test.yml' },
  xlsx: { corpus: 'canmatrix/tests/files/xlsx/test.xlsx' },
  xls: { corpus: 'canmatrix/tests/files/xlsx/test.xls' },
};

/** A file to hand to the page: its name, bytes and what canmatrix makes of it. */
function sample(ext) {
  const s = SAMPLES[ext];
  const buffer = s.corpus ? readFileSync(join(ROOT, 'third_party', s.corpus)) : Buffer.from(s.text);
  const name = s.name ?? s.corpus.split('/').pop();
  const pinned = s.expect ?? BASELINE[s.corpus];
  assert.ok(pinned, `no pinned result for ${s.corpus}`);
  // The cluster the app shows first: the first one that holds messages.
  const shown = pinned.clusters.find((c) => c.messages > 0) ?? pinned.clusters[0];
  return { ext, name, buffer, pinned, shown };
}
const corpusFile = (path) => {
  const name = path.split('/').pop();
  return { name, buffer: readFileSync(join(ROOT, path)) };
};
const DEMO = corpusFile('examples/demo.dbc');
const HOMER = corpusFile('third_party/cantools/tests/files/kcd/the_homer.kcd');
const TEST_SYM = corpusFile('third_party/canmatrix/tests/files/sym/test.sym');
const TEST_ARXML = corpusFile('third_party/canmatrix/tests/files/arxml/test.arxml');
const TEST_XML = corpusFile('third_party/canmatrix/tests/reference/from_dbc/test.xml');

// Runs in the page before the app: records every state of the import
// progress panel as it happens (a MutationObserver sees each React commit,
// however short), with whether it was on screen and what each step showed.
function recordProgress() {
  const log = (window.__impProgress = []);
  let last = null; // no panel
  const check = () => {
    const panel = document.querySelector('[data-testid=imp-progress]');
    const stage = panel ? panel.getAttribute('data-stage') : null;
    if (stage === last) return;
    last = stage;
    const rect = panel?.getBoundingClientRect();
    log.push({
      t: performance.now(),
      stage,
      onScreen: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight),
      steps: panel ? [...panel.querySelectorAll('[data-testid^="imp-step-"]')].map((li) => `${li.dataset.testid.slice(9)}:${li.dataset.state}`) : [],
      text: panel ? panel.innerText : '',
    });
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
}

let browser;
const foreign = [];

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
});
after(async () => {
  await browser?.close();
});

/** A fresh profile (no stored file, no cached runtime) with the progress recorder. */
async function freshPage({ lang = 'en', width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width, height } });
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(ORIGIN + '/') && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });
  await context.addInitScript(recordProgress);
  await context.addInitScript((l) => {
    if (!localStorage.getItem('canviewer.lang')) localStorage.setItem('canviewer.lang', l);
  }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP_URL);
  await page.waitForSelector('.welcome');
  return { context, page, errors };
}

async function shot(page, name) {
  if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`) });
}

const viaInput = (page, file) => () =>
  page.setInputFiles('input[type=file]', { name: file.name, mimeType: 'application/octet-stream', buffer: file.buffer });

/** Drop a file on the app the way a file manager does: dragenter, dragover, drop. */
const viaDrop = (page, file) => () =>
  page.evaluate(
    ({ name, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name));
      const target = document.querySelector('.main');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      }
    },
    { name: file.name, base64: file.buffer.toString('base64') },
  );

/** What the page shows: the alert, or the open file's title, facts and source. */
const shown = (page) =>
  page.evaluate(() => {
    const alert = document.querySelector('[role=alert]');
    const facts = Object.fromEntries(
      [...document.querySelectorAll('.facts .fact')].map((f) => [f.querySelector('.k').textContent, Number(f.querySelector('.v').textContent)]),
    );
    const source = document.querySelector('[data-testid=imp-source]');
    return {
      alert: alert ? alert.textContent.trim() : null,
      title: document.title.split(' — ')[0],
      messages: facts.Messages ?? facts.Botschaften,
      format: source ? source.querySelector('.imp-source-title').textContent : null,
      clusters: [...document.querySelectorAll('[data-testid=imp-cluster]')].map((c) => ({
        name: c.dataset.name,
        checked: c.getAttribute('aria-checked') === 'true',
      })),
    };
  });

/**
 * Open a file and wait until the app has finished with it. For a canmatrix
 * format that is: the progress panel came and went, and then the file's title
 * or an alert is shown. Returns the panel's states and what is shown.
 */
async function open(page, trigger, name, { imported = true } = {}) {
  const from = await page.evaluate(() => window.__impProgress.length);
  await trigger();
  if (imported) {
    await page.waitForFunction(
      (from) => {
        const states = window.__impProgress.slice(from);
        return states.some((s) => s.stage) && states[states.length - 1].stage === null;
      },
      from,
      { timeout: IMPORT_TIMEOUT },
    );
  }
  await page.waitForFunction(
    (n) => document.title.startsWith(n + ' ') || document.querySelector('[role=alert]'),
    name,
    { timeout: IMPORT_TIMEOUT },
  );
  const states = await page.evaluate((from) => window.__impProgress.slice(from), from);
  return { states, ...(await shown(page)) };
}

async function dismissAlert(page) {
  const close = page.locator('.snackbar .close');
  if (await close.count()) await close.click();
}

/** Check one open against what canmatrix makes of the file (pinned). */
function assertPinned(file, result) {
  // Routed to canmatrix: the panel went through the reading stage.
  assert.ok(
    result.states.some((s) => s.stage === 'reading'),
    `${file.name}: never reached the reading stage: ${JSON.stringify(result.states)}`,
  );
  const label = CANMATRIX_FORMATS[file.ext].label;
  if (file.pinned.error || file.pinned.clusters.length === 0) {
    assert.ok(result.alert, `${file.name}: expected canmatrix's error, got ${JSON.stringify(result)}`);
    assert.ok(result.alert.includes(file.name), result.alert);
    const reason = file.pinned.error ? file.pinned.error.split('\n')[0] : 'canmatrix found no CAN database in this file';
    assert.ok(result.alert.includes(reason), `${file.name}: ${result.alert} lacks ${reason}`);
  } else {
    assert.equal(result.alert, null, `${file.name}: ${result.alert}`);
    assert.equal(result.title, file.name);
    assert.equal(result.messages, file.shown.messages, `${file.name}: messages shown`);
    assert.equal(result.format, `Imported from ${label}`);
  }
}

describe('import UI', () => {
  test('the corpus samples cover every format in formats.ts', () => {
    assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(CANMATRIX_FORMATS).sort());
  });

  test('Open: the file dialog offers every format, and each one is read through canmatrix', async () => {
    const { context, page, errors } = await freshPage();
    const accept = await page.getAttribute('input[type=file]', 'accept');
    assert.equal(accept, FILE_INPUT_ACCEPT);
    for (const ext of ['dbc', 'txt', ...Object.keys(CANMATRIX_FORMATS)]) {
      assert.ok(accept.split(',').includes(`.${ext}`), `.${ext} missing from ${accept}`);
    }
    await shot(page, 'welcome-en');

    const results = [];
    for (const ext of Object.keys(CANMATRIX_FORMATS)) {
      const file = sample(ext);
      const result = await open(page, viaInput(page, file), file.name);
      assertPinned(file, result);
      results.push(`${file.name}: ${result.alert ?? `${result.messages} messages, ${result.format}`}`);
      await dismissAlert(page);
    }
    console.log(`opened through the file input:\n  ${results.join('\n  ')}`);
    // And a DBC still goes to CanViewer's own parser, with no import.
    const dbc = await open(page, viaInput(page, DEMO), DEMO.name, { imported: false });
    assert.equal(dbc.title, 'demo.dbc');
    assert.equal(dbc.format, null);
    assert.deepEqual(dbc.states, []);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('drag and drop: every format is accepted and read through canmatrix', async () => {
    const { context, page, errors } = await freshPage();
    // The overlay shows while a file is dragged over the window.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'x.kcd'));
      document.querySelector('.main').dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await page.waitForSelector('.drop-overlay');
    await shot(page, 'drop-overlay');

    const results = [];
    for (const ext of Object.keys(CANMATRIX_FORMATS)) {
      const file = sample(ext);
      const result = await open(page, viaDrop(page, file), file.name);
      assertPinned(file, result);
      assert.equal(await page.locator('.drop-overlay').count(), 0, 'the overlay goes away on drop');
      results.push(`${file.name}: ${result.alert ?? `${result.messages} messages, ${result.format}`}`);
      await dismissAlert(page);
    }
    console.log(`opened by drag and drop:\n  ${results.join('\n  ')}`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('a cold start keeps every loading stage on screen, from the first moment to the last', async () => {
    const { context, page, errors } = await freshPage();
    const t0 = Date.now();
    const pending = open(page, viaInput(page, TEST_ARXML), TEST_ARXML.name);
    if (OUT) {
      await page.waitForSelector('[data-testid=imp-progress][data-stage=runtime]');
      await shot(page, 'progress-runtime-en');
    }
    const result = await pending;
    const ms = Date.now() - t0;
    const stages = result.states.map((s) => s.stage);
    assert.deepEqual(stages, ['runtime', 'packages', 'reading', null], JSON.stringify(result.states));
    assert.deepEqual(result.states[0].steps, ['runtime:active', 'packages:pending', 'reading:pending']);
    assert.deepEqual(result.states[1].steps, ['runtime:done', 'packages:active', 'reading:pending']);
    assert.deepEqual(result.states[2].steps, ['runtime:done', 'packages:done', 'reading:active']);
    for (const s of result.states.slice(0, 3)) {
      assert.ok(s.onScreen, `stage ${s.stage} not on screen`);
      assert.match(s.text, /Opening test\.arxml/);
      assert.match(s.text, /Python runtime/);
      assert.match(s.text, /Format support/);
      assert.match(s.text, /lxml/);
      assert.match(s.text, /Reading with canmatrix/);
    }
    const durations = result.states.slice(0, 3).map((s, i) => `${s.stage} ${Math.round(result.states[i + 1].t - s.t)} ms`);
    console.log(`cold start of test.arxml, ${ms} ms in all: ${durations.join(', ')}`);
    assert.equal(result.title, 'test.arxml');
    assert.equal(result.messages, 28);

    // Warm: the runtime and lxml are loaded, the panel still shows the steps.
    const warm = await open(page, viaInput(page, HOMER), HOMER.name);
    assert.equal(warm.states[warm.states.length - 1].stage, null);
    assert.ok(warm.states.some((s) => s.stage === 'reading' && s.steps.join() === 'runtime:done,packages:done,reading:active'));
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('a file with several clusters lets the user pick one (the_homer.kcd)', async () => {
    const { context, page, errors } = await freshPage();
    let r = await open(page, viaInput(page, HOMER), HOMER.name);
    assert.deepEqual(r.clusters, [
      { name: 'Motor', checked: true },
      { name: 'Instrumentation', checked: false },
      { name: 'Comfort', checked: false },
    ]);
    assert.equal(r.messages, 7);
    assert.match(await page.locator('.imp-clusters-hint').innerText(), /This file holds 3 clusters/);
    const counts = await page.locator('[data-testid=imp-cluster] .imp-cluster-count').allInnerTexts();
    assert.deepEqual(counts, ['7 messages', '6 messages', '20 messages']);
    await shot(page, 'clusters-en');

    await page.click('[data-testid=imp-cluster][data-name=Comfort]');
    r = await shown(page);
    assert.equal(r.messages, 20);
    assert.deepEqual(
      r.clusters.map((c) => c.checked),
      [false, false, true],
    );
    // The message list follows the cluster.
    await page.click('.rail-item:has-text("Messages")');
    const listed = await page.locator('.list-item .title').count();
    assert.equal(listed, 20);
    await page.click('.rail-item:has-text("Overview")');

    // Keyboard: the arrow keys move the choice, as in any radio group.
    await page.focus('[data-testid=imp-cluster][aria-checked=true]');
    await page.keyboard.press('ArrowLeft');
    r = await shown(page);
    assert.equal(r.messages, 6);
    assert.equal(r.clusters.find((c) => c.checked).name, 'Instrumentation');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.name), 'Instrumentation');

    // Narrow screens: the chips wrap inside the page.
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('.main');
      return [...document.querySelectorAll('[data-testid=imp-cluster]')].some((c) => c.getBoundingClientRect().right > main.getBoundingClientRect().right);
    });
    assert.equal(overflow, false, 'a cluster chip overflows the page at 390 px');
    await shot(page, 'clusters-390');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('an imported database shows its source format, and the lossy note links to its problems', async () => {
    const { context, page, errors } = await freshPage();
    let r = await open(page, viaInput(page, TEST_SYM), TEST_SYM.name);
    assert.equal(r.format, 'Imported from SYM');
    const note = await page.locator('[data-testid=imp-source]').innerText();
    assert.match(note, /The conversion may be lossy/);
    const link = page.locator('[data-testid=imp-problems-link]');
    assert.equal((await link.innerText()).trim(), 'Show the 4 problems canmatrix reported');
    await shot(page, 'source-sym-en');

    // The link scrolls the problem list to the top of the page and focuses it.
    const offset = () =>
      page.evaluate(() => {
        const main = document.querySelector('.main').getBoundingClientRect().top;
        return Math.round(document.getElementById('imp-problems').getBoundingClientRect().top - main);
      });
    const before = await offset();
    assert.ok(before > 100, `the problem list is already at the top (${before} px)`);
    await link.click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'imp-problems');
    const afterClick = await offset();
    assert.ok(Math.abs(afterClick) <= 2, `the problem list is ${afterClick} px from the top after the click (was ${before} px)`);
    console.log(`problems link: the list moved from ${before} px to ${afterClick} px below the top of the page`);
    assert.match(await page.locator('#imp-problems').innerText(), /Parse problems \(4\)/);
    await shot(page, 'source-sym-problems');

    // A file canmatrix reported nothing for still says the conversion may be lossy.
    r = await open(page, viaInput(page, HOMER), HOMER.name);
    assert.equal(r.format, 'Imported from KCD');
    assert.match(await page.locator('[data-testid=imp-source]').innerText(), /lossy[\s\S]*canmatrix reported no problems\./);
    assert.equal(await link.count(), 0);

    // A DBC is CanViewer's own reading: no source note.
    r = await open(page, viaInput(page, DEMO), DEMO.name, { imported: false });
    assert.equal(r.format, null);
    assert.equal(await page.locator('[data-testid=imp-source]').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('an imported file is restored on reload, like a DBC, with its cluster and deep link', async () => {
    const { context, page, errors } = await freshPage();
    await open(page, viaInput(page, HOMER), HOMER.name);
    await page.click('[data-testid=imp-cluster][data-name=Comfort]');
    // Deep link into a message of the Comfort cluster.
    await page.locator('.card.table-card tr.clickable').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#msg='));
    const hash = await page.evaluate(() => location.hash);
    const heading = await page.locator('.page-header h1').innerText();

    const stored = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('canviewer-import');
          req.onsuccess = () => {
            const get = req.result.transaction('files').objectStore('files').get('last');
            get.onsuccess = () => {
              const v = get.result;
              resolve(v && { name: v.name, cluster: v.cluster, size: v.bytes.byteLength });
              req.result.close();
            };
          };
        }),
    );
    assert.deepEqual(stored, { name: 'the_homer.kcd', cluster: 'Comfort', size: HOMER.buffer.length });
    assert.equal(await page.evaluate(() => localStorage.getItem('canviewer.file')), null);

    // Reload: the file is read through canmatrix again, with its stages on screen.
    await page.reload();
    await page.waitForFunction(
      () => window.__impProgress.length > 0 && window.__impProgress[window.__impProgress.length - 1].stage === null && document.title.startsWith('the_homer.kcd '),
      null,
      { timeout: IMPORT_TIMEOUT },
    );
    const restoreStages = await page.evaluate(() => window.__impProgress.map((s) => s.stage));
    assert.deepEqual(restoreStages, ['runtime', 'packages', 'reading', null]);
    assert.equal(await page.evaluate(() => location.hash), hash);
    assert.equal(await page.locator('.page-header h1').innerText(), heading);
    await page.click('.rail-item:has-text("Overview")');
    let r = await shown(page);
    assert.equal(r.title, 'the_homer.kcd');
    assert.equal(r.messages, 20);
    assert.equal(r.clusters.find((c) => c.checked).name, 'Comfort');

    // Opening a DBC replaces the stored import, and the DBC is restored as before.
    await open(page, viaInput(page, DEMO), DEMO.name, { imported: false });
    await page.reload();
    await page.waitForFunction(() => document.title.startsWith('demo.dbc '));
    r = await shown(page);
    assert.equal(r.format, null);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('canviewer.file'))).name, 'demo.dbc');
    const afterDbc = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('canviewer-import');
          req.onsuccess = () => {
            const get = req.result.transaction('files').objectStore('files').get('last');
            get.onsuccess = () => {
              resolve(get.result ?? null);
              req.result.close();
            };
          };
        }),
    );
    assert.equal(afterDbc, null);

    // And an import after a DBC replaces the stored DBC.
    await open(page, viaInput(page, TEST_SYM), TEST_SYM.name);
    assert.equal(await page.evaluate(() => localStorage.getItem('canviewer.file')), null);
    await page.reload();
    await page.waitForFunction(() => document.title.startsWith('test.sym '), null, { timeout: IMPORT_TIMEOUT });
    r = await shown(page);
    assert.equal(r.format, 'Imported from SYM');
    assert.equal(r.messages, 28);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('German: progress, source note, clusters, problems link and errors', async () => {
    const { context, page, errors } = await freshPage({ lang: 'de' });
    assert.match(
      await page.locator('.welcome .formats').first().innerText(),
      /ARXML, KCD, FIBEX, ODX, SYM, DBF, JSON, YAML, XLSX und XLS werden mit canmatrix gelesen/,
    );
    await shot(page, 'welcome-de');
    const pending = open(page, viaInput(page, HOMER), HOMER.name);
    if (OUT) {
      await page.waitForSelector('[data-testid=imp-progress][data-stage=runtime]');
      await shot(page, 'progress-runtime-de');
    }
    let r = await pending;
    const runtime = r.states.find((s) => s.stage === 'runtime');
    assert.match(runtime.text, /the_homer\.kcd wird geöffnet/);
    assert.match(runtime.text, /Python-Laufzeit/);
    assert.match(runtime.text, /Formatunterstützung/);
    assert.match(runtime.text, /Lesen mit canmatrix/);
    assert.equal(r.format, 'Importiert aus KCD');
    const source = await page.locator('[data-testid=imp-source]').innerText();
    assert.match(source, /Die Umwandlung kann verlustbehaftet sein/);
    assert.match(source, /canmatrix hat keine Probleme gemeldet\./);
    assert.match(source, /Diese Datei enthält 3 Cluster\. Welcher soll angezeigt werden\?/);
    assert.deepEqual(await page.locator('[data-testid=imp-cluster] .imp-cluster-count').allInnerTexts(), [
      '7 Botschaften',
      '6 Botschaften',
      '20 Botschaften',
    ]);
    await shot(page, 'clusters-de');

    r = await open(page, viaInput(page, TEST_SYM), TEST_SYM.name);
    assert.equal(r.format, 'Importiert aus SYM');
    assert.equal((await page.locator('[data-testid=imp-problems-link]').innerText()).trim(), 'Die 4 von canmatrix gemeldeten Probleme anzeigen');

    r = await open(page, viaInput(page, TEST_XML), TEST_XML.name);
    assert.match(r.alert, /^test\.xml konnte nicht gelesen werden: KeyError: 'CANCHANNEL01'/);
    await shot(page, 'error-de');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test('no request left the app’s origin', () => {
    assert.deepEqual(foreign, []);
  });
});
