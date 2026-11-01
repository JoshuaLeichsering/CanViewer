// Shared by the export tests: the databases they run on, and the pinned
// output files they compare against. Not part of the app.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase, DbcMessage } from '../dbc/types';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../../../..');
export const PINNED_DIR = join(here, 'pinned');

export const demo = parseDbc(readFileSync(join(repoRoot, 'examples/demo.dbc'), 'utf8'));

/** A corpus DBC file, read as the corpus suites read them (Latin-1: some are not UTF-8). */
export const corpusDb = (path: string): DbcDatabase => parseDbc(readFileSync(join(repoRoot, path), 'latin1'));

export function messageNamed(db: DbcDatabase, name: string): DbcMessage {
  const message = db.messages.find((m) => m.name === name);
  if (!message) throw new Error(`no message ${name}`);
  return message;
}

/** The two corpus messages whose output is pinned besides demo.dbc's. */
export const PINNED_CORPUS = [
  // A J1939 parameter group in a J1939 database (ProtocolType "J1939").
  { dir: 'j1939-EEC1', file: 'third_party/canmatrix/src/canmatrix/j1939.dbc', message: 'EEC1' },
  // A 24-byte CAN FD frame with Intel and Motorola signals and an exponent in a factor.
  { dir: 'fd-HCA_03', file: 'third_party/opendbc/opendbc/dbc/vw_meb.dbc', message: 'HCA_03' },
] as const;

/**
 * Time allowed for a test that runs over a whole corpus file or calls the C
 * compiler: a loaded machine can take more than Vitest's default 5 s.
 */
export const CORPUS_TIMEOUT = 60_000;

export const corpusPresent = PINNED_CORPUS.every((p) => existsSync(join(repoRoot, p.file)));

/**
 * Every DBC file of the corpus submodules: the 58 OEM databases of the corpus
 * suite (opendbc and Model3CAN.dbc) and the DBC test files of cantools and
 * canmatrix, which collect the odd cases (long names, floats, extended
 * multiplexing, odd lengths). Empty when the submodules are not checked out.
 */
export function corpusFiles(): string[] {
  const dirs = [
    'third_party/opendbc/opendbc/dbc',
    'third_party/model3dbc',
    'third_party/cantools/tests/files/dbc',
    'third_party/canmatrix/tests/files/dbc',
    'third_party/canmatrix/src/canmatrix',
  ];
  return dirs
    .filter((dir) => existsSync(join(repoRoot, dir)))
    .flatMap((dir) =>
      readdirSync(join(repoRoot, dir))
        .filter((f) => f.endsWith('.dbc'))
        .sort()
        .map((f) => `${dir}/${f}`),
    );
}

/**
 * Compare generated output with its pinned file, byte for byte. A missing
 * pinned file fails. After an intended change to the output, rewrite them with
 *   UPDATE_EXPORT_PINNED=1 npx vitest run app/src/lib/export
 * and review the diff.
 */
export function expectPinned(path: string, actual: string): void {
  const file = join(PINNED_DIR, path);
  if (process.env.UPDATE_EXPORT_PINNED === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  const where = relative(repoRoot, file);
  expect(existsSync(file), `${where} is missing; write it with UPDATE_EXPORT_PINNED=1`).toBe(true);
  expect(actual, `${where} differs`).toBe(readFileSync(file, 'utf8'));
}
