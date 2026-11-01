// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Opening files: which reader a file goes to, the import's progress, the
 * clusters of an imported file, and what is stored for the next start.
 *
 * Plain TypeScript, so it is tested without a browser (loader.test.ts); the
 * React side is useDatabaseLoader.ts.
 *
 * - A `.dbc` (or any file whose extension is not in
 *   app/src/lib/canmatrix/formats.ts) is read by CanViewer's own parser.
 * - Every other format goes through canmatrix in the import worker. Its
 *   stages (runtime, packages, reading) are published as `progress`, so the
 *   UI can show them for as long as the import runs.
 * - The file opened last wins: an import still running when another file is
 *   opened is dropped when it finishes, with its stages and its errors.
 * - The last file shown is stored (storage.ts) and shown again by `restore()`
 *   on startup; an imported file is read through canmatrix again, with the
 *   cluster picked before.
 * - Edits made in the app (`edit()`) replace the database shown, and are kept
 *   only once saved as DBC (`savedAsDbc()`), which a reload then restores.
 */
import { decodeDbc } from '../dbc/decode';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase } from '../dbc/types';
import { canmatrixFormatFor, type CanmatrixFormat } from '../canmatrix/formats';
import { ImportFailure, noDatabase, type ImportFailureReason } from '../canmatrix/import-failure';
import type { ImportedCluster } from '../canmatrix/types';
import type { ImportStage } from '../canmatrix/worker-protocol';
import { initialCluster } from './clusters';
import type * as Storage from './storage';

/** Where an imported database came from, and which of its clusters is shown. */
export interface ImportedSource {
  format: CanmatrixFormat;
  clusters: ImportedCluster[];
  /** Index into `clusters` of the one shown. */
  cluster: number;
}

export interface ImportProgress {
  name: string;
  stage: ImportStage;
  /** The packages the format needs beyond canmatrix (empty: no package step). */
  packages: string[];
}

export interface LoaderState {
  db: DbcDatabase | null;
  fileName: string;
  /** Null for a DBC, which CanViewer reads itself. */
  source: ImportedSource | null;
  /** Non-null while an import runs. */
  progress: ImportProgress | null;
}

export type LoaderEvent =
  /** A database replaced the one shown (or a cluster replaced the cluster shown). */
  | { kind: 'shown'; restored: boolean }
  /**
   * `error` is the technical message (canmatrix's own, or the browser's);
   * `reason` is set when CanViewer knows why (import-failure.ts), and the UI
   * then says so in the user's language.
   */
  | { kind: 'failed'; name: string; error: string; reason?: ImportFailureReason; restored: boolean };

export type LoaderStorage = Pick<
  typeof Storage,
  | 'loadDbcText'
  | 'saveDbcText'
  | 'clearDbcText'
  | 'loadImportedFile'
  | 'saveImportedFile'
  | 'setImportedCluster'
  | 'clearImportedFile'
>;

export interface LoaderDeps {
  /**
   * Read a non-DBC file; rejects when canmatrix cannot, or with an
   * ImportFailure when CanViewer knows why (app/src/lib/canmatrix/client.ts).
   */
  importFile(
    name: string,
    bytes: ArrayBuffer,
    onStage: (stage: ImportStage) => void,
  ): Promise<{ clusters: ImportedCluster[] }>;
  storage: LoaderStorage;
}

const EMPTY: LoaderState = { db: null, fileName: '', source: null, progress: null };

export class DatabaseLoader {
  private state: LoaderState = EMPTY;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every open and restore; work started under an older value is stale. */
  private generation = 0;

  constructor(
    private readonly deps: LoaderDeps,
    private readonly emit: (event: LoaderEvent) => void,
  ) {}

  getState = (): LoaderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Open a file the user chose or dropped. Resolves once it is shown, or has failed. */
  open = async (name: string, bytes: ArrayBuffer): Promise<void> => {
    const generation = ++this.generation;
    const { storage } = this.deps;
    if (!canmatrixFormatFor(name)) {
      const text = decodeDbc(bytes);
      this.showDbc(name, text, false);
      // Too large to store: a reload then restores nothing, rather than the file opened before.
      if (!storage.saveDbcText(name, text)) storage.clearDbcText();
      void storage.clearImportedFile();
      return;
    }
    const shown = await this.runImport(generation, name, bytes, false);
    if (shown) {
      storage.clearDbcText();
      void storage.saveImportedFile({ name, bytes, cluster: shown.cluster });
    }
  };

  /** Show the file stored by the last session, if there is one. */
  restore = async (): Promise<void> => {
    const generation = ++this.generation;
    const { storage } = this.deps;
    const dbc = storage.loadDbcText();
    if (dbc) {
      this.showDbc(dbc.name, dbc.text, true);
      void storage.clearImportedFile();
      return;
    }
    const stored = await storage.loadImportedFile();
    if (!stored || generation !== this.generation) return;
    await this.runImport(generation, stored.name, stored.bytes, true, stored.cluster);
  };

  /** Show an edited version of the database shown; the file name and its source stay. */
  edit = (db: DbcDatabase): void => {
    if (this.state.db) this.set({ db });
  };

  /**
   * The database shown was saved as the DBC file `name`: a reload restores
   * that text, not the file as it was opened (or imported) before the edits.
   * When the text is too large to store, a reload restores nothing rather
   * than the file before the edits.
   */
  savedAsDbc = (name: string, text: string): void => {
    const { storage } = this.deps;
    if (!storage.saveDbcText(name, text)) storage.clearDbcText();
    void storage.clearImportedFile();
  };

  /** Show another cluster of the imported file. */
  selectCluster = (index: number): void => {
    const { source, fileName } = this.state;
    const picked = source?.clusters[index];
    if (!source || !picked || index === source.cluster) return;
    this.set({ db: picked.db, source: { ...source, cluster: index } });
    void this.deps.storage.setImportedCluster(fileName, picked.name);
    this.emit({ kind: 'shown', restored: false });
  };

  private set(patch: Partial<LoaderState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private showDbc(name: string, text: string, restored: boolean) {
    this.set({ db: parseDbc(text), fileName: name, source: null, progress: null });
    this.emit({ kind: 'shown', restored });
  }

  /** Import through canmatrix; resolves with the cluster shown, or undefined if it failed or went stale. */
  private async runImport(
    generation: number,
    name: string,
    bytes: ArrayBuffer,
    restored: boolean,
    picked?: string,
  ): Promise<{ cluster: string } | undefined> {
    const format = canmatrixFormatFor(name);
    if (!format) return undefined;
    const current = () => generation === this.generation;
    const progress = (stage: ImportStage) => ({ name, stage, packages: format.packages });
    this.set({ progress: progress('runtime') });
    try {
      const { clusters } = await this.deps.importFile(name, bytes, (stage) => {
        if (current()) this.set({ progress: progress(stage) });
      });
      if (!current()) return undefined;
      if (clusters.length === 0) throw noDatabase();
      const index = initialCluster(clusters, picked);
      this.set({ db: clusters[index].db, fileName: name, source: { format, clusters, cluster: index }, progress: null });
      this.emit({ kind: 'shown', restored });
      return { cluster: clusters[index].name };
    } catch (e) {
      if (!current()) return undefined;
      this.set({ progress: null });
      const reason = e instanceof ImportFailure ? { reason: e.reason } : {};
      this.emit({ kind: 'failed', name, error: e instanceof Error ? e.message : String(e), ...reason, restored });
      return undefined;
    }
  }
}
