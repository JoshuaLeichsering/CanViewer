// SPDX-License-Identifier: GPL-2.0-or-later
import { isJ1939Database } from '../dbc/j1939';
import { hexId } from '../format';
import type {
  DbcAttributeDefinition,
  DbcDatabase,
  DbcMessage,
  DbcNode,
  DbcSignal,
  DbcValueTable,
} from '../dbc/types';
import {
  attributeChanges,
  changeOf,
  definitionChanges,
  definitionKey,
  messageChanges,
  nodeChanges,
  nodeList,
  signalChanges,
  text,
  valueChanges,
  type FieldChange,
  type Scalar,
} from './fields';

/**
 * Diff mode: what changed between two versions of a database, in CanViewer's
 * model, so that it works for every format CanViewer reads.
 *
 * The fields compared, and how they are normalized, are the ones the twin
 * check compares (./fields.ts), with three differences that suit two versions
 * of one database rather than one file read two ways:
 * - a signal range given where the earlier version left it at [0|0] is a change;
 * - value descriptions and attributes are compared one by one, also when only
 *   one side has any;
 * - diff mode also compares the version string, the database comment and each
 *   message's additional transmitters (BO_TX_BU_).
 *
 * Messages are matched by extended flag and id; messages that share an id are
 * matched by their order in the file. A message whose extended flag changed is
 * still matched by its id alone, and one that moved to another id by its name,
 * when either match is unambiguous. Signals, nodes, value tables and attribute
 * definitions are matched by name (attribute definitions by object type and
 * name). What the parser skips (environment variables, signal groups, ...)
 * and the parse problems of either side are not part of the diff.
 */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

/** A node, value table or attribute definition. */
export interface ItemDiff<T> {
  kind: ChangeKind;
  name: string;
  before?: T;
  after?: T;
  changes: FieldChange[];
}

export type SignalDiff = ItemDiff<DbcSignal>;

export interface MessageDiff {
  kind: ChangeKind;
  before?: DbcMessage;
  after?: DbcMessage;
  /** Changes to the message's own properties and attributes; `id` if it moved. */
  changes: FieldChange[];
  /** Every signal of either version, in the order of the later version, removed ones where they were. */
  signals: SignalDiff[];
}

export interface DatabaseDiff {
  /** Version, comment, network attributes and whether CanViewer treats the database as J1939. */
  database: FieldChange[];
  attributeDefinitions: ItemDiff<DbcAttributeDefinition>[];
  nodes: ItemDiff<DbcNode>[];
  valueTables: ItemDiff<DbcValueTable>[];
  /** Every message of either version, by id (the later version's id for a matched pair). */
  messages: MessageDiff[];
}

export function diffDatabases(before: DbcDatabase, after: DbcDatabase): DatabaseDiff {
  const database = [
    ...changeOf('version', before.version, after.version),
    ...changeOf('comment', text(before.comment), text(after.comment)),
    ...attributeChanges(before.attributes, after.attributes),
    ...changeOf('j1939Database', isJ1939Database(before), isJ1939Database(after)),
  ];
  const attributeDefinitions = align(before.attributeDefinitions, after.attributeDefinitions, definitionKey).map(
    ([b, a]) => item(definitionKey((a ?? b)!), b, a, b && a ? definitionChanges(b, a) : []),
  );
  const nodes = align(before.nodes, after.nodes, (n) => n.name).map(([b, a]) =>
    item((a ?? b)!.name, b, a, b && a ? [...nodeChanges(b, a), ...attributeChanges(b.attributes, a.attributes)] : []),
  );
  const valueTables = align(before.valueTables, after.valueTables, (t) => t.name).map(([b, a]) =>
    item((a ?? b)!.name, b, a, b && a ? valueChanges(b.values, a.values) : []),
  );
  const messages = matchMessages(before.messages, after.messages).map(([b, a]) => diffMessage(before, b, after, a));
  return { database, attributeDefinitions, nodes, valueTables, messages };
}

function item<T>(name: string, before: T | undefined, after: T | undefined, changes: FieldChange[]): ItemDiff<T> {
  const kind: ChangeKind = !before ? 'added' : !after ? 'removed' : changes.length > 0 ? 'changed' : 'unchanged';
  return { kind, name, before, after, changes };
}

