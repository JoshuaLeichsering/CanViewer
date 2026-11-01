import type { DbcDatabase } from '../dbc/types';

/** One CAN cluster (bus) found in a file. ARXML, KCD and FIBEX can hold several. */
export interface ImportedCluster {
  name: string;
  db: DbcDatabase;
}

/** What canviewer_adapter.read() returns. */
export interface CanmatrixReadResult {
  clusters: ImportedCluster[];
  /** Everything canmatrix printed or logged at WARNING and above while loading. */
  log: string[];
  /** The loader's exception, if it raised one (Python None arrives as undefined). */
  error?: string | null;
}
