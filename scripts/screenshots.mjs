// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots for the documentation, taken from a running build in Chromium,
// so that the images in docs/guide/images/ show the app as it is.
//
// Every shot is taken in the variants it lists: English and German, light and
// dark. The images are WebP (encoded by Chromium itself, so no image library
// is needed), of a 1280 × 800 viewport (wider where a shot says so) at a
// device scale of 1, or of one element of it.
//
// Usage (Playwright is a dev dependency; fetch its Chromium once with
// `npx playwright install chromium`):
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/screenshots.mjs http://localhost:4173/ [--out <dir>] [--all] [--only <name>,…]
//
//   --out   where to write the images (default: docs/guide/images)
//   --all   every shot in all four variants, not only the ones the site uses
//   --only  only these shots
//
// Some shots need the corpus submodules (git submodule update --init); they
// are skipped with a note when the file is missing.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const DEMO = join(root, 'examples/demo.dbc');
const ARXML = join(root, 'third_party/canmatrix/tests/files/arxml/test.arxml');
const PROBLEMS = join(root, 'third_party/opendbc/opendbc/dbc/vw_mqb.dbc');

const EN = [['en', 'light'], ['en', 'dark']];
const BOTH = [...EN, ['de', 'light'], ['de', 'dark']];

/**
 * The shots. `file` is opened through the app's file input, `hash` is the deep
 * link shown after a reload (the app restores the last DBC file), `run` sets up
 * the view, `clip` picks one element instead of the viewport.
 */
const SHOTS = [
  { name: 'welcome', variants: EN },
  { name: 'overview', file: DEMO, variants: BOTH },
  { name: 'message', file: DEMO, hash: '#msg=256/EngineSpeed', variants: BOTH },
  {
    name: 'decoder',
    file: DEMO,
    hash: '#msg=256/EngineSpeed',
    run: (page) => page.fill('.text-field input', 'E0 2E 82 3C 90 81 0C 01'),
    clip: '.row',
    variants: EN,
  },
  // Wider, so that the signal table shows all its columns.
  { name: 'signals', file: DEMO, hash: '#msg=1024/SensorVoltage', clip: '.table-card', width: 1680, variants: EN },
  { name: 'j1939', file: DEMO, hash: '#msg=2364539904', variants: EN },
  {
    name: 'network',
    file: DEMO,
    hash: '#graph',
    run: (page) => page.locator('.ng-node', { has: page.locator('title', { hasText: /^ECM$/ }) }).click(),
    variants: EN,
  },
  { name: 'nodes', file: DEMO, hash: '#node=ECM', variants: EN },
  { name: 'tables', file: DEMO, hash: '#vt=GearPositions', variants: EN },
  { name: 'problems', file: PROBLEMS, variants: EN },
  { name: 'import', file: ARXML, variants: EN },
];

const args = process.argv.slice(2);
const appUrl = args.find((a) => /^https?:/.test(a));
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = option('--out') ?? join(root, 'docs/guide/images');
const all = args.includes('--all');
const only = option('--only')?.split(',');
if (!appUrl) {
  console.error('usage: node scripts/screenshots.mjs <app-url> [--out <dir>] [--all] [--only <name>,…]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  // Nothing may leave the machine, the screenshots included.
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
});

/** PNG to WebP, by Chromium's own encoder in a blank page. */
const encoder = await browser.newPage();
async function toWebp(png) {
  const dataUrl = await encoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.82);
  }, png.toString('base64'));
  if (!dataUrl.startsWith('data:image/webp;')) throw new Error('this Chromium cannot encode WebP');
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Open a file through the app's own file input and wait until it is shown. */
async function open(page, file) {
  await page.setInputFiles('input[type=file]', file);
  const name = file.split('/').pop();
  await page.waitForFunction(
    (n) => document.title.startsWith(n + ' ') || document.querySelector('[role=alert]'),
    name,
    { timeout: 120_000 },
  );
  if (await page.locator('[role=alert]').count()) {
    throw new Error(`could not open ${name}: ${await page.locator('[role=alert]').textContent()}`);
  }
}

let written = 0;
let bytes = 0;
const foreign = [];
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  if (shot.file && !existsSync(shot.file)) {
    console.log(`skipped ${shot.name}: ${shot.file.slice(root.length)} is missing (git submodule update --init)`);
    continue;
  }
  for (const [lang, theme] of all ? BOTH : shot.variants) {
    const context = await browser.newContext({
      viewport: { width: shot.width ?? 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: theme,
      locale: lang === 'de' ? 'de-DE' : 'en-US',
      reducedMotion: 'reduce',
      // The app registers its service worker only to cache itself; it would not change a screenshot.
      serviceWorkers: 'block',
    });
    context.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith(new URL(appUrl).origin + '/') && !/^(data|blob):/.test(url)) foreign.push(url);
    });
    await context.addInitScript(
      ([l, t]) => {
        if (sessionStorage.getItem('screenshots.init')) return;
        sessionStorage.setItem('screenshots.init', '1');
        localStorage.clear();
        localStorage.setItem('canviewer.lang', l);
        localStorage.setItem('canviewer.theme', t);
      },
      [lang, theme],
    );
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForSelector('.welcome');
    if (shot.file) {
      await open(page, shot.file);
      if (shot.hash) {
        // The app reads the deep link when it starts, so set it and reload.
        await page.goto(new URL(shot.hash, appUrl).href);
        await page.reload();
        await page.waitForSelector('.page-header');
      }
    }
    await shot.run?.(page);
    await page.evaluate(() => document.fonts.ready);
    // Let transitions (hover states, the snackbar) settle.
    await page.waitForTimeout(400);
    const png = shot.clip
      ? await page.locator(shot.clip).first().screenshot({ animations: 'disabled' })
      : await page.screenshot({ animations: 'disabled' });
    const path = join(outDir, `${shot.name}-${lang}-${theme}.webp`);
    writeFileSync(path, await toWebp(png));
    const size = statSync(path).size;
    written += 1;
    bytes += size;
    console.log(`${relative(root, path)} ${size} bytes`);
    await context.close();
  }
}
await browser.close();
console.log(`${written} screenshots, ${bytes} bytes; requests outside ${new URL(appUrl).origin}: ${foreign.length}`);
for (const url of foreign) console.log(`  FOREIGN ${url}`);
process.exitCode = foreign.length === 0 ? 0 : 1;
