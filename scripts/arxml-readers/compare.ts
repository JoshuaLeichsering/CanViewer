/**
 * Holds cantools' reading of the corpus ARXML files against canmatrix's and
 * against the DBC twins, for docs/develop/arxml-readers.md. A report tool, not
 * part of the app or of the test suite.
 *
 *   npx vite-node scripts/arxml-readers/compare.ts -- <cantools.json> [<details.json>]
 *
 * <cantools.json> is what cantools_dump.py wrote. canmatrix is run here the
 * way the app runs it: canmatrix 1.3.3 under Pyodide through
 * canviewer_adapter.py (app/src/lib/canmatrix/node-runtime.ts). Twins and the
 * cluster compared with each come from the pinned import baseline, and the
 * canmatrix differences found here must equal the pinned ones, or the script
 * fails. Both readers are compared with CanViewer's compareDatabases(), which
 * also produced the baseline, and every difference line is sorted into one
 * kind. Prints Markdown tables; <details.json> receives every line.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDatabases } from '../../app/src/lib/canmatrix/compare';
import { CANMATRIX_FORMATS } from '../../app/src/lib/canmatrix/formats';
import { missingWheels, startCanmatrix } from '../../app/src/lib/canmatrix/node-runtime';
import type { CanmatrixReadResult } from '../../app/src/lib/canmatrix/types';
import lock from '../../app/src/lib/canmatrix/wheels.lock.json';
import { parseDbc } from '../../app/src/lib/dbc/parser';
import type { DbcDatabase } from '../../app/src/lib/dbc/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const THIRD_PARTY = join(root, 'third_party');
const BASELINE = join(root, 'app/src/lib/canmatrix/import-corpus-baseline.json');

interface CantoolsRead {
  strictError: string | null;
  error: string | null;
  warnings: string[];
  database: DbcDatabase | null;
  containers: Array<{ container: string; contained: Array<{ name: string; headerId: number; length: number; signals: number }> }>;
}
interface Baseline {
  reads: Record<string, { error: string | null }>;
  twins: Record<string, { dbc: string; cluster: string | null; differences: string[] }>;
}

const KINDS = ['presence', 'frame', 'layout', 'scaling', 'no range', 'values', 'other'] as const;
type Kind = (typeof KINDS)[number];

const FRAME_FIELDS = new Set(['isExtended', 'name', 'dlc', 'frameFormat']);
const LAYOUT_FIELDS = new Set(['startBit', 'length', 'byteOrder', 'valueType', 'multiplex']);
const SCALING_FIELDS = new Set(['factor', 'offset', 'min', 'max', 'unit']);

/**
 * The kind of one compareDatabases() line:
 * - presence: a message or signal only one side has;
 * - frame: id kind, name, DLC or frame format (classic, FD, J1939) of a message;
 * - layout: start bit, length, byte order, value type or multiplexing of a signal;
 * - scaling: factor, offset, minimum, maximum or unit;
 * - no range: a minimum or maximum the compared reading does not have at all
 *   (cantools leaves them out where the file gives none; canmatrix computes one);
 * - values: value descriptions of a signal, and named value tables;
 * - other: senders, receivers, comments, attributes, definitions and nodes.
 */
