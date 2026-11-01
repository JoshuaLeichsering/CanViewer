import { NO_NODE } from '../dbc/parser';
import { isCanFd, isJ1939Pg } from '../dbc/canfd';
import { isJ1939Database } from '../dbc/j1939';
import type {
  AttrValue,
  DbcAttributeDefinition,
  DbcDatabase,
  DbcMessage,
  DbcNode,
  DbcSignal,
  DbcValueTable,
  MultiplexInfo,
} from '../dbc/types';

/**
 * Field-by-field differences between two databases in CanViewer's model, one
 * readable line each. Messages are matched by (extended flag, id), falling
 * back to the id alone so that a lost or added extended flag shows up as one
 * difference instead of a missing and an extra message; signals are matched
 * by name within a message. Used to compare a file read through canmatrix with
 * its DBC twin read by CanViewer's own parser.
 *
 * Compared:
 * - the database: attribute definitions (type, enum values, range, default),
 *   network attributes, whether CanViewer treats it as J1939, nodes (comment,
 *   attributes) and value tables (entries);
 * - per message: extended flag, name, DLC, sender, comment, frame format as
 *   CanViewer's own rules decide it (classic, CAN FD or J1939 PG, see
 *   src/lib/dbc/canfd.ts), and attributes;
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
  const compareAttributes = (
    where: string,
    scope: string,
    e: Record<string, AttrValue>,
    a: Record<string, AttrValue>,
  ) => {
    for (const k of [...new Set([...Object.keys(e), ...Object.keys(a)])].sort()) {
      if (e[k] === undefined) extras.set(`${scope} ${k}`, (extras.get(`${scope} ${k}`) ?? 0) + 1);
      else diff(out, where, `attr[${k}]`, e[k], a[k]);
    }
  };
  compareDefinitions(out, expected.attributeDefinitions, actual.attributeDefinitions);
  compareAttributes('network', 'network', expected.attributes, actual.attributes);
  diff(out, 'network', 'j1939Database', isJ1939Database(expected), isJ1939Database(actual));
  compareNodes(out, expected.nodes, actual.nodes, compareAttributes);
  compareValueTables(out, expected.valueTables, actual.valueTables);

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
    diff(out, where, 'isExtended', e.isExtended, a.isExtended);
    diff(out, where, 'name', e.name, a.name);
    diff(out, where, 'dlc', e.dlc, a.dlc);
    diff(out, where, 'sender', node(e.sender), node(a.sender));
    diff(out, where, 'comment', text(e.comment), text(a.comment));
    diff(out, where, 'frameFormat', frameFormat(expected, e), frameFormat(actual, a));
    compareAttributes(where, 'message', e.attributes, a.attributes);
    compareSignals(out, where, e.signals, a.signals, compareAttributes);
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

type AttributeComparer = (where: string, scope: string, e: Record<string, AttrValue>, a: Record<string, AttrValue>) => void;

function compareSignals(
  out: string[],
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
    diff(out, at, 'startBit', e.startBit, a.startBit);
    diff(out, at, 'length', e.length, a.length);
    diff(out, at, 'byteOrder', e.byteOrder, a.byteOrder);
    diff(out, at, 'valueType', e.valueType, a.valueType);
    diff(out, at, 'factor', e.factor, a.factor);
    diff(out, at, 'offset', e.offset, a.offset);
    // In DBC, [0|0] means "no range given"; canmatrix computes a range from
    // the raw value range instead, which is not a reading error.
    if (e.min !== 0 || e.max !== 0) {
      diff(out, at, 'min', e.min, a.min);
      diff(out, at, 'max', e.max, a.max);
    }
    diff(out, at, 'unit', e.unit.trim(), a.unit.trim());
    diff(out, at, 'receivers', nodes(e.receivers), nodes(a.receivers));
    diff(out, at, 'multiplex', mux(e.multiplex), mux(a.multiplex));
    compareValues(out, at, e.values ?? {}, a.values ?? {});
    diff(out, at, 'comment', text(e.comment), text(a.comment));
    compareAttributes(at, 'signal', e.attributes, a.attributes);
  }
  for (const name of actualByName.keys()) out.push(`${where} / ${name}: signal not in the DBC twin`);
}

const frameFormat = (db: DbcDatabase, m: DbcMessage) =>
  isJ1939Pg(db, m) ? 'j1939pg' : isCanFd(db, m) ? 'fd' : 'classic';

function compareNodes(out: string[], expected: DbcNode[], actual: DbcNode[], compareAttributes: AttributeComparer) {
  const byName = new Map(actual.map((n) => [n.name, n]));
  for (const e of expected) {
    const a = byName.get(e.name);
    if (!a) {
      out.push(`node ${e.name}: missing`);
      continue;
    }
    byName.delete(e.name);
    diff(out, `node ${e.name}`, 'comment', text(e.comment), text(a.comment));
    compareAttributes(`node ${e.name}`, 'node', e.attributes, a.attributes);
  }
  for (const name of byName.keys()) out.push(`node ${name}: not in the DBC twin`);
}

function compareValueTables(out: string[], expected: DbcValueTable[], actual: DbcValueTable[]) {
  const byName = new Map(actual.map((t) => [t.name, t]));
  for (const e of expected) {
    const a = byName.get(e.name);
    if (!a) {
      out.push(`value table ${e.name}: missing`);
      continue;
    }
    byName.delete(e.name);
    compareValues(out, `value table ${e.name}`, e.values, a.values);
  }
  for (const name of byName.keys()) out.push(`value table ${name}: not in the DBC twin`);
}

function compareDefinitions(out: string[], expected: DbcAttributeDefinition[], actual: DbcAttributeDefinition[]) {
  const key = (d: DbcAttributeDefinition) => `${d.objectType || 'network'} ${d.name}`;
  const byKey = new Map(actual.map((d) => [key(d), d]));
  for (const e of expected) {
    const where = `definition ${key(e)}`;
    const a = byKey.get(key(e));
    if (!a) {
      out.push(`${where}: missing`);
      continue;
    }
    byKey.delete(key(e));
    diff(out, where, 'valueType', e.valueType, a.valueType);
    diff(out, where, 'enumValues', (e.enumValues ?? []).join(','), (a.enumValues ?? []).join(','));
    diff(out, where, 'min', e.min, a.min);
    diff(out, where, 'max', e.max, a.max);
    diff(out, where, 'default', e.defaultValue, a.defaultValue);
  }
  for (const k of byKey.keys()) out.push(`definition ${k}: not in the DBC twin`);
}

function diff(out: string[], where: string, field: string, e: unknown, a: unknown) {
  if (typeof e === 'number' && typeof a === 'number') {
    if (e === a || Math.abs(e - a) <= 1e-9 * Math.max(Math.abs(e), Math.abs(a))) return;
  } else if (e === a) {
    return;
  }
  out.push(`${where}: ${field} ${show(e)} -> ${show(a)}`);
}

/** Long texts (comments) are cut so that a difference stays one short line. */
function show(v: unknown): string {
  if (typeof v !== 'string') return String(v);
  return JSON.stringify(v.length > 48 ? v.slice(0, 45) + '...' : v);
}

const node = (n: string) => (n === NO_NODE ? '' : n);
const nodes = (ns: string[]) =>
  ns
    .filter((n) => n !== NO_NODE && n !== '')
    .sort()
    .join(',');
const text = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim();

function mux(m: MultiplexInfo): string {
  let s = m.role;
  if (m.switchValue !== undefined) s += ` ${m.switchValue}`;
  if (m.extended) {
    s += ` by ${m.extended.switchName} [${m.extended.ranges.map(([lo, hi]) => `${lo}-${hi}`).join(', ')}]`;
  }
  return s;
}

/** Value descriptions: one line if a side has none, else one per differing raw value. */
function compareValues(out: string[], at: string, e: Record<number, string>, a: Record<number, string>) {
  const ek = Object.keys(e);
  const ak = Object.keys(a);
  if (ek.length === 0 || ak.length === 0) {
    if (ek.length !== ak.length) out.push(`${at}: values ${ek.length} entries -> ${ak.length} entries`);
    return;
  }
  const keys = [...new Set([...ek, ...ak])].map(Number).sort((x, y) => x - y);
  for (const k of keys) diff(out, at, `values[${k}]`, e[k]?.trim(), a[k]?.trim());
}
