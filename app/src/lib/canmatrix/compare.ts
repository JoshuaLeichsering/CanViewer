// SPDX-License-Identifier: GPL-2.0-or-later
import { isJ1939Database } from '../dbc/j1939';
import {
  attributeChanges,
  changeOf,
  definitionChanges,
  definitionKey,
  messageChanges,
  nodeChanges,
  signalChanges,
  valueChanges,
  type CompareOptions,
  type FieldChange,
} from '../diff/fields';
import type {
  AttrValue,
  DbcAttributeDefinition,
  DbcDatabase,
  DbcMessage,
  DbcNode,
  DbcSignal,
  DbcValueTable,
} from '../dbc/types';

/**
 * Field-by-field differences between two databases in CanViewer's model, one
 * readable line each. Messages are matched by (extended flag, id), falling
 * back to the id alone so that a lost or added extended flag shows up as one
 * difference instead of a missing and an extra message; signals are matched
 * by name within a message. Used to compare a file read through canmatrix with
 * its DBC twin read by CanViewer's own parser.
 *
 * Compared (the fields and how they are normalized are shared with diff mode,
 * see app/src/lib/diff/fields.ts):
 * - the database: attribute definitions (type, enum values, range, default),
 *   network attributes, whether CanViewer treats it as J1939, nodes (comment,
 *   attributes) and value tables (entries);
 * - per message: extended flag, name, DLC, sender, comment, frame format as
 *   CanViewer's own rules decide it (classic, CAN FD or J1939 PG, see
 *   app/src/lib/dbc/canfd.ts), and attributes;
 * - per signal: the layout (start bit as written in DBC, length, byte order),
 *   value type, factor, offset, min and max (unless the DBC leaves the range at
 *   [0|0]), unit, receivers, multiplexing, value descriptions, comment and
 *   attributes.
 *
 * An attribute only the imported side has (the ARXML reader, for one, adds its
 * own such as ISignalName to every signal) is summed up in one line per name at
 * the end instead of one line per object; attributes that are missing or
 * differ get a line each.
 */
export function compareDatabases(expected: DbcDatabase, actual: DbcDatabase): string[] {
  const out: string[] = [];
  const extras = new Map<string, number>();
  const report: Reporter = (where, changes) => {
    for (const c of changes) out.push(line(where, c));
  };
  const compareAttributes: AttributeComparer = (where, scope, e, a) => {
    for (const c of attributeChanges(e, a)) {
      const key = `${scope} ${c.attribute}`;
      if (c.before === undefined) extras.set(key, (extras.get(key) ?? 0) + 1);
      else out.push(line(where, c));
    }
  };
  compareDefinitions(out, report, expected.attributeDefinitions, actual.attributeDefinitions);
  compareAttributes('network', 'network', expected.attributes, actual.attributes);
  report('network', changeOf('j1939Database', isJ1939Database(expected), isJ1939Database(actual)));
  compareNodes(out, report, expected.nodes, actual.nodes, compareAttributes);
  compareValueTables(out, report, expected.valueTables, actual.valueTables);

  const key = (m: DbcMessage) => `${m.isExtended ? 'x' : 's'}${m.id}`;
  const label = (m: DbcMessage) => `${m.isExtended ? 'x' : ''}0x${m.id.toString(16).toUpperCase()} ${m.name}`;
  const actualByKey = new Map(actual.messages.map((m) => [key(m), m]));
  const seen = new Set<DbcMessage>();
  const byIdOnly = (e: DbcMessage) => {
    const candidates = actual.messages.filter((m) => m.id === e.id && !seen.has(m));
    return candidates.length === 1 && !expected.messages.some((x) => x !== e && x.id === e.id)
      ? candidates[0]
      : undefined;
  };

  for (const e of expected.messages) {
    const exact = actualByKey.get(key(e));
    const a = exact && !seen.has(exact) ? exact : byIdOnly(e);
    if (!a) {
      out.push(`${label(e)}: message missing`);
      continue;
    }
    seen.add(a);
    const where = label(e);
    report(where, messageChanges(expected, e, actual, a));
    compareAttributes(where, 'message', e.attributes, a.attributes);
    compareSignals(out, report, where, e.signals, a.signals, compareAttributes);
  }
  for (const a of actual.messages) {
    if (!seen.has(a)) out.push(`${label(a)}: message not in the DBC twin`);
  }
  for (const [key, count] of extras) {
    const [scope, name] = key.split(' ');
    out.push(`${scope} attribute ${name}: only in the import, on ${count} ${scope === 'network' ? 'database' : scope}${count === 1 ? '' : 's'}`);
  }
  return out;
}

