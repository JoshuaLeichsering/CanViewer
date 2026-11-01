import type { CanmatrixReadResult } from './types';

/** Steps of an import, for the loading state: the first import pays for all three. */
export type ImportStage = 'runtime' | 'packages' | 'reading';

export interface WorkerRequest {
  id: number;
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
