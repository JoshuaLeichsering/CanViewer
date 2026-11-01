import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pyodideAssets, pyodideLock, serviceWorker } from './scripts/vite-plugins';

export default defineConfig({
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
});
