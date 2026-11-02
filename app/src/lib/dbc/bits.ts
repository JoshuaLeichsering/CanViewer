// SPDX-License-Identifier: GPL-2.0-or-later
import type { DbcSignal } from './types';

/**
 * Defensive cap on signal length (CAN FD = 64 bytes = 512 bits). The parser
 * rejects longer signals, but hand-built DbcSignal values must not be able to
 * freeze the UI or blow up array sizes either.
 */
const MAX_BITS = 512;

/**
 * Absolute bit positions a signal occupies, in order from MSB to LSB of the
 * signal value. A position is `byteIndex * 8 + bitInByte` where bitInByte 0 is
 * the least significant bit of the byte (standard DBC numbering).
 *
 * Intel (little endian): start bit is the LSB, bits run upwards.
 * Motorola (big endian): start bit is the MSB, bits run down within a byte,
 * then wrap to bit 7 of the next byte (sawtooth numbering).
 */
export function signalBitPositions(signal: Pick<DbcSignal, 'startBit' | 'length' | 'byteOrder'>): number[] {
  const length = Math.min(Math.max(signal.length, 0), MAX_BITS);
  const positions: number[] = [];
  if (signal.byteOrder === 'intel') {
    for (let i = length - 1; i >= 0; i--) {
      positions.push(signal.startBit + i);
    }
  } else {
    let pos = signal.startBit;
    for (let i = 0; i < length; i++) {
      positions.push(pos);
      if (pos % 8 === 0) {
        pos += 15; // wrap: bit 0 of byte n -> bit 7 of byte n+1
      } else {
        pos -= 1;
      }
    }
  }
  return positions;
}

/** True if any occupied bit lies outside the message's data area. */
export function signalOutOfBounds(
  signal: Pick<DbcSignal, 'startBit' | 'length' | 'byteOrder'>,
  dlc: number,
): boolean {
  return signalBitPositions(signal).some((p) => p < 0 || p >= dlc * 8);
}

/** Two signals overlap if they share any bit position. */
export function signalsOverlap(a: DbcSignal, b: DbcSignal): boolean {
  const bitsA = new Set(signalBitPositions(a));
  return signalBitPositions(b).some((p) => bitsA.has(p));
}

/**
 * Can two signals of the same message be present in one frame at the same
 * time? Multiplexed alternatives (different switch values) cannot, so their
 * shared bits are fine; everything else counts as simultaneously active.
 */
export function canCoexist(a: DbcSignal, b: DbcSignal): boolean {
  const aMuxed = a.multiplex.role === 'multiplexed' || a.multiplex.role === 'both';
  const bMuxed = b.multiplex.role === 'multiplexed' || b.multiplex.role === 'both';
  if (!aMuxed || !bMuxed) return true;
  if (a.multiplex.extended && b.multiplex.extended) {
    if (a.multiplex.extended.switchName !== b.multiplex.extended.switchName) return true;
    return a.multiplex.extended.ranges.some(([alo, ahi]) =>
      b.multiplex.extended!.ranges.some(([blo, bhi]) => alo <= bhi && blo <= ahi),
    );
  }
  // One extended, one simple: driven by (potentially) different switches — be
  // lenient and treat them as alternatives rather than flagging a conflict.
  if (a.multiplex.extended || b.multiplex.extended) return false;
  return a.multiplex.switchValue === b.multiplex.switchValue;
}

/** True overlap conflict: shared bits AND both signals can occur in the same frame. */
export function signalsConflict(a: DbcSignal, b: DbcSignal): boolean {
  return canCoexist(a, b) && signalsOverlap(a, b);
}

/**
 * Extract the raw (unscaled) value of a signal from CAN frame data.
 * Returns the raw value as a number; for 64-bit-wide signals precision follows
 * JS number semantics (BigInt is used internally for exact bit collection).
 */
