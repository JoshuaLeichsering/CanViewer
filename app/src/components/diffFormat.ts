import type { ChangeKind, MessageDiff } from '../lib/diff/diff';
import type { Scalar } from '../lib/diff/fields';
import type { DbcSignal } from '../lib/dbc/types';
import type { MsgKey, TParams } from '../lib/i18n';
import { fmtNum } from '../lib/format';

/**
 * How diff mode presents a change: field names as the rest of the UI labels
 * them, values in the units and notation the viewer uses. Kept apart from the
 * component so that it can be tested without a browser.
 */
type T = (key: MsgKey, params?: TParams) => string;

const FIELD_KEYS: Record<string, MsgKey> = {
  id: 'thId',
  isExtended: 'difFieldExtended',
  name: 'thName',
  dlc: 'dlc',
  sender: 'sender',
  transmitters: 'difFieldTransmitters',
  comment: 'thComment',
  frameFormat: 'difFieldFrameFormat',
  startBit: 'thStart',
  length: 'thLength',
  byteOrder: 'thByteOrder',
  valueType: 'thType',
  factor: 'thFactor',
  offset: 'thOffset',
  unit: 'thUnit',
  receivers: 'thReceivers',
  multiplex: 'kvMux',
  version: 'difFieldVersion',
  j1939Database: 'difFieldJ1939',
  enumValues: 'thEnumValues',
  default: 'thDefault',
};

/** The label of a changed field, e.g. "Factor", "Value 3", "Attribute GenMsgCycleTime". */
export function fieldLabel(field: string, t: T): string {
  if (FIELD_KEYS[field]) return t(FIELD_KEYS[field]);
  if (field === 'min') return 'Min';
  if (field === 'max') return 'Max';
  const value = field.match(/^values\[(.+)\]$/);
  if (value) return t('difFieldValue', { raw: value[1] });
  const attribute = field.match(/^attr\[(.+)\]$/);
  if (attribute) return t('difFieldAttribute', { name: attribute[1] });
  return field;
}

/**
 * A field value as text, or undefined when the side does not have it (shown
 * as a dash). An empty text (no comment, no unit) also comes out as undefined.
 */
export function formatValue(field: string, v: Scalar, t: T): string | undefined {
  if (v === undefined || v === '') return undefined;
  switch (field) {
    case 'isExtended':
      return v ? t('pillExtended') : t('difStandard');
    case 'frameFormat':
      return v === 'classic' ? t('difFormatClassic') : v === 'fd' ? 'CAN FD' : v === 'j1939pg' ? 'J1939 PG' : String(v);
    case 'byteOrder':
      return v === 'intel' ? 'Intel' : v === 'motorola' ? 'Motorola' : String(v);
    case 'receivers':
    case 'transmitters':
    case 'enumValues':
      return String(v).split(',').join(', ');
    case 'multiplex':
      return muxNotation(String(v));
  }
  if (typeof v === 'boolean') return v ? t('difYes') : t('difNo');
  if (typeof v === 'number') return fmtNum(v);
  return v;
}

/**
 * Multiplexing in DBC notation, as the signal table shows it: M for the
 * switch, m<n> for a switched signal, m<n>M for both, and the switch and
 * value ranges of extended multiplexing in brackets. `text` is the form the
 * diff compares (muxText in app/src/lib/diff/fields.ts).
 */
export function muxNotation(text: string): string | undefined {
  const m = text.match(/^(none|multiplexor|multiplexed|both)(?: (-?\d+))?(?: by (.+) \[(.*)\])?$/);
  if (!m) return text;
  const [, role, value, switchName, ranges] = m;
  const base = role === 'none' ? '' : role === 'multiplexor' ? 'M' : role === 'both' ? `m${value}M` : `m${value}`;
  const extended = switchName ? `${switchName} ${ranges}` : '';
  if (!base && !extended) return undefined;
  return [base, extended && `(${extended})`].filter(Boolean).join(' ');
}

/** A signal in DBC notation: start|length@order sign (factor,offset) [min|max] "unit". */
export function signalNotation(s: DbcSignal): string {
  const order = s.byteOrder === 'intel' ? 1 : 0;
  const sign = s.valueType === 'unsigned' ? '+' : '-';
  const type = s.valueType === 'float' || s.valueType === 'double' ? ` ${s.valueType}` : '';
  return `${s.startBit}|${s.length}@${order}${sign}${type} (${fmtNum(s.factor)},${fmtNum(s.offset)}) [${fmtNum(s.min)}|${fmtNum(s.max)}] "${s.unit}"`;
}

/** How many of a message's signals were added, removed and changed. */
export function signalTally(m: MessageDiff): Record<Exclude<ChangeKind, 'unchanged'>, number> {
  const tally = { added: 0, removed: 0, changed: 0 };
  for (const s of m.signals) if (s.kind !== 'unchanged') tally[s.kind] += 1;
  return tally;
}

/** The labels of a message's own changed fields, each once (attributes by name). */
export function changedFields(m: MessageDiff, t: T): string[] {
  return [...new Set(m.changes.map((c) => fieldLabel(c.field, t)))];
}
