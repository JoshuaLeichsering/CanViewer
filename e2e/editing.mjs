// End-to-end check of editing and Save as DBC, against a production build in Chromium.
//
// Opens a DBC through the app's file input, edits a message and a signal in
// their dialogs (with the mouse and with the keyboard), checks validation,
// saves as DBC, and opens the saved file again to see the edits come back.
// Then it checks the German texts, the dark theme and a 390 px wide window,
// the prompts that guard unsaved edits, and that no request left the origin.
// Screenshots of the dialogs go to <out-dir>.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4174 --strictPort &
//   node e2e/editing.mjs http://localhost:4174/ <out-dir> examples/demo.dbc
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir, dbcPath] = process.argv;
if (!appUrl || !outDir || !dbcPath) {
  console.error('usage: node e2e/editing.mjs <app-url> <out-dir> <file.dbc>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const origin = new URL(appUrl).origin;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
};

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const requests = [];
const errors = [];
async function newPage(options = {}, init) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  if (init) await context.addInitScript(init);
  context.on('request', (r) => requests.push(r.url()));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}

const tid = (id) => `[data-testid="${id}"]`;
const heading = (page) => page.locator('.page-header h1').innerText();
const titled = (page, name) => page.waitForFunction((n) => document.title === `${n} — CanViewer`, name);
async function openFile(page, path, name) {
  await page.setInputFiles('input[type=file]', path);
  await titled(page, name);
}
/** The dialog's box lies inside what is on screen (the visual viewport, which can be smaller than the layout). */
async function fitsWindow(page, selector) {
  return page.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    const vv = window.visualViewport;
    const [left, top, width, height] = vv ? [vv.offsetLeft, vv.offsetTop, vv.width, vv.height] : [0, 0, innerWidth, innerHeight];
    return box.left >= left && box.top >= top && box.right <= left + width && box.bottom <= top + height;
  }, selector);
}

// ---- English, light, desktop: edit, validate, save, reopen ----
const page = await newPage({ viewport: { width: 1280, height: 860 } }, () => {
  localStorage.setItem('canviewer.lang', 'en');
  localStorage.setItem('canviewer.theme', 'light');
});
await page.goto(appUrl);
await page.waitForSelector('.welcome');
await openFile(page, dbcPath, 'demo.dbc');
await page.getByRole('button', { name: 'Messages', exact: true }).click();
check((await heading(page)) === 'EngineData', 'the rail opens the first message', await heading(page));
check((await page.locator(tid('edt-unsaved')).count()) === 0, 'no unsaved mark before an edit');

await page.click(tid('edt-edit-message'));
await page.waitForSelector(tid('edt-message-dialog'));
check(await page.evaluate(() => document.activeElement?.dataset.testid === 'edt-message-name'), 'the message dialog takes the focus');
await page.fill(tid('edt-message-name'), 'EngineStatus');
await page.fill(tid('edt-message-id'), '0x120');
await page.fill(tid('edt-message-comment'), 'Edited in CanViewer.');
await page.screenshot({ path: join(outDir, 'message-dialog-en-light.png') });
await page.click(tid('edt-submit'));
await page.waitForSelector(tid('edt-message-dialog'), { state: 'detached' });
check((await heading(page)) === 'EngineStatus', 'the header shows the new name', await heading(page));
check(new URL(page.url()).hash === '#msg=288', 'the deep link follows the new id', new URL(page.url()).hash);
check((await page.locator(tid('edt-unsaved')).count()) === 1, 'the rail marks unsaved edits');
check((await page.locator('.list-pane').innerText()).includes('EngineStatus'), 'the list shows the new name');

// The signal editor, by keyboard: select the row, Tab to the button, Enter.
await page.locator('table.m3 tbody tr', { hasText: 'EngineSpeed' }).click();
await page.locator(tid('edt-edit-signal')).focus();
await page.keyboard.press('Enter');
await page.waitForSelector(tid('edt-signal-dialog'));
await page.keyboard.type('X'); // the name field has the focus
check((await page.inputValue(tid('edt-signal-name'))) === 'EngineSpeedX', 'typing goes to the focused name field');
await page.keyboard.press('Escape');
await page.waitForSelector(tid('edt-signal-dialog'), { state: 'detached' });
check(await page.evaluate(() => document.activeElement?.dataset.testid === 'edt-edit-signal'), 'Escape closes and gives the focus back');
check((await page.locator('.signal-card h2').innerText()) === 'EngineSpeed', 'Escape applies nothing');

