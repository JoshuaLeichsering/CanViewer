// SPDX-License-Identifier: GPL-2.0-or-later
import { canmatrixFormatFor } from './formats';
import { ImportFailure, noDatabase } from './import-failure';
import type { CanmatrixReadResult, ImportedCluster } from './types';
import type { ImportStage, WorkerReply, WorkerRequest } from './worker-protocol';
import { inDesktopApp } from '../desktop';
import { startImportWorker } from './start-worker';
import workerUrl from './worker.ts?worker&url';

export type { ImportStage } from './worker-protocol';

interface Pending {
  resolve(result: CanmatrixReadResult): void;
  reject(reason: Error): void;
  onStage?: (stage: ImportStage) => void;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

/** The worker, created on first use so that DBC-only sessions never load Pyodide. */
function getWorker(): Worker {
  if (worker) return worker;
  // In the desktop app from a blob: URL, so that it runs under the page's CSP.
  worker = startImportWorker(workerUrl, inDesktopApp());
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.kind === 'stage') {
      p.onStage?.(reply.stage);
      return;
    }
    pending.delete(reply.id);
    if (reply.kind === 'result') p.resolve(reply.result);
    else if (reply.stage === 'reading') p.reject(new Error(reply.message));
    // The runtime or a package did not load: CanViewer's failure, not the file's.
    else p.reject(new ImportFailure(reply.stage, reply.message));
  };
  worker.onerror = (e) => {
    const error = new ImportFailure('runtime', e.message || 'the import worker failed to start');
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
}

/**
 * Read a non-DBC file through canmatrix in the worker. Rejects with
 * canmatrix's error, or with an ImportFailure (import-failure.ts) when the
 * file holds no CAN database at all or the runtime or a package did not
 * load. `bytes` stays usable (the worker gets a copy), so the caller can
 * store it.
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
  const result = await new Promise<CanmatrixReadResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, onStage });
    getWorker().postMessage(request, [copy]);
  });
  if (result.clusters.length === 0) {
    if (result.error) throw new Error(result.error);
    throw noDatabase();
  }
  return { clusters: result.clusters };
}
