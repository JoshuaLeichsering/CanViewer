// SPDX-License-Identifier: GPL-2.0-or-later
// Large database check: with 5000 messages the message list and the overview
// stay responsive.
//
// Generates a DBC of 5000 messages (2000 standard and 3000 extended frames,
// every 25th a 64-byte CAN FD frame, 4 signals each), and the first 1000 of
// them as a second file, and drives a production build in Chromium at 1280 x 800:
//
//   open      open the file, then go to the message list; the list renders only
//             the rows in view (it virtualizes above 1000 messages)
//   wheel     scroll the list with the mouse wheel; every frame's interval, and
//             frames where the top or bottom of the list shows no row (blank)
//   jump      jump to positions across the list; time until the second frame
//             after the jump, and that the right message is at the top
//   focus     focus a row and scroll it out of view with the wheel: the row
//             keeps the focus, and Tab and Shift+Tab move on to its neighbours;
//             End and Home move the focus to the last and the first row, which
//             were not rendered before the key
//   search    type searches key by key; time from each key press to the frame
//             after it (in the page), plus the browser's own Event Timing entries
//   chips     switch the Extended, CAN FD and All filter chips the same way
//   overview  back to the overview, whose message table shows 200 messages a
//             page above 1000 messages
//   page      go to the last page of that table
//   reveal    open the last message from the overview table; the list scrolls to it
//   threshold open a database of exactly 1000 messages, which the list renders in
//             full and the overview shows on one page; opening its last message
//             from the overview scrolls the list to it as well
//
// Writes everything to <out-dir>/large-database.json, takes screenshots, and
// exits non-zero if a budget below is exceeded or the page logs an error.
//
// Usage (Playwright must be installed; it is not a dependency of the app):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   NODE_PATH=$(npm root -g) node e2e/large-database.mjs http://localhost:4173/ <out-dir> [cpu-slowdown]
// cpu-slowdown (for example 4) runs the page on a CPU that many times slower
// (Chromium's CPU throttling), to see how much headroom the budgets leave.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// require() rather than import, so that a global install found via NODE_PATH works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , appUrl, outDir, slowdownArg] = process.argv;
const slowdown = Number(slowdownArg ?? 1);
if (!appUrl || !outDir) {
  console.error('usage: node e2e/large-database.mjs <app-url> <out-dir> [cpu-slowdown]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

/**
 * Budgets, generous on purpose: CI runners are slower than a workstation, and
 * the point is to catch a list that renders every row again (thousands of
 * rows, hundreds of milliseconds per key), not a few milliseconds of noise.
 * 200 ms is the "good" bound of Interaction to Next Paint.
 */
const BUDGET = {
  renderedRows: 100,
  keyMs: 200,
  chipMs: 200,
  jumpMs: 150,
  wheelFrameP95Ms: 50,
  blankFrames: 0,
  /** Longest main-thread task while scrolling, jumping, moving the focus, searching, switching chips or pages. */
  longTaskMs: 100,
  /**
   * Longest main-thread task when the whole view changes (to the message list,
   * back to the overview, opening a message from it), which lays out a new page
   * whatever the database's size. Rendering all 5000 rows of the overview took 600 ms.
   */
  viewLongTaskMs: 200,
  /** Rows of the overview's message table on one page. */
  overviewRows: 200,
  pageMs: 200,
};

const COUNT = 5000;
const SIGNALS = 4;
const pad = (i) => String(i).padStart(4, '0');
const FILE = `large-${COUNT}.dbc`;
/** The largest database whose list renders every row and whose overview has one page. */
const THRESHOLD = 1000;

function generateDbc(count) {
  const nodes = Array.from({ length: 20 }, (_, i) => `ECU${String(i).padStart(2, '0')}`);
  const lines = [`VERSION "generated, ${count} messages"`, '', 'NS_ :', '', 'BS_:', '', `BU_: ${nodes.join(' ')}`, ''];
  const cycles = [];
  for (let i = 0; i < count; i++) {
    const extended = i >= 2000;
    const id = extended ? 0x10000 + i : i;
    const rawId = extended ? (id | 0x80000000) >>> 0 : id;
    const fd = i % 25 === 24;
    lines.push(`BO_ ${rawId} Msg_${pad(i)}: ${fd ? 64 : 8} ${nodes[i % nodes.length]}`);
    for (let k = 0; k < SIGNALS; k++) {
      lines.push(` SG_ M${pad(i)}_Sig${k} : ${k * 16}|16@1+ (0.1,0) [0|6553.5] "km/h" ${nodes[(i + 1) % nodes.length]}`);
    }
    lines.push('');
    cycles.push(`BA_ "GenMsgCycleTime" BO_ ${rawId} ${10 * (1 + (i % 10))};`);
  }
  lines.push('BA_DEF_ BO_ "GenMsgCycleTime" INT 0 10000;', 'BA_DEF_DEF_ "GenMsgCycleTime" 0;', ...cycles, '');
  return lines.join('\n');
}

const dbcPath = join(outDir, FILE);
const dbcText = generateDbc(COUNT);
writeFileSync(dbcPath, dbcText);
const thresholdPath = join(outDir, `large-${THRESHOLD}.dbc`);
writeFileSync(thresholdPath, generateDbc(THRESHOLD));

const results = { url: appUrl, file: FILE, bytes: Buffer.byteLength(dbcText), cpuSlowdown: slowdown, budget: BUDGET };
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (n) => Math.round(n * 10) / 10;
  return sorted.length === 0
    ? { n: 0 }
    : { n: sorted.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]) };
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// The browser's own interaction timings (Event Timing API) and long tasks.
await context.addInitScript(() => {
  window.__events = [];
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__events.push({ name: e.name, duration: e.duration, interactionId: e.interactionId, start: e.startTime });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // An engine without these entry types: the in-page timings still work.
  }
});
const page = await context.newPage();
if (slowdown > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
  console.log(`CPU slowed down ${slowdown} times`);
}
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const say = (line) => console.log(line);
/** Marks the start of a phase, so the browser's own timings can be attributed to it. */
const phase = (name) => page.evaluate((n) => performance.mark(`phase:${n}`), name);

