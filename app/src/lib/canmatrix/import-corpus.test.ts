import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { compareDatabases } from './compare';
import { CANMATRIX_FORMATS, canmatrixFormatFor, fileExtension } from './formats';
import { missingWheels, startCanmatrix, type NodeCanmatrix } from './node-runtime';
import type { CanmatrixReadResult, ImportedCluster } from './types';

/**
 * Non-DBC corpus: the test files of canmatrix (tag 1.3.3.1, BSD-2-Clause) and
 * cantools (tag 45.1.2, MIT), vendored as shallow git submodules under
 * third_party/. Every file in a format canmatrix reads is loaded through
 * canmatrix under Pyodide, the runtime the app uses, and where a file has a
 * DBC twin the two are compared through CanViewer's model.
 *
 * What the readers make of each file is pinned in import-corpus-baseline.json.
 * Most of it is not right (see the twin differences); the point of pinning is
 * that any change, better or worse, shows up. Regenerate after an intended
 * change with
 *   UPDATE_IMPORT_BASELINE=1 npx vitest run app/src/lib/canmatrix/import-corpus.test.ts
 * and review the diff.
 *
 * The suite is skipped when the submodules are not checked out. With them it
 * needs the wheels in vendor/pyodide (`npm run fetch-wheels`); without them it
 * fails instead of skipping.
 */
const here = dirname(fileURLToPath(import.meta.url));
const THIRD_PARTY = join(here, '../../../../third_party');
const CANMATRIX_TESTS = join(THIRD_PARTY, 'canmatrix/tests');
const CANTOOLS_FILES = join(THIRD_PARTY, 'cantools/tests/files');
const BASELINE_FILE = join(here, 'import-corpus-baseline.json');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p: string) => relative(THIRD_PARTY, p);

const corpus: string[] = [CANMATRIX_TESTS, CANTOOLS_FILES]
  .filter((d) => existsSync(d))
  .flatMap(walk)
  .filter((f) => canmatrixFormatFor(f))
  .map(rel)
  .sort();

/**
 * DBC twins. canmatrix's tests/reference/from_<fmt>/ directories hold what an
 * older canmatrix converted tests/files/<fmt>/test.<fmt> into (tests/README:
 * "All others were generated from it by canmatrix itself"), so every file in
 * one directory, and the source file, describes the same database as the .dbc
 * next to them. cantools pairs files by name.
 */
