// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * Prose that repeats a count of the corpora or a download size, here and there
 * in the documentation, must say what the baselines and the shipped files say;
 * otherwise it goes stale without a test noticing. Each pattern names the
 * number it must equal, and must find at least one sentence.
 */
describe('numbers written into the documentation by hand', () => {
  const EXCLUDED = new Set(['docs/spikes', 'docs/design', 'docs/.vitepress']);
  const markdownIn = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) return EXCLUDED.has(path) ? [] : markdownIn(path);
      return e.name.endsWith('.md') ? [path] : [];
    });
  const pages = ['README.md', 'CONTRIBUTING.md', 'BACKLOG.md', ...markdownIn('docs')].map((file) => ({
    file,
    // Line breaks are spaces to a reader, so sentences match across them.
    text: read(file).replace(/\s+/g, ' '),
  }));
  const found = (pattern: RegExp) =>
    pages.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((m) => ({ file, sentence: m[0], number: m[1] })));
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const toNumber = (s: string) => (WORDS.includes(s) ? WORDS.indexOf(s) : Number(s.replace(/,/g, '')));

  const reads = Object.entries(importBaseline.reads as Record<string, { importType: string; error: string | null }>);
  const dbcFiles = Object.keys(dbcBaseline).length;

  it.each([
    [/\b(\d+) (?:OEM|real-world)\b/g, dbcFiles],
    [/\b(\d+) DBC files from carmakers/g, dbcFiles],
    [/<summary>All (\d+) files<\/summary>/g, Object.keys(mapperBaseline).length],
    [/\b(\d+) files in other formats/g, reads.length],
    [/\b(\d+) comparisons with their DBC twins/g, Object.keys(importBaseline.twins).length],
  ] as const)('%s is %i', (pattern, expected) => {
    const hits = found(pattern);
    expect(hits.length, String(pattern)).toBeGreaterThan(0);
    for (const hit of hits) expect(toNumber(hit.number), `${hit.file}: "${hit.sentence}"`).toBe(expected);
  });

  it('says how many YAML and FIBEX files there are, and that none was read', () => {
    const hits = found(/\*\*YAML and FIBEX\*\* read none of their (\w+) files/g);
    expect(hits.length).toBe(1);
    for (const type of ['yaml', 'fibex']) {
      const files = reads.filter(([, r]) => r.importType === type);
      expect(files.length, type).toBe(toNumber(hits[0].number));
      for (const [file, r] of files) expect(r.error, file).not.toBeNull();
    }
  });

  it('counts the AUTOSAR 4.2 files of cantools that canmatrix fails on', () => {
    const hits = found(/fails on (\w+) of cantools' AUTOSAR 4\.2 files/g);
    expect(hits.length).toBe(1);
    const failed = reads.filter(([file, r]) => file.startsWith('cantools/tests/files/arxml/') && /-4\.2[.\d]*\.arxml$/.test(file) && r.error !== null);
    expect(failed.length).toBe(toNumber(hits[0].number));
  });

  // The first ARXML import fetches the runtime and the wheels of canmatrix and
  // lxml; YAML and Excel add a wheel of their own the first time.
  describe('download sizes', () => {
    const lock = JSON.parse(read('app/src/lib/canmatrix/wheels.lock.json')) as {
      packages: Record<string, { tool: { canviewer: { size: number } } }>;
    };
    const wheels = (...names: string[]) => names.reduce((n, name) => n + lock.packages[name].tool.canviewer.size, 0);
    const runtime = ['pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide.asm.mjs'].reduce(
      (n, f) => n + statSync(join(root, 'node_modules/pyodide', f)).size,
      0,
    );
    const canmatrix = wheels('canmatrix', 'attrs', 'six', 'click');
    const lxml = wheels('lxml');
    const firstImport = runtime + canmatrix + lxml;
    const yaml = wheels('pyyaml');
    const excel = wheels('openpyxl', 'et-xmlfile');
    const bytes = (n: number) => n.toLocaleString('en-US');

    it('in the size table of the Pyodide worker page', () => {
      const page = read('docs/develop/pyodide-worker.md');
      for (const [label, size] of [
        ['Runtime (`pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide.asm.mjs`)', runtime],
        ['canmatrix with attrs, six and click', canmatrix],
        ['lxml (for ARXML, KCD, FIBEX and ODX)', lxml],
        ['**First ARXML import**', firstImport],
        ['pyyaml (YAML), when first needed', yaml],
        ['openpyxl with et-xmlfile (Excel), when first needed', excel],
      ] as const) {
        const value = label.startsWith('**') ? `**${bytes(size)}**` : bytes(size);
        expect(page, label).toContain(`| ${label} | ${value} |`);
      }
    });

    it.each([/\b([\d,]+) bytes measured\b/g, /\bimport downloads ([\d,]+) bytes\b/g])('wherever the first import is given in bytes: %s', (pattern) => {
      const hits = found(pattern);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(toNumber(hit.number), `${hit.file}: "${hit.sentence}"`).toBe(firstImport);
    });

    it('in megabytes, part by part, in the decision record', () => {
      const mb = (n: number) => (n / 1e6).toFixed(1);
      expect(read('docs/decisions/0003-self-hosted-pyodide-worker.md').replace(/\s+/g, ' ')).toContain(
        `(runtime ${mb(runtime)} MB, canmatrix and its dependencies ${mb(canmatrix)} MB, lxml ${mb(lxml)} MB)`,
      );
    });

    it('in kilobytes for the packages YAML and Excel load', () => {
      const hits = found(/YAML (\d+) kB, Excel (\d+) kB/g);
      expect(hits.length).toBe(1);
      expect(hits[0].sentence).toBe(`YAML ${Math.round(yaml / 1000)} kB, Excel ${Math.round(excel / 1000)} kB`);
    });
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
