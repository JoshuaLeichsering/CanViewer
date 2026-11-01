import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanFd, isJ1939Pg } from './canfd';
import { isJ1939Database } from './j1939';
import { parseDbc } from './parser';
import type { DbcDatabase } from './types';

/**
 * Real-world corpus test against the OEM databases vendored as git submodules
 * under third_party/ (run `git submodule update --init` to fetch them).
 * The suite is skipped when the submodules are not checked out.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');
const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'corpus-baseline.json');

/**
 * Genuine inconsistencies in the upstream files: stale CM_/VAL_ statements
 * referencing signals that were renamed or removed upstream. Everything else
 * must parse without problems. Counts are stable because the submodules pin
 * exact commits — update them together with a submodule bump.
 */
const KNOWN_UPSTREAM_PROBLEMS: Record<string, number> = {
  'chrysler_cusw.dbc': 4,
  'gm_global_a_lowspeed.dbc': 1,
  'rivian_primary_actuator.dbc': 2,
  'tesla_can.dbc': 1,
  'volvo_v40_2017_pt.dbc': 4,
  'vw_mqb.dbc': 17,
  'vw_pq.dbc': 7,
};

const files: Array<[string, string]> = existsSync(OPENDBC_DIR)
  ? readdirSync(OPENDBC_DIR)
      .filter((f) => f.endsWith('.dbc'))
      .map((f) => [f, join(OPENDBC_DIR, f)] as [string, string])
  : [];
if (existsSync(MODEL3_FILE)) files.push(['Model3CAN.dbc', MODEL3_FILE]);

/**
 * What the parser makes of one corpus file: readable counts, plus a SHA-256 of
 * the whole parsed model so that any change to it shows up, not only a change
 * to a count.
 */
interface CorpusSummary {
  messages: number;
  extendedMessages: number;
  signals: number;
  nodes: number;
  valueTables: number;
  attributeDefinitions: number;
  multiplexors: number;
  multiplexedSignals: number;
  extendedMuxSignals: number;
  floatSignals: number;
  doubleSignals: number;
  signalsWithValues: number;
  signalsWithComment: number;
  fdMessages: number;
  j1939Pgs: number;
  j1939Database: boolean;
  problems: number;
  skipped: Record<string, number>;
  modelSha256: string;
}

function summarize(db: DbcDatabase): CorpusSummary {
  const signals = db.messages.flatMap((m) => m.signals);
  const role = (r: string) => signals.filter((s) => s.multiplex.role === r).length;
  return {
    messages: db.messages.length,
    extendedMessages: db.messages.filter((m) => m.isExtended).length,
    signals: signals.length,
    nodes: db.nodes.length,
    valueTables: db.valueTables.length,
    attributeDefinitions: db.attributeDefinitions.length,
    multiplexors: role('multiplexor') + role('both'),
    multiplexedSignals: role('multiplexed') + role('both'),
    extendedMuxSignals: signals.filter((s) => s.multiplex.extended).length,
    floatSignals: signals.filter((s) => s.valueType === 'float').length,
    doubleSignals: signals.filter((s) => s.valueType === 'double').length,
    signalsWithValues: signals.filter((s) => s.values && Object.keys(s.values).length > 0).length,
    signalsWithComment: signals.filter((s) => s.comment !== undefined).length,
    fdMessages: db.messages.filter((m) => isCanFd(db, m)).length,
    j1939Pgs: db.messages.filter((m) => isJ1939Pg(db, m)).length,
    j1939Database: isJ1939Database(db),
    problems: db.problems.length,
    skipped: db.skipped,
    modelSha256: createHash('sha256').update(JSON.stringify(db)).digest('hex'),
  };
}

/**
 * The pinned baseline (corpus-baseline.json) was recorded before multi-format
 * import work started; that work must not change how DBC files parse. After an
 * intended parser change or a submodule bump, regenerate it with
 *   UPDATE_CORPUS_BASELINE=1 npx vitest run src/lib/dbc/corpus.test.ts
 * and review the diff.
 */
const UPDATE = process.env.UPDATE_CORPUS_BASELINE === '1';
const baseline: Record<string, CorpusSummary> =
  !UPDATE && existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const recorded: Record<string, CorpusSummary> = {};

describe.skipIf(files.length === 0)('OEM corpus (third_party submodules)', () => {
  it('found the corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(58);
  });

  it.each(files)('%s parses cleanly', (name, path) => {
    const db = parseDbc(readFileSync(path, 'latin1'));
    expect(db.messages.length).toBeGreaterThan(0);
    expect(db.problems.length).toBeLessThanOrEqual(KNOWN_UPSTREAM_PROBLEMS[name] ?? 0);
    // Whatever is reported must be a dangling reference in the source file,
    // never a statement our parser failed to understand.
    for (const p of db.problems) {
      expect(p.reason, `${name}:${p.line} ${p.text}`).toMatch(/references unknown/);
    }
  });

  it('baseline lists exactly the corpus files', () => {
    if (UPDATE) return;
    expect(Object.keys(baseline).sort()).toEqual(files.map(([name]) => name).sort());
  });

  it.each(files)('%s matches the pinned baseline', (name, path) => {
    const summary = summarize(parseDbc(readFileSync(path, 'latin1')));
    if (UPDATE) {
      recorded[name] = summary;
      if (Object.keys(recorded).length === files.length) {
        const sorted = Object.fromEntries(Object.keys(recorded).sort().map((k) => [k, recorded[k]]));
        writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
      }
      return;
    }
    expect(summary).toEqual(baseline[name]);
  });
});
