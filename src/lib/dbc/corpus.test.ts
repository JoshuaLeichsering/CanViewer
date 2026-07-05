import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from './parser';

/**
 * Real-world corpus test against the OEM databases vendored as git submodules
 * under third_party/ (run `git submodule update --init` to fetch them).
 * The suite is skipped when the submodules are not checked out.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');

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
});
