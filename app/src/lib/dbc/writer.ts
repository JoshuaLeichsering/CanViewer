// SPDX-License-Identifier: GPL-2.0-or-later
import { MAX_SIGNAL_BITS, NO_NODE } from './parser';
import type { AttrValue, DbcAttributeDefinition, DbcDatabase, DbcMessage, DbcSignal } from './types';

/**
 * Writes a DbcDatabase as DBC text that parseDbc reads back to the same
 * model. The guarantee is about the model, not the source text: comment
 * layout, whitespace and the order of statements are not kept (see
 * docs/decisions/0008-dbc-writer.md). It is checked on all 58 OEM corpus
 * files by roundtrip.test.ts.
 *
 * Anything the DBC grammar cannot hold as it is (a name with a space, a
 * double quote in a unit, a second signal of the same name that no statement
 * can address, …) is reported as an issue instead of being lost silently.
 * The text is still written; the caller decides whether to keep it.
 */

export type DbcWriteIssueKind =
  /** A name the grammar reads as letters, digits and underscores only. */
  | 'identifier'
  /** A node name in a list (BU_, receivers, transmitters): empty, with a space or comma, Vector__XXX, a repeat, or the sender itself. */
  | 'listName'
  /** A double quote in a string the grammar cannot escape it in. */
  | 'quote'
  /** A string that ends in a backslash, which would escape its closing quote. */
  | 'backslash'
  /** A number the grammar reads as a whole number of zero or more. */
  | 'integer'
  /** A start bit or length outside what the parser accepts (start 0–511, length 1–512). */
  | 'signalBits'
  /** A number that would be read back as the enum label at that index. */
  | 'enumIndex'
  /** Not a number where the grammar needs one (NaN as an attribute value). */
  | 'number'
  /** A property of a second message with the same id, or a second signal or attribute definition with the same name, which no statement can address. */
  | 'ambiguous';

export interface DbcWriteIssue {
  kind: DbcWriteIssueKind;
  /** The object, in DBC terms: `BO_ 256 EngineData`, `SG_ EngineData.EngineSpeed`, `BU_ ECM`, `VERSION`, … */
  where: string;
  /** The property: `name`, `unit`, `comment`, `attributes.GenMsgCycleTime`, … */
  field: string;
}

export interface DbcWriteResult {
  text: string;
  issues: DbcWriteIssue[];
}

/** The NS_ keyword list Vector tools write at the top of every file. */
const NS_LIST = [
  'NS_DESC_', 'CM_', 'BA_DEF_', 'BA_', 'VAL_', 'CAT_DEF_', 'CAT_', 'FILTER', 'BA_DEF_DEF_', 'EV_DATA_',
  'ENVVAR_DATA_', 'SGTYPE_', 'SGTYPE_VAL_', 'BA_DEF_SGTYPE_', 'BA_SGTYPE_', 'SIG_TYPE_REF_', 'VAL_TABLE_',
  'SIG_GROUP_', 'SIG_VALTYPE_', 'SIGTYPE_VALTYPE_', 'BO_TX_BU_', 'BA_DEF_REL_', 'BA_REL_', 'BA_DEF_DEF_REL_',
  'BU_SG_REL_', 'BU_EV_REL_', 'BU_BO_REL_', 'SG_MUL_VAL_',
];

const IDENTIFIER = /^\w+$/;
/** A name in a list the parser splits at commas and whitespace. */
const LIST_NAME = /^[^\s,]+$/;
/** What the parser reads as a value description key. */
const VALUE_KEY = /^-?\d+$/;

/**
 * Whether the statements after the BO_ blocks (CM_, BA_, VAL_, SIG_VALTYPE_,
 * …) can address this message, or this signal of it. They name a message by
 * its raw id and a signal by its name, and the parser attaches them to the
 * first match, so a later message with the same id, or a later signal of the
 * same name in a message, cannot be addressed. The editors use this rule too,
 * so they never accept a change the writer would have to report.
 */
export function dbcAddressing(db: DbcDatabase): (message: DbcMessage, signal?: DbcSignal) => boolean {
  const firstMessageWithId = new Map<number, DbcMessage>();
  for (const message of db.messages) if (!firstMessageWithId.has(message.rawId)) firstMessageWithId.set(message.rawId, message);
  return (message, signal) =>
    firstMessageWithId.get(message.rawId) === message &&
    (signal === undefined || message.signals.find((s) => s.name === signal.name) === signal);
}

