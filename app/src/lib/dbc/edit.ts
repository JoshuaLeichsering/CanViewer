import { MAX_SIGNAL_BITS } from './parser';
import type { ByteOrder, DbcDatabase, DbcMessage, DbcSignal, SignalValueType } from './types';
import { hexId } from '../format';

/**
 * Editing message and signal properties, as pure functions over the model.
 *
 * A draft holds the form fields as typed. editMessage and editSignal check a
 * draft and turn it into an updated object; replaceMessage and replaceSignal
 * put that object into a new database, leaving the old one untouched.
 *
 * A field left as it was keeps the file's value exactly, without being
 * checked or parsed again, so opening an editor and applying it unchanged
 * gives back the identical message or signal. A changed field must be
 * something the DBC writer can hold, so that an edited database still
 * round-trips (see docs/decisions/0002-dbc-writer.md).
 */

const EXT_FLAG = 0x80000000;
export const MAX_STANDARD_ID = 0x7ff;
export const MAX_EXTENDED_ID = 0x1fffffff;
/** Largest payload of any frame type CanViewer knows: a J1939 transport-protocol message (255 × 7 bytes). */
export const MAX_DLC = 1785;

/** A C identifier, which the DBC format asks for in message, signal and node names. */
const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validation messages; each is an i18n key, so the app shows them in English and German. */
export type EditErrorKey =
  | 'edtErrRequired'
  | 'edtErrIdentifier'
  | 'edtErrMessageNameTaken'
  | 'edtErrSignalNameTaken'
  | 'edtErrId'
  | 'edtErrIdRange'
  | 'edtErrIdTaken'
  | 'edtErrDlc'
  | 'edtErrBackslash'
  | 'edtErrQuote'
  | 'edtErrNumber'
  | 'edtErrStartBit'
  | 'edtErrLength'
  | 'edtErrFloatLength';

export interface EditError {
  key: EditErrorKey;
  params?: Record<string, string | number>;
}

export interface EditResult<T, F extends string> {
  errors: Partial<Record<F, EditError>>;
  /** The updated object; present only when there are no errors. */
  value?: T;
}

export interface MessageDraft {
  name: string;
  /** Hex with 0x, or decimal. */
  id: string;
  extended: boolean;
  dlc: string;
  /** '' for no sender (written as Vector__XXX). */
  sender: string;
  comment: string;
}

export interface SignalDraft {
  name: string;
  startBit: string;
  length: string;
  byteOrder: ByteOrder;
  valueType: SignalValueType;
  factor: string;
  offset: string;
  min: string;
  max: string;
  unit: string;
  receivers: string[];
  comment: string;
}

export function messageDraft(message: DbcMessage): MessageDraft {
  return {
    name: message.name,
    id: hexId(message.id, message.isExtended),
    extended: message.isExtended,
    dlc: String(message.dlc),
    sender: message.sender,
    comment: message.comment ?? '',
  };
}

export function signalDraft(signal: DbcSignal): SignalDraft {
  return {
    name: signal.name,
    startBit: String(signal.startBit),
    length: String(signal.length),
    byteOrder: signal.byteOrder,
    valueType: signal.valueType,
    // String() is exact: the shortest text that reads back as the same number.
    factor: String(signal.factor),
    offset: String(signal.offset),
    min: String(signal.min),
    max: String(signal.max),
    unit: signal.unit,
    receivers: [...signal.receivers],
    comment: signal.comment ?? '',
  };
}

