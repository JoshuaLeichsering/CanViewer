// SPDX-License-Identifier: GPL-2.0-or-later
import { signalBitPositions } from '../dbc/bits';
import { isCanFd, isJ1939Pg } from '../dbc/canfd';
import { decomposeJ1939Id, isJ1939Database, PGN_NAMES, type J1939Id } from '../dbc/j1939';
import type { DbcDatabase, DbcMessage, DbcSignal } from '../dbc/types';
import { hexId } from '../format';

/**
 * What the generated code says about a message and its signals, shared by
 * the C struct and the decode pseudo-code so that both describe a signal in
 * the same words, and decode it exactly as CanViewer's decoder does
 * (`decodeFrame` in lib/dbc/bits.ts).
 */

/** Numbers as the shortest text that reads back as the same double: nothing rounded, nothing added. */
export const num = (n: number): string => String(n);

/**
 * One run of a signal's bits inside one payload byte: the raw value gets
 * `(data[byte] >> shift) & mask(width)`, moved up by `at` bits.
 */
export interface ByteTerm {
  byte: number;
  /** Lowest bit of the run within the byte (bit 0 = least significant). */
  shift: number;
  /** Number of bits in the run, 1 to 8. */
  width: number;
  /** Position of the run's lowest bit within the raw value. */
  at: number;
}

/**
 * The byte runs that make up a signal's raw value, in payload byte order.
 * Intel signals come out least significant byte first, Motorola signals most
 * significant byte first, which is how each is usually written by hand.
 */
export function byteTerms(signal: Pick<DbcSignal, 'startBit' | 'length' | 'byteOrder'>): ByteTerm[] {
  const positions = signalBitPositions(signal); // most significant bit first
  const terms: ByteTerm[] = [];
  for (let i = 0; i < positions.length; ) {
    const byte = positions[i] >> 3;
    let j = i;
    while (j + 1 < positions.length && positions[j + 1] === positions[j] - 1 && positions[j + 1] >> 3 === byte) j++;
    terms.push({ byte, shift: positions[j] & 7, width: j - i + 1, at: positions.length - 1 - j });
    i = j + 1;
  }
  return terms.sort((a, b) => a.byte - b.byte);
}

/** True if every bit of the signal lies inside the payload, so that the decoder decodes it. */
export function fitsPayload(signal: DbcSignal, dlc: number): boolean {
  return signalBitPositions(signal).every((p) => p >= 0 && p < dlc * 8);
}

/** How the decoder reads the raw bits: as a float only at the matching width (as `extractRawValue`). */
export function rawKind(signal: Pick<DbcSignal, 'valueType' | 'length'>): 'unsigned' | 'signed' | 'float32' | 'float64' {
  if (signal.valueType === 'float' && signal.length === 32) return 'float32';
  if (signal.valueType === 'double' && signal.length === 64) return 'float64';
  return signal.valueType === 'signed' ? 'signed' : 'unsigned';
}

const rangesText = (ranges: Array<[number, number]>) =>
  ranges.map(([lo, hi]) => (lo === hi ? num(lo) : `${num(lo)}-${num(hi)}`)).join(', ');

/** When a signal is in the frame: the switch values it depends on, outermost switch first. */
export type MuxCondition =
  | { kind: 'always' }
  | { kind: 'never'; why: string }
  | { kind: 'when'; terms: Array<{ switch: DbcSignal; ranges: Array<[number, number]> }> };

/**
 * The condition under which `decodeFrame` marks a signal active, flattened
 * into the chain of switch tests it implies: simple `m<N>` signals switch on
 * the root multiplexor, extended ones (SG_MUL_VAL_) on their named switch,
 * which must itself be active.
 */
export function muxCondition(message: DbcMessage, signal: DbcSignal): MuxCondition {
  const root = message.signals.find((s) => s.multiplex.role === 'multiplexor');
  /** The decoder looks switches up by name, and the last signal of a name wins. */
  const byName = (name: string) => {
    for (let i = message.signals.length - 1; i >= 0; i--) if (message.signals[i].name === name) return message.signals[i];
    return undefined;
  };
  const terms: Array<{ switch: DbcSignal; ranges: Array<[number, number]> }> = [];
  const seen = new Set<DbcSignal>();
  for (let s: DbcSignal = signal; ; ) {
    if (seen.has(s)) return { kind: 'never', why: 'its multiplexors switch on each other' };
    seen.add(s);
    const mux = s.multiplex;
    if (mux.role !== 'multiplexed' && mux.role !== 'both') break;
    let sw: DbcSignal;
    if (mux.extended) {
      const found = byName(mux.extended.switchName);
      if (!found) return { kind: 'never', why: `its multiplexor ${mux.extended.switchName} is not in this message` };
      sw = found;
      terms.unshift({ switch: sw, ranges: mux.extended.ranges });
    } else {
      // Without a root multiplexor the decoder cannot test anything and shows the signal.
      if (!root || root === s) break;
      if (mux.switchValue === undefined) return { kind: 'never', why: 'it has no multiplexor value' };
      sw = root;
      terms.unshift({ switch: sw, ranges: [[mux.switchValue, mux.switchValue]] });
    }
    if (!fitsPayload(sw, message.dlc)) {
      return { kind: 'never', why: `its multiplexor ${sw.name} lies outside the payload` };
    }
    s = sw;
  }
  return terms.length > 0 ? { kind: 'when', terms } : { kind: 'always' };
}

