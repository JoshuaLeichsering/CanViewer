// UI checks in Chromium against a production build:
// - accessibility: axe-core finds no serious or critical issue in any view, at
//   desktop and 390 px wide, in both themes and both languages;
// - keyboard: "/" focuses the message search, the arrow keys, Home and End move
//   through the lists, and table rows and network nodes open with Enter;
// - the error boundary: a view that throws shows a recovery screen, and its
//   "Reset stored file" button ends the crash loop of a file restored on start;
// - the narrow layout: nothing scrolls sideways at 390 px, and the list and the
//   detail take turns;
// - deep links pasted into the open app, and the favicon.
// Every check also fails on a page error or a failed same-origin request.
//
// Usage (Playwright is not a dependency of the app; see network-check.mjs):
//   npm run build
//   NODE_PATH=$(npm root -g) node e2e/ui-checks.mjs [app-url]
// Without an app URL the script serves dist/ itself with Vite's preview server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// require() rather than import, so that a global install found via NODE_PATH works too.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const DEMO = readFileSync(fileURLToPath(new URL('../examples/demo.dbc', import.meta.url)), 'utf8');
/** demo.dbc with a comment on a signal that does not exist, which is one parse problem. */
const DEMO_WITH_PROBLEM = `${DEMO}\nCM_ SG_ 256 NoSuchSignal "A comment on a signal that is not there.";\n`;

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } };
/** The rail's destinations, in their order on screen. */
const RAIL = { overview: 0, messages: 1, network: 2, nodes: 3, tables: 4 };

let base = process.argv[2];
let server;
let browser;

