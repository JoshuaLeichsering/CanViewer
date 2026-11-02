// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { InlineConfig } from 'vitest/node';
import { favicon, pyodideAssets, pyodideLock, serviceWorker } from './scripts/vite-plugins';
import { legalFiles } from './scripts/vite-legal';

// Vitest 2 brings its own copy of Vite 5 and adds `test` to that copy's config
// type only, so add it to this Vite's as well.
declare module 'vite' {
  interface UserConfig {
    test?: InlineConfig;
  }
}

/** The repository root: config, node_modules, vendor/ and the build output stay here. */
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const { version } = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')) as { version: string };

export default defineConfig({
  // The web app (index.html and src/) lives in app/, see
  // docs/decisions/0001-repository-layout.md. Paths are absolute so that they do
  // not depend on the directory Vite is started from.
  root: fromRoot('app'),
  // .env files, the dependency cache and the build stay at the repository root.
  envDir: repoRoot,
  cacheDir: fromRoot('node_modules/.vite'),
  build: {
    outDir: fromRoot('dist'),
    // dist/ is outside the Vite root, which Vite does not empty unless told to.
    emptyOutDir: true,
  },
  plugins: [react(), pyodideLock(), pyodideAssets(), favicon(), legalFiles({ emit: true }), serviceWorker()],
  // The version the About dialog shows (app/src/app-version.d.ts).
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
  },
  // The import worker uses ES module syntax (pyodide.mjs loads its runtime with
  // a dynamic import), which the default 'iife' worker format cannot hold.
  worker: {
    format: 'es',
    plugins: () => [pyodideLock(), legalFiles({ emit: false })],
  },
  optimizeDeps: {
    // Pyodide locates its own files at run time; esbuild pre-bundling breaks that.
    exclude: ['pyodide'],
  },
  test: {
    // Vitest keeps the repository root as its root, so paths given on its command
    // line (--outputFile, coverage) stay relative to it, and looks for tests in app/.
    root: repoRoot,
    dir: fromRoot('app'),
    // Tests run in Node; the component tests opt into a DOM per file with
    // `// @vitest-environment jsdom`, so the corpus suites never pay for one.
    coverage: {
      // `npm run test:coverage` (CI runs the same). Off by default, so that
      // other runs stay fast.
      provider: 'v8',
      include: ['app/src/**/*.{ts,tsx,js}'],
      exclude: ['app/src/**/*.test.{ts,tsx}', 'app/src/test/**', 'app/src/**/*.d.ts'],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Minimums, enforced whenever coverage runs. The project asks for at least
      // 90 % of the lines in app/src/lib and 80 % overall; these sit higher,
      // but below what the tests reached when they were set, so that losing
      // tests fails the run while new code has some room. They may only rise:
      // never lower them to make a run pass.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
        'app/src/lib/**': { lines: 95, statements: 95, functions: 90, branches: 90 },
      },
    },
  },
});
