// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * canmatrix under Pyodide in Node, for the test suites. Node only: the app
 * runs the same Python code in a Web Worker instead.
 *
 * Everything is loaded from disk: the runtime from node_modules/pyodide, the
 * wheels from vendor/pyodide (filled by scripts/fetch-wheels.mjs) through the
 * custom lock file, which lists nothing else. `fetch` is replaced while the
 * runtime is in use, so any attempt to reach the network fails loudly and is
 * recorded in `fetchCalls`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { CanmatrixReadResult } from './types';
import lock from './wheels.lock.json';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../..');
const VENDOR_DIR = join(root, 'vendor/pyodide');
const PYODIDE_DIR = join(root, 'node_modules/pyodide');
const ADAPTER = readFileSync(join(here, 'canviewer_adapter.py'), 'utf8');

/** Lock file names missing from vendor/pyodide (empty when all are there). */
export function missingWheels(): string[] {
  return Object.values(lock.packages)
    .map((p) => p.file_name)
    .filter((f) => !existsSync(join(VENDOR_DIR, f)));
}

export interface NodeCanmatrix {
  pyodide: PyodideInterface;
  /** Load any lock entries a format needs (no-op once loaded). */
  loadPackages(names: string[]): Promise<void>;
  read(data: Uint8Array, importType: string): CanmatrixReadResult;
  /** URLs passed to fetch() since start; must stay empty. */
  fetchCalls: string[];
  /** Restore the real fetch. */
  close(): void;
}

export async function startCanmatrix(): Promise<NodeCanmatrix> {
  const fetchCalls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push(url);
    throw new Error(`network access is disabled in tests: ${url}`);
  }) as typeof fetch;

  const quiet = () => {};
  const pyodide = await loadPyodide({
    indexURL: PYODIDE_DIR + '/',
    lockFileContents: JSON.stringify(lock),
    packageBaseUrl: VENDOR_DIR + '/',
    stdout: quiet,
    stderr: quiet,
  });
  const loadPackages = async (names: string[]) => {
    await pyodide.loadPackage(names, { messageCallback: quiet, errorCallback: quiet, checkIntegrity: true });
  };
  await loadPackages(['canmatrix']);
  pyodide.FS.writeFile('/home/pyodide/canviewer_adapter.py', ADAPTER);
  pyodide.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
  const adapter = pyodide.pyimport('canviewer_adapter');

  return {
    pyodide,
    fetchCalls,
    loadPackages,
    read(data, importType) {
      // Pyodide converts plain Uint8Arrays only, not Node's Buffer subclass.
      const result = adapter.read(new Uint8Array(data), importType);
      try {
        return result.toJs({ dict_converter: Object.fromEntries }) as CanmatrixReadResult;
      } finally {
        result.destroy();
      }
    },
    close() {
      globalThis.fetch = realFetch;
    },
  };
}
