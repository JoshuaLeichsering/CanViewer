// SPDX-License-Identifier: GPL-2.0-or-later
// UI checks in Chromium against a production build:
// - accessibility: axe-core finds no serious or critical issue in any view, at
//   desktop and 390 px wide, in both themes and both languages, empty and with
//   content: a multiplexed message with a payload in the decoder and the
//   encoder, a replayed log with a line not read, a comparison, an import's
//   progress, source note and cluster picker, the export and copy-as menus, and
//   the Save as DBC, discard and About dialogs;
// - About CanViewer: it opens by keyboard, the license files and notices it
//   links resolve inside the app's origin, and each of them opens offline
//   after one visit;
// - keyboard: "/" focuses the message search (and closes the settings menu),
//   the arrow keys, Home and End move through the lists, table rows and network
//   nodes open with Enter, and the focus order follows the layout;
// - the network view: from the desktop app's smallest window to 1920 × 1080,
//   the graph and its details fit the detail pane, which does not scroll, and
//   the node labels stay on the graph;
// - the search field: the "/" hint never cuts the placeholder off;
// - the error boundary: a view that throws shows a recovery screen, and its
//   "Reset stored file" button ends the crash loop of a file restored on start,
//   a DBC (localStorage) or an imported file (IndexedDB);
// - the narrow layout: nothing scrolls sideways at 390 px, comments keep a
//   readable width, every top-bar button can be seen and clicked, no label of
//   the navigation bar is cut off or off screen at 390, 375, 360 or 320 px
//   with any destination active, and the list and the detail take turns;
// - deep links pasted into the open app, and the favicon.
// Every check also fails on a page error or a failed same-origin request.
//
// Usage (Playwright is a dev dependency; `npx playwright install chromium`
// fetches its browser):
//   npm run build
//   node e2e/ui-checks.mjs [app-url]
// Without an app URL the script serves dist/ itself with Vite's preview server,
// from whichever directory it is started.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// require() rather than import, so that a global install found via NODE_PATH works too.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** A path in the repository, independent of the directory the script is started from. */
const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const DEMO = readFileSync(repoPath('examples/demo.dbc'), 'utf8');
/** demo.dbc with a comment on a signal that does not exist, which is one parse problem. */
const DEMO_WITH_PROBLEM = `${DEMO}\nCM_ SG_ 256 NoSuchSignal "A comment on a signal that is not there.";\n`;
/** A KCD file, read through canmatrix (so the Python runtime loads in this run). */
const HOMER_KCD = readFileSync(repoPath('third_party/cantools/tests/files/kcd/the_homer.kcd'));
/** The next version of demo.dbc, for the Compare page. */
const DEMO_V2 = readFileSync(repoPath('examples/demo-v2.dbc'), 'utf8');
/** demo.asc with a line that is not a frame, so the Traces view lists a line not read. */
const DEMO_ASC_WITH_PROBLEM = readFileSync(repoPath('examples/demo.asc'), 'utf8').replace('End TriggerBlock', 'garbage\nEnd TriggerBlock');

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } };
/** The rail's destinations, in their order on screen. */
const RAIL = { overview: 0, messages: 1, network: 2, nodes: 3, tables: 4, compare: 5, traces: 6 };
/** Widths at which no label of the navigation bar may be cut off (app/src/narrow.css). */
const NAV_WIDTHS = [390, 375, 360, 320];

let base = process.argv[2];
let server;
let browser;

