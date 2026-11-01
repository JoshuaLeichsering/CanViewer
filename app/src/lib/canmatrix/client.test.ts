import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDbc } from '../dbc/parser';
import type { CanmatrixReadResult } from './types';
import type { ImportStage, WorkerReply, WorkerRequest } from './worker-protocol';

/** Stands in for the import worker: records what the page sends and answers as the test says. */
class FakeWorker {
  static all: FakeWorker[] = [];
  static last(): FakeWorker | undefined {
    return FakeWorker.all[FakeWorker.all.length - 1];
  }
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(request: WorkerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(reply: WorkerReply) {
    this.onmessage?.({ data: reply });
  }
  /** The id of the request sent last. */
  get id() {
    return this.requests[this.requests.length - 1].id;
  }
}

const timings = { runtimeMs: 1, packagesMs: 1, readMs: 1 };
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const result = (r: Partial<CanmatrixReadResult>): WorkerReply => ({
  id: 0,
  kind: 'result',
  result: { clusters: [], log: [], ...r },
  timings,
});

/**
 * A fresh copy of client.ts, so that no worker is left from another test,
 * and `failure` to see how one of its imports settled: the reason, for an
 * ImportFailure (from the same fresh copy of import-failure.ts), and the message.
 */
async function client() {
  vi.resetModules();
  const [{ importWithCanmatrix }, { ImportFailure }] = await Promise.all([import('./client'), import('./import-failure')]);
  async function failure(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (e) {
      return { failure: e instanceof ImportFailure ? e.reason : null, message: (e as Error).message };
    }
    throw new Error('expected the import to fail');
  }
  return { importWithCanmatrix, failure };
}

/** Wait until the page has sent its request. */
const sent = async () => {
  await vi.waitFor(() => expect(FakeWorker.last()?.requests.length).toBeGreaterThan(0));
  return FakeWorker.last()!;
};

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'http://localhost:4173/' });
});
afterEach(() => vi.unstubAllGlobals());

describe('importWithCanmatrix', () => {
  it('sends a copy of the bytes, passes on each stage and resolves with every cluster', async () => {
    const { importWithCanmatrix } = await client();
    const bytes = bytesOf('<NetworkDefinition/>');
    const stages: ImportStage[] = [];
    const pending = importWithCanmatrix('the_homer.kcd', bytes, (s) => stages.push(s));
    const worker = await sent();
    const request = worker.requests[0];
    expect(request).toMatchObject({ importType: 'kcd', packages: ['lxml'], assetsUrl: 'http://localhost:4173/pyodide/' });
    expect(request.bytes).not.toBe(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0); // still the caller's, to store
    for (const stage of ['runtime', 'packages', 'reading'] as const) worker.reply({ id: worker.id, kind: 'stage', stage });
    const clusters = [
      { name: 'Motor', db: parseDbc('BO_ 1 A: 8 ECU\n') },
      { name: 'Comfort', db: parseDbc('') },
    ];
    worker.reply({ ...result({ clusters }), id: worker.id });
    const imported = await pending;
    expect(stages).toEqual(['runtime', 'packages', 'reading']);
    expect(imported).toStrictEqual({ clusters, timings });
  });

  it('names the runtime or the packages when either did not load, and keeps the browser’s message', async () => {
    const { importWithCanmatrix, failure } = await client();
    const runtime = importWithCanmatrix('test.arxml', bytesOf('<AUTOSAR/>'));
    let worker = await sent();
    const message = 'Failed to fetch dynamically imported module: http://localhost:4173/pyodide/pyodide.asm.mjs';
    worker.reply({ id: worker.id, kind: 'error', message, stage: 'runtime' });
    expect(await failure(runtime)).toEqual({ failure: 'runtime', message });

    const packages = importWithCanmatrix('test.xlsx', bytesOf('PK'));
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker = FakeWorker.last()!;
    worker.reply({ id: worker.id, kind: 'error', message: "Failed to load 'openpyxl.whl': request failed.", stage: 'packages' });
    expect(await failure(packages)).toEqual({ failure: 'packages', message: "Failed to load 'openpyxl.whl': request failed." });
  });

  it('passes on an error while reading as it is: it is about the file', async () => {
    const { importWithCanmatrix, failure } = await client();
    const pending = importWithCanmatrix('test.sym', bytesOf('FormatVersion=6.0'));
    const worker = await sent();
    worker.reply({ id: worker.id, kind: 'error', message: 'PythonError: boom', stage: 'reading' });
    expect(await failure(pending)).toEqual({ failure: null, message: 'PythonError: boom' });
  });

  it('rejects with canmatrix’s error when it read nothing, and names a file without a database', async () => {
    const { importWithCanmatrix, failure } = await client();
    const broken = importWithCanmatrix('test.xml', bytesOf('<FIBEX/>'));
    const worker = await sent();
    worker.reply({ ...result({ error: "KeyError: 'CANCHANNEL01'" }), id: worker.id });
    expect(await failure(broken)).toEqual({ failure: null, message: "KeyError: 'CANCHANNEL01'" });

    const empty = importWithCanmatrix('empty.kcd', bytesOf('<NetworkDefinition/>'));
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.reply({ ...result({ error: null }), id: worker.id });
    expect(await failure(empty)).toEqual({ failure: 'no-database', message: 'canmatrix found no CAN database in this file' });
  });

  it('names the runtime when the worker itself fails, and starts a new one for the next import', async () => {
    const { importWithCanmatrix, failure } = await client();
    const first = importWithCanmatrix('test.arxml', bytesOf('<AUTOSAR/>'));
    const worker = await sent();
    worker.onerror?.({ message: '' });
    expect(await failure(first)).toEqual({ failure: 'runtime', message: 'the import worker failed to start' });
    expect(worker.terminated).toBe(true);

    void importWithCanmatrix('test.arxml', bytesOf('<AUTOSAR/>'));
    await vi.waitFor(() => expect(FakeWorker.all).toHaveLength(2));
  });

  it('refuses a file that is not a canmatrix format', async () => {
    const { importWithCanmatrix, failure } = await client();
    expect(await failure(importWithCanmatrix('demo.dbc', bytesOf('')))).toEqual({
      failure: null,
      message: 'not a format canmatrix reads: demo.dbc',
    });
    expect(FakeWorker.all).toHaveLength(0);
  });
});
