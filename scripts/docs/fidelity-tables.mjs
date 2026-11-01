// SPDX-License-Identifier: GPL-2.0-or-later
// Generates the fidelity tables of the format reference (docs/reference/) from
// the pinned baselines, so that no number in them is written by hand:
//
//   app/src/lib/canmatrix/import-corpus-baseline.json  what canmatrix reads from
//       each non-DBC corpus file, and how it differs from the file's DBC twin
//   app/src/lib/canmatrix/mapper-dbc-baseline.json  what canmatrix's DBC reader
//       does differently from CanViewer's parser on the 58 OEM DBC files
//   app/src/lib/dbc/corpus-baseline.json  what CanViewer's parser reads from them
//
// Each table lives between two markers in a page,
//   <!-- generated:<name> --> ... <!-- /generated:<name> -->
// and everything outside the markers is written by hand. The test
// app/src/lib/reference-docs.test.ts regenerates the tables and fails when a
// page does not match the baselines.
//
// Usage:
//   node scripts/docs/fidelity-tables.mjs           rewrite the pages
//   node scripts/docs/fidelity-tables.mjs --check   exit 1 if a page is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The formats the app reads through canmatrix, in the order the reference
 * lists them. The test checks this list against app/src/lib/canmatrix/formats.ts.
 */
export const FORMATS = [
  { importType: 'arxml', name: 'ARXML (AUTOSAR)', extensions: ['arxml'] },
  { importType: 'kcd', name: 'KCD (Kayak)', extensions: ['kcd'] },
  { importType: 'sym', name: 'SYM (PEAK PCAN Symbol Editor)', extensions: ['sym'] },
  { importType: 'dbf', name: 'DBF (Busmaster)', extensions: ['dbf'] },
  { importType: 'xlsx', name: 'Excel', extensions: ['xlsx'] },
  { importType: 'json', name: 'JSON (canmatrix)', extensions: ['json'] },
  { importType: 'yaml', name: 'YAML (canmatrix)', extensions: ['yaml', 'yml'] },
  { importType: 'fibex', name: 'FIBEX', extensions: ['xml'] },
  { importType: 'odx', name: 'ODX', extensions: ['odx'] },
];

/** The pages and the blocks each one carries. */
export const TARGETS = [
  {
    file: 'docs/reference/formats.md',
    blocks: ['import-formats', 'import-twins', 'import-kinds', 'import-files', 'mapper-summary', 'mapper-kinds', 'mapper-files'],
  },
  { file: 'docs/reference/dbc.md', blocks: ['dbc-corpus', 'dbc-skipped'] },
];

/** Kinds of difference, in the order the tables list them, with their labels. */
const KINDS = [
  ['nothing', 'Nothing read (the reader failed)'],
  ['message-missing', 'Message missing'],
  ['message-added', 'Message the reader adds'],
  ['message-isExtended', 'Message: extended (29-bit) flag'],
  ['message-name', 'Message: name'],
  ['message-dlc', 'Message: DLC'],
  ['message-sender', 'Message: sender'],
  ['message-frameFormat', 'Message: frame format (classic, CAN FD, J1939)'],
  ['message-comment', 'Message: comment'],
  ['message-attr', 'Message: attribute value'],
  ['signal-missing', 'Signal missing'],
  ['signal-added', 'Signal the reader adds'],
  ['signal-startBit', 'Signal: start bit'],
  ['signal-length', 'Signal: length'],
  ['signal-byteOrder', 'Signal: byte order'],
  ['signal-valueType', 'Signal: value type (signed, unsigned, float)'],
  ['signal-factor', 'Signal: factor'],
  ['signal-offset', 'Signal: offset'],
  ['signal-min', 'Signal: minimum'],
  ['signal-max', 'Signal: maximum'],
  ['signal-unit', 'Signal: unit'],
  ['signal-receivers', 'Signal: receivers'],
  ['signal-multiplex', 'Signal: multiplexing'],
  ['signal-values', 'Signal: value descriptions'],
  ['signal-comment', 'Signal: comment'],
  ['signal-attr', 'Signal: attribute value'],
  ['node-missing', 'Node missing'],
  ['node-added', 'Node the reader adds'],
  ['node-comment', 'Node: comment'],
  ['node-attr', 'Node: attribute value'],
  ['network-attr', 'Database: attribute value'],
  ['network-j1939Database', 'Database: J1939 or not'],
  ['valueTable-missing', 'Value table missing'],
  ['valueTable-added', 'Value table the reader adds'],
  ['valueTable-values', 'Value table: entries'],
  ['definition-missing', 'Attribute definition missing'],
  ['definition-added', 'Attribute definition the reader adds'],
  ['definition-changed', 'Attribute definition: type, range, default or enum values'],
  ['import-attr', 'Attribute the reader adds to objects (once per name)'],
];
const KIND_LABEL = new Map(KINDS);

