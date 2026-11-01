// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { ImportFailure } from '../canmatrix/import-failure';
import type { ImportedCluster } from '../canmatrix/types';
import type { ImportStage } from '../canmatrix/worker-protocol';
import { DatabaseLoader, type LoaderEvent, type LoaderStorage } from './loader';
import type { StoredImport } from './storage';

const DEMO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../examples/demo.dbc'), 'utf8');
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const textOf = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

/** A cluster whose database holds `messages` messages, as the adapter would map it. */
function cluster(name: string, messages: number): ImportedCluster {
  const lines = ['VERSION ""', 'BU_: ECU'];
  for (let i = 0; i < messages; i++) lines.push(`BO_ ${i + 1} ${name}_${i}: 8 ECU`);
  return { name, db: parseDbc(lines.join('\n') + '\n') };
}
// the_homer.kcd from the cantools corpus, as pinned in import-corpus-baseline.json.
const HOMER = [cluster('Motor', 7), cluster('Instrumentation', 6), cluster('Comfort', 20)];

/** An importer whose calls the test answers, one by one. */
function controlledImporter() {
  const calls: Array<{
    name: string;
    bytes: ArrayBuffer;
    onStage: (s: ImportStage) => void;
    resolve: (v: { clusters: ImportedCluster[] }) => void;
    reject: (e: Error) => void;
  }> = [];
  const importFile = (name: string, bytes: ArrayBuffer, onStage: (s: ImportStage) => void) =>
    new Promise<{ clusters: ImportedCluster[] }>((resolve, reject) => calls.push({ name, bytes, onStage, resolve, reject }));
  return { importFile, calls };
}

/** Storage in memory, with a log of what was written. */
function memoryStorage(initial: { dbc?: { name: string; text: string }; imported?: StoredImport } = {}) {
  const state = { ...initial };
  const log: string[] = [];
  let release: (() => void) | undefined;
  const storage: LoaderStorage = {
    loadDbcText: () => state.dbc,
    saveDbcText: (name, text) => {
      log.push(`saveDbc ${name}`);
      state.dbc = { name, text };
      return true;
    },
    clearDbcText: () => {
      log.push('clearDbc');
      state.dbc = undefined;
    },
    loadImportedFile: async () => {
      if (holdLoad) await new Promise<void>((r) => (release = r));
      return state.imported;
    },
    saveImportedFile: async (f) => {
      log.push(`saveImported ${f.name} ${JSON.stringify(f.cluster)}`);
      state.imported = { ...f };
      return true;
    },
    setImportedCluster: async (name, c) => {
      log.push(`setCluster ${name} ${c}`);
      if (state.imported?.name === name) state.imported = { ...state.imported, cluster: c };
      return true;
    },
    clearImportedFile: async () => {
      log.push('clearImported');
      state.imported = undefined;
      return true;
    },
  };
  let holdLoad = false;
  return {
    storage,
    state,
    log,
    holdLoad: () => (holdLoad = true),
    releaseLoad: () => release?.(),
  };
}