await page.click(tid('edt-edit-signal'));
await page.fill(tid('edt-signal-start'), '600');
await page.click(tid('edt-submit'));
const startError = await page.locator(`${tid('edt-signal-dialog')} .field-help.error`).innerText();
check(startError === 'Enter a whole number from 0 to 511.', 'an invalid start bit is explained', startError);
await page.fill(tid('edt-signal-start'), '0');
await page.waitForSelector(`${tid('edt-signal-dialog')} .field-help.error`, { state: 'detached' });
await page.fill(tid('edt-signal-factor'), '0,5');
await page.fill(tid('edt-signal-unit'), 'U/min');
await page.click(tid('edt-signal-receiver-ABS'));
await page.screenshot({ path: join(outDir, 'signal-dialog-en-light.png') });
await page.click(tid('edt-submit'));
await page.waitForSelector(tid('edt-signal-dialog'), { state: 'detached' });
const row = await page.locator('table.m3 tbody tr', { hasText: 'EngineSpeed' }).innerText();
check(/\b0\.5\b/.test(row) && row.includes('U/min') && !row.includes('ABS'), 'the signal table shows the edit', row.replace(/\s+/g, ' '));

const [download] = await Promise.all([page.waitForEvent('download'), page.click(tid('edt-save-dbc'))]);
const savedPath = join(outDir, 'saved.dbc');
await download.saveAs(savedPath);
const saved = readFileSync(savedPath, 'utf8');
check(download.suggestedFilename() === 'demo.dbc', 'the download is named after the file', download.suggestedFilename());
check(saved.includes('BO_ 288 EngineStatus: 8 ECM\n'), 'the saved file holds the edited message');
check(saved.includes(' SG_ EngineSpeed : 0|16@1+ (0.5,0) [0|16383.75] "U/min" TCM,IC\n'), 'the saved file holds the edited signal');
check(saved.includes('CM_ BO_ 288 "Edited in CanViewer.";'), 'the saved file holds the edited comment');
check((await page.locator(tid('edt-unsaved')).count()) === 0, 'saving clears the unsaved mark');
check((await page.locator('.snackbar').innerText()).includes('Saved demo.dbc'), 'a snackbar confirms the save');

// Open what was saved: the edits come back through the parser.
await openFile(page, savedPath, 'saved.dbc');
await page.getByRole('button', { name: 'Messages', exact: true }).click();
check((await heading(page)) === 'EngineStatus', 'the saved file opens with the edited message', await heading(page));
const reopened = await page.locator('table.m3 tbody tr', { hasText: 'EngineSpeed' }).innerText();
check(/\b0\.5\b/.test(reopened) && reopened.includes('U/min'), 'the saved file opens with the edited signal');
const overview = await page.getByRole('button', { name: 'Overview', exact: true }).click().then(() => page.locator('.main').innerText());
check(overview.includes('Parsed without problems.'), 'the saved file parses without problems');

// Unsaved edits are guarded: another file asks first, and so does leaving.
await page.getByRole('button', { name: 'Messages', exact: true }).click();
await page.click(tid('edt-edit-message'));
await page.fill(tid('edt-message-dlc'), '6');
await page.click(tid('edt-submit'));
let asked = '';
page.once('dialog', (d) => {
  asked = d.message();
  void d.dismiss();
});
await page.setInputFiles('input[type=file]', dbcPath);
await page.waitForTimeout(300);
check(asked === 'Discard the unsaved edits to saved.dbc?', 'opening another file asks first', asked);
check((await page.locator('.facts').innerText()).includes('6 B'), 'declining keeps the edits');
let unload = '';
page.once('dialog', (d) => {
  unload = d.type();
  void d.accept();
});
const closed = page.waitForEvent('close');
await page.close({ runBeforeUnload: true });
await closed;
check(unload === 'beforeunload', 'leaving the page asks first', unload);