/**
 * The kind of one difference line written by compareDatabases
 * (app/src/lib/canmatrix/compare.ts). Throws on a line it does not know, so
 * that a new kind of difference cannot go unlisted.
 */
export function classifyDifference(line) {
  if (line.startsWith('nothing read')) return 'nothing';
  if (/^(network|node|message|signal) attribute \S+: only in the import, on \d+ /.test(line)) return 'import-attr';
  const m = line.match(/^(.*?): (.*)$/);
  if (!m) throw new Error(`unknown difference: ${line}`);
  const [, where, what] = m;
  const scope = where.startsWith('definition ')
    ? 'definition'
    : where.startsWith('value table ')
      ? 'valueTable'
      : where.startsWith('node ')
        ? 'node'
        : where === 'network'
          ? 'network'
          : where.includes(' / ')
            ? 'signal'
            : 'message';
  let kind;
  if (what === 'message missing' || what === 'signal missing' || what === 'missing') kind = `${scope}-missing`;
  else if (/^(message |signal )?not in the DBC twin$/.test(what)) kind = `${scope}-added`;
  else if (/^values \d+ entries -> \d+ entries$/.test(what) || /^values\[-?\d+\] /.test(what)) kind = `${scope}-values`;
  else if (/^attr\[[^\]]*\] /.test(what)) kind = `${scope}-attr`;
  else if (scope === 'definition' && /^(valueType|enumValues|min|max|default) /.test(what)) kind = 'definition-changed';
  else kind = `${scope}-${what.split(' ')[0]}`;
  if (!KIND_LABEL.has(kind)) throw new Error(`unknown difference: ${line}`);
  return kind;
}