function diffMessage(
  beforeDb: DbcDatabase,
  b: DbcMessage | undefined,
  afterDb: DbcDatabase,
  a: DbcMessage | undefined,
): MessageDiff {
  if (!b || !a) {
    const kind = b ? 'removed' : 'added';
    const signals = (b ?? a)!.signals.map((s) => item(s.name, b && s, a && s, []));
    return { kind, before: b, after: a, changes: [], signals };
  }
  const changes = [
    ...changeOf('id', hexId(b.id, b.isExtended), hexId(a.id, a.isExtended)),
    ...messageChanges(beforeDb, b, afterDb, a),
    ...changeOf('transmitters', nodeList(b.transmitters), nodeList(a.transmitters)),
    ...attributeChanges(b.attributes, a.attributes),
  ];
  // An id that changed only by its extended flag shows up as isExtended alone.
  const own = b.id === a.id ? changes.filter((c) => c.field !== 'id') : changes;
  const signals = align(b.signals, a.signals, (s) => s.name).map(([sb, sa]) =>
    item((sa ?? sb)!.name, sb, sa, sb && sa ? [...signalChanges(sb, sa), ...attributeChanges(sb.attributes, sa.attributes)] : []),
  );
  const kind = own.length > 0 || signals.some((s) => s.kind !== 'unchanged') ? 'changed' : 'unchanged';
  return { kind, before: b, after: a, changes: own, signals };
}

/**
 * Pairs the items of two lists by key, the n-th occurrence of a key with the
 * n-th, in the order of the later list; an item only the earlier list has is
 * placed where it was, after the unchanged items that preceded it.
 */
function align<T>(before: T[], after: T[], key: (t: T) => string): Array<[T | undefined, T | undefined]> {
  const queues = new Map<string, number[]>();
  before.forEach((t, i) => {
    const queue = queues.get(key(t));
    if (queue) queue.push(i);
    else queues.set(key(t), [i]);
  });
  const partner = after.map((t) => queues.get(key(t))?.shift());
  const matched = new Set(partner.filter((i): i is number => i !== undefined));
  const out: Array<[T | undefined, T | undefined]> = [];
  const emitted = new Set<number>();
  let next = 0;
  /** Emit the earlier list's unmatched items up to (not including) index `end`. */
  const flushRemoved = (end: number, contiguousOnly: boolean) => {
    for (; next < end; next++) {
      if (matched.has(next)) {
        if (contiguousOnly) return;
        continue;
      }
      if (!emitted.has(next)) {
        out.push([before[next], undefined]);
        emitted.add(next);
      }
    }
  };
  after.forEach((t, j) => {
    const i = partner[j];
    if (i === undefined) {
      flushRemoved(before.length, true);
      out.push([undefined, t]);
    } else {
      flushRemoved(i, false);
      next = Math.max(next, i + 1);
      out.push([before[i], t]);
    }
  });
  next = 0;
  flushRemoved(before.length, false);
  return out;
}

/**
 * Pairs messages: by extended flag and id (n-th occurrence with n-th), then a
 * remaining message by its id alone (the extended flag changed), then by its
 * name (it moved to another id), each only when the match is unambiguous.
 * Sorted by id, the later version's for a pair.
 */
function matchMessages(before: DbcMessage[], after: DbcMessage[]): Array<[DbcMessage | undefined, DbcMessage | undefined]> {
  const pairs: Array<[DbcMessage | undefined, DbcMessage | undefined]> = [];
  const restB = new Set(before);
  const restA = new Set(after);
  const pair = (b: DbcMessage, a: DbcMessage) => {
    pairs.push([b, a]);
    restB.delete(b);
    restA.delete(a);
  };
  const byKey = (key: (m: DbcMessage) => string, unique: boolean) => {
    const groups = new Map<string, { b: DbcMessage[]; a: DbcMessage[] }>();
    for (const m of restB) {
      const group = groups.get(key(m));
      if (group) group.b.push(m);
      else groups.set(key(m), { b: [m], a: [] });
    }
    for (const m of restA) groups.get(key(m))?.a.push(m);
    for (const { b, a } of groups.values()) {
      if (unique && (b.length !== 1 || a.length !== 1)) continue;
      for (let i = 0; i < Math.min(b.length, a.length); i++) pair(b[i], a[i]);
    }
  };
  byKey((m) => `${m.isExtended ? 'x' : 's'}${m.id}`, false);
  byKey((m) => String(m.id), true);
  byKey((m) => m.name, true);
  for (const b of restB) pairs.push([b, undefined]);
  for (const a of restA) pairs.push([undefined, a]);
  const sortKey = ([b, a]: [DbcMessage | undefined, DbcMessage | undefined]) => (a ?? b)!;
  return pairs
    .map((p, i) => ({ p, i }))
    .sort((x, y) => {
      const mx = sortKey(x.p);
      const my = sortKey(y.p);
      return mx.id - my.id || Number(mx.isExtended) - Number(my.isExtended) || x.i - y.i;
    })
    .map(({ p }) => p);
}

