// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import type { DbcDatabase } from '../dbc/types';
import type { CanmatrixReadResult } from './types';
import type { WorkerReply, WorkerRequest } from './worker-protocol';

/** Stands in for the module worker; the real one runs Pyodide (see worker.test.ts). */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((e: Partial<ErrorEvent>) => void) | null = null;
  posted: Array<{ request: WorkerRequest; transfer: Transferable[] }> = [];
  terminated = false;
  constructor(
    readonly url: URL | string,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest, transfer: Transferable[]) {
    this.posted.push({ request, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: WorkerReply) {
    this.onmessage?.({ data } as MessageEvent<WorkerReply>);
  }
  /** The id of the last request, once the client has read the file and posted it. */
  async lastId() {
    await vi.waitFor(() => expect(this.posted.length).toBeGreaterThan(0));
    return this.posted[this.posted.length - 1].request.id;
  }
}

const file = (name: string, content = '<AUTOSAR/>') => new NodeFile([content], name) as unknown as File;
const db = (messages: number): DbcDatabase =>
  ({ messages: Array.from({ length: messages }, () => ({})) }) as unknown as DbcDatabase;
const result = (clusters: CanmatrixReadResult['clusters'], error?: string | null): CanmatrixReadResult => ({
  clusters,
  log: [],
  error,
});
const timings = { runtimeMs: 1, packagesMs: 2, readMs: 3 };
const worker = async () => {
  await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(0));
  return FakeWorker.instances[FakeWorker.instances.length - 1];
};

/** client.ts keeps its worker in module state: import a fresh copy per test. */
async function freshClient() {
  vi.resetModules();
  return import('./client');
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('importWithCanmatrix', () => {
  it('refuses a file canmatrix does not read, without starting the worker', async () => {
    const { importWithCanmatrix } = await freshClient();
    await expect(importWithCanmatrix(file('demo.dbc'))).rejects.toThrow('not a format canmatrix reads: demo.dbc');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('starts a module worker on first use and posts the file with what its format needs', async () => {
    const { importWithCanmatrix } = await freshClient();
    const pending = importWithCanmatrix(file('System.ARXML', 'bytes'));
    const w = await worker();
    expect(String(w.url)).toContain('worker');
    expect(w.options).toEqual({ type: 'module' });
    await w.lastId();
    const { request, transfer } = w.posted[0];
    expect(request).toMatchObject({ id: 1, importType: 'arxml', packages: ['lxml'] });
    // Resolved against the page, so a relative base still finds the runtime.
    expect(request.assetsUrl).toBe(new URL('/pyodide/', document.baseURI).href);
    expect(new TextDecoder().decode(request.bytes)).toBe('bytes');
    // The bytes are transferred, not copied.
    expect(transfer).toEqual([request.bytes]);
    w.reply({ id: 1, kind: 'result', result: result([{ name: 'CAN', db: db(1) }]), timings });
    await pending;
  });

  it('reports each stage and shows the first cluster that holds messages', async () => {
    const { importWithCanmatrix } = await freshClient();
    const stages: string[] = [];
    const pending = importWithCanmatrix(file('bus.kcd'), (s) => stages.push(s));
    const w = await worker();
    const id = await w.lastId();
    w.reply({ id, kind: 'stage', stage: 'runtime' });
    w.reply({ id, kind: 'stage', stage: 'packages' });
    w.reply({ id, kind: 'stage', stage: 'reading' });
    const second = db(2);
    w.reply({
      id,
      kind: 'result',
      result: result([
        { name: 'Empty', db: db(0) },
        { name: 'Body', db: second },
        { name: 'Chassis', db: db(5) },
      ]),
      timings,
    });
    await expect(pending).resolves.toEqual({ db: second, cluster: 'Body', clusterCount: 3, timings });
    expect(stages).toEqual(['runtime', 'packages', 'reading']);
  });

  it('shows the first cluster when none holds messages', async () => {
    const { importWithCanmatrix } = await freshClient();
    const pending = importWithCanmatrix(file('a.json', '{}'));
    const w = await worker();
    const empty = db(0);
    w.reply({ id: await w.lastId(), kind: 'result', result: result([{ name: 'Only', db: empty }]), timings });
    await expect(pending).resolves.toMatchObject({ db: empty, cluster: 'Only', clusterCount: 1 });
  });

  it('fails with canmatrix’s own error when it found no cluster, or says so itself', async () => {
    const { importWithCanmatrix } = await freshClient();
    const first = importWithCanmatrix(file('a.sym'));
    const w = await worker();
    w.reply({ id: await w.lastId(), kind: 'result', result: result([], 'ParseError: line 3'), timings });
    await expect(first).rejects.toThrow('ParseError: line 3');

    const second = importWithCanmatrix(file('b.sym'));
    await vi.waitFor(() => expect(w.posted).toHaveLength(2));
    w.reply({ id: w.posted[1].request.id, kind: 'result', result: result([], null), timings });
    await expect(second).rejects.toThrow('canmatrix found no CAN database in this file');
  });

  it('rejects with the worker’s error message', async () => {
    const { importWithCanmatrix } = await freshClient();
    const pending = importWithCanmatrix(file('a.xlsx'));
    const w = await worker();
    w.reply({ id: await w.lastId(), kind: 'error', message: 'No module named openpyxl' });
    await expect(pending).rejects.toThrow('No module named openpyxl');
  });

  it('keeps one worker for every import, and matches replies by id', async () => {
    const { importWithCanmatrix } = await freshClient();
    const a = importWithCanmatrix(file('a.arxml'));
    const b = importWithCanmatrix(file('b.arxml'));
    const w = await worker();
    await vi.waitFor(() => expect(w.posted).toHaveLength(2));
    expect(FakeWorker.instances).toHaveLength(1);
    const [idA, idB] = w.posted.map((p) => p.request.id);
    expect(idB).toBe(idA + 1);
    // A reply for no pending request is ignored.
    w.reply({ id: 99, kind: 'error', message: 'stray' });
    w.reply({ id: idB, kind: 'result', result: result([{ name: 'B', db: db(1) }]), timings });
    w.reply({ id: idA, kind: 'result', result: result([{ name: 'A', db: db(1) }]), timings });
    await expect(a).resolves.toMatchObject({ cluster: 'A' });
    await expect(b).resolves.toMatchObject({ cluster: 'B' });
    // A late stage message for a finished import changes nothing.
    w.reply({ id: idA, kind: 'stage', stage: 'reading' });
  });

  it('fails every pending import when the worker fails, and starts a new one next time', async () => {
    const { importWithCanmatrix } = await freshClient();
    const a = importWithCanmatrix(file('a.arxml'));
    const b = importWithCanmatrix(file('b.arxml'));
    const w = await worker();
    await vi.waitFor(() => expect(w.posted).toHaveLength(2));
    w.onerror!({ message: 'Failed to fetch worker script' });
    await expect(a).rejects.toThrow('Failed to fetch worker script');
    await expect(b).rejects.toThrow('Failed to fetch worker script');
    expect(w.terminated).toBe(true);

    const c = importWithCanmatrix(file('c.arxml'));
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const next = FakeWorker.instances[1];
    next.onerror!({ message: '' });
    await expect(c).rejects.toThrow('the import worker failed to start');
  });
});
