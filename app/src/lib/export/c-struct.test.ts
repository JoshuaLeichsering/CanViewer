import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase } from '../dbc/types';
import { cStruct, memberType } from './c-struct';
import { CORPUS_TIMEOUT, corpusDb, corpusFiles, corpusPresent, demo, expectPinned, messageNamed, PINNED_CORPUS, PINNED_DIR, repoRoot } from './test-fixtures';

/**
 * The generated C must compile. These tests run the C compiler (`$CC`, or
 * `cc`) in syntax-only mode with every warning an error. Without a compiler
 * they are skipped with the reason printed, except in CI (`CI` set), where a
 * missing compiler fails them: CI must never pass without compiling.
 */
const CC = process.env.CC || 'cc';
const ccVersion = spawnSync(CC, ['--version'], { encoding: 'utf8' });
const haveCc = ccVersion.status === 0;
const inCi = Boolean(process.env.CI);
const runCompile = haveCc || inCi;
if (!haveCc) {
  const why = `no C compiler: "${CC} --version" failed (${ccVersion.error?.message ?? ccVersion.stderr?.trim()})`;
  console.warn(inCi ? `${why}; CI requires one, so the compile tests fail` : `${why}; the compile tests are skipped`);
}

const FLAGS = ['-fsyntax-only', '-std=c99', '-pedantic-errors', '-Wall', '-Wextra', '-Werror', '-x', 'c'];

