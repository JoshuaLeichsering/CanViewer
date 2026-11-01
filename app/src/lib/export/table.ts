import { isCanFd } from '../dbc/canfd';
import type { AttrValue, DbcDatabase, DbcMessage, DbcSignal, MultiplexInfo } from '../dbc/types';
import { hexId } from '../format';
import { j1939Of, num } from './layout';

/**
 * Export of the message and signal list, as CSV (one file of messages, one of
 * signals) and as JSON (messages with their signals). Both hold what the file
 * says and nothing more: attributes are the ones set in the file (no
 * defaults filled in), and an absent comment or value table stays absent.
 * The few derived columns are the ones CanViewer shows: the hex identifier,
 * the CAN FD flag and the J1939 breakdown.
 *
 * Messages come in identifier order, as every message list in the app shows
 * them; signals keep their order in the file. Column names are fixed English
 * identifiers (they equal the JSON keys), whatever the interface language.
 */

/** The messages in the order the app lists them (stable for duplicate identifiers). */
function listed(db: DbcDatabase): DbcMessage[] {
  return [...db.messages].sort((a, b) => a.id - b.id);
}

/** Attribute names in use on the given objects, sorted, for one column each. */
function attributeColumns(objects: Array<{ attributes: Record<string, AttrValue> }>): string[] {
  return [...new Set(objects.flatMap((o) => Object.keys(o.attributes)))].sort();
}

/** DBC notation of a signal's multiplexing: `M`, `m3`, `m3M`, or empty. */
export function muxNotation(mux: MultiplexInfo): string {
  const value = mux.switchValue !== undefined ? num(mux.switchValue) : '';
  if (mux.role === 'multiplexor') return 'M';
  if (mux.role === 'multiplexed') return `m${value}`;
  if (mux.role === 'both') return `m${value}M`;
  return '';
}

/** Value descriptions in VAL_ notation: `0 "Off" 1 "On"`, sorted by value. */
function valuesNotation(values: Record<number, string> | undefined): string {
  return Object.entries(values ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([value, text]) => `${value} ${JSON.stringify(text)}`)
    .join(' ');
}

export const MESSAGE_COLUMNS = [
  'id',
  'idHex',
  'isExtended',
  'name',
  'dlc',
  'canFd',
  'j1939Pgn',
  'sender',
  'transmitters',
  'signalCount',
  'comment',
] as const;

export const SIGNAL_COLUMNS = [
  'messageId',
  'messageIdHex',
  'messageName',
  'name',
  'startBit',
  'length',
  'byteOrder',
  'valueType',
  'factor',
  'offset',
  'min',
  'max',
  'unit',
  'receivers',
  'multiplex',
  'multiplexSwitch',
  'multiplexRanges',
  'values',
  'comment',
] as const;

type Cell = string | number | boolean | undefined;

/** The messages as CSV: one row per message, then one `attr.<name>` column per message attribute in use. */
export function messagesCsv(db: DbcDatabase): string {
  const messages = listed(db);
  const attributes = attributeColumns(messages);
  const rows: Cell[][] = messages.map((m) => [
    m.id,
    hexId(m.id, m.isExtended),
    m.isExtended,
    m.name,
    m.dlc,
    isCanFd(db, m),
    j1939Of(db, m)?.pgn,
    m.sender,
    m.transmitters.join(', '),
    m.signals.length,
    m.comment,
    ...attributes.map((a) => m.attributes[a]),
  ]);
  return csv([...MESSAGE_COLUMNS, ...attributes.map((a) => `attr.${a}`)], rows);
}

/** The signals as CSV: one row per signal with its message, then one `attr.<name>` column per signal attribute in use. */
export function signalsCsv(db: DbcDatabase): string {
  const pairs = listed(db).flatMap((m) => m.signals.map((s) => [m, s] as [DbcMessage, DbcSignal]));
  const attributes = attributeColumns(pairs.map(([, s]) => s));
  const rows: Cell[][] = pairs.map(([m, s]) => [
    m.id,
    hexId(m.id, m.isExtended),
    m.name,
    s.name,
    s.startBit,
    s.length,
    s.byteOrder,
    s.valueType,
    s.factor,
    s.offset,
    s.min,
    s.max,
    s.unit,
    s.receivers.join(', '),
    muxNotation(s.multiplex),
    s.multiplex.extended?.switchName,
    s.multiplex.extended?.ranges.map(([lo, hi]) => `${num(lo)}-${num(hi)}`).join(', '),
    valuesNotation(s.values),
    s.comment,
    ...attributes.map((a) => s.attributes[a]),
  ]);
  return csv([...SIGNAL_COLUMNS, ...attributes.map((a) => `attr.${a}`)], rows);
}

/**
 * RFC 4180: comma-separated, CRLF after every record, and a field in double
 * quotes when it holds a comma, a quote or a line break (quotes doubled).
 * Values are written as they are; nothing is rewritten for spreadsheets.
 */
export function csv(header: readonly string[], rows: Cell[][]): string {
  const field = (cell: Cell) => {
    const text = cell === undefined ? '' : typeof cell === 'number' ? num(cell) : String(cell);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(field).join(',') + '\r\n').join('');
}

/** The messages and their signals as JSON, two-space indented, with a final newline. */
export function messagesJson(db: DbcDatabase, fileName: string): string {
  const out = {
    source: fileName,
    databaseVersion: db.version,
    messages: listed(db).map((m) => {
      const j1939 = j1939Of(db, m);
      return {
        id: m.id,
        idHex: hexId(m.id, m.isExtended),
        isExtended: m.isExtended,
        name: m.name,
        dlc: m.dlc,
        canFd: isCanFd(db, m),
        ...(j1939 && { j1939 }),
        sender: m.sender,
        transmitters: m.transmitters,
        comment: m.comment,
        attributes: m.attributes,
        signals: m.signals.map((s) => ({
          name: s.name,
          startBit: s.startBit,
          length: s.length,
          byteOrder: s.byteOrder,
          valueType: s.valueType,
          factor: s.factor,
          offset: s.offset,
          min: s.min,
          max: s.max,
          unit: s.unit,
          receivers: s.receivers,
          multiplex: s.multiplex,
          values: s.values,
          comment: s.comment,
          attributes: s.attributes,
        })),
      };
    }),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/** `demo.dbc` -> `demo`, the stem the exported files are named after. */
export function exportStem(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]*$/, '');
  return stem === '' ? 'canviewer' : stem;
}
