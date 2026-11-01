// SPDX-License-Identifier: GPL-2.0-or-later
import type { CanmatrixReadResult } from './types';

/** Steps of an import, for the loading state: the first import pays for all three. */
export type ImportStage = 'runtime' | 'packages' | 'reading';

export interface WorkerRequest {
  id: number;
  /**
   * Absolute URL of the directory holding the Pyodide runtime and wheels.
   * Resolved by the page, not the worker: with a relative base (`--base ./`,
   * or a host serving the app below a path) the worker's own URL points into
   * assets/, where these files are not.
   */
  assetsUrl: string;
  bytes: ArrayBuffer;
  importType: string;
  /** Lock entries the format needs beyond canmatrix itself. */
  packages: string[];
}

export interface ImportTimings {
  runtimeMs: number;
  packagesMs: number;
  readMs: number;
}

export type WorkerReply =
  | { id: number; kind: 'stage'; stage: ImportStage }
  | { id: number; kind: 'result'; result: CanmatrixReadResult; timings: ImportTimings }
  | { id: number; kind: 'error'; message: string };