/** A decimal number as people type it, with a decimal comma accepted too. Null if it is not one. */
export function parseNumber(text: string): number | null {
  let t = text.trim();
  if (/^[+-]?\d*,\d+(e[+-]?\d+)?$/i.test(t)) t = t.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseWhole(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function parseId(text: string): number | null {
  const t = text.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  return parseWhole(t);
}

/** Checks for a string the writer puts in quotes; `quotes` is false where DBC cannot escape a quote. */
function stringError(text: string, quotes: boolean): EditError | undefined {
  if (!quotes && text.includes('"')) return { key: 'edtErrQuote' };
  if (text.endsWith('\\')) return { key: 'edtErrBackslash' };
  return undefined;
}

function nameError(name: string, takenBy: boolean, takenKey: EditErrorKey): EditError | undefined {
  if (name.trim() === '') return { key: 'edtErrRequired' };
  if (!C_IDENTIFIER.test(name)) return { key: 'edtErrIdentifier' };
  if (takenBy) return { key: takenKey, params: { name } };
  return undefined;
}

/** A comment: an empty field means no comment; an untouched field keeps the file's value, '' included. */
function withComment<T extends { comment?: string }>(object: T, draft: string, changed: boolean): T {
  if (!changed) return object;
  const { comment: _old, ...rest } = object;
  return (draft === '' ? rest : { ...rest, comment: draft }) as T;
}

export function editMessage(db: DbcDatabase, message: DbcMessage, draft: MessageDraft): EditResult<DbcMessage, keyof MessageDraft> {
  const initial = messageDraft(message);
  const errors: EditResult<DbcMessage, keyof MessageDraft>['errors'] = {};
  const others = db.messages.filter((m) => m !== message);
  let next: DbcMessage = { ...message };

  if (draft.name !== initial.name) {
    const error = nameError(draft.name, others.some((m) => m.name === draft.name), 'edtErrMessageNameTaken');
    if (error) errors.name = error;
    else next.name = draft.name;
  }

  if (draft.id !== initial.id || draft.extended !== initial.extended) {
    const id = parseId(draft.id);
    const max = draft.extended ? MAX_EXTENDED_ID : MAX_STANDARD_ID;
    if (id === null) errors.id = { key: 'edtErrId' };
    else if (id > max) errors.id = { key: 'edtErrIdRange', params: { bits: draft.extended ? 29 : 11, max: hexId(max, false) } };
    else {
      const rawId = draft.extended ? id + EXT_FLAG : id;
      const holder = others.find((m) => m.rawId === rawId);
      if (holder) errors.id = { key: 'edtErrIdTaken', params: { name: holder.name } };
      else next = { ...next, id, rawId, isExtended: draft.extended };
    }
  }

  if (draft.dlc !== initial.dlc) {
    const dlc = parseWhole(draft.dlc);
    if (dlc === null || dlc > MAX_DLC) errors.dlc = { key: 'edtErrDlc' };
    else next.dlc = dlc;
  }

  if (draft.sender !== initial.sender) {
    if (draft.sender !== '' && !C_IDENTIFIER.test(draft.sender)) errors.sender = { key: 'edtErrIdentifier' };
    else {
      next.sender = draft.sender;
      // The parser drops the sender from the extra transmitters (BO_TX_BU_).
      next.transmitters = next.transmitters.filter((t) => t !== draft.sender);
    }
  }

  const commentChanged = draft.comment !== initial.comment;
  if (commentChanged) {
    const error = stringError(draft.comment, true);
    if (error) errors.comment = error;
  }
  next = withComment(next, draft.comment, commentChanged && !errors.comment);

  return Object.keys(errors).length > 0 ? { errors } : { errors, value: next };
}

export function editSignal(message: DbcMessage, signal: DbcSignal, draft: SignalDraft): EditResult<DbcSignal, keyof SignalDraft> {
  const initial = signalDraft(signal);
  const errors: EditResult<DbcSignal, keyof SignalDraft>['errors'] = {};
  let next: DbcSignal = { ...signal };

  if (draft.name !== initial.name) {
    const taken = message.signals.some((s) => s !== signal && s.name === draft.name);
    const error = nameError(draft.name, taken, 'edtErrSignalNameTaken');
    if (error) errors.name = error;
    else next.name = draft.name;
  }

  if (draft.startBit !== initial.startBit) {
    const start = parseWhole(draft.startBit);
    if (start === null || start >= MAX_SIGNAL_BITS) errors.startBit = { key: 'edtErrStartBit' };
    else next.startBit = start;
  }

  const lengthChanged = draft.length !== initial.length;
  if (lengthChanged) {
    const length = parseWhole(draft.length);
    if (length === null || length < 1 || length > MAX_SIGNAL_BITS) errors.length = { key: 'edtErrLength' };
    else next.length = length;
  }

  next.byteOrder = draft.byteOrder;
  next.valueType = draft.valueType;
  // IEEE floats have a fixed size; check it whenever the type or the length changes.
  if ((lengthChanged || draft.valueType !== initial.valueType) && !errors.length) {
    const size = next.valueType === 'float' ? 32 : next.valueType === 'double' ? 64 : undefined;
    if (size !== undefined && next.length !== size) {
      errors.length = { key: 'edtErrFloatLength', params: { type: next.valueType, n: size } };
    }
  }

  for (const field of ['factor', 'offset', 'min', 'max'] as const) {
    if (draft[field] === initial[field]) continue;
    const n = parseNumber(draft[field]);
    if (n === null) errors[field] = { key: 'edtErrNumber' };
    else next[field] = n;
  }

  if (draft.unit !== initial.unit) {
    const error = stringError(draft.unit, false);
    if (error) errors.unit = error;
    else next.unit = draft.unit;
  }

  if (draft.receivers.join(',') !== initial.receivers.join(',')) next.receivers = [...draft.receivers];

  const commentChanged = draft.comment !== initial.comment;
  if (commentChanged) {
    const error = stringError(draft.comment, true);
    if (error) errors.comment = error;
  }
  next = withComment(next, draft.comment, commentChanged && !errors.comment);

  return Object.keys(errors).length > 0 ? { errors } : { errors, value: next };
}

/** The nodes a signal can be received by: the database's, plus any the file names without defining them. */
export function receiverOptions(db: DbcDatabase, signal: DbcSignal): string[] {
  const names = db.nodes.map((n) => n.name);
  for (const r of signal.receivers) if (!names.includes(r)) names.push(r);
  return names;
}

export function replaceMessage(db: DbcDatabase, old: DbcMessage, updated: DbcMessage): DbcDatabase {
  return { ...db, messages: db.messages.map((m) => (m === old ? updated : m)) };
}

/**
 * Replaces a signal in its message. A renamed signal is renamed where other
 * signals of the message name it as their extended-multiplexing switch.
 */
export function replaceSignal(
  db: DbcDatabase,
  message: DbcMessage,
  old: DbcSignal,
  updated: DbcSignal,
): { db: DbcDatabase; message: DbcMessage } {
  const renamed = old.name !== updated.name;
  const signals = message.signals.map((s) => {
    if (s === old) return updated;
    const extended = s.multiplex.extended;
    if (renamed && extended && extended.switchName === old.name) {
      return { ...s, multiplex: { ...s.multiplex, extended: { ...extended, switchName: updated.name } } };
    }
    return s;
  });
  const nextMessage = { ...message, signals };
  return { db: replaceMessage(db, message, nextMessage), message: nextMessage };
}
