import { canmatrixFormatFor } from './formats';
import type { CanmatrixReadResult, ImportedCluster } from './types';
import type { ImportStage, ImportTimings, WorkerReply, WorkerRequest } from './worker-protocol';

export type { ImportStage, ImportTimings } from './worker-protocol';

interface Pending {
  resolve(value: { result: CanmatrixReadResult; timings: ImportTimings }): void;
  reject(reason: Error): void;
  onStage?: (stage: ImportStage) => void;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

/** The worker, created on first use so that DBC-only sessions never load Pyodide. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.kind === 'stage') {
      p.onStage?.(reply.stage);
      return;
    }
    pending.delete(reply.id);
    if (reply.kind === 'result') p.resolve({ result: reply.result, timings: reply.timings });
    else p.reject(new Error(reply.message));
  };
  worker.onerror = (e) => {
    const error = new Error(e.message || 'the import worker failed to start');
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

export interface ImportedFile {
  /**
   * Every cluster (bus) the file holds, in file order; never empty. ARXML,
   * KCD and FIBEX files can hold several; which one to show is the caller's
   * choice (app/src/lib/import/clusters.ts).
   */
  clusters: ImportedCluster[];
  /** Everything canmatrix printed or logged; canviewer_adapter.py has already turned it into problems. */
  log: string[];
  timings: ImportTimings;
}

/**
 * Read a non-DBC file through canmatrix in the worker. Rejects with
 * canmatrix's error, or when the file holds no CAN database at all. `bytes`
 * stays usable (the worker gets a copy), so the caller can store it.
 */
export async function importWithCanmatrix(
  name: string,
  bytes: ArrayBuffer,
  onStage?: (stage: ImportStage) => void,
): Promise<ImportedFile> {
  const format = canmatrixFormatFor(name);
  if (!format) throw new Error(`not a format canmatrix reads: ${name}`);
  const copy = bytes.slice(0);
  const id = nextId++;
  const request: WorkerRequest = {
    id,
    assetsUrl: new URL(`${import.meta.env.BASE_URL}pyodide/`, document.baseURI).href,
    bytes: copy,
    importType: format.importType,
    packages: format.packages,
  };
  const { result, timings } = await new Promise<{ result: CanmatrixReadResult; timings: ImportTimings }>(
    (resolve, reject) => {
      pending.set(id, { resolve, reject, onStage });
      getWorker().postMessage(request, [copy]);
    },
  );
  if (result.clusters.length === 0) throw new Error(result.error ?? 'canmatrix found no CAN database in this file');
  return { clusters: result.clusters, log: result.log, timings };
}