/** The skipped statements the writer writes itself: an empty BS_ and the standard NS_ list. */
const WRITTEN_SKIPPED = new Set(['NS_', 'BS_']);
/**
 * The one parse problem whose line stays in the model: a second message with
 * an id already taken is kept, and written, as it is. writer.test.ts pins
 * this against the parser's wording.
 */
const KEPT_PROBLEM = /^duplicate message id /;

/** What the source held that is not in the model, so that a written file lacks it too. */
export interface DbcNotWritten {
  /** Statements the reader recognized but CanViewer does not model, as counted in `skipped`: EV_, SIG_GROUP_, BA_REL_, … */
  skipped: Array<[keyword: string, count: number]>;
  /** Parse problems whose content is lost: lines the reader could not use, such as a CM_ for an unknown signal. */
  problems: number;
}

/**
 * The two parse diagnostics, read as what a written file cannot have: the
 * model holds neither the statements CanViewer does not model nor the lines
 * it could not use, so the writer cannot write them. Save as DBC lists them
 * before it saves, so that nothing is lost silently.
 */
export function notWritten(db: DbcDatabase): DbcNotWritten {
  return {
    skipped: Object.entries(db.skipped).filter(([keyword]) => !WRITTEN_SKIPPED.has(keyword)),
    problems: db.problems.filter((p) => !KEPT_PROBLEM.test(p.reason)).length,
  };
}

