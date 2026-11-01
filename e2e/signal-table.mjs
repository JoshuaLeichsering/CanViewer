// Signal table check: sorting and filtering in the real UI, by mouse and keyboard,
// in English and German.
//
// Drives a production build in Chromium with examples/demo.dbc:
//   - every column header is a button; clicking one sorts ascending, then
//     descending, then back to file order, and the header carries aria-sort;
//   - Enter and Space on a focused header sort as well;
//   - each signal keeps its number (chip) whatever the order;
//   - the Filter button opens a filter row (aria-expanded) and focuses it;
//     text and number filters combine, an unreadable number filter is marked
//     invalid and ignored, Escape clears a filter, and "Clear filters" and
//     closing the row bring every signal back;
//   - the sort stays when another message is shown;
//   - the German UI labels the controls in German;
//   - when the table is wider than its card, it scrolls sideways on its own and
//     the title and the filter controls stay in view.
// Screenshots go to <out-dir>; exits non-zero on the first broken expectation.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   NODE_PATH=$(npm root -g) node e2e/signal-table.mjs http://localhost:4173/ <out-dir> examples/demo.dbc
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir, dbc] = process.argv;
if (!appUrl || !outDir || !dbc) {
  console.error('usage: node e2e/signal-table.mjs <app-url> <out-dir> <demo.dbc>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

let passed = 0;
const step = async (what, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok    ${what}`);
  } catch (e) {
    console.log(`FAIL  ${what}\n${e.message}`);
    await page.screenshot({ path: join(outDir, 'signal-table-failure.png') });
    await browser.close();
    process.exit(1);
  }
};

const table = () => page.locator('[data-testid=tbl-signals]');
/** Name and chip number of every row, top to bottom. */
const rows = () =>
  table().evaluate((t) =>
    [...t.querySelectorAll('tbody tr')].map((tr) => {
      const name = tr.querySelector('.sig-name');
      return name ? `${name.querySelector('.sig-chip').textContent} ${name.lastChild.textContent}` : tr.textContent.trim();
    }),
  );
const names = async () => (await rows()).map((r) => r.replace(/^\d+ /, ''));
/** Columns that carry aria-sort, with its value. */
const sorted = () =>
  table().evaluate((t) => [...t.querySelectorAll('th[aria-sort]')].map((th) => `${th.textContent}:${th.getAttribute('aria-sort')}`));
const header = (label) => table().locator('thead th button', { hasText: new RegExp(`^${label}$`) });
const status = () => page.locator('.card.table-card [role=status]').textContent();
const filter = (label) => page.getByRole('textbox', { name: label, exact: true });
/** Scrolls the table back to its first column and into view, for a screenshot that shows the names. */
const showTable = async () => {
  await table().evaluate((t) => {
    t.closest('.tbl-scroll').scrollLeft = 0;
    t.closest('.card').scrollIntoView({ block: 'center' });
  });
};

const FILE_ORDER = ['EngineSpeed', 'EngineTemp', 'ThrottlePosition', 'EngineTorque', 'TorqueRequest', 'EngineRunning'];

await page.goto(appUrl);
await page.setInputFiles('input[type=file]', dbc);
await page.waitForFunction((n) => document.title.startsWith(n + ' '), basename(dbc));
await page.getByRole('button', { name: 'Messages', exact: true }).click();
await page.locator('.page-header h1', { hasText: 'EngineData' }).waitFor();

await step('the table starts in file order, with a sort button in each of the 12 headers and no aria-sort', async () => {
  assert.deepEqual(await names(), FILE_ORDER);
  assert.equal(await table().locator('thead th button').count(), 12);
  assert.deepEqual(await sorted(), []);
});

await step('sort buttons add no width: the table is as wide as with plain header text', async () => {
  // The sort arrows sit in the gutters between columns. Measured at the
  // table's natural width, since it otherwise stretches to fill its card.
  const widths = await table().evaluate((t) => {
    const clone = t.cloneNode(true);
    for (const b of clone.querySelectorAll('thead th button')) b.replaceWith(b.textContent);
    t.after(clone);
    t.style.width = clone.style.width = 'max-content';
    const result = { withButtons: t.getBoundingClientRect().width, plain: clone.getBoundingClientRect().width };
    clone.remove();
    t.style.width = '';
    return result;
  });
  assert.equal(widths.withButtons, widths.plain);
});

await step('a click on Length sorts ascending, the next descending, the third returns to file order', async () => {
  await header('Length').click();
  assert.deepEqual(await sorted(), ['Length:ascending']);
  assert.deepEqual(await rows(), [
    '06 EngineRunning',
    '02 EngineTemp',
    '03 ThrottlePosition',
    '04 EngineTorque',
    '05 TorqueRequest',
    '01 EngineSpeed',
  ]);
  assert.equal(await status(), 'Sorted by Length, ascending');
  await header('Length').click();
  assert.deepEqual(await sorted(), ['Length:descending']);
  assert.deepEqual(await names(), ['EngineSpeed', 'EngineTorque', 'TorqueRequest', 'EngineTemp', 'ThrottlePosition', 'EngineRunning']);
  assert.equal(await status(), 'Sorted by Length, descending');
  await header('Length').click();
  assert.deepEqual(await sorted(), []);
  assert.deepEqual(await names(), FILE_ORDER);
  assert.equal(await status(), 'In file order');
});

await step('Enter and Space on a focused header sort too, and its title names the next step', async () => {
  await header('Name').focus();
  assert.equal(await header('Name').getAttribute('title'), 'Sort ascending');
  await page.keyboard.press('Enter');
  assert.deepEqual(await sorted(), ['Name:ascending']);
  assert.deepEqual(await names(), ['EngineRunning', 'EngineSpeed', 'EngineTemp', 'EngineTorque', 'ThrottlePosition', 'TorqueRequest']);
  assert.equal(await header('Name').getAttribute('title'), 'Sort descending');
  await page.keyboard.press('Space');
  assert.deepEqual(await sorted(), ['Name:descending']);
  assert.equal(await header('Name').getAttribute('title'), 'Back to file order');
  await page.keyboard.press('Enter');
  assert.deepEqual(await sorted(), []);
});

await step('the Filter button opens the filter row and focuses the first filter', async () => {
  const toggle = page.getByRole('button', { name: 'Filter', exact: true });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await filter('Filter Name').isVisible(), false);
  const background = () => toggle.evaluate((b) => getComputedStyle(b).backgroundColor);
  assert.equal(await background(), 'rgba(0, 0, 0, 0)');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  // While open, the toggle wears the secondary container color, like a selected chip.
  assert.notEqual(await background(), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Filter Name');
  assert.equal(await page.locator('.tbl-help').first().isVisible(), true);
});

await step('text and number filters combine, and the count says how many are shown', async () => {
  await filter('Filter Name').fill('torque');
  assert.deepEqual(await names(), ['EngineTorque', 'TorqueRequest']);
  assert.equal(await page.locator('.tbl-count').textContent(), '2 of 6 shown');
  await filter('Filter Start').fill('>40');
  assert.deepEqual(await rows(), ['05 TorqueRequest']);
  assert.equal(await page.locator('.tbl-count').textContent(), '1 of 6 shown');
  await filter('Filter Name').fill('');
  await filter('Filter Start').fill('16..32');
  assert.deepEqual(await names(), ['EngineTemp', 'ThrottlePosition', 'EngineTorque']);
  await filter('Filter Receivers').fill('=TCM');
  assert.deepEqual(await names(), ['ThrottlePosition', 'EngineTorque']);
});

await step('an unreadable number filter is marked invalid and ignored; Escape clears it', async () => {
  await filter('Filter Length').fill('abc');
  assert.equal(await filter('Filter Length').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.getByText('The Length filter cannot be read and is ignored.').isVisible(), true);
  assert.deepEqual(await names(), ['ThrottlePosition', 'EngineTorque']);
  await filter('Filter Length').press('Escape');
  assert.equal(await filter('Filter Length').inputValue(), '');
  assert.equal(await filter('Filter Length').getAttribute('aria-invalid'), null);
});

await step('sorting applies to the filtered rows', async () => {
  await header('Start').click();
  await header('Start').click();
  assert.deepEqual(await rows(), ['04 EngineTorque', '03 ThrottlePosition']);
  await showTable();
  await page.screenshot({ path: join(outDir, 'signal-table-light-en.png'), fullPage: true });
});

await step('no match shows a note with a way out; Clear filters brings every signal back', async () => {
  await filter('Filter Name').fill('no such signal');
  const empty = table().locator('tbody tr.tbl-empty');
  assert.equal(await empty.locator('td').getAttribute('colspan'), '12');
  assert.match(await empty.textContent(), /No signals match the filters\./);
  await empty.getByRole('button', { name: 'Clear filters' }).click();
  assert.deepEqual(await names(), ['EngineRunning', 'TorqueRequest', 'EngineTorque', 'ThrottlePosition', 'EngineTemp', 'EngineSpeed']);
  assert.equal(await filter('Filter Name').inputValue(), '');
  assert.equal(await page.locator('.tbl-count').count(), 0);
  // The button is gone; the focus moved to the first filter instead of the page.
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Filter Name');
});

await step('closing the filter row drops its filters', async () => {
  await filter('Filter Unit').fill('rpm');
  assert.deepEqual(await names(), ['EngineSpeed']);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  assert.equal(await filter('Filter Unit').isVisible(), false);
  assert.equal((await names()).length, 6);
});

await step('the sort stays when another message is shown, and a click on a row still selects its signal', async () => {
  await page.locator('.list-item', { hasText: 'GearboxData' }).click();
  await page.locator('.page-header h1', { hasText: 'GearboxData' }).waitFor();
  assert.deepEqual(await sorted(), ['Start:descending']);
  assert.deepEqual(await rows(), ['04 OutputShaftSpeed', '03 TorqueConverterLock', '02 GearboxTemp', '01 GearPosition']);
  await table().locator('tbody tr', { hasText: 'GearboxTemp' }).click();
  await page.waitForFunction(() => location.hash.endsWith('/GearboxTemp'));
  assert.equal(await table().locator('tbody tr.selected').count(), 1);
  assert.match(await table().locator('tbody tr.selected').textContent(), /GearboxTemp/);
});

await step('the German UI labels the controls in German, in the dark theme', async () => {
  await page.evaluate(() => {
    localStorage.setItem('canviewer.lang', 'de');
    localStorage.setItem('canviewer.theme', 'dark');
  });
  await page.reload();
  await page.locator('.page-header h1', { hasText: 'GearboxData' }).waitFor();
  assert.equal(await page.getByRole('table', { name: 'Signale' }).count(), 1);
  await header('Länge').click();
  assert.equal(await status(), 'Sortiert nach Länge, aufsteigend');
  assert.equal(await header('Länge').getAttribute('title'), 'Absteigend sortieren');
  await page.getByRole('button', { name: 'Filtern', exact: true }).click();
  await filter('Einheit filtern').fill('degC');
  assert.equal(await page.locator('.tbl-count').textContent(), '1 von 4 angezeigt');
  await filter('Länge filtern').fill('>>');
  assert.equal(await page.getByText('Der Filter für Länge ist nicht lesbar und wird ignoriert.').isVisible(), true);
  await showTable();
  await page.screenshot({ path: join(outDir, 'signal-table-dark-de.png'), fullPage: true });
});

// The app shell has no layout for phones yet (that is W6's audit): at 390 px the
// detail pane is squeezed to nothing. A 900 px window leaves the detail pane
// about 500 px, narrower than the table, which is the case this step is about.
await step('in a narrow window the table scrolls on its own; the title and the filter controls stay in view', async () => {
  await page.setViewportSize({ width: 900, height: 844 });
  const card = page.locator('.card.table-card', { has: table() });
  const scroller = card.locator('.tbl-scroll');
  const scroll = await scroller.evaluate((c) => ({ scrollWidth: c.scrollWidth, clientWidth: c.clientWidth }));
  assert.ok(scroll.scrollWidth > scroll.clientWidth, JSON.stringify(scroll));
  // Focusing the last filter scrolls the table to it, not the card.
  await filter('Empfänger filtern').focus();
  assert.ok((await scroller.evaluate((c) => c.scrollLeft)) > 0);
  assert.equal(await card.evaluate((c) => c.scrollLeft), 0);
  const inCard = await card.evaluate((c) => {
    const box = c.getBoundingClientRect();
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right;
    };
    return { title: inside(c.querySelector('h2')), toggle: inside(c.querySelector('.tbl-filter-toggle')) };
  });
  assert.deepEqual(inCard, { title: true, toggle: true });
  await card.screenshot({ path: join(outDir, 'signal-table-narrow.png') });
});

await step('the page logged no errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
console.log(`\nsignal table check passed: ${passed} steps`);
