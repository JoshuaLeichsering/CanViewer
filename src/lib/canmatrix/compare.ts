import { NO_NODE } from '../dbc/parser';
import type { DbcDatabase, DbcMessage, DbcSignal, MultiplexInfo } from '../dbc/types';

/**
 * Field-by-field differences between two databases in CanViewer's model, one
 * readable line each. Messages are matched by (extended flag, id), falling
 * back to the id alone so that a lost or added extended flag shows up as one
 * difference instead of a missing and an extra message; signals are matched
 * by name within a message. Used to compare a file read through canmatrix with
 * its DBC twin read by CanViewer's own parser.
 *
 * Compared: extended flag, message name, DLC, sender and comment; per signal
 * the layout (start bit as written in DBC, length, byte order), value type,
 * factor, offset, min and max (unless the DBC leaves the range at [0|0]),
 * unit, receivers, multiplexing, value descriptions and comment. Nodes, attributes and value tables are not compared yet: the
 * adapter does not map them before handover task 4.
 */
export function compareDatabases(expected: DbcDatabase, actual: DbcDatabase): string[] {
  const out: string[] = [];
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
    compareSignals(out, where, e.signals, a.signals);
  }
  for (const a of actual.messages) {
    if (!seen.has(a)) out.push(`${label(a)}: message not in the DBC twin`);
  }
  return out;
}

function compareSignals(out: string[], where: string, expected: DbcSignal[], actual: DbcSignal[]) {
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
  }
  for (const name of actualByName.keys()) out.push(`${where} / ${name}: signal not in the DBC twin`);
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
