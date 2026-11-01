import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { countChanges, diffDatabases, diffLines, hasChanges, type DiffCounts } from './diff';

/**
 * Diff mode on the OEM corpus (the third_party submodules; run
 * `git submodule update --init` to fetch them):
 * - every corpus file diffed with a second parse of itself shows no change;
 * - two versions of a real database give the diff pinned in
 *   diff-corpus-baseline.json, line by line, and its mirror image when swapped;
 * - a version derived in the test from a corpus file by known edits gives
 *   exactly those edits.
 *
 * The pinned pairs, both from opendbc:
 * - toyota_adas.dbc -> toyota_tss2_adas.dbc: the radar database of Toyota
 *   Safety Sense P cars and its version for TSS 2.0 cars. The same messages;
 *   the track messages moved to other ids, some grew to 8 bytes, two are new.
 * - vw_mqb.dbc -> vw_mqbevo.dbc: Volkswagen's MQB database and opendbc's
 *   version of it for the successor platform, MQB Evo, which was derived from
 *   it (its receivers are still the MQB nodes). Every kind of change occurs.
 *
 * After an intended change to diff mode or a submodule bump, regenerate the
 * baseline with
 *   UPDATE_DIFF_BASELINE=1 npx vitest run app/src/lib/diff/diff-corpus.test.ts
 * and review the diff.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');
const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'diff-corpus-baseline.json');

const files: Array<[string, string]> = existsSync(OPENDBC_DIR)
  ? readdirSync(OPENDBC_DIR)
      .filter((f) => f.endsWith('.dbc'))
      .sort()
      .map((f) => [f, join(OPENDBC_DIR, f)] as [string, string])
  : [];
if (existsSync(MODEL3_FILE)) files.push(['Model3CAN.dbc', MODEL3_FILE]);

const PAIRS: Array<[string, string]> = [
  ['toyota_adas.dbc', 'toyota_tss2_adas.dbc'],
  ['vw_mqb.dbc', 'vw_mqbevo.dbc'],
];
const pairName = ([before, after]: [string, string]) => `${before} -> ${after}`;

/** Read as the corpus test does: the files are ASCII apart from a few comments. */
const read = (path: string) => readFileSync(path, 'latin1');
const opendbc = (name: string) => parseDbc(read(join(OPENDBC_DIR, name)));

interface Pinned {
  counts: DiffCounts;
  sha256: string;
  lines: string[];
}
const UPDATE = process.env.UPDATE_DIFF_BASELINE === '1';
const baseline: Record<string, Pinned> =
  !UPDATE && existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const recorded: Record<string, Pinned> = {};

describe.skipIf(files.length === 0)('diff mode on the OEM corpus (third_party submodules)', () => {
  afterAll(() => {
    if (UPDATE) writeFileSync(BASELINE_FILE, JSON.stringify(recorded, null, 2) + '\n');
  });

  it.each(files)('%s has no differences with itself', (_name, path) => {
    const text = read(path);
    const diff = diffDatabases(parseDbc(text), parseDbc(text));
    expect(diffLines(diff)).toEqual([]);
    expect(hasChanges(diff)).toBe(false);
    expect(diff.messages.every((m) => m.kind === 'unchanged')).toBe(true);
  });

  it('baseline lists exactly the pinned pairs', () => {
    if (UPDATE) return;
    expect(Object.keys(baseline)).toEqual(PAIRS.map(pairName));
  });

  it.each(PAIRS)('%s -> %s gives the pinned diff', (beforeFile, afterFile) => {
    const diff = diffDatabases(opendbc(beforeFile), opendbc(afterFile));
    const lines = diffLines(diff);
    const pinned: Pinned = {
      counts: countChanges(diff),
      sha256: createHash('sha256').update(lines.join('\n')).digest('hex'),
      lines,
    };
    if (UPDATE) recorded[pairName([beforeFile, afterFile])] = pinned;
    else expect(pinned).toEqual(baseline[pairName([beforeFile, afterFile])]);
  });

  it.each(PAIRS)('%s -> %s swapped gives the mirror image', (beforeFile, afterFile) => {
    const forward = diffDatabases(opendbc(beforeFile), opendbc(afterFile));
    const back = diffDatabases(opendbc(afterFile), opendbc(beforeFile));
    const mirrored = (c: DiffCounts[keyof Omit<DiffCounts, 'database'>]) => ({ ...c, added: c.removed, removed: c.added });
    const f = countChanges(forward);
    const b = countChanges(back);
    expect(b.messages).toEqual(mirrored(f.messages));
    expect(b.signals).toEqual(mirrored(f.signals));
    expect(b.nodes).toEqual(mirrored(f.nodes));
    expect(b.valueTables).toEqual(mirrored(f.valueTables));
    expect(b.attributeDefinitions).toEqual(mirrored(f.attributeDefinitions));
    expect(b.database).toBe(f.database);
    expect(diffLines(back).length).toBe(diffLines(forward).length);
  });

  it('finds exactly the edits made to a corpus file (vw_meb.dbc)', () => {
    const text = read(join(OPENDBC_DIR, 'vw_meb.dbc'));
    const edits: Array<[RegExp, string]> = [
      // a node and a message added, a message removed
      [/^(BU_: .*)$/m, '$1 Gateway_Neu'],
      [/$/, '\nBO_ 2047 Diag_Neu: 8 Gateway\n SG_ Diag_Code : 0|16@1+ (1,0) [0|65535] "" XXX\n'],
      [/^BO_ 134 LWI_01:[\s\S]*?\n\n/m, ''],
      // in LH_EPS_03: a comment, a factor, value descriptions, a signal replaced by another
      [/^(CM_ BO_ 184 )/m, 'CM_ BO_ 159 "Steering status";\n$1'],
      [/^( SG_ EPS_Lenkmoment : 40\|10@1\+ )\(1,0\)/m, '$1(0.01,0)'],
      [/^(VAL_ 159 EPS_HCA_Status .*) 8 "preempted";/m, '$1 6 "limited" 8 "overridden";'],
      [/^ SG_ EPS_Lenkungstyp : 60\|4@1\+ .*$/m, ' SG_ EPS_Neu : 56|8@1+ (1,0) [0|255] "" XXX'],
    ];
    const edited = edits.reduce((t, [from, to]) => {
      expect(from.test(t), String(from)).toBe(true);
      return t.replace(from, to);
    }, text);
    expect(diffLines(diffDatabases(parseDbc(text), parseDbc(edited)))).toEqual([
      'node Gateway_Neu: added',
      'message 0x086 LWI_01: removed',
      'message 0x09F LH_EPS_03: comment "" -> "Steering status"',
      'message 0x09F LH_EPS_03 / EPS_HCA_Status: values[6] undefined -> "limited"',
      'message 0x09F LH_EPS_03 / EPS_HCA_Status: values[8] "preempted" -> "overridden"',
      'message 0x09F LH_EPS_03 / EPS_Lenkmoment: factor 1 -> 0.01',
      'message 0x09F LH_EPS_03 / EPS_Lenkungstyp: removed',
      'message 0x09F LH_EPS_03 / EPS_Neu: added',
      'message 0x7FF Diag_Neu: added',
    ]);
  });
});