// --- open ---------------------------------------------------------------
await page.goto(appUrl);
await phase('open');
let t0 = Date.now();
await page.setInputFiles('input[type=file]', dbcPath);
await page.waitForFunction((name) => document.title.startsWith(name + ' '), FILE, { timeout: 60_000 });
results.openMs = Date.now() - t0;

await phase('to the message list');
t0 = Date.now();
await page.getByRole('button', { name: 'Messages', exact: true }).click();
await page.waitForSelector('.list-scroll .list-item.active');
results.toMessagesMs = Date.now() - t0;

results.list = await page.evaluate(() => {
  const s = document.querySelector('.list-scroll');
  return {
    label: document.querySelector('.list-label').textContent,
    renderedRows: s.querySelectorAll('.list-item').length,
    virtual: s.matches('[data-testid=tbl-virtual-list]'),
    scrollHeight: s.scrollHeight,
    clientHeight: s.clientHeight,
  };
});
say(`open ${FILE} (${results.bytes} bytes): ${results.openMs} ms; to the message list: ${results.toMessagesMs} ms`);
say(`list: "${results.list.label}", ${results.list.renderedRows} rows rendered, scrollHeight ${results.list.scrollHeight} px`);
check(results.list.label.includes(String(COUNT)), `the list label shows ${COUNT} messages`);
check(results.list.renderedRows <= BUDGET.renderedRows, `at most ${BUDGET.renderedRows} rows rendered (got ${results.list.renderedRows})`);