before(async () => {
  if (!base) {
    if (!existsSync(repoPath('dist/index.html'))) {
      throw new Error('There is no build in dist/: run "npm run build" first, or pass the URL of a running app.');
    }
    const { preview } = await import('vite');
    // The repository's config says where the build is; without it Vite would
    // look for a config, and for dist/, in the current directory.
    server = await preview({ configFile: repoPath('vite.config.ts'), logLevel: 'warn', preview: { port: 4180 } });
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

/** Waits until the page has rendered a few frames, e.g. after a resize. */
const frames = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));

/** The names of the first `count` elements that Tab reaches, from the start of the page. */
async function tabOrder(page, count) {
  // blur() would not do: Tab goes on from the element that had the focus last.
  // Start from a focusable element (but not a Tab stop) at the top instead.
  await page.evaluate(() => {
    const start = document.createElement('div');
    start.tabIndex = -1;
    start.dataset.tabStart = '';
    document.body.prepend(start);
    start.focus();
  });
  const names = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return el?.querySelector('.label')?.textContent ?? el?.getAttribute('aria-label') ?? el?.textContent?.trim();
      }),
    );
  }
  await page.evaluate(() => document.querySelector('[data-tab-start]')?.remove());
  return names;
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
      // The editors are dialogs over the page.
      await page.locator('[data-testid="edt-edit-message"]').click();
      await check('message editor');
      await page.keyboard.press('Escape');
      await page.locator('[data-testid="edt-edit-signal"]').click();
      await check('signal editor');
      await page.keyboard.press('Escape');
      // The header also holds the copy-as-code menu button.
      await page.locator('.page-header').getByRole('button', { name: combo.lang === 'de' ? 'Link kopieren' : 'Copy link' }).click();
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
      await rail(page, 'compare');
      await check('compare, before another version is open');
      await rail(page, 'traces');
      await check('traces, before a log is open');

      assert.deepEqual(found, [], `axe found:\n${found.join('\n')}`);
      assert.deepEqual(problems, []);
      await context.close();
    });

    // The states with content loaded and the menus and dialogs open, which the
    // pass above does not reach.
    test(`working states, ${combo.viewport}, ${combo.theme}, ${combo.lang}`, async () => {
      const { context, page, problems } = await openApp(combo);
      const de = combo.lang === 'de';
      const found = [];
      const check = async (state) => {
        for (const issue of await seriousIssues(page)) found.push(`${state}: ${issue}`);
      };
      await openFile(page, 'demo.dbc', DEMO_WITH_PROBLEM);
      // The overview's export menu, open.
      await page.getByTestId('exp-export-button').click();
      await page.waitForSelector('.exp-menu-popover');
      await check('export menu open');
      await page.keyboard.press('Escape');

      // A multiplexed message: the decoder with a payload in which some signals
      // are not active (one of them selected), and the encoder likewise.
      await rail(page, 'messages');
      await selectMessage(page, 'DiagData');
      await page.locator('label.text-field input').fill('01 FA 00 00 00 00 00 00');
      await page.locator('.decoded-row.inactive').first().click();
      await page.locator('[data-testid=trc-encoder] [data-signal="MuxSelector"] input').fill('1');
      await page.locator('[data-testid=trc-encoder] [data-signal="SensorVoltage"] input').fill('12');
      assert.ok((await page.locator('.decoded-row.inactive').count()) > 0, 'the decoder shows signals that are not active');
      assert.ok((await page.locator('.trc-enc-row.inactive').count()) > 0, 'the encoder shows signals that are not active');
      await check('multiplexed message with a payload, in the decoder and the encoder');
      // The message page's copy-as menu, open.
      await page.getByTestId('exp-copy-button').click();
      await page.waitForSelector('.exp-menu-popover');
      await check('copy-as menu open');
      await page.keyboard.press('Escape');

      // Save as DBC: the parse problem is listed as a loss before saving.
      await page.getByTestId('edt-save-dbc').click();
      await page.waitForSelector('[data-testid=edt-issues-dialog]');
      await check('Save as DBC dialog with its list of losses');
      await page.keyboard.press('Escape');

      // An edit, then another file: the discard prompt.
      await page.getByTestId('edt-edit-message').click();
      await page.getByTestId('edt-message-comment').fill('Edited.');
      await page.getByTestId('edt-submit').click();
      await page.waitForSelector('[data-testid=edt-unsaved]');
      await page.setInputFiles('input[type=file]:not([data-testid])', { name: 'demo.dbc', mimeType: 'text/plain', buffer: Buffer.from(DEMO) });
      await page.waitForSelector('[data-testid=edt-discard-dialog]');
      await check('discard-edits prompt');
      await page.getByTestId('edt-discard-dialog').getByTestId('edt-submit').click();
      await page.waitForSelector('[data-testid=edt-unsaved]', { state: 'detached' });

      // Traces: a log replayed, with a frame selected and a line not read.
      await rail(page, 'traces');
      await page.setInputFiles('[data-testid=trc-file-input]', { name: 'demo.asc', mimeType: 'text/plain', buffer: Buffer.from(DEMO_ASC_WITH_PROBLEM) });
      await page.waitForSelector('[data-testid=trc-problems]');
      await page.locator('[data-testid=trc-row]').nth(4).click();
      await check('traces with a log, a frame selected and a line not read');

      // Compare: the result of a comparison with the next version.
      await rail(page, 'compare');
      await page.setInputFiles('[data-testid=dif-file-input]', { name: 'demo-v2.dbc', mimeType: 'text/plain', buffer: Buffer.from(DEMO_V2) });
      await page.waitForSelector('[data-testid=dif-counts]');
      await check('compare with a result');

      // About CanViewer, from the settings menu.
      await page.locator('.rail-icon-btn[aria-expanded]').click();
      await page.getByRole('menuitem', { name: de ? 'Über CanViewer' : 'About CanViewer' }).click();
      await page.waitForSelector('[data-testid=abt-dialog]');
      await check('About dialog');
      await page.keyboard.press('Escape');

      // An import through canmatrix: its progress on a cold start, then the
      // source note and the cluster picker of a file with three clusters.
      await page.setInputFiles('input[type=file]:not([data-testid])', { name: 'the_homer.kcd', mimeType: 'application/xml', buffer: HOMER_KCD });
      await page.waitForSelector('[data-testid=imp-progress][data-stage=runtime]', { timeout: 30_000 });
      await check('import progress');
      await page.waitForSelector('[data-testid=imp-source]', { timeout: 60_000 });
      await page.waitForSelector('[data-testid=imp-progress]', { state: 'detached' });
      assert.ok((await page.locator('[data-testid=imp-cluster]').count()) > 1, 'the cluster picker shows');
      await check('imported file with its source note and cluster picker');

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

  test('"/" closes the settings menu on its way to the search', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    const menuButton = page.locator('.rail-icon-btn[aria-expanded]');
    await menuButton.click();
    assert.equal(await page.locator('.menu-popover').count(), 1);
    assert.equal((await activeElement(page)).text, 'English', 'the menu has the focus');
    await page.keyboard.press('/');
    assert.equal((await activeElement(page)).type, 'search');
    assert.equal(await page.locator('.menu-popover').count(), 0, 'the menu is closed');
    assert.equal(await menuButton.getAttribute('aria-expanded'), 'false');

    // Moving the focus inside the menu, or clicking an item, still works.
    await menuButton.click();
    await page.keyboard.press('ArrowDown');
    assert.equal((await activeElement(page)).text, 'Deutsch');
    assert.equal(await page.locator('.menu-popover').count(), 1);
    await page.locator('.menu-item', { hasText: 'Deutsch' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
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

describe('focus order', () => {
  test('Tab follows the layout: below 600 px the theme toggle is in the top bar', async () => {
    const { context, page, problems } = await openApp({ viewport: 'narrow' });
    await openFile(page, 'demo.dbc', DEMO);
    // Top bar (menu, open file, Save as DBC, theme), then the navigation bar at the bottom.
    assert.deepEqual(await tabOrder(page, 11), [
      'Settings',
      'Open file',
      'Save as DBC',
      'Switch to dark theme',
      'Overview',
      'Messages',
      'Network',
      'Nodes',
      'Tables',
      'Compare',
      'Traces',
    ]);
    const theme = await page.locator('.rail-icon-btn[aria-label="Switch to dark theme"]').boundingBox();
    assert.ok(theme.y < 56, 'the theme toggle is in the top bar');

    // In the rail it is at the bottom, after the destinations, in both senses.
    await page.setViewportSize(VIEWPORTS.desktop);
    await frames(page);
    assert.deepEqual(await tabOrder(page, 11), [
      'Settings',
      'Open file',
      'Save as DBC',
      'Overview',
      'Messages',
      'Network',
      'Nodes',
      'Tables',
      'Compare',
      'Traces',
      'Switch to dark theme',
    ]);
    const railTheme = await page.locator('.rail-icon-btn[aria-label="Switch to dark theme"]').boundingBox();
    assert.ok(railTheme.y > VIEWPORTS.desktop.height / 2, 'the theme toggle is at the bottom of the rail');
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('search field', () => {
  /**
   * Whether the "/" hint shows, and whether the whole placeholder fits in the
   * empty search field. An input's scrollWidth grows with its value but not
   * with its placeholder, so the placeholder goes in as the value for the
   * measurement, set directly, without an input event, so the app does not react.
   */
  const searchState = (page) =>
    page.locator('.list-pane input[type=search]').evaluate((input) => {
      const hint = input.parentElement.querySelector('.rgh-kbd');
      const style = hint && getComputedStyle(hint);
      const hintShown = !!style && style.display !== 'none' && style.visibility === 'visible';
      input.value = input.placeholder;
      const placeholderFits = input.scrollWidth <= input.clientWidth;
      input.value = '';
      return { hintShown, placeholderFits };
    });

  for (const lang of ['de', 'en']) {
    test(`the "/" hint never cuts the placeholder off (${lang})`, async () => {
      const { context, page, problems } = await openApp({ lang });
      await openFile(page, 'demo.dbc', DEMO);
      await rail(page, 'messages');
      await page.evaluate(() => document.fonts.ready);
      // At desktop width, the list pane has room for both.
      assert.deepEqual(await searchState(page), { hintShown: true, placeholderFits: true });
      // Where it has not, the hint gives way.
      for (const width of [1100, 840, 390, 320]) {
        await page.setViewportSize({ width, height: VIEWPORTS.narrow.height });
        await showList(page);
        await frames(page);
        const state = await searchState(page);
        assert.ok(!state.hintShown || state.placeholderFits, `at ${width} px the hint cuts the placeholder off`);
      }
      // And comes back when the room is there again.
      await page.setViewportSize(VIEWPORTS.desktop);
      await frames(page);
      assert.deepEqual(await searchState(page), { hintShown: true, placeholderFits: true });
      assert.deepEqual(problems, []);
      await context.close();
    });
  }
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
    // The focus moves to the recovery screen, rather than falling back to <body>,
    // and Tab goes on to its first button.
    assert.deepEqual(await activeElement(page), { tag: 'h1', type: null, text: 'Etwas ist schiefgelaufen' });
    await page.keyboard.press('Tab');
    assert.equal((await activeElement(page)).text, 'Gespeicherte Datei zurücksetzen');
    assert.match(await screen.locator('details pre').textContent(), /Injected failure for rgh-crash files/);
    assert.deepEqual(await seriousIssues(page), [], 'the recovery screen passes axe');

    // The file is stored and restored on start, so a reload crashes again.
    await page.reload();
    await screen.waitFor();
    assert.equal((await activeElement(page)).tag, 'h1');
    assert.match(await page.evaluate(() => localStorage.getItem('canviewer.file')), /rgh-crash\.dbc/);

    // The reset reloads once the stored files are gone (IndexedDB deletes
    // asynchronously), so wait for that load: the recovery screen is a
    // .welcome too.
    await Promise.all([
      page.waitForEvent('load'),
      screen.locator('button', { hasText: 'Gespeicherte Datei zurücksetzen' }).click(),
    ]);
    await page.waitForSelector('.welcome');
    assert.equal(await screen.count(), 0);
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

  test('"Reset stored file" also ends the crash loop of an imported file, restored from IndexedDB', async () => {
    const { context, page, problems } = await openApp({ init: crashOnTitle });
    const screen = page.locator('[data-testid=rgh-crash]');
    /** The name of the imported file the app keeps for the next start (lib/import/storage.ts), or null. */
    const storedImport = () =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('canviewer-import');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('files')) return db.close(), resolve(null);
              const get = db.transaction('files').objectStore('files').get('last');
              get.onsuccess = () => (db.close(), resolve(get.result?.name ?? null));
              get.onerror = () => reject(get.error);
            };
          }),
      );
    await page.setInputFiles('input[type=file]', { name: 'rgh-crash.kcd', mimeType: 'application/xml', buffer: HOMER_KCD });
    // The first import starts the Python runtime.
    await screen.waitFor({ timeout: 60_000 });
    for (let i = 0; i < 50 && (await storedImport()) === null; i++) await page.waitForTimeout(100);
    assert.equal(await storedImport(), 'rgh-crash.kcd');
    assert.equal(await page.evaluate(() => localStorage.getItem('canviewer.file')), null);

    // Restored on start and read through canmatrix again, it crashes again.
    await page.reload();
    await screen.waitFor({ timeout: 60_000 });

    await Promise.all([page.waitForEvent('load'), screen.locator('button', { hasText: 'Reset stored file' }).click()]);
    await page.waitForSelector('.welcome');
    assert.equal(await storedImport(), null);
    assert.equal(await screen.count(), 0);
    assert.equal(await page.locator('[data-testid=imp-progress]').count(), 0);
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
    // Comments and value lists keep a readable width (the table scrolls sideways
    // in its card instead), rather than a narrow column of very tall rows.
    const commentWidths = await page.locator('.main td.comment').evaluateAll((cells) =>
      cells.map((td) => Math.round(td.getBoundingClientRect().width)),
    );
    assert.ok(commentWidths.length > 0);
    assert.ok(Math.min(...commentWidths) >= 240, `comment cells are ${commentWidths.join(', ')} px wide`);
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

  for (const lang of ['en', 'de']) {
    test(`every top-bar button can be seen and clicked, and no destination's label is cut off (${lang})`, async () => {
      const { context, page, problems } = await openApp({ viewport: 'narrow', lang });
      await openFile(page, 'demo.dbc', DEMO);
      await page.evaluate(() => document.fonts.ready);
      // The top bar: the menu, open file, Save as DBC and the theme toggle.
      // Each one is on screen, inside the bar, and is what a tap at its
      // centre hits, so that nothing covers another.
      const topBar = await page.evaluate(() =>
        [...document.querySelectorAll('.rail > div:first-child > .rail-icon-btn, .rail > .rail-fab, .rail > .rail-icon-btn')].map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { name: el.getAttribute('aria-label'), x: Math.round(r.x), top: Math.round(r.y), bottom: Math.round(r.bottom), hit: el.contains(hit) };
        }),
      );
      const names = lang === 'de'
        ? ['Einstellungen', 'Datei öffnen', 'Als DBC speichern', 'Dunkles Design']
        : ['Settings', 'Open file', 'Save as DBC', 'Switch to dark theme'];
      assert.deepEqual(topBar.map((b) => b.name), names, 'the top bar holds these buttons, in this order in the DOM');
      for (const b of topBar) {
        assert.ok(b.hit, `${b.name} is covered by another element`);
        assert.ok(b.top >= 0 && b.bottom <= 56, `${b.name} is outside the top bar (${b.top}..${b.bottom})`);
      }
      // From left to right in the same order as the focus moves.
      const xs = topBar.map((b) => b.x);
      assert.deepEqual([...xs].sort((a, b) => a - b), xs, `the buttons are not in the focus order from left to right: ${xs.join(', ')}`);
      // A real click on Save as DBC reaches it (demo.dbc saves without a dialog).
      const download = page.waitForEvent('download');
      await page.locator('[data-testid=edt-save-dbc]').click();
      assert.equal((await download).suggestedFilename(), 'demo.dbc');

      // The navigation bar: every label fits, with the active one in bold, and
      // every destination is on screen, at 390 px and on narrower phones
      // (360 px is a common Android width, 320 px the narrowest iPhone's).
      for (const width of NAV_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORTS.narrow.height });
        for (const destination of Object.keys(RAIL)) {
          await rail(page, destination);
          await frames(page);
          const cut = await page.locator('.rail-item').evaluateAll((items) => {
            const right = document.documentElement.clientWidth;
            return items.flatMap((item) => {
              const label = item.querySelector('.label');
              const box = item.getBoundingClientRect();
              const problems = [];
              if (label.scrollWidth > label.clientWidth) problems.push(`${label.textContent} (${label.scrollWidth} > ${label.clientWidth} px)`);
              if (box.left < -0.5 || box.right > right + 0.5) problems.push(`${label.textContent} (off screen, ${Math.round(box.left)}..${Math.round(box.right)} px)`);
              return problems;
            });
          });
          assert.deepEqual(cut, [], `at ${width} px with ${destination} active, these labels are cut off`);
        }
      }
      assert.deepEqual(problems, []);
      await context.close();
    });
  }

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

describe('About CanViewer', () => {
  test('opens from the settings menu by keyboard, and its documents resolve inside the origin', async () => {
    const { context, page, problems } = await openApp();
    const menuButton = page.locator('.rail-icon-btn[aria-expanded]');
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    assert.equal((await activeElement(page)).text, 'About CanViewer');
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('abt-dialog');
    await dialog.waitFor();
    assert.equal((await activeElement(page)).text, 'Close', 'the dialog takes the focus');
    // The license files and the notices: same-origin links to files the build has.
    const origin = new URL(base).origin;
    const docs = await page.getByTestId('abt-doc').evaluateAll((links) => links.map((a) => a.href));
    assert.deepEqual(
      docs.map((href) => new URL(href).pathname.split('/').pop()),
      ['COPYRIGHT.txt', 'LICENSE.txt', 'LICENSE-GPL-3.0.txt', 'THIRD_PARTY_NOTICES.md'],
    );
    for (const href of docs) {
      assert.equal(new URL(href).origin, origin, href);
      assert.equal(await page.evaluate((h) => fetch(h).then((r) => r.status), href), 200, href);
    }
    assert.equal(await page.getByTestId('abt-source').getAttribute('href'), 'https://github.com/JoshuaLeichsering/CanViewer');
    // A document opens in the dialog, without leaving the page.
    await page.getByRole('link', { name: 'GNU General Public License, version 3' }).click();
    assert.match(await page.getByTestId('abt-text').textContent(), /Version 3, 29 June 2007/);
    assert.equal(new URL(page.url()).origin + new URL(page.url()).pathname, new URL(base).href);
    // Escape closes it, and the focus goes back to the menu button.
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await menuButton.evaluate((el) => el === document.activeElement), true);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('each of its documents opens offline after one visit, from the service worker\'s cache', async () => {
    // A visit online installs the service worker, which precaches the app
    // with the license files and notices; none of them is opened online.
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, serviceWorkers: 'allow' });
    context.setDefaultTimeout(15_000);
    await context.addInitScript(() => localStorage.setItem('canviewer.lang', 'en'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'the service worker controls the page');

    await context.setOffline(true);
    // The network is gone: a file the service worker does not hold fails.
    assert.match(await page.evaluate(() => fetch('offline-probe', { cache: 'no-store' }).then((r) => `HTTP ${r.status}`, (e) => String(e))), /TypeError/);
    await page.reload();
    await page.waitForSelector('.welcome');
    await page.locator('.rail-icon-btn[aria-expanded]').click();
    await page.getByRole('menuitem', { name: 'About CanViewer' }).click();
    await page.getByTestId('abt-dialog').waitFor();
    const expected = [/Copyright \(C\)/, /Version 2, June 1991/, /Version 3, 29 June 2007/, /# Third-party notices/];
    const docs = page.getByTestId('abt-doc');
    assert.equal(await docs.count(), expected.length);
    for (const [i, text] of expected.entries()) {
      await docs.nth(i).click();
      // The document is shown below the list, or an alert says why it is not.
      const outcome = await page.waitForFunction(
        (source) => {
          const alert = document.querySelector('[data-testid=abt-dialog] [role=alert]');
          if (alert) return `failed: ${alert.textContent}`;
          const shown = document.querySelector('[data-testid=abt-text]')?.textContent ?? '';
          return new RegExp(source).test(shown) && 'shown';
        },
        text.source,
      );
      assert.equal(await outcome.jsonValue(), 'shown', `document ${i}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });
});

describe('favicon', () => {
  test('the page links an icon that loads, made from the desktop app\'s icon, and no request fails', async () => {
    const { context, page, problems } = await openApp();
    const href = await page.locator('link[rel=icon]').first().getAttribute('href');
    assert.ok(href, 'a link rel=icon exists');
    const icon = await page.evaluate(async (h) => {
      const r = await fetch(new URL(h, document.baseURI));
      return { status: r.status, type: r.headers.get('content-type'), body: await r.text() };
    }, href);
    assert.equal(icon.status, 200);
    assert.match(icon.type ?? '', /^image\/svg\+xml/);
    // The shapes of desktop/app-icon.svg, cropped to its rounded square.
    const appIcon = readFileSync(repoPath('desktop/app-icon.svg'), 'utf8');
    const shapes = (svg) => svg.replace(/<svg\b[^>]*>/, '').trim();
    assert.match(icon.body, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="96 96 832 832">/);
    assert.equal(shapes(icon.body), shapes(appIcon));
    assert.deepEqual(problems, []);
    await context.close();
  });
});

describe('network view', () => {
  test('the graph and its details fit the detail pane, from the desktop app\'s smallest window to 1920 × 1080', async () => {
    const { context, page, problems } = await openApp();
    await openFile(page, 'demo.dbc', DEMO);
    await rail(page, 'network');
    // With a node selected, the details panel lists its connections.
    await page.locator('.ng-node[aria-label="ABS"]').click();
    assert.equal(await page.locator('.side-card .side-head h2').textContent(), 'ABS');
    const misfits = [];
    // The desktop app's smallest and default windows (desktop/tauri.conf.json), and larger screens.
    for (const size of [{ width: 720, height: 480 }, { width: 1280, height: 820 }, VIEWPORTS.desktop, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await frames(page);
      const m = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        const main = document.querySelector('.main');
        return { main: box('.main'), scroll: main.scrollHeight - main.clientHeight, graph: box('.netgraph'), labels: box('.graph-wrap'), side: box('.side-card') };
      });
      const at = `${size.width} × ${size.height}`;
      if (m.scroll > 0) misfits.push(`${at}: the detail scrolls by ${m.scroll} px`);
      if (m.graph.bottom > m.main.bottom + 0.5) misfits.push(`${at}: the graph ends ${Math.round(m.graph.bottom - m.main.bottom)} px below the detail`);
      if (m.side.top >= m.main.bottom || m.side.right > m.main.right + 0.5) misfits.push(`${at}: the details panel is out of sight`);
      // The labels are placed in percent of .graph-wrap: it must be the graph's own box.
      if (Math.abs(m.labels.width - m.graph.width) > 1 || Math.abs(m.labels.height - m.graph.height) > 1) {
        misfits.push(`${at}: the labels' box is ${Math.round(m.labels.width)} × ${Math.round(m.labels.height)}, the graph ${Math.round(m.graph.width)} × ${Math.round(m.graph.height)}`);
      }
    }
    assert.deepEqual(misfits, [], 'the network view does not fit');
    assert.deepEqual(problems, []);
    await context.close();
  });
});