export function writeDbc(db: DbcDatabase): DbcWriteResult {
  const issues: DbcWriteIssue[] = [];
  const out: string[] = [];
  const reported = new Set<string>();
  const issue = (kind: DbcWriteIssueKind, where: string, field: string) => {
    const key = `${kind}\0${where}\0${field}`;
    if (reported.has(key)) return;
    reported.add(key);
    issues.push({ kind, where, field });
  };

  const identifier = (name: string, where: string, field: string) => {
    if (!IDENTIFIER.test(name)) issue('identifier', where, field);
    return name;
  };
  const integer = (n: number, where: string, field: string) => {
    if (!Number.isSafeInteger(n) || n < 0) issue('integer', where, field);
    return String(n);
  };
  /** A string in quotes that the parser does not unescape: no double quote may appear in it. */
  const plain = (s: string, where: string, field: string) => {
    if (s.includes('"')) issue('quote', where, field);
    else if (s.endsWith('\\')) issue('backslash', where, field);
    return `"${s}"`;
  };
  /** A string in quotes that the parser unescapes (\" → "). */
  const escaped = (s: string, where: string, field: string) => {
    if (s.endsWith('\\')) issue('backslash', where, field);
    return `"${s.replace(/"/g, '\\"')}"`;
  };
  const nodeList = (names: string[], where: string, field: string, exclude?: string) => {
    for (const name of names) {
      if (!LIST_NAME.test(name) || name === NO_NODE || (exclude !== undefined && name === exclude)) {
        issue('listName', where, field);
      }
    }
    return names.join(',');
  };

  const firstDefinition = new Map<string, DbcAttributeDefinition>();
  for (const def of db.attributeDefinitions) if (!firstDefinition.has(def.name)) firstDefinition.set(def.name, def);

  /**
   * An attribute value as BA_ and BA_DEF_DEF_ write it. The parser resolves
   * an in-range integer to the enum label of the first definition with that
   * name, so a label is written as its index (BA_) or quoted (BA_DEF_DEF_),
   * and a number that would turn into a label is reported.
   */
  const attrValue = (name: string, value: AttrValue, where: string, field: string, labelAsIndex: boolean) => {
    const def = firstDefinition.get(name);
    const labels = def?.valueType === 'ENUM' ? def.enumValues : undefined;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) issue('number', where, field);
      else if (labels && Number.isInteger(value) && value >= 0 && value < labels.length) issue('enumIndex', where, field);
      return String(value);
    }
    if (labelAsIndex && labels && labels.includes(value)) return String(labels.indexOf(value));
    return escaped(value, where, field);
  };
  const attrName = (name: string, where: string, field: string) => {
    if (name === '') issue('identifier', where, field);
    return plain(name, where, field);
  };

  const signalWhere = (message: DbcMessage, signal: DbcSignal) => `SG_ ${message.name}.${signal.name}`;
  const messageWhere = (message: DbcMessage) => `BO_ ${message.rawId} ${message.name}`;

  // A property of a later duplicate cannot be addressed, so it is reported
  // and not written (writing it would attach it to the first one).
  const addressable = dbcAddressing(db);

  // Header
  out.push(`VERSION ${plain(db.version, 'VERSION', 'version')}`, '', '');
  out.push('NS_ :', ...NS_LIST.map((k) => `\t${k}`), '');
  out.push('BS_:', '');

  // Nodes
  const seenNodes = new Set<string>();
  for (const node of db.nodes) {
    if (!LIST_NAME.test(node.name) || node.name === NO_NODE || seenNodes.has(node.name)) {
      issue('listName', `BU_ ${node.name}`, 'name');
    }
    seenNodes.add(node.name);
  }
  out.push(`BU_: ${db.nodes.map((n) => n.name).join(' ')}`.trimEnd(), '');

  // Value tables
  for (const table of db.valueTables) {
    const where = `VAL_TABLE_ ${table.name}`;
    out.push(`VAL_TABLE_ ${identifier(table.name, where, 'name')} ${valuePairs(table.values, where, 'values')};`);
  }
  if (db.valueTables.length > 0) out.push('');

  // Messages and their signals
  for (const message of db.messages) {
    const where = messageWhere(message);
    const sender = message.sender === '' ? NO_NODE : identifier(message.sender, where, 'sender');
    out.push(
      `BO_ ${integer(message.rawId, where, 'id')} ${identifier(message.name, where, 'name')}: ${integer(message.dlc, where, 'dlc')} ${sender}`,
    );
    for (const signal of message.signals) out.push(signalLine(message, signal));
    out.push('');
  }

  function signalLine(message: DbcMessage, signal: DbcSignal): string {
    const where = signalWhere(message, signal);
    const name = identifier(signal.name, where, 'name');
    if (!Number.isSafeInteger(signal.startBit) || signal.startBit < 0 || signal.startBit >= MAX_SIGNAL_BITS) {
      issue('signalBits', where, 'startBit');
    }
    if (!Number.isSafeInteger(signal.length) || signal.length < 1 || signal.length > MAX_SIGNAL_BITS) {
      issue('signalBits', where, 'length');
    }
    let mux = '';
    const { role, switchValue } = signal.multiplex;
    if (role === 'multiplexor') mux = ' M';
    else if (role === 'multiplexed' || role === 'both') {
      mux = ` m${integer(switchValue ?? NaN, where, 'multiplex.switchValue')}${role === 'both' ? 'M' : ''}`;
    }
    const order = signal.byteOrder === 'intel' ? '1' : '0';
    // Floats keep their sign bit only through SIG_VALTYPE_; '-' is what other writers use.
    const sign = signal.valueType === 'unsigned' ? '+' : '-';
    const receivers = signal.receivers.length > 0 ? nodeList(signal.receivers, where, 'receivers') : NO_NODE;
    return (
      ` SG_ ${name}${mux} : ${signal.startBit}|${signal.length}@${order}${sign}` +
      ` (${signal.factor},${signal.offset}) [${signal.min}|${signal.max}]` +
      ` ${plain(signal.unit, where, 'unit')} ${receivers}`
    );
  }

  // Additional transmitters
  const tx: string[] = [];
  for (const message of db.messages) {
    if (message.transmitters.length === 0) continue;
    const where = messageWhere(message);
    if (!addressable(message)) {
      issue('ambiguous', where, 'transmitters');
      continue;
    }
    tx.push(`BO_TX_BU_ ${message.rawId} : ${nodeList(message.transmitters, where, 'transmitters', message.sender)};`);
  }
  section(tx);

  // Comments
  const cm: string[] = [];
  if (db.comment !== undefined) cm.push(`CM_ ${escaped(db.comment, 'CM_', 'comment')};`);
  for (const node of db.nodes) {
    if (node.comment === undefined) continue;
    const where = `BU_ ${node.name}`;
    cm.push(`CM_ BU_ ${identifier(node.name, where, 'name')} ${escaped(node.comment, where, 'comment')};`);
  }
  for (const message of db.messages) {
    const where = messageWhere(message);
    if (message.comment !== undefined) {
      if (addressable(message)) cm.push(`CM_ BO_ ${message.rawId} ${escaped(message.comment, where, 'comment')};`);
      else issue('ambiguous', where, 'comment');
    }
    for (const signal of message.signals) {
      if (signal.comment === undefined) continue;
      const sWhere = signalWhere(message, signal);
      if (addressable(message, signal)) {
        cm.push(`CM_ SG_ ${message.rawId} ${signal.name} ${escaped(signal.comment, sWhere, 'comment')};`);
      } else issue('ambiguous', sWhere, 'comment');
    }
  }
  section(cm);

  // Attribute definitions and defaults
  const defs: string[] = [];
  for (const def of db.attributeDefinitions) {
    const where = `BA_DEF_ "${def.name}"`;
    let rest = '';
    if (def.valueType === 'ENUM') {
      rest = (def.enumValues ?? []).map((label) => plain(label, where, 'enumValues')).join(',');
    } else if (def.valueType !== 'STRING' && def.min !== undefined && def.max !== undefined) {
      rest = `${def.min} ${def.max}`;
    }
    const object = def.objectType === '' ? '' : `${def.objectType} `;
    defs.push(`BA_DEF_ ${object}${attrName(def.name, where, 'name')} ${def.valueType}${rest === '' ? '' : ' ' + rest};`);
  }
  section(defs);
  const defaults: string[] = [];
  for (const def of db.attributeDefinitions) {
    if (def.defaultValue === undefined) continue;
    const where = `BA_DEF_ "${def.name}"`;
    if (firstDefinition.get(def.name) !== def) {
      issue('ambiguous', where, 'defaultValue');
      continue;
    }
    defaults.push(`BA_DEF_DEF_ ${plain(def.name, where, 'name')} ${attrValue(def.name, def.defaultValue, where, 'defaultValue', false)};`);
  }
  section(defaults);

  // Attribute values
  const ba: string[] = [];
  const attrs = (attributes: Record<string, AttrValue>, where: string, target: string) => {
    for (const [name, value] of Object.entries(attributes)) {
      const field = `attributes.${name}`;
      ba.push(`BA_ ${attrName(name, where, field)} ${target}${attrValue(name, value, where, field, true)};`);
    }
  };
  attrs(db.attributes, 'BA_', '');
  for (const node of db.nodes) {
    if (Object.keys(node.attributes).length === 0) continue;
    const where = `BU_ ${node.name}`;
    attrs(node.attributes, where, `BU_ ${identifier(node.name, where, 'name')} `);
  }
  for (const message of db.messages) {
    const where = messageWhere(message);
    if (Object.keys(message.attributes).length > 0) {
      if (addressable(message)) attrs(message.attributes, where, `BO_ ${message.rawId} `);
      else issue('ambiguous', where, 'attributes');
    }
    for (const signal of message.signals) {
      if (Object.keys(signal.attributes).length === 0) continue;
      const sWhere = signalWhere(message, signal);
      if (addressable(message, signal)) attrs(signal.attributes, sWhere, `SG_ ${message.rawId} ${signal.name} `);
      else issue('ambiguous', sWhere, 'attributes');
    }
  }
  section(ba);

  // Value descriptions, float types and extended multiplexing
  const val: string[] = [];
  const valType: string[] = [];
  const mulVal: string[] = [];
  for (const message of db.messages) {
    for (const signal of message.signals) {
      const where = signalWhere(message, signal);
      const ok = addressable(message, signal);
      const ref = `${message.rawId} ${signal.name}`;
      if (signal.values !== undefined) {
        if (ok) val.push(`VAL_ ${ref} ${valuePairs(signal.values, where, 'values')};`);
        else issue('ambiguous', where, 'values');
      }
      if (signal.valueType === 'float' || signal.valueType === 'double') {
        if (ok) valType.push(`SIG_VALTYPE_ ${ref} : ${signal.valueType === 'float' ? 1 : 2};`);
        else issue('ambiguous', where, 'valueType');
      }
      const extended = signal.multiplex.extended;
      if (extended) {
        if (!ok) {
          issue('ambiguous', where, 'multiplex.extended');
          continue;
        }
        const ranges = extended.ranges
          .map(([lo, hi]) => `${integer(lo, where, 'multiplex.extended')}-${integer(hi, where, 'multiplex.extended')}`)
          .join(', ');
        // The grammar needs at least one character of ranges; a lone comma reads back as none.
        mulVal.push(
          `SG_MUL_VAL_ ${ref} ${identifier(extended.switchName, where, 'multiplex.extended')} ${ranges === '' ? ',' : ranges};`,
        );
      }
    }
  }
  section(val);
  section(valType);
  section(mulVal);

  function section(lines: string[]) {
    if (lines.length > 0) out.push(...lines, '');
  }

  function valuePairs(values: Record<number, string>, where: string, field: string): string {
    const pairs = Object.entries(values).map(([key, label]) => {
      if (!VALUE_KEY.test(key)) issue('integer', where, field);
      return `${key} ${plain(label, where, field)}`;
    });
    return pairs.length > 0 ? `${pairs.join(' ')} ` : '';
  }

  return { text: out.join('\n').replace(/\n+$/, '') + '\n', issues };
}
