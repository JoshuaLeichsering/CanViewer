import { NO_NODE } from '../dbc/parser';
import { isCanFd, isJ1939Pg } from '../dbc/canfd';
import type {
  AttrValue,
  DbcAttributeDefinition,
  DbcDatabase,
  DbcMessage,
  DbcNode,
  DbcSignal,
  MultiplexInfo,
} from '../dbc/types';

/**
 * The field-by-field comparison of two objects in CanViewer's model, shared by
 * the twin check (compareDatabases in app/src/lib/canmatrix/compare.ts, which
 * compares a file read through canmatrix with its DBC twin) and diff mode
 * (diffDatabases in ./diff.ts, which compares two versions of a database).
 * Both see the same fields, normalized the same way; they differ only in the
 * options below and in how they match messages and present the result.
 */

/** A field value as compared: already normalized (sorted lists joined, comments trimmed, ...). */
export type Scalar = string | number | boolean | undefined;

export interface FieldChange {
  /**
   * The field: a property name (dlc, startBit, ...), `attr[<name>]` for an
   * attribute, `values[<raw>]` for one value description, or `values` for the
   * twin check's summary of value descriptions that only one side has.
   */
  field: string;
  before: Scalar;
  after: Scalar;
  /** For `attr[...]` changes: the attribute's name. */
  attribute?: string;
}

export interface CompareOptions {
  /**
   * In DBC, a signal range of [0|0] means "no range given". With this set, min
   * and max are compared only when the before side gives a range (the twin
   * check: canmatrix computes a range where the DBC gives none, which is not a
   * reading error). Diff mode leaves it off: a range added in a new version is
   * a change.
   */
  zeroRangeUnset?: boolean;
  /**
   * When only one side has value descriptions, report the two counts as one
   * `values` change instead of one change per raw value (the twin check).
   */
  valueCountWhenOneSideEmpty?: boolean;
}

/** Numbers within a relative 1e-9 count as equal (float noise); everything else must be identical. */
export function same(before: Scalar, after: Scalar): boolean {
  if (typeof before === 'number' && typeof after === 'number') {
    return before === after || Math.abs(before - after) <= 1e-9 * Math.max(Math.abs(before), Math.abs(after));
  }
  return before === after;
}

/** One change if the two values differ, else none. */
export function changeOf(field: string, before: Scalar, after: Scalar): FieldChange[] {
  return same(before, after) ? [] : [{ field, before, after }];
}

/** The placeholder node means "no node". */
export const nodeName = (n: string) => (n === NO_NODE ? '' : n);
export const nodeList = (ns: string[]) =>
  ns
    .filter((n) => n !== NO_NODE && n !== '')
    .sort()
    .join(',');
export const text = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim();

/** The frame format by CanViewer's own rules (app/src/lib/dbc/canfd.ts). */
export const frameFormat = (db: DbcDatabase, m: DbcMessage) =>
  isJ1939Pg(db, m) ? 'j1939pg' : isCanFd(db, m) ? 'fd' : 'classic';

export function muxText(m: MultiplexInfo): string {
  let s = m.role;
  if (m.switchValue !== undefined) s += ` ${m.switchValue}`;
  if (m.extended) {
    s += ` by ${m.extended.switchName} [${m.extended.ranges.map(([lo, hi]) => `${lo}-${hi}`).join(', ')}]`;
  }
  return s;
}

/** Message properties: extended flag, name, DLC, sender, comment and frame format (not attributes or signals). */
export function messageChanges(beforeDb: DbcDatabase, b: DbcMessage, afterDb: DbcDatabase, a: DbcMessage): FieldChange[] {
  return [
    ...changeOf('isExtended', b.isExtended, a.isExtended),
    ...changeOf('name', b.name, a.name),
    ...changeOf('dlc', b.dlc, a.dlc),
    ...changeOf('sender', nodeName(b.sender), nodeName(a.sender)),
    ...changeOf('comment', text(b.comment), text(a.comment)),
    ...changeOf('frameFormat', frameFormat(beforeDb, b), frameFormat(afterDb, a)),
  ];
}

/**
 * Signal properties, in this order: layout (start bit as written in DBC,
 * length, byte order), value type, factor, offset, min, max, unit, receivers,
 * multiplexing, value descriptions and comment (not attributes).
 */
export function signalChanges(b: DbcSignal, a: DbcSignal, options: CompareOptions = {}): FieldChange[] {
  const out = [
    ...changeOf('startBit', b.startBit, a.startBit),
    ...changeOf('length', b.length, a.length),
    ...changeOf('byteOrder', b.byteOrder, a.byteOrder),
    ...changeOf('valueType', b.valueType, a.valueType),
    ...changeOf('factor', b.factor, a.factor),
    ...changeOf('offset', b.offset, a.offset),
  ];
  if (!options.zeroRangeUnset || b.min !== 0 || b.max !== 0) {
    out.push(...changeOf('min', b.min, a.min), ...changeOf('max', b.max, a.max));
  }
  out.push(
    ...changeOf('unit', b.unit.trim(), a.unit.trim()),
    ...changeOf('receivers', nodeList(b.receivers), nodeList(a.receivers)),
    ...changeOf('multiplex', muxText(b.multiplex), muxText(a.multiplex)),
    ...valueChanges(b.values ?? {}, a.values ?? {}, options),
    ...changeOf('comment', text(b.comment), text(a.comment)),
  );
  return out;
}

/** Value descriptions, one change per raw value whose text differs (or the twin check's count summary). */
export function valueChanges(
  b: Record<number, string>,
  a: Record<number, string>,
  options: CompareOptions = {},
): FieldChange[] {
  const bk = Object.keys(b);
  const ak = Object.keys(a);
  if (options.valueCountWhenOneSideEmpty && (bk.length === 0 || ak.length === 0)) {
    return bk.length === ak.length ? [] : [{ field: 'values', before: bk.length, after: ak.length }];
  }
  const keys = [...new Set([...bk, ...ak])].map(Number).sort((x, y) => x - y);
  return keys.flatMap((k) => changeOf(`values[${k}]`, b[k]?.trim(), a[k]?.trim()));
}

/** Attribute values by name, sorted; a side without the attribute has `undefined`. */
export function attributeChanges(b: Record<string, AttrValue>, a: Record<string, AttrValue>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (!same(b[k], a[k])) out.push({ field: `attr[${k}]`, before: b[k], after: a[k], attribute: k });
  }
  return out;
}

/** Node properties other than attributes: the comment. */
export function nodeChanges(b: DbcNode, a: DbcNode): FieldChange[] {
  return changeOf('comment', text(b.comment), text(a.comment));
}

/** Attribute definitions are identified by object type and name. */
export const definitionKey = (d: DbcAttributeDefinition) => `${d.objectType || 'network'} ${d.name}`;

/** Attribute definition properties: value type, enum values, range and default. */
export function definitionChanges(b: DbcAttributeDefinition, a: DbcAttributeDefinition): FieldChange[] {
  return [
    ...changeOf('valueType', b.valueType, a.valueType),
    ...changeOf('enumValues', (b.enumValues ?? []).join(','), (a.enumValues ?? []).join(',')),
    ...changeOf('min', b.min, a.min),
    ...changeOf('max', b.max, a.max),
    ...changeOf('default', b.defaultValue, a.defaultValue),
  ];
}
