// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Web Worker that reads non-DBC files with canmatrix under Pyodide.
 *
 * Started on the first import only. The Pyodide runtime and every wheel come
 * from the app's own origin (`<base>pyodide/`, put there by the Vite plugin in
 * scripts/vite-plugins.ts; the page passes its absolute URL): the lock file
 * passed to loadPyodide lists only the self-hosted wheels, packageBaseUrl
 * points at that same directory, and each wheel is checked against the
 * SHA-256 in the lock. There is no micropip and no CDN fallback, so a missing
 * file fails instead of being fetched elsewhere.
 */
import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { PyProxy } from 'pyodide/ffi';
import adapterSource from './canviewer_adapter.py?raw';
import lock from 'virtual:canviewer-pyodide-lock';
import type { CanmatrixReadResult } from './types';
import type { ImportStage, WorkerReply, WorkerRequest } from './worker-protocol';

interface Runtime {
  pyodide: PyodideInterface;
  adapter: PyProxy & { read(data: Uint8Array, importType: string): PyProxy };
}

const scope = self as unknown as {
  postMessage(message: WorkerReply): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let runtime: Promise<Runtime> | undefined;
let runtimeReady = false;
const loaded = new Set<string>();

// loadPyodide starts fetching the standard library and the WebAssembly module
// before it imports pyodide.asm.mjs, and awaits those fetches only after the
// import. When the import fails (offline before the first import), that error
// goes to the page, and the fetches' rejections are left unhandled: keep these
// duplicates out of the console. Once the runtime is up, nothing is held back.
self.addEventListener('unhandledrejection', (e) => {
  if (!runtimeReady && e.reason instanceof TypeError) e.preventDefault();
});

/**
 * Load packages from the lock. Pyodide reports a package it could not load
 * (offline before it was ever cached, say) to errorCallback and resolves
 * anyway; reject instead, so the import fails at this step and the package
 * is tried again next time.
 */
async function loadPackages(pyodide: PyodideInterface, names: string[]): Promise<void> {
  const errors: string[] = [];
  await pyodide.loadPackage(names, { messageCallback: () => {}, errorCallback: (m) => errors.push(m), checkIntegrity: true });
  if (errors.length) throw new Error(errors.join(' '));
}

function startRuntime(assetsUrl: string): Promise<Runtime> {
  runtime ??= (async () => {
    const quiet = () => {};
    const pyodide = await loadPyodide({
      indexURL: assetsUrl,
      lockFileContents: JSON.stringify(lock),
      packageBaseUrl: assetsUrl,
      stdout: quiet,
      stderr: quiet,
    });
    await loadPackages(pyodide, ['canmatrix']);
    pyodide.FS.writeFile('/home/pyodide/canviewer_adapter.py', adapterSource);
    pyodide.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
    const adapter = pyodide.pyimport('canviewer_adapter') as Runtime['adapter'];
    runtimeReady = true;
    return { pyodide, adapter };
  })();
  // A failed start (offline before the runtime was ever cached, say) must not
  // stick: the next import tries again.
  runtime.catch(() => (runtime = undefined));
  return runtime;
}

scope.onmessage = async (e) => {
  const { id, assetsUrl, bytes, importType, packages } = e.data;
  const t0 = performance.now();
  let stage: ImportStage = 'runtime';
  const enter = (next: ImportStage) => {
    stage = next;
    scope.postMessage({ id, kind: 'stage', stage });
  };
  try {
    enter('runtime');
    const { pyodide, adapter } = await startRuntime(assetsUrl);
    const t1 = performance.now();
    const missing = packages.filter((p) => !loaded.has(p));
    if (missing.length) {
      enter('packages');
      await loadPackages(pyodide, missing);
      missing.forEach((p) => loaded.add(p));
    }
    const t2 = performance.now();
    enter('reading');
    const proxy = adapter.read(new Uint8Array(bytes), importType);
    let result: CanmatrixReadResult;
    try {
      result = proxy.toJs({ dict_converter: Object.fromEntries }) as CanmatrixReadResult;
    } finally {
      proxy.destroy();
    }
    const t3 = performance.now();
    scope.postMessage({
      id,
      kind: 'result',
      result,
      timings: { runtimeMs: t1 - t0, packagesMs: t2 - t1, readMs: t3 - t2 },
    });
  } catch (err) {
    scope.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err), stage });
  }
};