function twinOf(file: string): string | undefined {
  const m = file.match(/^canmatrix\/tests\/reference\/from_(\w+)\//);
  if (m) {
    if (m[1] === 'dbc') return 'canmatrix/tests/files/dbc/test.dbc';
    const dir = join(THIRD_PARTY, dirname(file));
    const dbc = readdirSync(dir).find((f) => f.endsWith('.dbc'));
    return dbc ? join(dirname(file), dbc) : undefined;
  }
  const source = file.match(/^canmatrix\/tests\/files\/(?:\w+)\/test\.(\w+)$/);
  if (source && source[1] !== 'dbc') {
    const fmt = source[1] === 'xml' ? 'fibex' : source[1];
    const dir = join(CANMATRIX_TESTS, 'reference', `from_${fmt}`);
    const dbc = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.dbc')) : undefined;
    return dbc ? rel(join(dir, dbc)) : undefined;
  }
  const NAMED: Record<string, string> = {
    'cantools/tests/files/sym/comments_hex_and_motorola.sym':
      'cantools/tests/files/dbc/comments_hex_and_motorola_converted_from_sym.dbc',
  };
  if (NAMED[file]) return NAMED[file];
  const c = file.match(/^cantools\/tests\/files\/\w+\/(.+)\.\w+$/);
  if (c) {
    const dbc = `cantools/tests/files/dbc/${c[1]}.dbc`;
    if (existsSync(join(THIRD_PARTY, dbc))) return dbc;
  }
  return undefined;
}

const twins: Array<[string, string]> = corpus.flatMap((f) => {
  const t = twinOf(f);
  return t ? [[f, t] as [string, string]] : [];
});

/** Same decoding as the app: UTF-8 when valid, else Windows-1252. */
function decodeDbc(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/**
 * The cluster to compare with a twin: the one named like the twin's suffix
 * (canmatrix writes cluster "CAN" of test.arxml as test_CAN.dbc), else the
 * only one, else the first that holds messages.
 */
function pickCluster(clusters: ImportedCluster[], dbcFile: string): ImportedCluster | undefined {
  const stem = basename(dbcFile, '.dbc');
  return (
    clusters.find((c) => c.name && stem.endsWith(`_${c.name}`)) ??
    (clusters.length === 1 ? clusters[0] : clusters.find((c) => c.db.messages.length > 0) ?? clusters[0])
  );
}

interface ReadSummary {
  importType: string;
  error: string | null;
  clusters: Array<{ name: string; messages: number; signals: number }>;
  log: string[];
  /** What the mapper made of the log: "line: reason: text". */
  problems: string[];
}
interface TwinSummary {
  dbc: string;
  dbcMessages: number;
  dbcSignals: number;
  dbcProblems: number;
  cluster: string | null;
  differences: string[];
}
interface Baseline {
  reads: Record<string, ReadSummary>;
  twins: Record<string, TwinSummary>;
}

const UPDATE = process.env.UPDATE_IMPORT_BASELINE === '1';
const baseline: Baseline =
  !UPDATE && existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { reads: {}, twins: {} };
const recorded: Baseline = { reads: {}, twins: {} };
const results = new Map<string, CanmatrixReadResult>();

const countSignals = (c: ImportedCluster) => c.db.messages.reduce((n, m) => n + m.signals.length, 0);
const ALL_PACKAGES = [...new Set(Object.values(CANMATRIX_FORMATS).flatMap((f) => f.packages))];

describe.skipIf(corpus.length === 0)('non-DBC corpus (canmatrix and cantools submodules)', () => {
  let cm: NodeCanmatrix;

  beforeAll(async () => {
    const missing = missingWheels();
    if (missing.length) {
      throw new Error(`wheels missing from vendor/pyodide, run \`npm run fetch-wheels\`: ${missing.join(', ')}`);
    }
    cm = await startCanmatrix();
    await cm.loadPackages(ALL_PACKAGES);
  }, 120_000);

  afterAll(() => {
    cm?.close();
    if (UPDATE) {
      const sort = <T>(o: Record<string, T>) =>
        Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
      writeFileSync(
        BASELINE_FILE,
        JSON.stringify({ reads: sort(recorded.reads), twins: sort(recorded.twins) }, null, 2) + '\n',
      );
    }
  });

  it('found the corpus', () => {
    const count = (prefix: string) => {
      const byExt: Record<string, number> = {};
      for (const f of corpus.filter((f) => f.startsWith(prefix))) {
        const ext = fileExtension(f);
        byExt[ext] = (byExt[ext] ?? 0) + 1;
      }
      return byExt;
    };
    // The handover's inventory (docs/handover/2026-11-01-multi-format-import.md,
    // task 2). Its ninth XLSX is examples/cmTemplate.xlsx, a template outside tests/.
    expect(count('canmatrix/')).toEqual({
      arxml: 13, dbf: 8, json: 8, kcd: 8, sym: 8, xlsx: 8, xml: 8, yaml: 8,
    });
    expect(count('cantools/')).toEqual({ arxml: 15, kcd: 9, sym: 21 });
    expect(twins.length).toBeGreaterThanOrEqual(70);
  });

  it('baseline lists exactly the corpus files and twins', () => {
    if (UPDATE) return;
    expect(Object.keys(baseline.reads)).toEqual(corpus);
    expect(Object.keys(baseline.twins)).toEqual(twins.map(([f]) => f).sort());
  });

  it.each(corpus)('%s reads as pinned', (file) => {
    const format = canmatrixFormatFor(file)!;
    const result = cm.read(readFileSync(join(THIRD_PARTY, file)), format.importType);
    results.set(file, result);
    const summary: ReadSummary = {
      importType: format.importType,
      error: result.error ?? null,
      clusters: result.clusters.map((c) => ({
        name: c.name,
        messages: c.db.messages.length,
        signals: countSignals(c),
      })),
      log: result.log,
      problems: (result.clusters[0]?.db.problems ?? []).map((p) => `${p.line}: ${p.reason}: ${p.text.slice(0, 100)}`),
    };
    if (UPDATE) recorded.reads[file] = summary;
    else expect(summary).toEqual(baseline.reads[file]);
  });

  it.each(twins)('%s matches its DBC twin %s as pinned', (file, dbcFile) => {
    const result = results.get(file);
    expect(result, 'the read test for this file must run first').toBeDefined();
    const dbc = parseDbc(decodeDbc(readFileSync(join(THIRD_PARTY, dbcFile))));
    const cluster = pickCluster(result!.clusters, dbcFile);
    const differences = cluster
      ? compareDatabases(dbc, cluster.db)
      : [`nothing read${result!.error ? ` (${result!.error})` : ''}`];
    const summary: TwinSummary = {
      dbc: dbcFile,
      dbcMessages: dbc.messages.length,
      dbcSignals: dbc.messages.reduce((n, m) => n + m.signals.length, 0),
      dbcProblems: dbc.problems.length,
      cluster: cluster ? cluster.name : null,
      differences,
    };
    if (UPDATE) recorded.twins[file] = summary;
    else expect(summary).toEqual(baseline.twins[file]);
  });

  it('never touched the network', () => {
    expect(cm.fetchCalls).toEqual([]);
  });
});
