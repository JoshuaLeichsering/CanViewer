import type { DbcDatabase } from '../dbc/types';
import { canmatrixFormatFor } from './formats';
import type { CanmatrixReadResult } from './types';
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

export interface ImportedDatabase {
  db: DbcDatabase;
  /** Cluster shown, and how many the file holds (ARXML, KCD and FIBEX can hold several). */
  cluster: string;
  clusterCount: number;
  timings: ImportTimings;
}

/**
 * Read a non-DBC file through canmatrix in the worker. Spike scope: the first
 * cluster that holds messages is shown, and canmatrix's log lines become
 * problems so that nothing it reports is hidden.
 */
export async function importWithCanmatrix(
  file: File,
  onStage?: (stage: ImportStage) => void,
): Promise<ImportedDatabase> {
  const format = canmatrixFormatFor(file.name);
  if (!format) throw new Error(`not a format canmatrix reads: ${file.name}`);
  const bytes = await file.arrayBuffer();
  const id = nextId++;
  const request: WorkerRequest = { id, bytes, importType: format.importType, packages: format.packages };
  const { result, timings } = await new Promise<{ result: CanmatrixReadResult; timings: ImportTimings }>(
    (resolve, reject) => {
      pending.set(id, { resolve, reject, onStage });
      getWorker().postMessage(request, [bytes]);
    },
  );
  const cluster = result.clusters.find((c) => c.db.messages.length > 0) ?? result.clusters[0];
  if (!cluster) throw new Error(result.error ?? 'canmatrix found no CAN database in this file');
  const problems = [
    ...(result.error ? [{ line: 0, text: result.error, reason: 'canmatrix raised' }] : []),
    ...result.log.map((text) => ({ line: 0, text, reason: 'canmatrix log' })),
  ];
  return {
    db: { ...cluster.db, problems: [...cluster.db.problems, ...problems] },
    cluster: cluster.name,
    clusterCount: result.clusters.length,
    timings,
  };
}
