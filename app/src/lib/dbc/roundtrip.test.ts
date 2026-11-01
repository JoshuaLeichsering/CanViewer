import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from './parser';
import { notWritten, writeDbc } from './writer';
import type { DbcDatabase } from './types';

/**
 * The DBC writer's round-trip guarantee, checked on the OEM corpus (the same
 * 58 files as corpus.test.ts): parse → write → parse gives the same model.
 *
 * "The same model" is checked against the pinned corpus baseline itself: the
 * re-parsed database, hashed the way corpus.test.ts hashes a parse
 * (SHA-256 of JSON.stringify), must give the file's modelSha256 from
 * corpus-baseline.json. The two parse diagnostics are carried over from the
 * first parse before hashing, because they describe the source text and not
 * the database: `problems` holds line numbers and dangling references the
 * model cannot hold, and `skipped` counts statements CanViewer does not model.
 * What the writer does with them is asserted separately below. See
 * docs/decisions/0002-dbc-writer.md.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');
const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'corpus-baseline.json');

const files: Array<[string, string]> = existsSync(OPENDBC_DIR)
  ? readdirSync(OPENDBC_DIR)
      .filter((f) => f.endsWith('.dbc'))
      .map((f) => [f, join(OPENDBC_DIR, f)] as [string, string])
  : [];
if (existsSync(MODEL3_FILE)) files.push(['Model3CAN.dbc', MODEL3_FILE]);

const baseline: Record<string, { modelSha256: string }> = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : {};

const modelSha256 = (db: DbcDatabase) => createHash('sha256').update(JSON.stringify(db)).digest('hex');

describe.skipIf(files.length === 0)('DBC writer round trip on the OEM corpus (third_party submodules)', () => {
  it('found the corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(58);
  });

  it.each(files)('%s round-trips through the writer', (name, path) => {
    const first = parseDbc(readFileSync(path, 'latin1'));
    // The first parse is the one the baseline pins (corpus.test.ts checks it in full).
    expect(modelSha256(first)).toBe(baseline[name]?.modelSha256);

    const { text, issues } = writeDbc(first);
    expect(issues).toEqual([]);

    const second = parseDbc(text);
    // The writer only writes what the parser reads back: no problems, and only
    // the two header statements CanViewer skips (NS_ and BS_).
    expect(second.problems).toEqual([]);
    expect(second.skipped).toEqual({ NS_: 1, BS_: 1 });
    // So a saved file, opened again, saves without a list of losses.
    expect(notWritten(second)).toEqual({ skipped: [], problems: 0 });

    const carried: DbcDatabase = { ...second, problems: first.problems, skipped: first.skipped };
    expect(modelSha256(carried)).toBe(baseline[name].modelSha256);

    // Writing is stable: the re-parsed model writes the same text again.
    expect(writeDbc(second).text).toBe(text);
  });
});