// --- wheel --------------------------------------------------------------
await phase('wheel');
const box = await page.locator('.list-scroll').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.evaluate(() => {
  const s = document.querySelector('.list-scroll');
  const r = s.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const isRow = (y) => Boolean(document.elementFromPoint(x, y)?.closest('.list-item'));
  const f = { intervals: [], blank: 0, stop: false, longTasksBefore: window.__longTasks.length };
  window.__frames = f;
  let last = performance.now();
  const tick = (t) => {
    f.intervals.push(t - last);
    last = t;
    if (!isRow(r.top + 4) || !isRow(r.bottom - 16)) f.blank++;
    if (!f.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
// 90 steps of 600 px down (900 rows), then 30 steps of 300 px back up.
const WHEEL_STEPS = 120;
for (let i = 0; i < WHEEL_STEPS; i++) {
  await page.mouse.wheel(0, i < 90 ? 600 : -300);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(300);
const wheel = await page.evaluate(() => {
  const f = window.__frames;
  f.stop = true;
  const s = document.querySelector('.list-scroll');
  return {
    intervals: f.intervals.slice(1),
    blank: f.blank,
    longTasks: window.__longTasks.slice(f.longTasksBefore).map((t) => Math.round(t.duration)),
    scrollTop: s.scrollTop,
    renderedRows: s.querySelectorAll('.list-item').length,
  };
});
results.wheel = {
  steps: WHEEL_STEPS,
  frames: stats(wheel.intervals),
  blankFrames: wheel.blank,
  longTasksMs: wheel.longTasks,
  endScrollTop: wheel.scrollTop,
  renderedRows: wheel.renderedRows,
};
await page.screenshot({ path: join(outDir, 'large-wheel.png') });
say(
  `wheel: ${WHEEL_STEPS} steps to scrollTop ${wheel.scrollTop}; frame interval ms ${JSON.stringify(results.wheel.frames)}; ` +
    `blank frames ${wheel.blank}; long tasks ${JSON.stringify(wheel.longTasks)}; rows rendered ${wheel.renderedRows}`,
);
check(wheel.scrollTop === 90 * 600 - 30 * 300, 'the wheel scrolled the list by every step');
check(results.wheel.frames.p95 <= BUDGET.wheelFrameP95Ms, `wheel frame interval p95 <= ${BUDGET.wheelFrameP95Ms} ms`);
check(wheel.blank <= BUDGET.blankFrames, `no blank frames while scrolling (got ${wheel.blank})`);
check(wheel.renderedRows <= BUDGET.renderedRows, `at most ${BUDGET.renderedRows} rows rendered while scrolling`);

// --- jump ---------------------------------------------------------------
await phase('jump');
results.jumps = [];
for (const fraction of [0.1, 0.5, 0.9, 1, 0.25, 0]) {
  const jump = await page.evaluate(async (fraction) => {
    const s = document.querySelector('.list-scroll');
    const start = performance.now();
    s.scrollTop = Math.round(fraction * (s.scrollHeight - s.clientHeight));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ms = performance.now() - start;
    const r = s.getBoundingClientRect();
    const probe = 2;
    const row = document.elementFromPoint(r.left + r.width / 2, r.top + probe)?.closest('.list-item');
    const height = row ? row.getBoundingClientRect().height : 0;
    return {
      fraction,
      scrollTop: s.scrollTop,
      ms: Math.round(ms * 10) / 10,
      top: row?.querySelector('.title')?.textContent ?? null,
      expected: height ? `Msg_${String(Math.floor((s.scrollTop + probe) / height)).padStart(4, '0')}` : null,
    };
  }, fraction);
  results.jumps.push(jump);
  say(`jump to ${fraction * 100} %: ${jump.ms} ms, top row ${jump.top} (expected ${jump.expected})`);
  check(jump.top !== null && jump.top === jump.expected, `after a jump to ${fraction * 100} % the right row is at the top`);
  check(jump.ms <= BUDGET.jumpMs, `jump to ${fraction * 100} % painted within ${BUDGET.jumpMs} ms`);
}

// --- focus: a focused row stays rendered when it scrolls out of view ----------
await phase('focus');
/** The focused element: a row's title, whether it is inside the list's viewport, and the rows rendered. */
const focusState = () =>
  page.evaluate(() => {
    const s = document.querySelector('.list-scroll');
    const a = document.activeElement;
    const view = s.getBoundingClientRect();
    const box = a.getBoundingClientRect();
    return {
      focused: a.closest('.list-item')?.querySelector('.title')?.textContent ?? a.tagName,
      inView: box.bottom > view.top && box.top < view.bottom,
      renderedRows: s.querySelectorAll('.list-item').length,
    };
  });
const wheelAway = async (steps, dy) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(200);
};
await page.locator('.list-scroll .list-item', { hasText: 'Msg_0003' }).focus();
const focusBefore = await focusState();
await wheelAway(20, 600);
const focusAway = await focusState();
await page.keyboard.press('Tab');
await page.waitForTimeout(100);
const focusTab = await focusState();
await wheelAway(20, 600);
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(100);
const focusBack = await focusState();
// Once the focus is elsewhere, the row is rendered only while it is in view again.
await page.locator('.search-field input').focus();
await wheelAway(20, 600);
const released = await page.evaluate(() => ({
  kept: [...document.querySelectorAll('.list-scroll .list-item .title')].some((t) => t.textContent === 'Msg_0003'),
  renderedRows: document.querySelectorAll('.list-scroll .list-item').length,
}));
await page.evaluate(() => {
  document.querySelector('.list-scroll').scrollTop = 0;
});
results.focus = { before: focusBefore, scrolledAway: focusAway, tab: focusTab, shiftTabAfterScrollingAway: focusBack, released };
say(
  `focus: ${focusBefore.focused}; after 20 wheel steps away ${JSON.stringify(focusAway)}; Tab ${JSON.stringify(focusTab)}; ` +
    `scrolled away again, Shift+Tab ${JSON.stringify(focusBack)}; focus in the search, scrolled away ${JSON.stringify(released)}`,
);
check(!released.kept, 'a row that no longer has the focus is not kept rendered out of view');
check(focusBefore.focused === 'Msg_0003', 'a message row takes the focus');
check(focusAway.focused === 'Msg_0003' && !focusAway.inView, 'the focused row keeps the focus when it is scrolled out of view');
check(focusAway.renderedRows <= BUDGET.renderedRows, `at most ${BUDGET.renderedRows} rows rendered with a focused row out of view`);
check(focusTab.focused === 'Msg_0004' && focusTab.inView, 'Tab moves from the focused row to the next one and scrolls it into view');
check(focusBack.focused === 'Msg_0003' && focusBack.inView, 'Shift+Tab moves to the previous row and scrolls it into view');

// End and Home (W6's list keys) reach rows the virtual list had not rendered.
await page.waitForTimeout(100);
await page.locator('.list-scroll .list-item', { hasText: 'Msg_0003' }).focus();
await page.keyboard.press('End');
await page.waitForTimeout(100);
const focusEnd = await focusState();
await page.keyboard.press('Home');
await page.waitForTimeout(100);
const focusHome = await focusState();
results.focus.end = focusEnd;
results.focus.home = focusHome;
say(`focus: End ${JSON.stringify(focusEnd)}; Home ${JSON.stringify(focusHome)}`);
check(focusEnd.focused === `Msg_${pad(COUNT - 1)}` && focusEnd.inView, 'End moves the focus to the last row and scrolls it into view');
check(focusEnd.renderedRows <= BUDGET.renderedRows, `at most ${BUDGET.renderedRows} rows rendered after End`);
check(focusHome.focused === 'Msg_0000' && focusHome.inView, 'Home moves the focus to the first row and scrolls it into view');

// --- search and chips: time from each key press or click to the frame after it ---
await page.evaluate(() => {
  window.__inputs = [];
  const measure = (e) => {
    const start = e.timeStamp;
    requestAnimationFrame(() => {
      // A task queued in the frame's rAF runs after that frame is painted.
      const channel = new MessageChannel();
      channel.port1.onmessage = () =>
        window.__inputs.push({ type: e.type, key: e.key ?? null, ms: Math.round((performance.now() - start) * 10) / 10 });
      channel.port2.postMessage(0);
    });
  };
  document.addEventListener('keydown', measure, true);
  document.addEventListener('pointerdown', measure, true);
});
const takeInputs = () =>
  page.evaluate(() => {
    const taken = window.__inputs;
    window.__inputs = [];
    return taken;
  });
const label = () => page.locator('.list-label').textContent();

await phase('search');
const search = page.locator('.search-field input');
await search.click();
await takeInputs();
results.searches = [];
const queries = [
  { text: 'Msg_4321', expect: `1 / ${COUNT}`, first: 'Msg_4321' },
  { text: 'Sig3', expect: `${COUNT} / ${COUNT}`, first: 'Msg_0000' },
  { text: 'M12', expect: `100 / ${COUNT}`, first: 'Msg_1200' },
  { text: '0x7CF', expect: `1 / ${COUNT}`, first: 'Msg_1999' },
];
for (const q of queries) {
  await page.keyboard.type(q.text, { delay: 50 });
  await page.waitForFunction((e) => document.querySelector('.list-label').textContent.includes(e), q.expect);
  await page.waitForTimeout(100);
  const typed = await takeInputs();
  const shown = await label();
  const first = await page.locator('.list-scroll .list-item .title').first().textContent();
  if (q === queries[0]) await page.screenshot({ path: join(outDir, 'large-search.png') });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForFunction((n) => document.querySelector('.list-label').textContent === `Messages · ${n}`, COUNT);
  await page.waitForTimeout(100);
  const cleared = await takeInputs();
  const keys = typed.filter((i) => i.type === 'keydown').map((i) => i.ms);
  const clearKeys = cleared.filter((i) => i.type === 'keydown').map((i) => i.ms);
  const row = { query: q.text, label: shown, first, keysMs: keys, clearMs: clearKeys, worstMs: Math.max(...keys, ...clearKeys) };
  results.searches.push(row);
  say(`search "${q.text}": "${shown}", first ${first}; per key ms ${JSON.stringify(keys)}; select all + delete ms ${JSON.stringify(clearKeys)}`);
  check(shown.includes(q.expect), `search "${q.text}" shows ${q.expect}`);
  check(first === q.first, `search "${q.text}" lists ${q.first} first (got ${first})`);
  check(row.worstMs <= BUDGET.keyMs, `every key of search "${q.text}" painted within ${BUDGET.keyMs} ms (worst ${row.worstMs})`);
}

await phase('chips');
results.chips = [];
for (const [name, expect] of [
  ['Extended', `3000 / ${COUNT}`],
  ['CAN FD', `200 / ${COUNT}`],
  ['All', `Messages · ${COUNT}`],
]) {
  await page.getByRole('radio', { name }).click();
  await page.waitForFunction((e) => document.querySelector('.list-label').textContent.includes(e), expect);
  await page.waitForTimeout(100);
  const clicks = (await takeInputs()).filter((i) => i.type === 'pointerdown').map((i) => i.ms);
  results.chips.push({ chip: name, label: await label(), ms: clicks });
  say(`chip ${name}: "${await label()}", ms ${JSON.stringify(clicks)}`);
  check(clicks.length === 1 && clicks[0] <= BUDGET.chipMs, `chip ${name} painted within ${BUDGET.chipMs} ms`);
}

// --- overview and page: the overview's message table shows a page at a time ----
await phase('overview');
await page.getByRole('button', { name: 'Overview', exact: true }).click();
await page.waitForSelector('table.m3 tbody tr.clickable');
/** Rows of the overview's message table: count, first and last name, and the pager's range (null without a pager). */
const overviewTable = () =>
  page.evaluate(() => {
    const card = [...document.querySelectorAll('.card.table-card')].find((c) => c.querySelector('h2')?.textContent === 'Messages');
    const rows = card.querySelectorAll('tbody tr.clickable');
    const name = (row) => row?.querySelector('.strong')?.firstChild?.textContent ?? null;
    return {
      rows: rows.length,
      first: name(rows[0]),
      last: name(rows[rows.length - 1]),
      range: card.querySelector('[data-testid=tbl-pager] .tbl-pager-range')?.textContent ?? null,
    };
  });
results.overview = await overviewTable();
say(`overview: ${JSON.stringify(results.overview)}`);
check(results.overview.rows === BUDGET.overviewRows, `the overview's message table renders ${BUDGET.overviewRows} rows (got ${results.overview.rows})`);
check(results.overview.range === `1–200 of ${COUNT}` && results.overview.first === 'Msg_0000', 'the overview starts on its first page');

await phase('page');
await takeInputs();
await page.getByRole('button', { name: 'Last page', exact: true }).click();
await page.waitForFunction(
  (e) => document.querySelector('[data-testid=tbl-pager] .tbl-pager-range')?.textContent === e,
  `4801–5000 of ${COUNT}`,
);
await page.waitForTimeout(100);
const pageClicks = (await takeInputs()).filter((i) => i.type === 'pointerdown').map((i) => i.ms);
results.page = { ...(await overviewTable()), ms: pageClicks };
await page.screenshot({ path: join(outDir, 'large-overview-last-page.png') });
say(`last page: ${JSON.stringify(results.page)}`);
check(results.page.last === `Msg_${pad(COUNT - 1)}` && results.page.rows === BUDGET.overviewRows, 'the last page ends with the last message');
check(pageClicks.length === 1 && pageClicks[0] <= BUDGET.pageMs, `the last page painted within ${BUDGET.pageMs} ms`);

// --- reveal: open the last message from the overview -----------------------
await phase('reveal');
await page.locator('table.m3 tbody tr.clickable', { hasText: `Msg_${pad(COUNT - 1)}` }).click();
await page.waitForSelector('.list-scroll .list-item.active');
/** The active row of the list, the detail heading, whether the row is inside the list's viewport, and how the list renders. */
const revealState = () =>
  page.evaluate(() => {
    const scroller = document.querySelector('.list-scroll');
    const s = scroller.getBoundingClientRect();
    const active = document.querySelector('.list-scroll .list-item.active');
    const a = active.getBoundingClientRect();
    return {
      active: active.querySelector('.title').textContent,
      heading: document.querySelector('.page-header h1')?.textContent,
      inView: a.top >= s.top - 0.5 && a.bottom <= s.bottom + 0.5,
      virtual: scroller.matches('[data-testid=tbl-virtual-list]'),
      renderedRows: scroller.querySelectorAll('.list-item').length,
    };
  });
results.reveal = await revealState();
await page.screenshot({ path: join(outDir, 'large-reveal.png') });
say(`reveal: active row ${results.reveal.active}, detail "${results.reveal.heading}", in view: ${results.reveal.inView}`);
check(results.reveal.active === `Msg_${pad(COUNT - 1)}` && results.reveal.inView, 'the list scrolls to a message opened elsewhere');

// --- threshold: the same with 1000 messages, where nothing is virtual or paged ---
await phase('threshold');
await page.setInputFiles('input[type=file]', thresholdPath);
await page.waitForFunction((name) => document.title.startsWith(name + ' '), `large-${THRESHOLD}.dbc`, { timeout: 60_000 });
await page.waitForSelector('table.m3 tbody tr.clickable');
results.threshold = { overview: await overviewTable() };
await page.locator('table.m3 tbody tr.clickable', { hasText: `Msg_${pad(THRESHOLD - 1)}` }).click();
await page.waitForSelector('.list-scroll .list-item.active');
results.threshold.reveal = await revealState();
say(`threshold, ${THRESHOLD} messages: overview ${JSON.stringify(results.threshold.overview)}; reveal ${JSON.stringify(results.threshold.reveal)}`);
check(
  results.threshold.overview.rows === THRESHOLD && results.threshold.overview.range === null,
  `the overview shows all ${THRESHOLD} messages without a pager`,
);
check(
  results.threshold.reveal.active === `Msg_${pad(THRESHOLD - 1)}` &&
    results.threshold.reveal.inView &&
    !results.threshold.reveal.virtual &&
    results.threshold.reveal.renderedRows === THRESHOLD,
  `the full list of ${THRESHOLD} messages scrolls to a message opened elsewhere too`,
);

// --- the browser's view -----------------------------------------------------
// Event Timing reports only interactions of 16 ms or more, rounded to 8 ms;
// long tasks are main-thread tasks of 50 ms or more. Both per phase.
const browserTimings = await page.evaluate(() => ({
  events: window.__events,
  longTasks: window.__longTasks,
  phases: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('phase:')).map((m) => ({ name: m.name.slice(6), start: m.startTime })),
}));
const phaseAt = (time) => [...browserTimings.phases].reverse().find((p) => p.start <= time)?.name ?? 'load';
results.browserTimings = {};
for (const p of ['load', ...browserTimings.phases.map((x) => x.name)]) {
  results.browserTimings[p] = { interactionsOver16Ms: [], longTasksMs: [] };
}
const worst = new Map();
for (const e of browserTimings.events) {
  if (!e.interactionId) continue;
  const prev = worst.get(e.interactionId);
  if (!prev || e.duration > prev.duration) worst.set(e.interactionId, e);
}
for (const e of worst.values()) results.browserTimings[phaseAt(e.start)].interactionsOver16Ms.push(Math.round(e.duration));
for (const t of browserTimings.longTasks) results.browserTimings[phaseAt(t.start)].longTasksMs.push(Math.round(t.duration));
for (const [name, t] of Object.entries(results.browserTimings)) {
  say(`browser timings, ${name}: interactions over 16 ms ${JSON.stringify(t.interactionsOver16Ms)}, long tasks ${JSON.stringify(t.longTasksMs)}`);
}
// Opening a file parses it on the main thread, so the open and threshold phases
// are reported but not budgeted.
for (const [p, budget] of [
  ['to the message list', BUDGET.viewLongTaskMs],
  ['wheel', BUDGET.longTaskMs],
  ['jump', BUDGET.longTaskMs],
  ['focus', BUDGET.longTaskMs],
  ['search', BUDGET.longTaskMs],
  ['chips', BUDGET.longTaskMs],
  ['overview', BUDGET.viewLongTaskMs],
  ['page', BUDGET.longTaskMs],
  ['reveal', BUDGET.viewLongTaskMs],
]) {
  const longTasks = results.browserTimings[p]?.longTasksMs ?? [];
  const longest = Math.max(0, ...longTasks);
  check(longest <= budget, `no task over ${budget} ms during ${p} (long tasks: ${JSON.stringify(longTasks)})`);
}

results.errors = errors;
check(errors.length === 0, `no errors in the page (${errors.join('; ')})`);
results.failures = failures;
writeFileSync(join(outDir, 'large-database.json'), JSON.stringify(results, null, 2));
await browser.close();

if (failures.length > 0) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nlarge database check passed: scrolling and search stay responsive');
