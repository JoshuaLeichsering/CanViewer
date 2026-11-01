import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DBC_STORAGE_KEY,
  IMPORT_DB_NAME,
  clearDbcText,
  clearImportedFile,
  loadDbcText,
  loadImportedFile,
  parseStoredDbc,
  saveDbcText,
  saveImportedFile,
  setImportedCluster,
  toStoredImport,
} from './storage';

afterEach(() => vi.unstubAllGlobals());

/** localStorage as a Map, optionally refusing writes the way a full quota does. */
function memoryStorage({ full = false } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new DOMException('quota exceeded', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

/**
 * Just enough of IndexedDB for storage.ts: versioned open with upgrade,
 * one object store per database, get/put/delete requests answered
 * asynchronously, and a transaction that completes once its last request
 * (including one issued from another's success handler) has. Values are
 * structured-cloned, as the real thing does.
 */
function fakeIndexedDB({ failOpen = false } = {}) {
  type Data = Map<IDBValidKey, unknown>;
  const databases = new Map<string, { version: number; stores: Map<string, Data> }>();
  const connections = { opened: 0, closed: 0 };
  const later = (f: () => void) => setTimeout(f, 0);

  function transaction(data: Data, mode: IDBTransactionMode) {
    let pending = 0;
    let completed = false;
    const tx = {
      error: null,
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
      objectStore: () => store,
    };
    const maybeComplete = () => {
      if (pending === 0 && !completed) {
        completed = true;
        later(() => tx.oncomplete?.());
      }
    };
    const request = (op: () => unknown) => {
      pending++;
      const req = { result: undefined as unknown, onsuccess: null as null | (() => void) };
      later(() => {
        req.result = op();
        pending--;
        req.onsuccess?.();
        maybeComplete();
      });
      return req;
    };
    const writable = () => {
      if (mode !== 'readwrite') throw new DOMException('read-only transaction', 'ReadOnlyError');
    };
    const store = {
      get: (key: IDBValidKey) => request(() => structuredClone(data.get(key))),
      put: (value: unknown, key: IDBValidKey) => {
        writable();
        return request(() => void data.set(key, structuredClone(value)));
      },
      delete: (key: IDBValidKey) => {
        writable();
        return request(() => void data.delete(key));
      },
    };
    later(maybeComplete);
    return tx;
  }

  const factory = {
    open(name: string, version: number) {
      const req = {
        result: undefined as unknown,
        error: failOpen ? new DOMException('denied', 'UnknownError') : null,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
        onblocked: null as null | (() => void),
      };
      later(() => {
        if (failOpen) return req.onerror?.();
        let entry = databases.get(name);
        if (!entry) databases.set(name, (entry = { version: 0, stores: new Map() }));
        const db = {
          createObjectStore: (store: string) => entry!.stores.set(store, new Map()),
          transaction: (store: string, mode: IDBTransactionMode) => transaction(entry!.stores.get(store)!, mode),
          close: () => void connections.closed++,
        };
        connections.opened++;
        req.result = db;
        if (version > entry.version) {
          entry.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory, databases, connections };
}

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const textOf = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

describe('the stored DBC (localStorage, unchanged)', () => {
  it('reads back what was written, under the key used before imports existed', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(saveDbcText('demo.dbc', 'VERSION ""')).toBe(true);
    expect(JSON.parse(storage.data.get(DBC_STORAGE_KEY)!)).toEqual({ name: 'demo.dbc', text: 'VERSION ""' });
    expect(loadDbcText()).toEqual({ name: 'demo.dbc', text: 'VERSION ""' });
    clearDbcText();
    expect(loadDbcText()).toBeUndefined();
  });

  it('treats missing, corrupt and foreign entries as nothing stored', () => {
    expect(parseStoredDbc(null)).toBeUndefined();
    expect(parseStoredDbc('')).toBeUndefined();
    expect(parseStoredDbc('{not json')).toBeUndefined();
    expect(parseStoredDbc('null')).toBeUndefined();
    expect(parseStoredDbc('{"name":"a.dbc"}')).toBeUndefined();
    expect(parseStoredDbc('{"name":"a.dbc","text":"x","extra":1}')).toEqual({ name: 'a.dbc', text: 'x' });
  });

  it('reports a file too large to store, and never throws', () => {
    vi.stubGlobal('localStorage', memoryStorage({ full: true }));
    expect(saveDbcText('huge.dbc', 'x')).toBe(false);
    vi.stubGlobal('localStorage', undefined);
    expect(loadDbcText()).toBeUndefined();
    expect(saveDbcText('a.dbc', 'x')).toBe(false);
    expect(() => clearDbcText()).not.toThrow();
  });
});

describe('the stored import (IndexedDB)', () => {
  it('keeps the bytes, the name and the picked cluster', async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb.factory);
    const before = Date.now();
    expect(await saveImportedFile({ name: 'the_homer.kcd', bytes: bytesOf('<NetworkDefinition/>') })).toBe(true);
    const stored = await loadImportedFile();
    expect(stored?.name).toBe('the_homer.kcd');
    expect(textOf(stored!.bytes)).toBe('<NetworkDefinition/>');
    expect(stored?.cluster).toBeUndefined();
    expect(stored!.savedAt).toBeGreaterThanOrEqual(before);
    expect([...idb.databases.keys()]).toEqual([IMPORT_DB_NAME]);

    expect(await setImportedCluster('the_homer.kcd', 'Comfort')).toBe(true);
    expect((await loadImportedFile())?.cluster).toBe('Comfort');
    expect(textOf((await loadImportedFile())!.bytes)).toBe('<NetworkDefinition/>');
  });

  it('stores the cluster given with the file, and an empty cluster name too', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB().factory);
    await saveImportedFile({ name: 'test.sym', bytes: bytesOf('FormatVersion=6.0'), cluster: '' });
    expect((await loadImportedFile())?.cluster).toBe('');
  });

  it('replaces the stored file with the next one', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB().factory);
    await saveImportedFile({ name: 'a.arxml', bytes: bytesOf('a'), cluster: 'A' });
    await saveImportedFile({ name: 'b.kcd', bytes: bytesOf('b') });
    const stored = await loadImportedFile();
    expect(stored?.name).toBe('b.kcd');
    expect(stored?.cluster).toBeUndefined();
  });

  it('does not move a cluster choice onto another file', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB().factory);
    await saveImportedFile({ name: 'b.kcd', bytes: bytesOf('b'), cluster: 'Motor' });
    expect(await setImportedCluster('a.kcd', 'Comfort')).toBe(false);
    expect((await loadImportedFile())?.cluster).toBe('Motor');
  });

  it('forgets the file when cleared', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB().factory);
    expect(await loadImportedFile()).toBeUndefined();
    await saveImportedFile({ name: 'a.arxml', bytes: bytesOf('a') });
    expect(await clearImportedFile()).toBe(true);
    expect(await loadImportedFile()).toBeUndefined();
    expect(await setImportedCluster('a.arxml', 'A')).toBe(false);
  });

  it('closes every connection it opens', async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb.factory);
    await saveImportedFile({ name: 'a.arxml', bytes: bytesOf('a') });
    await loadImportedFile();
    await setImportedCluster('a.arxml', 'A');
    await clearImportedFile();
    expect(idb.connections).toEqual({ opened: 4, closed: 4 });
  });

  it('works without IndexedDB, and when it refuses to open', async () => {
    for (const factory of [undefined, fakeIndexedDB({ failOpen: true }).factory]) {
      vi.stubGlobal('indexedDB', factory);
      expect(await saveImportedFile({ name: 'a.arxml', bytes: bytesOf('a') })).toBe(false);
      expect(await loadImportedFile()).toBeUndefined();
      expect(await setImportedCluster('a.arxml', 'A')).toBe(false);
      expect(await clearImportedFile()).toBe(false);
    }
  });

  it('ignores a record that is not one of its own', () => {
    expect(toStoredImport(undefined)).toBeUndefined();
    expect(toStoredImport('a.arxml')).toBeUndefined();
    expect(toStoredImport({ name: 'a.arxml', bytes: 'not bytes' })).toBeUndefined();
    expect(toStoredImport({ bytes: new ArrayBuffer(1) })).toBeUndefined();
    const bytes = new ArrayBuffer(2);
    expect(toStoredImport({ name: 'a.arxml', bytes, cluster: 7 })).toEqual({ name: 'a.arxml', bytes, savedAt: 0 });
  });
});
