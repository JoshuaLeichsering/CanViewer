// End-to-end check of the export features in a production build: the
// overview's export menu downloads the message and signal list as CSV and
// JSON, and the message page's copy menu puts the C struct and the decode
// pseudo-code on the clipboard. Each result must equal the pinned file the
// unit tests compare against (app/src/lib/export/pinned/), byte for byte.
//
// It also drives the menus by keyboard, in German, in the dark theme and at
// phone width, and records every request: everything must stay inside the
// app's origin (a download is a blob: URL of the page itself).
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4174 --strictPort &
//   node e2e/export-check.mjs http://localhost:4174/ <out-dir> examples/demo.dbc
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir, demoPath] = process.argv;
if (!appUrl || !outDir || !demoPath) {
  console.error('usage: node e2e/export-check.mjs <app-url> <out-dir> <demo.dbc>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const origin = new URL(appUrl).origin;
const pinned = (name) => readFileSync(fileURLToPath(new URL(`../app/src/lib/export/pinned/${name}`, import.meta.url)), 'utf8');

const failures = [];
const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};
const check = (ok, what) => {
  say(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const requests = [];
context.on('request', (r) => requests.push(r.url()));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(appUrl);
await page.setInputFiles('input[type=file]', demoPath);
await page.waitForFunction(() => document.title.startsWith('demo.dbc '));

/** Choose an item from a menu by mouse and return the download it starts. */
async function download(item) {
  await page.getByTestId('exp-export-button').click();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`exp-export-${item}`).click()]);
  const path = join(outDir, file.suggestedFilename());
  await file.saveAs(path);
  return { name: file.suggestedFilename(), url: file.url(), text: readFileSync(path, 'utf8') };
}

say('# export menu, mouse');
const BOM = '﻿';
for (const [item, name, expected] of [
  ['messagesCsv', 'demo.messages.csv', BOM + pinned('demo.messages.csv')],
  ['signalsCsv', 'demo.signals.csv', BOM + pinned('demo.signals.csv')],
  ['messagesJson', 'demo.messages.json', pinned('demo.messages.json')],
]) {
  const got = await download(item);
  check(got.name === name, `${item}: file name ${got.name}`);
  check(got.url.startsWith(`blob:${origin}/`), `${item}: downloaded from a blob: URL of the page (${got.url.slice(0, 40)}…)`);
  check(got.text === expected, `${item}: content equals the pinned file (${got.text.length} characters)`);
}
check((await page.getByTestId('exp-export-button').innerText()).includes('Exported'), 'the button confirms the export');
check(
  (await page.locator('.exp-menu [role=status]').first().innerText()) === 'demo.messages.json exported',
  'the live region announces the exported file',
);
await page.getByTestId('exp-export-button').click();
{
  const button = await page.getByTestId('exp-export-button').boundingBox();
  const menu = await page.locator('.exp-menu-popover').boundingBox();
  check(
    menu.y >= button.y + button.height && Math.abs(menu.x + menu.width - (button.x + button.width)) < 1,
    'the export menu opens below its button, right-aligned with it',
  );
}
await page.screenshot({ path: join(outDir, 'overview-menu-light-en.png') });
await page.keyboard.press('Escape');

say('# export menu, keyboard');
await page.getByTestId('exp-export-button').focus();
await page.keyboard.press('ArrowDown');
check(await page.getByTestId('exp-export-messagesCsv').evaluate((el) => el === document.activeElement), 'ArrowDown opens the menu on its first item');
await page.keyboard.press('End');
check(await page.getByTestId('exp-export-messagesJson').evaluate((el) => el === document.activeElement), 'End moves to the last item');
await page.keyboard.press('ArrowDown');
check(await page.getByTestId('exp-export-messagesCsv').evaluate((el) => el === document.activeElement), 'ArrowDown wraps to the first item');
await page.keyboard.press('Escape');
check((await page.locator('[role=menu]').count()) === 0, 'Escape closes the menu');
check(await page.getByTestId('exp-export-button').evaluate((el) => el === document.activeElement), 'Escape returns focus to the button');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const [byKey] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
check(byKey.suggestedFilename() === 'demo.signals.csv', `Enter on the second item downloads ${byKey.suggestedFilename()}`);
await page.mouse.click(5, 795);