export function extractRawValue(signal: DbcSignal, data: Uint8Array): number | null {
  const positions = signalBitPositions(signal);
  let raw = 0n;
  for (const pos of positions) {
    const byte = pos >> 3;
    const bit = pos & 7;
    if (byte < 0 || byte >= data.length) return null;
    raw = (raw << 1n) | BigInt((data[byte] >> bit) & 1);
  }

  if (signal.valueType === 'float' && signal.length === 32) {
    const buf = new DataView(new ArrayBuffer(4));
    buf.setUint32(0, Number(raw));
    return buf.getFloat32(0);
  }
  if (signal.valueType === 'double' && signal.length === 64) {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigUint64(0, raw);
    return buf.getFloat64(0);
  }
  if (signal.valueType === 'signed') {
    const signBit = 1n << BigInt(signal.length - 1);
    if (raw & signBit) raw -= 1n << BigInt(signal.length);
  }
  return Number(raw);
}

/** raw -> physical using factor/offset. */
export function toPhysical(signal: DbcSignal, raw: number): number {
  return raw * signal.factor + signal.offset;
}

export interface DecodedSignal {
  signal: DbcSignal;
  raw: number;
  physical: number;
  /** Value description text if the raw value has a VAL_ mapping. */
  label?: string;
  /** False when the signal is multiplexed and its switch value doesn't match. */
  active: boolean;
}

/**
 * Decode all signals of a message from frame data. Multiplexed signals are
 * decoded but marked inactive when their switch condition does not match the
 * frame content. Activity is evaluated recursively so that with extended
 * (nested) multiplexing a signal is only active when its whole switch chain
 * is active — and simple m<N> signals always compare against the root
 * multiplexor (M), never against an m<N>M sub-multiplexor.
 */
export function decodeFrame(signals: DbcSignal[], data: Uint8Array): DecodedSignal[] {
  const byName = new Map(signals.map((s) => [s.name, s]));
  const rootMux = signals.find((s) => s.multiplex.role === 'multiplexor');

  const rawCache = new Map<string, number | null>();
  const rawOf = (s: DbcSignal): number | null => {
    if (!rawCache.has(s.name)) rawCache.set(s.name, extractRawValue(s, data));
    return rawCache.get(s.name)!;
  };

  const activeMemo = new Map<string, boolean>();
  const isActive = (s: DbcSignal, visiting: Set<string>): boolean => {
    const memo = activeMemo.get(s.name);
    if (memo !== undefined) return memo;
    if (visiting.has(s.name)) return false; // defensive: cyclic switch references
    visiting.add(s.name);

    let active = true;
    const mux = s.multiplex;
    if (mux.role === 'multiplexed' || mux.role === 'both') {
      if (mux.extended) {
        const sw = byName.get(mux.extended.switchName);
        const swRaw = sw ? rawOf(sw) : null;
        active =
          sw !== undefined &&
          swRaw !== null &&
          isActive(sw, visiting) &&
          mux.extended.ranges.some(([lo, hi]) => swRaw >= lo && swRaw <= hi);
      } else {
        const root = rootMux !== s ? rootMux : undefined;
        const rootRaw = root ? rawOf(root) : null;
        // Without a root multiplexor we cannot evaluate the condition; show
        // the signal as active rather than hiding data.
        active = root === undefined || (rootRaw !== null && rootRaw === mux.switchValue);
      }
    }

    visiting.delete(s.name);
    activeMemo.set(s.name, active);
    return active;
  };

  const results: DecodedSignal[] = [];
  for (const signal of signals) {
    const raw = extractRawValue(signal, data);
    if (raw === null) continue;
    results.push({
      signal,
      raw,
      physical: toPhysical(signal, raw),
      label: signal.values?.[raw],
      active: isActive(signal, new Set()),
    });
  }
  return results;
}

/** Parse user-entered hex bytes ("12 AB 00", "0x12,0xAB", "12AB00") into bytes. */
export function parseHexBytes(input: string, dlc: number): Uint8Array | null {
  const cleaned = input.replace(/0x/gi, '').replace(/[\s,;.-]+/g, '');
  if (cleaned === '') return new Uint8Array(dlc);
  if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0) return null;
  const bytes = new Uint8Array(dlc);
  for (let i = 0; i < Math.min(cleaned.length / 2, dlc); i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