export interface DiffCounts {
  /** Signals of an added message count as added, those of a removed one as removed. */
  messages: Record<ChangeKind, number>;
  signals: Record<ChangeKind, number>;
  nodes: Record<ChangeKind, number>;
  valueTables: Record<ChangeKind, number>;
  attributeDefinitions: Record<ChangeKind, number>;
  /** Changes to the database's own fields (version, comment, network attributes, J1939). */
  database: number;
}

const zero = (): Record<ChangeKind, number> => ({ added: 0, removed: 0, changed: 0, unchanged: 0 });
const tally = (items: Array<{ kind: ChangeKind }>) =>
  items.reduce((counts, { kind }) => ((counts[kind] += 1), counts), zero());

export function countChanges(diff: DatabaseDiff): DiffCounts {
  return {
    messages: tally(diff.messages),
    signals: tally(diff.messages.flatMap((m) => m.signals)),
    nodes: tally(diff.nodes),
    valueTables: tally(diff.valueTables),
    attributeDefinitions: tally(diff.attributeDefinitions),
    database: diff.database.length,
  };
}

/** True when the two versions differ in anything diff mode compares. */
export function hasChanges(diff: DatabaseDiff): boolean {
  return (
    diff.database.length > 0 ||
    [diff.attributeDefinitions, diff.nodes, diff.valueTables, diff.messages].some((items) =>
      items.some((i) => i.kind !== 'unchanged'),
    )
  );
}

/** A message as diff lines and the viewer name it: id and name, the earlier version's for a pair. */
export const messageLabel = (m: MessageDiff) => {
  const shown = (m.before ?? m.after)!;
  return `${hexId(shown.id, shown.isExtended)} ${shown.name}`;
};

/**
 * The diff as plain text, one line per change: added and removed objects as
 * one line each (their signals are not listed), changed ones with one line
 * per field. Texts are quoted; a side without the value (a value description
 * or an attribute only one version has) is written as (none). Used to pin
 * diffs in tests and to copy a diff from the app.
 */
export function diffLines(diff: DatabaseDiff): string[] {
  const out: string[] = [];
  const fields = (where: string, changes: FieldChange[]) => {
    for (const c of changes) out.push(`${where}: ${c.field} ${show(c.before)} -> ${show(c.after)}`);
  };
  const items = <T>(scope: string, list: ItemDiff<T>[]) => {
    for (const i of list) {
      if (i.kind === 'added' || i.kind === 'removed') out.push(`${scope} ${i.name}: ${i.kind}`);
      else fields(`${scope} ${i.name}`, i.changes);
    }
  };
  fields('database', diff.database);
  items('definition', diff.attributeDefinitions);
  items('node', diff.nodes);
  items('value table', diff.valueTables);
  for (const m of diff.messages) {
    const where = `message ${messageLabel(m)}`;
    if (m.kind === 'added' || m.kind === 'removed') {
      out.push(`${where}: ${m.kind}`);
      continue;
    }
    fields(where, m.changes);
    for (const s of m.signals) {
      if (s.kind === 'added' || s.kind === 'removed') out.push(`${where} / ${s.name}: ${s.kind}`);
      else fields(`${where} / ${s.name}`, s.changes);
    }
  }
  return out;
}

/** A value in diff lines: texts quoted, an absent side as (none) rather than JavaScript's undefined. */
const show = (v: Scalar) => (v === undefined ? '(none)' : typeof v === 'string' ? JSON.stringify(v) : String(v));
