// SPDX-License-Identifier: GPL-2.0-or-later
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { InlineConfig } from 'vitest/node';
import { pyodideAssets, pyodideLock, serviceWorker } from './scripts/vite-plugins';

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
  plugins: [react(), pyodideLock(), pyodideAssets(), serviceWorker()],
  server: {
    port: 5173,
  },
  // The import worker uses ES module syntax (pyodide.mjs loads its runtime with
  // a dynamic import), which the default 'iife' worker format cannot hold.
  worker: {
    format: 'es',
    plugins: () => [pyodideLock()],
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
  },
});
