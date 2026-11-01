// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, TARGETS, classifyDifference, generate, renderBlocks } from '../../../scripts/docs/fidelity-tables.mjs';
import { CANMATRIX_FORMATS } from './canmatrix/formats';
import { SKIPPED_KEYWORDS } from './dbc/parser';

/**
 * The format reference (docs/reference/) carries tables generated from the
 * pinned baselines by scripts/docs/fidelity-tables.mjs. This suite regenerates
 * them and compares them with the committed pages, so a baseline that changes
 * without its documentation fails here. After an intended baseline change, run
 *   node scripts/docs/fidelity-tables.mjs
 * and commit the regenerated pages with it.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const importBaseline = JSON.parse(read('app/src/lib/canmatrix/import-corpus-baseline.json'));
const mapperBaseline = JSON.parse(read('app/src/lib/canmatrix/mapper-dbc-baseline.json'));
const dbcBaseline = JSON.parse(read('app/src/lib/dbc/corpus-baseline.json'));

describe('format reference generated from the baselines', () => {
  it.each(generate(root).map((t) => [t.file, t] as const))('%s matches the pinned baselines', (_file, target) => {
    expect(target.current, 'run `node scripts/docs/fidelity-tables.mjs` and commit the result').toBe(target.expected);
  });

  it('has a row for every format the app reads through canmatrix, and no other', () => {
    const appTypes = [...new Set(Object.values(CANMATRIX_FORMATS).map((f) => f.importType))].sort();
    expect(FORMATS.map((f) => f.importType).sort()).toEqual(appTypes);
    for (const f of FORMATS) {
      const extensions = Object.entries(CANMATRIX_FORMATS)
        .filter(([, v]) => v.importType === f.importType)
        .map(([ext]) => ext)
        .sort();
      expect([...f.extensions].sort(), f.importType).toEqual(extensions);
    }
  });

  it('counts every file and twin of the baselines', () => {
    const blocks = renderBlocks({ importBaseline, mapperBaseline, dbcBaseline });
    const reads = Object.keys(importBaseline.reads).length;
    const twins = Object.keys(importBaseline.twins).length;
    expect(blocks['import-formats']).toContain(`| **All formats** |  | **${reads}** |`);
    expect(blocks['import-twins']).toContain(`| **All formats** | **${twins}** |`);
    expect(blocks['mapper-summary']).toContain(`| DBC files read through canmatrix | ${Object.keys(mapperBaseline).length} |`);
    expect(blocks['dbc-corpus']).toContain(`| Files | ${Object.keys(dbcBaseline).length} |`);
    // One row per corpus file in the per-file tables.
    expect(blocks['import-files'].split('\n').filter((l) => l.startsWith('| `')).length).toBe(reads);
    expect(blocks['mapper-files'].split('\n').filter((l) => l.startsWith('| `')).length).toBe(
      Object.keys(mapperBaseline).length,
    );
  });

  it('knows every kind of difference the baselines record', () => {
    const lines = [
      ...Object.values(importBaseline.twins as Record<string, { differences: string[] }>).flatMap((t) => t.differences),
      ...Object.values(mapperBaseline as Record<string, { differences: string[] }>).flatMap((m) => m.differences),
    ];
    expect(lines.length).toBeGreaterThan(1000);
    for (const line of lines) expect(() => classifyDifference(line), line).not.toThrow();
  });

  it('classifies differences by what changed', () => {
    expect(classifyDifference('x0xCFFAC41 FRAME_CommandPower / RealPower_command: signal missing')).toBe('signal-missing');
    expect(classifyDifference('x0xFFAB41 FRAME_X / Enable_command: min -2 -> 0')).toBe('signal-min');
    expect(classifyDifference('0x477 BSM / LEFT_BS_STATUS: values 3 entries -> 0 entries')).toBe('signal-values');
    expect(classifyDifference('0x10 M / S: values[3] "a" -> "b"')).toBe('signal-values');
    expect(classifyDifference('x0xFFAB41 FRAME_X: attr[GenMsgStartValue] "00" -> "0000"')).toBe('message-attr');
    expect(classifyDifference('0x201 ID201: name "ID201" -> "ID20"')).toBe('message-name');
    expect(classifyDifference('0x10630000 DriverDoorStatus: message missing')).toBe('message-missing');
    expect(classifyDifference('0x10 X: message not in the DBC twin')).toBe('message-added');
    expect(classifyDifference('node ASCM: not in the DBC twin')).toBe('node-added');
    expect(classifyDifference('node SBW: missing')).toBe('node-missing');
    expect(classifyDifference('definition BO_ GenMsgCycleTime: missing')).toBe('definition-missing');
    expect(classifyDifference('definition SG_ LongName: not in the DBC twin')).toBe('definition-added');
    expect(classifyDifference('definition SG_ GenSigSendType: enumValues "No" -> "No,Yes"')).toBe('definition-changed');
    expect(classifyDifference('signal attribute ISignalName: only in the import, on 152 signals')).toBe('import-attr');
    expect(classifyDifference('nothing read (KeyError: x)')).toBe('nothing');
    expect(() => classifyDifference('something new')).toThrow();
  });

  it('escapes text that markdown, HTML or Vue would interpret', () => {
    const blocks = renderBlocks({ importBaseline, mapperBaseline, dbcBaseline });
    for (const [name, block] of Object.entries(blocks)) {
      expect(block, name).not.toMatch(/<file>|\{\{/);
    }
  });

  it('lists every target page with its blocks', () => {
    for (const target of TARGETS) {
      const page = read(target.file);
      for (const block of target.blocks) expect(page, target.file).toContain(`<!-- generated:${block} -->`);
    }
  });
});

describe('DBC reference', () => {
  const page = read('docs/reference/dbc.md');
  const notModelled = page.slice(page.indexOf('## Recognized, not modelled'));

  it('lists every statement the parser recognizes without modelling it', () => {
    expect(notModelled.length).toBeLessThan(page.length);
    for (const keyword of SKIPPED_KEYWORDS) expect(notModelled, keyword).toContain(`\`${keyword}\``);
  });
});