// ---- formatting ----

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dash = (n) => (n ? num(n) : '–');
const code = (s) => `\`${s}\``;
/** Text from a reader's message in a table cell: one line, nothing that markdown, HTML or Vue would act on. */
function cellText(s, max = 90) {
  let t = s.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`');
}
function table(header, rows, align) {
  const sep = header.map((_, i) => (align?.[i] === 'r' ? '---:' : '---'));
  return [header, sep, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const formatOf = (importType) => FORMATS.find((f) => f.importType === importType);
const extList = (f) => f.extensions.map((e) => code(`.${e}`)).join(', ');

// ---- the blocks ----

function readStats(entries) {
  const messages = (r) => sum(r.clusters, (c) => c.messages);
  return {
    files: entries.length,
    read: entries.filter(([, r]) => !r.error && messages(r) > 0).length,
    empty: entries.filter(([, r]) => !r.error && messages(r) === 0).length,
    failed: entries.filter(([, r]) => r.error).length,
    messages: sum(entries, ([, r]) => messages(r)),
    signals: sum(entries, ([, r]) => sum(r.clusters, (c) => c.signals)),
    notes: entries.filter(([, r]) => r.log.length > 0).length,
  };
}

function importFormats({ reads }) {
  const all = Object.entries(reads);
  const row = (label, ext, s, bold = false) => {
    const b = (v) => (bold ? `**${v}**` : v);
    return [b(label), ext, b(num(s.files)), b(num(s.read)), b(num(s.empty)), b(num(s.failed)), b(num(s.messages)), b(num(s.signals)), b(num(s.notes))];
  };
  const rows = FORMATS.map((f) => {
    const entries = all.filter(([, r]) => r.importType === f.importType);
    if (entries.length === 0) return [f.name, extList(f), '0', '–', '–', '–', '–', '–', '–'];
    return row(f.name, extList(f), readStats(entries));
  });
  rows.push(row('All formats', '', readStats(all), true));
  return table(
    ['Format', 'Extensions', 'Corpus files', 'Read', 'Read, no messages', 'Failed', 'Messages', 'Signals', 'With reader notes'],
    rows,
    ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
}

function twinStats(entries) {
  return {
    twins: entries.length,
    identical: entries.filter(([, t]) => t.differences.length === 0).length,
    nothing: entries.filter(([, t]) => t.differences.some((d) => classifyDifference(d) === 'nothing')).length,
    lines: sum(entries, ([, t]) => t.differences.length),
  };
}

function importTwins({ reads, twins }) {
  const all = Object.entries(twins);
  const row = (label, s, bold = false) => {
    const b = (v) => (bold ? `**${v}**` : v);
    return [b(label), b(num(s.twins)), b(num(s.identical)), b(num(s.twins - s.identical - s.nothing)), b(num(s.nothing)), b(num(s.lines))];
  };
  const rows = FORMATS.filter((f) => all.some(([file]) => reads[file].importType === f.importType)).map((f) =>
    row(f.name, twinStats(all.filter(([file]) => reads[file].importType === f.importType))),
  );
  rows.push(row('All formats', twinStats(all), true));
  return table(
    ['Format', 'Files with a DBC twin', 'Identical to the twin', 'With differences', 'Nothing read', 'Difference lines'],
    rows,
    ['l', 'r', 'r', 'r', 'r', 'r'],
  );
}

/** Rows: kinds of difference; columns: groups; cells: files with at least one difference of that kind. */
function kindMatrix(groups) {
  const counts = groups.map(({ entries }) => {
    const byKind = new Map();
    for (const differences of entries) {
      for (const kind of new Set(differences.map(classifyDifference))) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    return byKind;
  });
  const rows = KINDS.filter(([kind]) => counts.some((c) => c.has(kind))).map(([kind, label]) => [
    label,
    ...counts.map((c) => dash(c.get(kind))),
  ]);
  return { rows, header: groups.map((g) => g.label) };
}

function importKinds({ reads, twins }) {
  const all = Object.entries(twins);
  const groups = FORMATS.filter((f) => all.some(([file]) => reads[file].importType === f.importType)).map((f) => {
    const entries = all.filter(([file]) => reads[file].importType === f.importType);
    return { label: `${f.name.split(' ')[0]} (${entries.length})`, entries: entries.map(([, t]) => t.differences) };
  });
  const { rows, header } = kindMatrix(groups);
  return table(['What differs from the DBC twin', ...header], rows, ['l', ...header.map(() => 'r')]);
}

function importFiles({ reads, twins }) {
  const rows = Object.entries(reads).map(([file, r]) => {
    const twin = twins[file];
    return [
      code(file),
      formatOf(r.importType)?.name.split(' ')[0] ?? r.importType,
      r.error ? '–' : num(r.clusters.length),
      num(sum(r.clusters, (c) => c.messages)),
      num(sum(r.clusters, (c) => c.signals)),
      dash(r.log.length),
      twin ? num(twin.differences.length) : '',
      r.error ? cellText(r.error) : '',
    ];
  });
  return table(
    ['File', 'Format', 'Clusters', 'Messages', 'Signals', 'Reader notes', 'Differences from the twin', 'Error'],
    rows,
    ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'l'],
  );
}

const COULD_NOT_READ = /canmatrix could not read this line/;

function mapperSummary(mapper) {
  const all = Object.values(mapper);
  return table(
    ['', 'Files'],
    [
      ['DBC files read through canmatrix', num(all.length)],
      ['Identical to CanViewer’s parser, no problems', num(all.filter((m) => !m.differences.length && !m.problems.length).length)],
      ['With differences', num(all.filter((m) => m.differences.length).length)],
      ['With problems reported for canmatrix’s output', num(all.filter((m) => m.problems.length).length)],
      ['With lines canmatrix could not read', num(all.filter((m) => m.problems.some((p) => COULD_NOT_READ.test(p))).length)],
    ],
    ['l', 'r'],
  );
}

function mapperKinds(mapper) {
  const all = Object.values(mapper);
  const lines = new Map();
  for (const m of all) for (const d of m.differences) lines.set(classifyDifference(d), (lines.get(classifyDifference(d)) ?? 0) + 1);
  const { rows } = kindMatrix([{ label: 'Files', entries: all.map((m) => m.differences) }]);
  const byLabel = new Map(KINDS.map(([k, l]) => [l, k]));
  return table(
    ['What canmatrix reads differently', 'Files', 'Difference lines'],
    rows.map(([label, files]) => [label, files, num(lines.get(byLabel.get(label)))]),
    ['l', 'r', 'r'],
  );
}

function mapperFiles(mapper) {
  const rows = Object.entries(mapper)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([file, m]) => {
      const lines = new Map();
      for (const d of m.differences) lines.set(classifyDifference(d), (lines.get(classifyDifference(d)) ?? 0) + 1);
      const top = [...lines].sort((a, b) => b[1] - a[1] || KINDS.findIndex(([k]) => k === a[0]) - KINDS.findIndex(([k]) => k === b[0]))[0];
      return [
        code(file),
        dash(m.differences.length),
        dash(m.problems.length),
        dash(m.problems.filter((p) => COULD_NOT_READ.test(p)).length),
        top ? `${KIND_LABEL.get(top[0])} (${num(top[1])})` : '',
      ];
    });
  return table(
    ['File', 'Differences', 'Problems', 'Lines not read', 'Most frequent difference'],
    rows,
    ['l', 'r', 'r', 'r', 'l'],
  );
}

function dbcCorpus(dbc) {
  const all = Object.values(dbc);
  const total = (k) => num(sum(all, (s) => Number(s[k])));
  return table(
    ['', 'Corpus total'],
    [
      ['Files', num(all.length)],
      ['Messages', total('messages')],
      ['Extended (29-bit) messages', total('extendedMessages')],
      ['CAN FD messages', total('fdMessages')],
      ['J1939 parameter groups', total('j1939Pgs')],
      ['Signals', total('signals')],
      ['Multiplexor signals', total('multiplexors')],
      ['Multiplexed signals', total('multiplexedSignals')],
      ['Signals with extended multiplexing (`SG_MUL_VAL_`)', total('extendedMuxSignals')],
      ['Float and double signals (`SIG_VALTYPE_`)', num(sum(all, (s) => s.floatSignals + s.doubleSignals))],
      ['Signals with value descriptions', total('signalsWithValues')],
      ['Signals with a comment', total('signalsWithComment')],
      ['Nodes', total('nodes')],
      ['Value tables', total('valueTables')],
      ['Attribute definitions', total('attributeDefinitions')],
      ['Files with parse problems', num(all.filter((s) => s.problems > 0).length)],
      ['Parse problems', total('problems')],
    ],
    ['l', 'r'],
  );
}

function dbcSkipped(dbc) {
  const counts = new Map();
  for (const s of Object.values(dbc)) {
    for (const [k, n] of Object.entries(s.skipped)) {
      const c = counts.get(k) ?? { files: 0, statements: 0 };
      c.files += 1;
      c.statements += n;
      counts.set(k, c);
    }
  }
  return table(
    ['Statement', 'Files', 'Statements'],
    [...counts].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, c]) => [code(k), num(c.files), num(c.statements)]),
    ['l', 'r', 'r'],
  );
}

/** Every block, rendered from the three baselines. */
export function renderBlocks({ importBaseline, mapperBaseline, dbcBaseline }) {
  return {
    'import-formats': importFormats(importBaseline),
    'import-twins': importTwins(importBaseline),
    'import-kinds': importKinds(importBaseline),
    'import-files': importFiles(importBaseline),
    'mapper-summary': mapperSummary(mapperBaseline),
    'mapper-kinds': mapperKinds(mapperBaseline),
    'mapper-files': mapperFiles(mapperBaseline),
    'dbc-corpus': dbcCorpus(dbcBaseline),
    'dbc-skipped': dbcSkipped(dbcBaseline),
  };
}

const NOTICE = 'Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand.';

/** Replace the named blocks in a page; fails on a missing or unknown marker. */
export function applyBlocks(page, names, blocks) {
  const found = [...page.matchAll(/<!-- generated:([\w-]+) -->/g)].map((m) => m[1]);
  const unknown = found.filter((n) => !names.includes(n));
  if (unknown.length) throw new Error(`unknown generated block(s): ${unknown.join(', ')}`);
  let out = page;
  for (const name of names) {
    const re = new RegExp(`<!-- generated:${name} -->[\\s\\S]*?<!-- /generated:${name} -->`);
    if (!re.test(out)) throw new Error(`missing markers for generated block ${name}`);
    out = out.replace(re, () => `<!-- generated:${name} -->\n<!-- ${NOTICE} -->\n\n${blocks[name]}\n\n<!-- /generated:${name} -->`);
  }
  return out;
}

export function loadBaselines(root) {
  const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  return {
    importBaseline: json('app/src/lib/canmatrix/import-corpus-baseline.json'),
    mapperBaseline: json('app/src/lib/canmatrix/mapper-dbc-baseline.json'),
    dbcBaseline: json('app/src/lib/dbc/corpus-baseline.json'),
  };
}

/** Each target page as it is and as the baselines say it should be. */
export function generate(root) {
  const blocks = renderBlocks(loadBaselines(root));
  return TARGETS.map(({ file, blocks: names }) => {
    const current = readFileSync(join(root, file), 'utf8');
    return { file, current, expected: applyBlocks(current, names, blocks) };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const { file, current, expected } of generate(root)) {
    if (current === expected) {
      console.log(`up to date: ${file}`);
    } else if (check) {
      console.error(`stale: ${file} (run node scripts/docs/fidelity-tables.mjs)`);
      stale += 1;
    } else {
      writeFileSync(join(root, file), expected);
      console.log(`written: ${file}`);
    }
  }
  process.exitCode = stale ? 1 : 0;
}