function kindOf(line: string): Kind {
  if (/: (message|signal) (missing|not in the DBC twin)$/.test(line)) return 'presence';
  if (line.startsWith('value table ')) return 'values';
  if (/^(definition|node|network) /.test(line) || / attribute \S+: only in the import/.test(line)) return 'other';
  const at = line.indexOf(': ');
  const field = (at < 0 ? '' : line.slice(at + 2)).split(/[\s[]/)[0];
  if (field === 'values') return 'values';
  if (FRAME_FIELDS.has(field) && !line.slice(0, at).includes(' / ')) return 'frame';
  if (LAYOUT_FIELDS.has(field)) return 'layout';
  if ((field === 'min' || field === 'max') && line.endsWith(' -> null')) return 'no range';
  if (SCALING_FIELDS.has(field)) return 'scaling';
  return 'other';
}

function tally(lines: string[]): Record<Kind, number> {
  const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  for (const l of lines) out[kindOf(l)]++;
  return out;
}

const signalCount = (db: DbcDatabase) => db.messages.reduce((n, m) => n + m.signals.length, 0);
const decode = (buf: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
};

/** An error, short enough for a table cell; a crash inside cantools' reader is marked as one. */
function shortError(error: string | null | undefined, crashed = false): string {
  const text = String(error)
    .replace(/^UnsupportedDatabaseFormatError: ARXML: "(.*)"$/, '$1')
    .replace(/\|/g, '\\|');
  return `error: ${text.length > 70 ? text.slice(0, 67) + '...' : text}${crashed ? ' (reader crash)' : ''}`;
}

/** All clusters of a canmatrix read as one database (cantools merges its buses too). */
function merged(result: CanmatrixReadResult): DbcDatabase | null {
  if (result.error || result.clusters.length === 0) return null;
  if (result.clusters.length === 1) return result.clusters[0].db;
  const [first, ...rest] = result.clusters.map((c) => c.db);
  return { ...first, messages: [first, ...rest].flatMap((d) => d.messages) };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args.length < 1) {
    console.error('usage: npx vite-node scripts/arxml-readers/compare.ts -- <cantools.json> [<details.json>]');
    process.exit(2);
  }
  const cantools = JSON.parse(readFileSync(args[0], 'utf8')) as { cantools: string; files: Record<string, CantoolsRead> };
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  const files = Object.keys(baseline.reads).filter((f) => f.endsWith('.arxml'));
  const missingFromDump = files.filter((f) => !cantools.files[f]);
  if (missingFromDump.length) throw new Error(`not in ${args[0]}: ${missingFromDump.join(', ')}`);
  const missing = missingWheels();
  if (missing.length) throw new Error(`wheels missing from vendor/pyodide: ${missing.join(', ')}`);

  const cm = await startCanmatrix();
  await cm.loadPackages(CANMATRIX_FORMATS.arxml.packages);
  const details: Record<string, unknown> = {};
  const readRows: string[] = [];
  const twinRows: string[] = [];
  const crossRows: string[] = [];
  let baselineChecked = 0;

  for (const file of files) {
    const cmResult = cm.read(readFileSync(join(THIRD_PARTY, file)), CANMATRIX_FORMATS.arxml.importType);
    const cmDb = merged(cmResult);
    const ct = cantools.files[file];
    const ctDb = ct.database;
    const containers = ct.containers.reduce((n, c) => n + c.contained.length, 0);
    const crashed = ct.warnings.length > 0;
    const show = (db: DbcDatabase | null, error: string) => (db ? `${db.messages.length} / ${signalCount(db)}` : error);
    readRows.push(
      `| ${file} | ${show(cmDb, shortError(cmResult.error))} | ${show(ctDb, shortError(ct.error, crashed))}${containers ? ` (+${containers} contained PDUs)` : ''} |`,
    );
    const entry: Record<string, unknown> = {
      canmatrix: { error: cmResult.error ?? null, messages: cmDb?.messages.length ?? null, signals: cmDb ? signalCount(cmDb) : null, database: cmDb },
      cantools: {
        error: ct.error,
        strictError: ct.strictError,
        warnings: ct.warnings,
        messages: ctDb?.messages.length ?? null,
        signals: ctDb ? signalCount(ctDb) : null,
        containers: ct.containers,
        database: ctDb,
      },
    };

    const twin = baseline.twins[file];
    if (twin) {
      const dbc = parseDbc(decode(readFileSync(join(THIRD_PARTY, twin.dbc))));
      const cluster = cmResult.clusters.find((c) => c.name === twin.cluster);
      const cmLines = cluster ? compareDatabases(dbc, cluster.db) : [`nothing read${cmResult.error ? ` (${cmResult.error})` : ''}`];
      if (JSON.stringify(cmLines) !== JSON.stringify(twin.differences)) {
        throw new Error(`${file}: canmatrix differences are not the pinned ones; rerun the import corpus suite first`);
      }
      baselineChecked++;
      const ctLines = ctDb ? compareDatabases(dbc, ctDb) : [];
      const twinSize = `${dbc.messages.length} / ${signalCount(dbc)}`;
      const row = (reader: string, db: DbcDatabase | null, lines: string[], error: string) => {
        if (!db) return `| ${file} | ${twinSize} | ${reader} | ${error} | ${KINDS.map(() => '').join(' | ')} |`;
        const t = tally(lines);
        return `| ${file} | ${twinSize} | ${reader} | ${db.messages.length} / ${signalCount(db)} | ${KINDS.map((k) => t[k]).join(' | ')} |`;
      };
      twinRows.push(row('canmatrix', cluster?.db ?? null, cmLines, shortError(cmResult.error ?? 'no cluster')));
      twinRows.push(row('cantools', ctDb, ctLines, shortError(ct.error, crashed)));
      entry.twin = { dbc: twin.dbc, canmatrix: cmLines, cantools: ctDb ? ctLines : null };
    }

    if (cmDb && ctDb && (cmDb.messages.length || ctDb.messages.length)) {
      // canmatrix's reading as the reference, so "missing" means only canmatrix
      // has it and "not in the DBC twin" means only cantools has it.
      const lines = compareDatabases(cmDb, ctDb);
      const t = tally(lines);
      crossRows.push(
        `| ${file} | ${cmDb.messages.length} / ${signalCount(cmDb)} | ${ctDb.messages.length} / ${signalCount(ctDb)} | ${KINDS.map((k) => t[k]).join(' | ')} |`,
      );
      entry.cross = lines;
    }
    details[file] = entry;
  }
  cm.close();
  if (cm.fetchCalls.length) throw new Error(`canmatrix tried the network: ${cm.fetchCalls.join(', ')}`);

  const head = KINDS.join(' | ');
  console.log(`cantools ${cantools.cantools}, canmatrix ${lock.packages.canmatrix.version} under Pyodide`);
  console.log(`${files.length} ARXML files; canmatrix side equal to the pinned baseline for ${baselineChecked} twins\n`);
  console.log('Messages / signals read\n');
  console.log('| file | canmatrix | cantools |\n|---|---|---|');
  console.log(readRows.join('\n'));
  console.log('\nDifference lines against the DBC twin, by kind\n');
  console.log(`| file | twin | reader | read | ${head} |\n|---|---|---|---|${KINDS.map(() => '---').join('|')}|`);
  console.log(twinRows.join('\n'));
  console.log('\ncantools against canmatrix, by kind (files both read)\n');
  console.log(`| file | canmatrix | cantools | ${head} |\n|---|---|---|${KINDS.map(() => '---').join('|')}|`);
  console.log(crossRows.join('\n'));
  if (args[1]) writeFileSync(args[1], JSON.stringify(details, null, 1) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