/** The twin check's options, see CompareOptions. */
const TWIN: CompareOptions = { zeroRangeUnset: true, valueCountWhenOneSideEmpty: true };

type Reporter = (where: string, changes: FieldChange[]) => void;
type AttributeComparer = (where: string, scope: string, e: Record<string, AttrValue>, a: Record<string, AttrValue>) => void;

function compareSignals(
  out: string[],
  report: Reporter,
  where: string,
  expected: DbcSignal[],
  actual: DbcSignal[],
  compareAttributes: AttributeComparer,
) {
  const actualByName = new Map(actual.map((s) => [s.name, s]));
  for (const e of expected) {
    const a = actualByName.get(e.name);
    const at = `${where} / ${e.name}`;
    if (!a) {
      out.push(`${at}: signal missing`);
      continue;
    }
    actualByName.delete(e.name);
    report(at, signalChanges(e, a, TWIN));
    compareAttributes(at, 'signal', e.attributes, a.attributes);
  }
  for (const name of actualByName.keys()) out.push(`${where} / ${name}: signal not in the DBC twin`);
}

function compareNodes(
  out: string[],
  report: Reporter,
  expected: DbcNode[],
  actual: DbcNode[],
  compareAttributes: AttributeComparer,
) {
  const byName = new Map(actual.map((n) => [n.name, n]));
  for (const e of expected) {
    const a = byName.get(e.name);
    if (!a) {
      out.push(`node ${e.name}: missing`);
      continue;
    }
    byName.delete(e.name);
    report(`node ${e.name}`, nodeChanges(e, a));
    compareAttributes(`node ${e.name}`, 'node', e.attributes, a.attributes);
  }
  for (const name of byName.keys()) out.push(`node ${name}: not in the DBC twin`);
}

function compareValueTables(out: string[], report: Reporter, expected: DbcValueTable[], actual: DbcValueTable[]) {
  const byName = new Map(actual.map((t) => [t.name, t]));
  for (const e of expected) {
    const a = byName.get(e.name);
    if (!a) {
      out.push(`value table ${e.name}: missing`);
      continue;
    }
    byName.delete(e.name);
    report(`value table ${e.name}`, valueChanges(e.values, a.values, TWIN));
  }
  for (const name of byName.keys()) out.push(`value table ${name}: not in the DBC twin`);
}

function compareDefinitions(
  out: string[],
  report: Reporter,
  expected: DbcAttributeDefinition[],
  actual: DbcAttributeDefinition[],
) {
  const byKey = new Map(actual.map((d) => [definitionKey(d), d]));
  for (const e of expected) {
    const where = `definition ${definitionKey(e)}`;
    const a = byKey.get(definitionKey(e));
    if (!a) {
      out.push(`${where}: missing`);
      continue;
    }
    byKey.delete(definitionKey(e));
    report(where, definitionChanges(e, a));
  }
  for (const k of byKey.keys()) out.push(`definition ${k}: not in the DBC twin`);
}

/** One line per change; value descriptions that only one side has are summed up by count. */
function line(where: string, c: FieldChange): string {
  if (c.field === 'values') return `${where}: values ${c.before} entries -> ${c.after} entries`;
  return `${where}: ${c.field} ${show(c.before)} -> ${show(c.after)}`;
}

/** Long texts (comments) are cut so that a difference stays one short line. */
function show(v: unknown): string {
  if (typeof v !== 'string') return String(v);
  return JSON.stringify(v.length > 48 ? v.slice(0, 45) + '...' : v);
}