/** The condition in words, e.g. `MuxSelector == 2` or `Mode in 1-3, 5 and Sub == 0`. */
export function conditionText(condition: MuxCondition, nameOf: (s: DbcSignal) => string): string {
  if (condition.kind !== 'when') return '';
  return condition.terms
    .map(({ switch: sw, ranges }) =>
      ranges.length === 1 && ranges[0][0] === ranges[0][1]
        ? `${nameOf(sw)} == ${num(ranges[0][0])}`
        : `${nameOf(sw)} in ${rangesText(ranges)}`,
    )
    .join(' and ');
}

/**
 * One line that describes a signal as the signal card does: bits, byte order,
 * type, scaling, range and unit, and its role in multiplexing.
 */
export function describeSignal(message: DbcMessage, signal: DbcSignal, nameOf: (s: DbcSignal) => string): string {
  const kind = rawKind(signal);
  const type =
    kind === 'float32' || kind === 'float64'
      ? `${kind} (IEEE 754)`
      : signal.valueType === 'float' || signal.valueType === 'double'
        ? `${signal.valueType} declared at ${signal.length} bits, read as unsigned`
        : signal.valueType;
  const parts = [
    `start bit ${signal.startBit}`,
    `${signal.length} ${signal.length === 1 ? 'bit' : 'bits'}`,
    signal.byteOrder === 'intel' ? 'Intel' : 'Motorola',
    type,
    `factor ${num(signal.factor)}`,
    `offset ${num(signal.offset)}`,
    `range ${num(signal.min)} .. ${num(signal.max)}${signal.unit ? ` ${signal.unit}` : ''}`,
  ];
  if (signal.multiplex.role === 'multiplexor' || signal.multiplex.role === 'both') parts.push('multiplexor');
  const condition = muxCondition(message, signal);
  if (condition.kind === 'when') parts.push(`when ${conditionText(condition, nameOf)}`);
  if (condition.kind === 'never') parts.push(`never decoded: ${condition.why}`);
  return parts.join(', ');
}

/** The J1939 view of a message, when CanViewer shows one (same rule as the message page). */
export function j1939Of(db: DbcDatabase, message: DbcMessage): J1939Id | null {
  return message.isExtended && (isJ1939Pg(db, message) || isJ1939Database(db)) ? decomposeJ1939Id(message.id) : null;
}

const hexByte = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

/** "CAN ID 0x100 (standard), 8 bytes, sender ECM, cycle time 10 ms" and the J1939 breakdown. */
export function describeFrame(db: DbcDatabase, message: DbcMessage): string[] {
  const kinds = [message.isExtended ? 'extended' : 'standard'];
  if (isCanFd(db, message)) kinds.push('CAN FD');
  const parts = [`CAN ID ${hexId(message.id, message.isExtended)} (${kinds.join(', ')})`, `${message.dlc} bytes`];
  if (message.sender) parts.push(`sender ${message.sender}`);
  const cycle = message.attributes.GenMsgCycleTime;
  if (cycle !== undefined) parts.push(`cycle time ${String(cycle)} ms`);
  const lines = [parts.join(', ')];
  const j1939 = j1939Of(db, message);
  if (j1939) {
    const name = PGN_NAMES[j1939.pgn];
    const target =
      j1939.pduType === 'PDU1' ? `PDU1 to ${hexByte(j1939.destinationAddress!)}` : 'PDU2 (broadcast)';
    lines.push(
      `J1939 PGN ${j1939.pgn} (0x${j1939.pgn.toString(16).toUpperCase()})${name ? ` ${name}` : ''}, ` +
        `priority ${j1939.priority}, ${target}, source address ${hexByte(j1939.sourceAddress)}`,
    );
  }
  return lines;
}

/** Comment text on one line: whitespace collapsed, control characters dropped. */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
