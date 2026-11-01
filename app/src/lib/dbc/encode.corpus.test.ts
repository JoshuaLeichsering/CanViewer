import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signalOutOfBounds, signalsOverlap } from './bits';
import { messageRoundTrip, physicalRoundTrip, rawRoundTrip } from './encode-properties';
import { parseDbc } from './parser';
import type { DbcDatabase, DbcMessage } from './types';

/**
 * Property tests of the frame encoder over the OEM corpus vendored as git
 * submodules under third_party/ (the 58 files of corpus.test.ts). Every signal
 * of every file round-trips on its own; whole frames, multiplexing included,
 * round-trip for a fixed sample of each file's messages: all multiplexed
 * messages, all whose signals share bits, all with a signal outside the data
 * area, and every tenth of the others. scripts/check-test-report.mjs counts
 * the tests, so a missing submodule cannot pass for a green run.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');

const files: Array<[string, string]> = existsSync(OPENDBC_DIR)
  ? readdirSync(OPENDBC_DIR)
      .filter((f) => f.endsWith('.dbc'))
      .map((f) => [f, join(OPENDBC_DIR, f)] as [string, string])
  : [];
if (existsSync(MODEL3_FILE)) files.push(['Model3CAN.dbc', MODEL3_FILE]);

const parsed = new Map<string, DbcDatabase>();
const load = (path: string) => {
  if (!parsed.has(path)) parsed.set(path, parseDbc(readFileSync(path, 'latin1')));
  return parsed.get(path)!;
};

/** The messages whose whole frames are checked. */
function sampleMessages(db: DbcDatabase): DbcMessage[] {
  const sorted = [...db.messages].sort((a, b) => a.rawId - b.rawId);
  const interesting = (m: DbcMessage) =>
    m.signals.some((s) => s.multiplex.role !== 'none') ||
    m.signals.some((s) => signalOutOfBounds(s, m.dlc)) ||
    m.signals.some((a, i) => m.signals.some((b, j) => j > i && signalsOverlap(a, b)));
  let others = 0;
  return sorted.filter((m) => interesting(m) || others++ % 10 === 0);
}

const covered = { signals: 0, messages: 0 };

describe.skipIf(files.length === 0)('frame encoder on the OEM corpus (property tests)', () => {
  it.each(files)(
    '%s: every signal round-trips through the encoder',
    (_, path) => {
      for (const message of load(path).messages) {
        for (const signal of message.signals) {
          rawRoundTrip(signal, message.dlc, 6);
          physicalRoundTrip(signal, message.dlc, 12);
          covered.signals++;
        }
      }
    },
    120_000,
  );

  it.each(files)(
    '%s: its sampled messages round-trip as whole frames',
    (_, path) => {
      for (const message of sampleMessages(load(path))) {
        messageRoundTrip(message, 25);
        covered.messages++;
      }
    },
    120_000,
  );

  it('covered every corpus signal and the whole sample', () => {
    // Pinned with the submodule commits: a change here means the corpus or the sample changed.
    expect(covered).toEqual({ signals: 33651, messages: 680 });
  });
});