before(async () => {
  if (!base) {
    const { preview } = await import('vite');
    server = await preview({ logLevel: 'warn', preview: { port: 4180 } });
    base = server.resolvedUrls.local[0];
  }
  // As in the network check, no hostname but localhost resolves.
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens the app in a fresh browser profile with a theme and a language stored,
 * as if the user had picked them. `init` runs in the page before the app.
 */
async function openApp({ viewport = 'desktop', theme = 'light', lang = 'en', init } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  context.setDefaultTimeout(10_000);
  await context.addInitScript(
    ([th, l]) => {
      // Only on the first load, so that a reload keeps what the app stored.
      if (sessionStorage.getItem('ui-checks')) return;
      sessionStorage.setItem('ui-checks', '1');
      localStorage.setItem('canviewer.theme', th);
      localStorage.setItem('canviewer.lang', l);
    },
    [theme, lang],
  );
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
  await page.goto(base);
  await page.waitForSelector('.welcome');
  return { context, page, problems };
}

/** Opens a file through the app's own file input and waits until it is shown. */
async function openFile(page, name, text) {
  await page.setInputFiles('input[type=file]', { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.waitForFunction((n) => document.title.startsWith(`${n} `), name);
}

const rail = (page, destination) => page.locator('.rail-item').nth(RAIL[destination]).click();
const heading = (page) => page.locator('.main h1').textContent();
const activeElement = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName.toLowerCase(), type: el?.getAttribute('type'), text: el?.textContent?.trim() ?? '' };
  });

/** On narrow screens the list and the detail take turns: go back to the list if it is hidden. */
async function showList(page) {
  const back = page.locator('.rgh-back');
  if (await back.isVisible()) await back.click();
}

/** Selects a message in the list pane by name. */
async function selectMessage(page, name) {
  await showList(page);
  await page.locator('.list-item', { hasText: name }).click();
  await page.waitForFunction((n) => document.querySelector('.main h1')?.textContent === n, name);
}

/** The serious and critical issues axe-core finds on the page as it is now. */
async function seriousIssues(page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE_SOURCE });
  const { violations } = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}; e.g. ${v.nodes[0].target.join(' ')}`);
}

/** The width by which the page, or its main pane, scrolls sideways (0 when it does not). */
const sidewaysOverflow = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector('.main');
    return Math.max(doc.scrollWidth - doc.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });

describe('accessibility (axe-core): no serious or critical issues', () => {
  const combos = [
    { viewport: 'desktop', theme: 'light', lang: 'en' },
    { viewport: 'desktop', theme: 'dark', lang: 'de' },
    { viewport: 'narrow', theme: 'light', lang: 'de' },
    { viewport: 'narrow', theme: 'dark', lang: 'en' },
  ];
  for (const combo of combos) {
    test(`every view, ${combo.viewport}, ${combo.theme}, ${combo.lang}`, async () => {
      const { context, page, problems } = await openApp(combo);
      const found = [];
      const check = async (state) => {
        for (const issue of await seriousIssues(page)) found.push(`${state}: ${issue}`);
      };
      await check('welcome');
      await page.locator('.rail-icon-btn[aria-expanded]').click();
      await check('settings menu');
      await page.keyboard.press('Escape');

      await openFile(page, 'demo.dbc', DEMO_WITH_PROBLEM);
      await check('overview with a parse problem');
      await rail(page, 'messages');
      await check('message list');
      await selectMessage(page, 'EngineData');
      await page.locator('tr.clickable', { hasText: 'EngineSpeed' }).click();
      await page.locator('.text-field input').fill('10 27 40 1F 00 64 00 00');
      await check('message with a signal and a payload');
      await page.locator('.page-header .btn').click();
      await page.waitForSelector('.snackbar');
      await check('message with the copy-link snackbar');
      await selectMessage(page, 'J1939_EEC1');
      await check('J1939 message');
      await selectMessage(page, 'AdasObjects');
      await check('CAN FD message');
      await rail(page, 'network');
      await check('network');
      await page.locator('.ng-node').first().click();
      await check('network with a node selected');
      await rail(page, 'nodes');
      await check('nodes');
      await rail(page, 'tables');
      await check('value tables');

      assert.deepEqual(found, [], `axe found:\n${found.join('\n')}`);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }
});

describe('keyboard', () => {
  test('"/" focuses the message search from anywhere, but not while typing', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    await page.keyboard.press('/');
    assert.deepEqual(await activeElement(page), { tag: 'input', type: 'search', text: '' });
    assert.equal(await page.locator('.list-pane input[type=search]').inputValue(), '', 'the "/" is not typed');
    assert.equal(await page.locator('.rail-item').nth(RAIL.messages).getAttribute('aria-current'), 'page');

    // In a text field "/" is just a character.
    await page.locator('.text-field input').click();
    await page.keyboard.type('12/');
    assert.equal(await page.locator('.text-field input').inputValue(), '12/');
    assert.equal((await activeElement(page)).type, null);

    // From another destination it switches to the messages.
    await rail(page, 'network');
    await page.locator('body').press('/');
    assert.equal((await activeElement(page)).type, 'search');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the arrow keys, Home and End move through the message list', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    await page.keyboard.press('/');
    await page.keyboard.type('J1939');
    assert.equal(await page.locator('.list-item').count(), 3);

    // The selected message (EngineData) is filtered out, so ↓ starts at the first match.
    await page.keyboard.press('ArrowDown');
    assert.equal(await heading(page), 'J1939_TSC1');
    assert.match((await activeElement(page)).text, /^0x0C000003\s*J1939_TSC1/);
    await page.keyboard.press('ArrowDown');
    assert.equal(await heading(page), 'J1939_EEC1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await heading(page), 'J1939_CCVS1', 'stops at the last message');
    await page.keyboard.press('Home');
    assert.equal(await heading(page), 'J1939_TSC1');
    await page.keyboard.press('End');
    assert.equal(await heading(page), 'J1939_CCVS1');
    assert.equal(await page.locator('.list-item[aria-current="true"]').textContent().then((t) => t.includes('J1939_CCVS1')), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await heading(page), 'J1939_EEC1');
    assert.equal(new URL(page.url()).hash, '#msg=2364539904');

    // ↑ on the first message returns to the search field.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    assert.equal((await activeElement(page)).type, 'search');
    // ↓ from the search field goes back to the selected message, without changing it.
    await page.keyboard.press('ArrowDown');
    assert.equal(await heading(page), 'J1939_TSC1');
    assert.match((await activeElement(page)).text, /J1939_TSC1/);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the arrow keys also move through nodes and value tables', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    await rail(page, 'nodes');
    await page.locator('.list-item').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await heading(page), 'TCM');
    await rail(page, 'tables');
    await page.locator('.list-item').first().focus();
    await page.keyboard.press('End');
    assert.equal(await heading(page), 'OnOff');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('table rows and network nodes open with Enter', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    // A row of the overview's message table.
    await page.locator('.main tr.clickable', { hasText: 'BrakeData' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await heading(page), 'BrakeData');
    // A row of the signal table selects the signal; Space selects it too.
    await page.locator('.main tr.clickable', { hasText: 'BrakePressure' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.signal-card h2').textContent(), 'BrakePressure');
    await page.keyboard.press(' ');
    assert.equal(await page.locator('.signal-card').count(), 0, 'Space toggles the selection off');
    // A node of the network graph.
    await rail(page, 'network');
    await page.locator('.ng-node[aria-label="ABS"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('.side-card .btn', { hasText: 'Open node' }).click();
    assert.equal(await heading(page), 'ABS');
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('deep links', () => {
  test('a link pasted into the open app shows its target', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    await page.evaluate(() => (location.hash = '#msg=512'));
    await page.waitForFunction(() => document.querySelector('.main h1')?.textContent === 'GearboxData');
    await page.evaluate(() => (location.hash = '#node=ABS'));
    await page.waitForFunction(() => document.querySelector('.main h1')?.textContent === 'ABS');
    // A malformed link shows the overview instead of failing.
    await page.evaluate(() => (location.hash = '#vt=%E0%A4'));
    await page.waitForFunction(() => document.querySelector('.main h1')?.textContent === 'demo.dbc');
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('error boundary', () => {
  // A stand-in for a view that throws on a particular file: the document title
  // refuses names that start with "rgh-crash". The app sets the title from the
  // file name when a file opens, and again when it is restored on start.
  const crashOnTitle = () => {
    const title = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    Object.defineProperty(Document.prototype, 'title', {
      ...title,
      set(value) {
        if (String(value).startsWith('rgh-crash')) throw new Error('Injected failure for rgh-crash files');
        title.set.call(this, value);
      },
    });
  };

  test('a crash shows a recovery screen, and "Reset stored file" ends the crash loop', async () => {
    const { context, page, problems } = await openApp({ lang: 'de', theme: 'dark', init: crashOnTitle });
    await openFile(page, 'demo.dbc', DEMO);
    await rail(page, 'messages');
    await page.setInputFiles('input[type=file]', {
      name: 'rgh-crash.dbc',
      mimeType: 'text/plain',
      buffer: Buffer.from(DEMO),
    });
    const screen = page.locator('[data-testid=rgh-crash]');
    await screen.waitFor();
    assert.equal(await screen.locator('h1').textContent(), 'Etwas ist schiefgelaufen');
    assert.match(await screen.locator('details pre').textContent(), /Injected failure for rgh-crash files/);
    assert.deepEqual(await seriousIssues(page), [], 'the recovery screen passes axe');

    // The file is stored and restored on start, so a reload crashes again.
    await page.reload();
    await screen.waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('canviewer.file')), /rgh-crash\.dbc/);

    await screen.locator('button', { hasText: 'Gespeicherte Datei zurücksetzen' }).click();
    await page.waitForSelector('.welcome');
    assert.equal(await page.evaluate(() => localStorage.getItem('canviewer.file')), null);
    assert.equal(new URL(page.url()).hash, '');
    // Only the stored file is gone: language and theme stay.
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    // And the app works again.
    await openFile(page, 'demo.dbc', DEMO);
    assert.equal(await heading(page), 'demo.dbc');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('"Reload" keeps the stored file', async () => {
    const { context, page, problems } = await openApp({ init: crashOnTitle });
    await page.setInputFiles('input[type=file]', { name: 'rgh-crash.dbc', mimeType: 'text/plain', buffer: Buffer.from(DEMO) });
    const screen = page.locator('[data-testid=rgh-crash]');
    await screen.waitFor();
    await Promise.all([page.waitForEvent('load'), screen.locator('button', { hasText: /^Reload$/ }).click()]);
    await screen.waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('canviewer.file')), /rgh-crash\.dbc/);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('a stored file of the wrong shape starts the app empty instead of crashing', async () => {
    const { context, page, problems } = await openApp({
      init: () => localStorage.setItem('canviewer.file', JSON.stringify({ name: { not: 'a string' }, text: 'VERSION ""' })),
    });
    assert.equal(await page.locator('[data-testid=rgh-crash]').count(), 0);
    assert.equal(await page.locator('.welcome').count(), 1);
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('narrow layout (390 px)', () => {
  test('nothing scrolls sideways, and the navigation sits at the bottom', async () => {
    const { context, page, problems } = await openApp({ viewport: 'narrow' });
    const wide = [];
    const measure = async (state) => {
      const px = await sidewaysOverflow(page);
      if (px > 0) wide.push(`${state}: ${px} px`);
    };
    await measure('welcome');
    const bar = await page.locator('.rail').boundingBox();
    assert.equal(Math.round(bar.y + bar.height), VIEWPORTS.narrow.height, 'the navigation bar is at the bottom');
    assert.equal(Math.round(bar.width), VIEWPORTS.narrow.width, 'and spans the width');

    await openFile(page, 'demo.dbc', DEMO_WITH_PROBLEM);
    await measure('overview');
    await rail(page, 'messages');
    await measure('message list');
    for (const name of ['EngineData', 'AdasObjects', 'J1939_EEC1']) {
      await selectMessage(page, name);
      await measure(name);
    }
    await rail(page, 'network');
    await measure('network');
    await rail(page, 'nodes');
    await measure('node list');
    await page.locator('.list-item').first().click();
    await measure('node');
    await rail(page, 'tables');
    await page.locator('.list-item').first().click();
    await measure('value table');
    assert.deepEqual(wide, []);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the list and the detail take turns', async () => {
    const { context, page, problems } = await openApp({ viewport: 'narrow' });
    await openFile(page, 'demo.dbc', DEMO);
    await rail(page, 'messages');
    assert.equal(await page.locator('.list-pane').isVisible(), true, 'the rail opens the list');
    assert.equal(await page.locator('.main').isVisible(), false);

    await page.locator('.list-item', { hasText: 'GearboxData' }).click();
    assert.equal(await page.locator('.list-pane').isVisible(), false, 'a tap opens the detail');
    assert.equal(await heading(page), 'GearboxData');

    await page.locator('.rgh-back').click();
    assert.equal(await page.locator('.list-pane').isVisible(), true, 'back returns to the list');
    assert.match(await page.locator('.list-item[aria-current="true"]').textContent(), /GearboxData/);

    // The arrow keys browse the list without leaving it; Enter opens the detail.
    await page.locator('.list-item[aria-current="true"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.list-pane').isVisible(), true);
    assert.match(await page.locator('.list-item[aria-current="true"]').textContent(), /BrakeData/);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.list-pane').isVisible(), false);
    assert.equal(await heading(page), 'BrakeData');
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('favicon', () => {
  test('the page links an icon that loads, and no request fails', async () => {
    const { context, page, problems } = await openApp();
    const href = await page.locator('link[rel=icon]').first().getAttribute('href');
    assert.ok(href, 'a link rel=icon exists');
    const icon = await page.evaluate(async (h) => {
      const r = await fetch(new URL(h, document.baseURI));
      return { status: r.status, type: r.headers.get('content-type'), body: await r.text() };
    }, href);
    assert.equal(icon.status, 200);
    assert.match(icon.type ?? '', /^image\/svg\+xml/);
    assert.match(icon.body, /<svg/);
    assert.deepEqual(problems, []);
    await context.close();
  });
});
