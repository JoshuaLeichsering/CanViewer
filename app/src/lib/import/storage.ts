// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where CanViewer keeps the last opened file, so that a reload shows it again.
 *
 * - A DBC is kept as text in localStorage under `canviewer.file`, as JSON
 *   `{ name, text }`, exactly as before imports existed.
 * - An imported file (any format in app/src/lib/canmatrix/formats.ts) is kept
 *   in IndexedDB as its bytes, its name and the cluster the user picked. It
 *   is read again through canmatrix on restore, and it can be binary (XLS,
 *   XLSX) or larger than localStorage allows (ARXML).
 *
 * Only one file is kept: opening one removes the other (lib/import/loader.ts).
 * Should both be found, the DBC is the newer one, because localStorage is
 * written synchronously while IndexedDB may not have finished deleting the
 * imported file before a reload.
 *
 * Nothing here throws or rejects: storage can be unavailable (a private
 * window, blocked site data, a full quota), and the app then works as before,
 * without restoring.
 */

export const DBC_STORAGE_KEY = 'canviewer.file';

/** IndexedDB names; separate from anything else the app may store. */
export const IMPORT_DB_NAME = 'canviewer-import';
const STORE = 'files';
const KEY = 'last';

export interface StoredDbc {
  name: string;
  text: string;
}

export interface StoredImport {
  name: string;
  bytes: ArrayBuffer;
  /** The cluster shown, by name; absent until one is known. */
  cluster?: string;
}

// ---------------------------------------------------------------- DBC text

/** A stored DBC entry, or undefined for anything else (missing or corrupt). */
export function parseStoredDbc(raw: string | null): StoredDbc | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredDbc> | null;
    if (value && typeof value.name === 'string' && typeof value.text === 'string') {
      return { name: value.name, text: value.text };
    }
  } catch {
    // corrupt storage: start empty
  }
  return undefined;
}

export function loadDbcText(): StoredDbc | undefined {
  try {
    return parseStoredDbc(localStorage.getItem(DBC_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

/** False when the text could not be stored (too large for localStorage, say). */
export function saveDbcText(name: string, text: string): boolean {
  try {
    localStorage.setItem(DBC_STORAGE_KEY, JSON.stringify({ name, text }));
    return true;
  } catch {
    return false;
  }
}

export function clearDbcText(): void {
  try {
    localStorage.removeItem(DBC_STORAGE_KEY);
  } catch {
    // storage unavailable: nothing is stored either
  }
}

// ---------------------------------------------------------------- imported file

/** A stored import record, or undefined for anything else. */
export function toStoredImport(value: unknown): StoredImport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<StoredImport>;
  if (typeof v.name !== 'string' || !(v.bytes instanceof ArrayBuffer)) return undefined;
  return {
    name: v.name,
    bytes: v.bytes,
    ...(typeof v.cluster === 'string' ? { cluster: v.cluster } : {}),
  };
}

function factory(): IDBFactory | undefined {
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB;
  } catch {
    return undefined; // some browsers throw on access when site data is blocked
  }
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(IMPORT_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`${IMPORT_DB_NAME} is blocked by another connection`));
  });
}

/**
 * Run one transaction on the store and resolve with what `run` returns once
 * it has committed, or with `fallback` if IndexedDB is unavailable or fails.
 * The connection is closed afterwards, so nothing holds the database open.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => () => T,
  fallback: T,
): Promise<T> {
  const idb = factory();
  if (!idb) return fallback;
  let db: IDBDatabase | undefined;
  try {
    db = await openDb(idb);
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    return await new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

export function loadImportedFile(): Promise<StoredImport | undefined> {
  return transact<StoredImport | undefined>(
    'readonly',
    (store) => {
      const request = store.get(KEY);
      return () => toStoredImport(request.result);
    },
    undefined,
  );
}

/** Resolves true once the file is stored. */
export function saveImportedFile(file: StoredImport): Promise<boolean> {
  const record: StoredImport = {
    name: file.name,
    bytes: file.bytes,
    ...(file.cluster !== undefined ? { cluster: file.cluster } : {}),
  };
  return transact(
    'readwrite',
    (store) => {
      store.put(record, KEY);
      return () => true;
    },
    false,
  );
}

/** Remember the cluster picked for the stored file, if `name` is the file stored. */
export function setImportedCluster(name: string, cluster: string): Promise<boolean> {
  return transact(
    'readwrite',
    (store) => {
      let updated = false;
      const request = store.get(KEY);
      request.onsuccess = () => {
        const record = toStoredImport(request.result);
        if (record && record.name === name) {
          store.put({ ...record, cluster }, KEY);
          updated = true;
        }
      };
      return () => updated;
    },
    false,
  );
}

export function clearImportedFile(): Promise<boolean> {
  return transact(
    'readwrite',
    (store) => {
      store.delete(KEY);
      return () => true;
    },
    false,
  );
}