say('# copy menu');
async function copied(message, item) {
  await page.getByTestId('exp-copy-button').click();
  await page.getByTestId(`exp-copy-${item}`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=exp-copy-button]')?.textContent?.includes('Copied'));
  return page.evaluate(() => navigator.clipboard.readText());
}
for (const message of ['EngineData', 'DiagData', 'AdasObjects', 'J1939_EEC1']) {
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.locator('tr.clickable', { hasText: message }).first().click();
  await page.waitForFunction((name) => document.querySelector('h1')?.textContent === name, message);
  check((await copied(message, 'cStruct')) === pinned(`demo/${message}.h`), `${message}: copied C struct equals the pinned file`);
  check((await copied(message, 'pseudoCode')) === pinned(`demo/${message}.decode.txt`), `${message}: copied pseudo-code equals the pinned file`);
}
check(
  (await page.locator('.exp-menu [role=status]').first().innerText()) === 'Decode pseudo-code of J1939_EEC1 copied',
  'the live region announces the copy',
);
await page.screenshot({ path: join(outDir, 'message-light-en.png') });

say('# German, dark theme, phone width');
await page.evaluate(() => {
  localStorage.setItem('canviewer.lang', 'de');
  localStorage.setItem('canviewer.theme', 'dark');
});
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForFunction(() => document.title.startsWith('demo.dbc '));
const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const inView = (testId) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
await page.getByRole('button', { name: 'Übersicht' }).click();
check((await page.getByTestId('exp-export-button').innerText()).includes('Exportieren'), 'German: the export button reads "Exportieren"');
await page.getByTestId('exp-export-button').click();
check((await page.getByTestId('exp-export-signalsCsv').innerText()) === 'Signale als CSV', 'German: the menu items are translated');
check(await inView('exp-export-messagesJson'), 'phone width: the export menu fits the screen');
check(await noOverflow(), 'phone width: no horizontal scrolling with the export menu open');
check(
  await page.locator('h1').evaluate((h1) => h1.getBoundingClientRect().height <= parseFloat(getComputedStyle(h1).lineHeight) * 1.5),
  'phone width: the file name keeps its line next to the export menu',
);
await page.screenshot({ path: join(outDir, 'overview-menu-dark-de-390.png') });
await page.keyboard.press('Escape');
await page.locator('tr.clickable', { hasText: 'BrakeData' }).first().click();
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'BrakeData');
check((await page.getByTestId('exp-copy-button').innerText()).includes('Kopieren als'), 'German: the copy button reads "Kopieren als"');
// The message page is wider than a phone with or without the menu (the
// message list stays beside it), so the menu must only not make it wider.
const closedWidth = await scrollWidth();
await page.getByTestId('exp-copy-button').click();
check((await page.getByTestId('exp-copy-pseudoCode').innerText()) === 'Dekodier-Pseudocode', 'German: the copy items are translated');
check(await inView('exp-copy-cStruct'), 'phone width: the copy menu fits the screen');
check((await scrollWidth()) <= closedWidth, `phone width: the open copy menu adds no horizontal scrolling (${closedWidth} px wide either way)`);
await page.screenshot({ path: join(outDir, 'message-menu-dark-de-390.png') });

await browser.close();

const foreign = requests.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith(`blob:${origin}/`) && !url.startsWith('data:'));
say(`# requests: ${requests.length}, outside ${origin}: ${foreign.length}`);
for (const url of foreign) say(`  ${url}`);
check(foreign.length === 0, `requests outside ${origin}: ${foreign.length}`);
check(errors.length === 0, `page errors: ${errors.length}${errors.length ? ` (${errors.join('; ')})` : ''}`);

writeFileSync(join(outDir, 'export-check.log'), log.join('\n') + '\n');
writeFileSync(join(outDir, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall export checks passed');
