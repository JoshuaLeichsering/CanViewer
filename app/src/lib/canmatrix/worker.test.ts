// SPDX-License-Identifier: GPL-2.0-or-later
// The import worker's protocol, with Pyodide replaced by a stand-in. The real
// runtime runs in the corpus suites (node-runtime.ts loads the same adapter)
// and, in a browser, in the end-to-end tests and the network check.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkerReply, WorkerRequest } from './worker-protocol';

const py = vi.hoisted(() => {
  const proxy = { toJs: vi.fn(), destroy: vi.fn() };
  const adapter = { read: vi.fn((_data: Uint8Array, _importType: string) => proxy) };
  const pyodide = {
    loadPackage: vi.fn(async () => {}),
    runPython: vi.fn(),
    FS: { writeFile: vi.fn() },
    pyimport: vi.fn(() => adapter),
  };
  return { proxy, adapter, pyodide, loadPyodide: vi.fn(async (_options: Record<string, unknown>) => pyodide) };
});
vi.mock('pyodide', () => ({ loadPyodide: py.loadPyodide }));

const ADAPTER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canviewer_adapter.py'), 'utf8');
const ASSETS = 'http://localhost/app/pyodide/';

/** The worker's global scope: what it posts, and its onmessage handler. */
let posted: WorkerReply[];
let scope: { postMessage(m: WorkerReply): void; onmessage: ((e: MessageEvent<WorkerRequest>) => Promise<void>) | null };

async function freshWorker() {
  vi.resetModules();
  posted = [];
  scope = { postMessage: (m) => posted.push(m), onmessage: null };
  vi.stubGlobal('self', scope);
  await import('./worker');
  expect(scope.onmessage).toBeTypeOf('function');
}

const send = (request: Partial<WorkerRequest> & { id: number }) =>
  scope.onmessage!({
    data: { assetsUrl: ASSETS, bytes: new Uint8Array([1, 2, 3]).buffer, importType: 'arxml', packages: ['lxml'], ...request },
  } as MessageEvent<WorkerRequest>);
const last = () => posted[posted.length - 1];
const kinds = () => posted.map((m) => (m.kind === 'stage' ? `stage:${m.stage}` : m.kind));

beforeEach(async () => {
  vi.clearAllMocks();
  py.loadPyodide.mockImplementation(async () => py.pyodide);
  py.adapter.read.mockImplementation(() => py.proxy);
  py.proxy.toJs.mockReturnValue({ clusters: [], log: [] });
  await freshWorker();
});
afterEach(() => vi.unstubAllGlobals());

describe('import worker', () => {
  it('loads the runtime from the app’s own origin, with the self-hosted lock and integrity checks', async () => {
    await send({ id: 1 });
    expect(py.loadPyodide).toHaveBeenCalledOnce();
    const options = py.loadPyodide.mock.calls[0][0];
    expect(options.indexURL).toBe(ASSETS);
    expect(options.packageBaseUrl).toBe(ASSETS);
    // The lock lists the wheels without their download sources, so the
    // bundle names no other host.
    const lock = JSON.parse(options.lockFileContents as string);
    expect(Object.keys(lock.packages)).toContain('canmatrix');
    expect(options.lockFileContents).not.toMatch(/https?:/);
    expect(py.pyodide.loadPackage).toHaveBeenNthCalledWith(1, 'canmatrix', expect.objectContaining({ checkIntegrity: true }));
    expect(py.pyodide.FS.writeFile).toHaveBeenCalledWith('/home/pyodide/canviewer_adapter.py', ADAPTER);
    expect(py.pyodide.runPython).toHaveBeenCalledWith('import sys; sys.path.insert(0, "/home/pyodide")');
    expect(py.pyodide.pyimport).toHaveBeenCalledWith('canviewer_adapter');
  });

  it('reports the stages, reads the bytes with the adapter and posts the result with timings', async () => {
    const result = { clusters: [{ name: 'CAN', db: {} }], log: ['warning'] };
    py.proxy.toJs.mockReturnValue(result);
    await send({ id: 7, importType: 'kcd' });
    expect(kinds()).toEqual(['stage:runtime', 'stage:packages', 'stage:reading', 'result']);
    expect(py.pyodide.loadPackage).toHaveBeenNthCalledWith(2, ['lxml'], expect.objectContaining({ checkIntegrity: true }));
    const [data, importType] = py.adapter.read.mock.calls[0];
    expect([...data]).toEqual([1, 2, 3]);
    expect(importType).toBe('kcd');
    expect(py.proxy.toJs).toHaveBeenCalledWith({ dict_converter: Object.fromEntries });
    expect(py.proxy.destroy).toHaveBeenCalledOnce();
    const reply = posted[3] as Extract<WorkerReply, { kind: 'result' }>;
    expect(reply.id).toBe(7);
    expect(reply.result).toBe(result);
    for (const ms of Object.values(reply.timings)) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('starts the runtime once and loads each package once', async () => {
    await send({ id: 1 });
    posted = [];
    await send({ id: 2 });
    expect(py.loadPyodide).toHaveBeenCalledOnce();
    expect(kinds()).toEqual(['stage:runtime', 'stage:reading', 'result']);
    await send({ id: 3, importType: 'yaml', packages: ['pyyaml'] });
    expect(py.pyodide.loadPackage).toHaveBeenLastCalledWith(['pyyaml'], expect.anything());
  });

  it('skips the package stage for a format that needs nothing beyond canmatrix', async () => {
    await send({ id: 1, importType: 'sym', packages: [] });
    expect(kinds()).toEqual(['stage:runtime', 'stage:reading', 'result']);
  });

  it('posts the error when reading fails, and still frees the proxy when converting fails', async () => {
    py.adapter.read.mockImplementationOnce(() => {
      throw new Error('PythonError: bad file');
    });
    await send({ id: 1 });
    expect(last()).toEqual({ id: 1, kind: 'error', message: 'PythonError: bad file' });

    py.proxy.toJs.mockImplementationOnce(() => {
      throw 'conversion failed';
    });
    await send({ id: 2 });
    expect(last()).toEqual({ id: 2, kind: 'error', message: 'conversion failed' });
    expect(py.proxy.destroy).toHaveBeenCalledOnce();
  });

  it('tries the runtime again after a failed start, such as offline before it was ever cached', async () => {
    py.loadPyodide.mockRejectedValueOnce(new Error('Failed to fetch'));
    await send({ id: 1 });
    expect(last()).toEqual({ id: 1, kind: 'error', message: 'Failed to fetch' });
    await send({ id: 2 });
    expect(py.loadPyodide).toHaveBeenCalledTimes(2);
    expect(last()?.kind).toBe('result');
  });
});