// ---- German, dark, 390 px wide ----
// A narrow window, not phone emulation: with the list pane open the app shell
// is wider than 390 px, which on a phone widens the layout viewport past the
// screen (the narrow layout is audited separately).
const narrow = await newPage({ viewport: { width: 390, height: 844 } }, () => {
  localStorage.setItem('canviewer.lang', 'de');
  localStorage.setItem('canviewer.theme', 'dark');
});
await narrow.goto(appUrl);
await narrow.waitForSelector('.welcome');
await openFile(narrow, dbcPath, 'demo.dbc');
await narrow.goto(`${appUrl}#msg=256/EngineSpeed`);
await narrow.reload();
await narrow.waitForSelector(tid('edt-edit-message'));
check((await narrow.locator(tid('edt-edit-message')).innerText()) === 'Botschaft bearbeiten', 'the message button speaks German');
check((await narrow.locator(tid('edt-edit-signal')).innerText()) === 'Signal bearbeiten', 'the signal button speaks German');
check((await narrow.getAttribute(tid('edt-save-dbc'), 'aria-label')) === 'Als DBC speichern', 'the save button speaks German');
await narrow.click(tid('edt-edit-message'));
await narrow.waitForSelector(tid('edt-message-dialog'));
check((await narrow.locator(`${tid('edt-message-dialog')} h2`).innerText()) === 'Botschaft EngineData bearbeiten', 'the message dialog speaks German');
check(await fitsWindow(narrow, tid('edt-message-dialog')), 'the message dialog fits a 390 px window');
await narrow.screenshot({ path: join(outDir, 'message-dialog-de-dark-390.png') });
await narrow.click(tid('edt-cancel'));
await narrow.click(tid('edt-edit-signal'));
await narrow.waitForSelector(tid('edt-signal-dialog'));
check(await fitsWindow(narrow, tid('edt-signal-dialog')), 'the signal dialog fits a 390 px window');
check((await narrow.locator(tid('edt-signal-dialog')).innerText()).includes('Empfänger'), 'the signal dialog speaks German');
await narrow.screenshot({ path: join(outDir, 'signal-dialog-de-dark-390.png') });
await narrow.click(tid('edt-cancel'));
await narrow.context().close();

// ---- Save anyway: an imported-style database the writer cannot hold as it is ----
const issues = await newPage({ viewport: { width: 1280, height: 860 } }, () => localStorage.setItem('canviewer.lang', 'en'));
await issues.goto(appUrl);
await issues.waitForSelector('.welcome');
const oddPath = join(outDir, 'odd.dbc');
// A BA_ value written before its ENUM definition stays a number, which the
// writer would put after the definition, where it reads back as a label.
writeFileSync(
  oddPath,
  'BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\nBA_ "Kind" BO_ 1 1;\nBA_DEF_ BO_ "Kind" ENUM "Off","On";\n',
);
await openFile(issues, oddPath, 'odd.dbc');
await issues.click(tid('edt-save-dbc'));
await issues.waitForSelector(tid('edt-issues-dialog'));
const issueText = await issues.locator(`${tid('edt-issues-dialog')} li`).allInnerTexts();
check(
  issueText.length === 1 && issueText[0].includes('BO_ 1 M') && issueText[0].includes('read back as an enum label'),
  'Save as DBC lists what DBC cannot hold',
  issueText.join(' | '),
);
await issues.screenshot({ path: join(outDir, 'issues-dialog-en-light.png') });
await issues.click(tid('edt-cancel'));
check((await issues.locator(tid('edt-issues-dialog')).count()) === 0, 'Cancel closes the issue list without saving');
await issues.context().close();
await browser.close();

const foreign = requests.filter((u) => !u.startsWith(origin + '/') && !u.startsWith('data:') && !u.startsWith('blob:'));
check(foreign.length === 0, `requests outside ${origin}: ${foreign.length}`, foreign.slice(0, 5).join(', '));
check(errors.length === 0, `page errors: ${errors.length}`, errors.slice(0, 3).join(' | '));
console.log(`\n${requests.length} requests, ${failures} failed check(s)`);
process.exit(failures === 0 ? 0 : 1);
