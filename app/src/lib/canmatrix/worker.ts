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
import type { WorkerReply, WorkerRequest } from './worker-protocol';

interface Runtime {
  pyodide: PyodideInterface;
  adapter: PyProxy & { read(data: Uint8Array, importType: string): PyProxy };
}

const scope = self as unknown as {
  postMessage(message: WorkerReply): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let runtime: Promise<Runtime> | undefined;
const loaded = new Set<string>();

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
    await pyodide.loadPackage('canmatrix', { messageCallback: quiet, checkIntegrity: true });
    pyodide.FS.writeFile('/home/pyodide/canviewer_adapter.py', adapterSource);
    pyodide.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
    return { pyodide, adapter: pyodide.pyimport('canviewer_adapter') as Runtime['adapter'] };
  })();
  // A failed start (offline before the runtime was ever cached, say) must not
  // stick: the next import tries again.
  runtime.catch(() => (runtime = undefined));
  return runtime;
}

scope.onmessage = async (e) => {
  const { id, assetsUrl, bytes, importType, packages } = e.data;
  const t0 = performance.now();
  try {
    scope.postMessage({ id, kind: 'stage', stage: 'runtime' });
    const { pyodide, adapter } = await startRuntime(assetsUrl);
    const t1 = performance.now();
    const missing = packages.filter((p) => !loaded.has(p));
    if (missing.length) {
      scope.postMessage({ id, kind: 'stage', stage: 'packages' });
      await pyodide.loadPackage(missing, { messageCallback: () => {}, checkIntegrity: true });
      missing.forEach((p) => loaded.add(p));
    }
    const t2 = performance.now();
    scope.postMessage({ id, kind: 'stage', stage: 'reading' });
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
    scope.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