function setup(initial?: Parameters<typeof memoryStorage>[0]) {
  const importer = controlledImporter();
  const stored = memoryStorage(initial);
  const events: LoaderEvent[] = [];
  const loader = new DatabaseLoader({ importFile: importer.importFile, storage: stored.storage }, (e) => events.push(e));
  return { loader, importer, stored, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('opening a DBC', () => {
  it('parses it with CanViewer’s parser, stores its text and forgets an imported file', async () => {
    const { loader, importer, stored, events } = setup();
    await loader.open('demo.dbc', bytesOf(DEMO));
    const state = loader.getState();
    expect(state.fileName).toBe('demo.dbc');
    expect(state.db?.messages.map((m) => m.name)).toEqual(parseDbc(DEMO).messages.map((m) => m.name));
    expect(state.source).toBeNull();
    expect(state.progress).toBeNull();
    expect(importer.calls).toHaveLength(0);
    expect(stored.log).toEqual(['saveDbc demo.dbc', 'clearImported']);
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });

  it('decodes Windows-1252 when the bytes are not UTF-8, as Vector tools often write', async () => {
    // The decoding is app/src/lib/dbc/decode.ts, which diff mode shares.
    const { loader } = setup();
    const head = bytesOf('BU_: ECU\nBO_ 1 M: 8 ECU\nCM_ BO_ 1 "');
    const latin1 = new Uint8Array([...new Uint8Array(head), 0xe4, 0x22, 0x3b, 0x0a]);
    await loader.open('latin1.dbc', latin1.buffer);
    expect(loader.getState().db?.messages[0].comment).toBe('ä');
    await loader.open('utf8.dbc', bytesOf('BU_: ECU\nBO_ 1 M: 8 ECU\nCM_ BO_ 1 "ä";\n'));
    expect(loader.getState().db?.messages[0].comment).toBe('ä');
  });

  it('treats .txt and unknown extensions as DBC', async () => {
    const { loader, importer } = setup();
    await loader.open('export.txt', bytesOf(DEMO));
    await loader.open('no-extension', bytesOf(DEMO));
    expect(importer.calls).toHaveLength(0);
    expect(loader.getState().fileName).toBe('no-extension');
  });
});

describe('importing a file through canmatrix', () => {
  it('shows each stage while it runs, then the first cluster with messages', async () => {
    const { loader, importer, stored, events } = setup();
    const done = loader.open('the_homer.kcd', bytesOf('<NetworkDefinition/>'));
    await tick();
    expect(loader.getState().progress).toEqual({ name: 'the_homer.kcd', stage: 'runtime', packages: ['lxml'] });
    expect(loader.getState().db).toBeNull();

    const call = importer.calls[0];
    expect(call.name).toBe('the_homer.kcd');
    expect(textOf(call.bytes)).toBe('<NetworkDefinition/>');
    for (const stage of ['runtime', 'packages', 'reading'] as const) {
      call.onStage(stage);
      expect(loader.getState().progress?.stage).toBe(stage);
    }
    call.resolve({ clusters: HOMER });
    await done;

    const state = loader.getState();
    expect(state.progress).toBeNull();
    expect(state.fileName).toBe('the_homer.kcd');
    expect(state.db).toBe(HOMER[0].db);
    expect(state.source?.format.label).toBe('KCD');
    expect(state.source?.clusters.map((c) => c.name)).toEqual(['Motor', 'Instrumentation', 'Comfort']);
    expect(state.source?.cluster).toBe(0);
    expect(stored.log).toEqual(['clearDbc', 'saveImported the_homer.kcd "Motor"']);
    expect(textOf(stored.state.imported!.bytes)).toBe('<NetworkDefinition/>');
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });

  it('lists no package step for a format that needs none', async () => {
    const { loader } = setup();
    void loader.open('test.sym', bytesOf('FormatVersion=6.0'));
    await tick();
    expect(loader.getState().progress?.packages).toEqual([]);
  });

  it('keeps the database shown before when an import fails, and says why', async () => {
    const { loader, importer, stored, events } = setup();
    await loader.open('demo.dbc', bytesOf(DEMO));
    const before = loader.getState().db;
    const done = loader.open('broken.xml', bytesOf('<FIBEX/>'));
    await tick();
    importer.calls[0].reject(new Error("KeyError: 'CANCHANNEL01'"));
    await done;
    expect(loader.getState().db).toBe(before);
    expect(loader.getState().fileName).toBe('demo.dbc');
    expect(loader.getState().progress).toBeNull();
    // canmatrix's own error: shown as canmatrix wrote it, with no reason to translate.
    expect(events[events.length - 1]).toStrictEqual({ kind: 'failed', name: 'broken.xml', error: "KeyError: 'CANCHANNEL01'", restored: false });
    expect(stored.state.dbc?.name).toBe('demo.dbc');
    expect(stored.state.imported).toBeUndefined();
  });

  it('names the reason when the file holds no CAN database, so the UI can translate it', async () => {
    const { loader, importer, stored, events } = setup();
    const done = loader.open('empty.kcd', bytesOf('<NetworkDefinition/>'));
    await tick();
    importer.calls[0].resolve({ clusters: [] });
    await done;
    expect(loader.getState().db).toBeNull();
    expect(events).toStrictEqual([
      { kind: 'failed', name: 'empty.kcd', error: 'canmatrix found no CAN database in this file', reason: 'no-database', restored: false },
    ]);
    expect(stored.state.imported).toBeUndefined();
  });

  it('passes on the reason of a runtime or a package that did not load', async () => {
    const { loader, importer, events } = setup();
    for (const reason of ['runtime', 'packages'] as const) {
      const done = loader.open('test.arxml', bytesOf('<AUTOSAR/>'));
      await tick();
      importer.calls[importer.calls.length - 1].reject(new ImportFailure(reason, 'Failed to fetch'));
      await done;
    }
    expect(events).toStrictEqual([
      { kind: 'failed', name: 'test.arxml', error: 'Failed to fetch', reason: 'runtime', restored: false },
      { kind: 'failed', name: 'test.arxml', error: 'Failed to fetch', reason: 'packages', restored: false },
    ]);
  });

  it('lets the file opened last win over an import still running', async () => {
    const { loader, importer, stored, events } = setup();
    const slow = loader.open('big.arxml', bytesOf('<AUTOSAR/>'));
    await tick();
    await loader.open('demo.dbc', bytesOf(DEMO));
    expect(loader.getState().progress).toBeNull();

    importer.calls[0].onStage('reading');
    expect(loader.getState().progress).toBeNull();
    importer.calls[0].resolve({ clusters: [cluster('Bus', 3)] });
    await slow;
    expect(loader.getState().fileName).toBe('demo.dbc');
    expect(loader.getState().source).toBeNull();
    expect(stored.state.imported).toBeUndefined();
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });

  it('drops the error of an import that a newer file replaced', async () => {
    const { loader, importer, events } = setup();
    const first = loader.open('a.arxml', bytesOf('a'));
    const second = loader.open('b.kcd', bytesOf('b'));
    await tick();
    importer.calls[1].resolve({ clusters: [cluster('B', 1)] });
    await second;
    importer.calls[0].reject(new Error('too late'));
    await first;
    expect(loader.getState().fileName).toBe('b.kcd');
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });
});

describe('picking a cluster', () => {
  async function homer() {
    const s = setup();
    const done = s.loader.open('the_homer.kcd', bytesOf('<NetworkDefinition/>'));
    await tick();
    s.importer.calls[0].resolve({ clusters: HOMER });
    await done;
    s.events.length = 0;
    s.stored.log.length = 0;
    return s;
  }

  it('shows the picked cluster and remembers it for the stored file', async () => {
    const { loader, stored, events } = await homer();
    loader.selectCluster(2);
    expect(loader.getState().db).toBe(HOMER[2].db);
    expect(loader.getState().source?.cluster).toBe(2);
    expect(loader.getState().fileName).toBe('the_homer.kcd');
    expect(stored.log).toEqual(['setCluster the_homer.kcd Comfort']);
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });

  it('ignores the cluster already shown and clusters the file does not hold', async () => {
    const { loader, stored, events } = await homer();
    loader.selectCluster(0);
    loader.selectCluster(3);
    loader.selectCluster(-1);
    expect(loader.getState().db).toBe(HOMER[0].db);
    expect(stored.log).toEqual([]);
    expect(events).toEqual([]);
  });

  it('does nothing for a DBC', async () => {
    const { loader, events } = setup();
    await loader.open('demo.dbc', bytesOf(DEMO));
    loader.selectCluster(1);
    expect(events).toHaveLength(1);
  });
});

describe('restoring on startup', () => {
  it('restores a stored DBC first, and drops a stale imported file', async () => {
    const { loader, importer, stored, events } = setup({
      dbc: { name: 'demo.dbc', text: DEMO },
      imported: { name: 'old.arxml', bytes: bytesOf('a') },
    });
    await loader.restore();
    expect(loader.getState().fileName).toBe('demo.dbc');
    expect(importer.calls).toHaveLength(0);
    expect(stored.log).toEqual(['clearImported']);
    expect(events).toEqual([{ kind: 'shown', restored: true }]);
  });

  it('reads a stored import again, with its stages, and shows the cluster picked before', async () => {
    const { loader, importer, stored, events } = setup({
      imported: { name: 'the_homer.kcd', bytes: bytesOf('<NetworkDefinition/>'), cluster: 'Comfort' },
    });
    const done = loader.restore();
    await tick();
    expect(loader.getState().progress).toEqual({ name: 'the_homer.kcd', stage: 'runtime', packages: ['lxml'] });
    expect(textOf(importer.calls[0].bytes)).toBe('<NetworkDefinition/>');
    importer.calls[0].onStage('packages');
    expect(loader.getState().progress?.stage).toBe('packages');
    importer.calls[0].resolve({ clusters: HOMER });
    await done;
    expect(loader.getState().db).toBe(HOMER[2].db);
    expect(loader.getState().source?.cluster).toBe(2);
    expect(stored.log).toEqual([]); // nothing to write: it is what is stored
    expect(events).toEqual([{ kind: 'shown', restored: true }]);
  });

  it('does nothing when nothing is stored', async () => {
    const { loader, events } = setup();
    await loader.restore();
    expect(loader.getState()).toEqual({ db: null, fileName: '', source: null, progress: null });
    expect(events).toEqual([]);
  });

  it('reports a failed restore and keeps the file for the next start', async () => {
    const { loader, importer, stored, events } = setup({
      imported: { name: 'test.arxml', bytes: bytesOf('<AUTOSAR/>') },
    });
    const done = loader.restore();
    await tick();
    importer.calls[0].reject(new Error('offline'));
    await done;
    expect(loader.getState().db).toBeNull();
    expect(loader.getState().progress).toBeNull();
    expect(events).toEqual([{ kind: 'failed', name: 'test.arxml', error: 'offline', restored: true }]);
    expect(stored.state.imported?.name).toBe('test.arxml');
  });

  it('names the reason when the runtime is not there for a restore (offline before the first import)', async () => {
    const { loader, importer, stored, events } = setup({
      imported: { name: 'the_homer.kcd', bytes: bytesOf('<NetworkDefinition/>'), cluster: 'Comfort' },
    });
    const done = loader.restore();
    await tick();
    importer.calls[0].reject(new ImportFailure('runtime', 'Failed to fetch dynamically imported module'));
    await done;
    expect(events).toStrictEqual([
      { kind: 'failed', name: 'the_homer.kcd', error: 'Failed to fetch dynamically imported module', reason: 'runtime', restored: true },
    ]);
    expect(stored.state.imported?.cluster).toBe('Comfort');
  });

  it('gives way to a file the user opens while storage is still being read', async () => {
    const { loader, importer, stored, events } = setup({
      imported: { name: 'test.arxml', bytes: bytesOf('<AUTOSAR/>') },
    });
    stored.holdLoad();
    const restoring = loader.restore();
    await loader.open('demo.dbc', bytesOf(DEMO));
    stored.releaseLoad();
    await restoring;
    expect(importer.calls).toHaveLength(0);
    expect(loader.getState().fileName).toBe('demo.dbc');
    expect(events).toEqual([{ kind: 'shown', restored: false }]);
  });
});

describe('subscribers', () => {
  it('hear about every change until they unsubscribe', async () => {
    const { loader } = setup();
    let calls = 0;
    const unsubscribe = loader.subscribe(() => calls++);
    await loader.open('demo.dbc', bytesOf(DEMO));
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    unsubscribe();
    await loader.open('demo.dbc', bytesOf(DEMO));
    expect(calls).toBe(seen);
  });
});