const scratch = mkdtempSync(join(tmpdir(), 'canviewer-c-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Compile each file as its own translation unit, with one compiler per CPU
 * running at a time; batches keep the command lines short.
 */
async function expectCompiles(files: string[]) {
  expect(haveCc, `the C compiler "${CC}" is required in CI`).toBe(true);
  const size = Math.min(100, Math.max(8, Math.ceil(files.length / availableParallelism())));
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += size) batches.push(files.slice(i, i + size));
  const results = await Promise.all(
    batches.map(
      (batch) =>
        new Promise<string>((done) =>
          execFile(CC, [...FLAGS, ...batch], (error, stdout, stderr) =>
            done(stdout + stderr + (error ? `\n${CC} exited with ${error.code}` : '')),
          ),
        ),
    ),
  );
  expect(results.join(''), `${CC} ${FLAGS.join(' ')} failed`).toBe('');
}

/** Write every message's C struct to its own file. */
function writeAll(db: DbcDatabase, label: string, dir: string): string[] {
  const out = join(scratch, dir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  return db.messages.map((m, i) => {
    const file = join(out, `${i}.h`);
    writeFileSync(file, cStruct(db, m, label));
    return file;
  });
}

describe('memberType', () => {
  it('picks the smallest <stdint.h> type that holds the raw value', () => {
    const type = (valueType: 'unsigned' | 'signed' | 'float' | 'double', length: number) =>
      memberType({ valueType, length }).type + memberType({ valueType, length }).suffix;
    expect(type('unsigned', 1)).toBe('uint8_t');
    expect(type('unsigned', 8)).toBe('uint8_t');
    expect(type('unsigned', 9)).toBe('uint16_t');
    expect(type('signed', 12)).toBe('int16_t');
    expect(type('unsigned', 17)).toBe('uint32_t');
    expect(type('signed', 33)).toBe('int64_t');
    expect(type('unsigned', 64)).toBe('uint64_t');
    expect(type('float', 32)).toBe('float');
    expect(type('double', 64)).toBe('double');
    // The decoder reads a float of any other width as an unsigned integer; so does the struct.
    expect(type('float', 16)).toBe('uint16_t');
    expect(type('unsigned', 72)).toBe('uint8_t[9]');
  });
});

describe('C struct, pinned', () => {
  it.each(demo.messages.map((m) => [m.name, m] as const))('demo.dbc %s', (name, message) => {
    expectPinned(`demo/${name}.h`, cStruct(demo, message, 'demo.dbc'));
  });

  describe.skipIf(!corpusPresent)('corpus', () => {
    it.each(PINNED_CORPUS.map((p) => [`${p.file} ${p.message}`, p] as const))('%s', (_, p) => {
      const db = corpusDb(p.file);
      expectPinned(`${p.dir}/${p.message}.h`, cStruct(db, messageNamed(db, p.message), p.file.split('/').pop()!));
    });
  });
});

describe.skipIf(!runCompile)(`C struct compiles with ${CC} ${FLAGS.join(' ')}`, () => {
  it('every pinned C struct', async () => {
    const files = readdirSync(PINNED_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.h'))
      .map((f) => join(PINNED_DIR, f));
    expect(files.map((f) => relative(PINNED_DIR, f)).sort()).toEqual(
      [...demo.messages.map((m) => `demo/${m.name}.h`), ...PINNED_CORPUS.map((p) => `${p.dir}/${p.message}.h`)].sort(),
    );
    await expectCompiles(files);
  }, CORPUS_TIMEOUT);

  it('all of demo.dbc in one translation unit', async () => {
    const file = join(scratch, 'demo-all.h');
    writeFileSync(file, demo.messages.map((m) => cStruct(demo, m, 'demo.dbc')).join('\n'));
    await expectCompiles([file]);
  }, CORPUS_TIMEOUT);

  it('names and comments that are not C', async () => {
    const db = parseDbc(
      [
        'VERSION ""',
        'BU_: A',
        'BO_ 1 int: 8 A',
        ' SG_ default : 0|8@1+ (1,0) [0|0] "*/ /* ??/" A',
        ' SG_ INT__ID : 8|8@1+ (1,0) [0|0] "" A',
        ' SG_ UINT8_MAX : 16|8@1+ (1,0) [0|0] "" A',
        ' SG_ linux : 24|8@1+ (1,0) [0|0] "" A',
        ' SG_ Dup : 32|4@1+ (1,0) [0|0] "" A',
        ' SG_ Dup : 36|4@1+ (1,0) [0|0] "" A',
        ' SG_ __x : 40|8@1+ (1,0) [0|0] "" A',
        ' SG_ Wide : 0|72@1+ (1,0) [0|0] "" A',
        'BO_ 2 uint8: 8 A',
        ' SG_ uint8_t : 0|8@1+ (1,0) [0|0] "" A',
        'BO_ 3 Empty: 0 A',
        'BO_ 4 _engine: 8 A',
        ' SG_ _speed : 0|8@1+ (1,0) [0|0] "" A',
        // The parser reads \" as an escaped quote, so a space follows the backslash; comments drop it.
        'CM_ BO_ 1 "Ends with a backslash \\ ";',
        'CM_ SG_ 1 default "Line one',
        'ends in ??/";',
        '',
      ].join('\n'),
    );
    expect(db.problems).toEqual([]);
    expect(db.messages.map((m) => m.signals.length)).toEqual([8, 1, 0, 1]);
    expect(db.messages[0].comment).toMatch(/\\ $/);
    expect(db.messages[0].signals[0].comment).toMatch(/\?\?\/$/);
    const files = writeAll(db, 'odd */ name.dbc', 'odd');
    await expectCompiles(files);
    const text = cStruct(db, db.messages[0], 'odd.dbc');
    expect(text).toContain('uint8_t default_;');
    expect(text).toContain('uint8_t INT__ID_;');
    expect(text).toContain('uint8_t UINT8_MAX_;');
    expect(text).toContain('uint8_t linux_;');
    expect(text).toContain('uint8_t Dup;');
    expect(text).toContain('uint8_t Dup_2;');
    expect(text).toContain('uint8_t x__x;');
    expect(text).toContain('uint8_t Wide[9];');
    expect(text).toContain('} int__t;');
    expect(cStruct(db, db.messages[1], 'odd.dbc')).toContain('} uint8__t;');
    expect(cStruct(db, db.messages[2], 'odd.dbc')).toContain('/* Empty has no signals, so there is no struct. */');
    // A file-scope name must not start with an underscore (C99 7.1.3); a member may, before a lower-case letter.
    const underscored = cStruct(db, db.messages[3], 'odd.dbc');
    expect(underscored).toContain('#define X_ENGINE_ID 0x004u');
    expect(underscored).toContain('#define X_ENGINE_IS_EXTENDED 0');
    expect(underscored).toContain('#define X_ENGINE_LENGTH 8u');
    expect(underscored).toContain('uint8_t _speed;');
    expect(underscored).toContain('} x_engine_t;');
    expect(underscored).not.toMatch(/^#define _|^} _/m);
  }, CORPUS_TIMEOUT);

  describe.skipIf(corpusFiles().length === 0)('corpus', () => {
    it.each(corpusFiles())("%s: every message's C struct compiles", async (file) => {
      const db = corpusDb(file);
      await expectCompiles(writeAll(db, file.split('/').pop()!, relative(repoRoot, file).replace(/\W/g, '_')));
    }, CORPUS_TIMEOUT);
  });
});
