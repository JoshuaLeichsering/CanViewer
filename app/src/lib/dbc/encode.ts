// SPDX-License-Identifier: GPL-2.0-or-later
import { decodeFrame, extractRawValue, signalBitPositions, signalOutOfBounds, toPhysical, type DecodedSignal } from './bits';
import type { DbcSignal } from './types';

/**
 * The frame encoder, the inverse of `decodeFrame`: physical values in, frame
 * bytes out. Every rule here mirrors the decoder in bits.ts, and every encoded
 * frame is decoded again before it is returned, so a value that does not
 * survive the round trip is reported, never silently changed.
 */

/** IEEE floats are read as such only at their natural width; the decoder reads any other length as an integer. */
function isIeee(signal: Pick<DbcSignal, 'valueType' | 'length'>): boolean {
  return (signal.valueType === 'float' && signal.length === 32) || (signal.valueType === 'double' && signal.length === 64);
}

/**
 * The raw values a signal's bits can hold, or null for IEEE float signals,
 * whose raw value is a bit pattern rather than an integer.
 */
export function rawRange(signal: DbcSignal): { min: bigint; max: bigint } | null {
  if (isIeee(signal)) return null;
  const bits = BigInt(signalBitPositions(signal).length);
  if (signal.valueType === 'signed') {
    if (bits === 0n) return { min: 0n, max: 0n };
    return { min: -(1n << (bits - 1n)), max: (1n << (bits - 1n)) - 1n };
  }
  return { min: 0n, max: (1n << bits) - 1n };
}

/** The signal's bits as an unsigned pattern (MSB first), or null when they leave the data. */
export function readRawBits(signal: DbcSignal, data: Uint8Array): bigint | null {
  let raw = 0n;
  for (const pos of signalBitPositions(signal)) {
    const byte = pos >> 3;
    if (byte < 0 || byte >= data.length) return null;
    raw = (raw << 1n) | BigInt((data[byte] >> (pos & 7)) & 1);
  }
  return raw;
}

/**
 * Write a raw value into the signal's bits, negative values as two's
 * complement. The other bits of `data` are kept. Returns false, and writes
 * nothing, when the signal does not fit into `data`.
 */
export function insertRawValue(signal: DbcSignal, data: Uint8Array, raw: bigint): boolean {
  const positions = signalBitPositions(signal);
  if (positions.some((p) => p < 0 || p >= data.length * 8)) return false;
  let pattern = BigInt.asUintN(positions.length, raw);
  // positions run from the MSB to the LSB of the value.
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const mask = 1 << (pos & 7);
    if (pattern & 1n) data[pos >> 3] |= mask;
    else data[pos >> 3] &= ~mask;
    pattern >>= 1n;
  }
  return true;
}

export type RawResult = { ok: true; raw: bigint } | { ok: false; reason: 'range' | 'notFinite' };

/**
 * The raw value whose decoded physical value is nearest to `physical`. A
 * value is accepted when it lies within half a step (|factor| / 2) of a raw
 * value the signal's bits can hold; anything further away is out of range,
 * and is reported rather than clamped. IEEE float signals get the float
 * nearest to (physical − offset) / factor.
 */
export function physicalToRaw(signal: DbcSignal, physical: number): RawResult {
  if (!Number.isFinite(physical)) return { ok: false, reason: 'notFinite' };
  if (signal.factor === 0) {
    // Every raw value decodes to the offset.
    return physical === signal.offset ? { ok: true, raw: 0n } : { ok: false, reason: 'range' };
  }
  const value = (physical - signal.offset) / signal.factor;

  if (isIeee(signal)) {
    const view = new DataView(new ArrayBuffer(8));
    if (signal.length === 32) {
      if (!Number.isFinite(Math.fround(value))) return { ok: false, reason: 'range' };
      view.setFloat32(0, value);
      return { ok: true, raw: BigInt(view.getUint32(0)) };
    }
    if (!Number.isFinite(value)) return { ok: false, reason: 'range' };
    view.setFloat64(0, value);
    return { ok: true, raw: view.getBigUint64(0) };
  }

  const range = rawRange(signal)!;
  if (!Number.isFinite(value)) return { ok: false, reason: 'range' };
  const rounded = BigInt(Math.round(value));
  const center = rounded < range.min ? range.min : rounded > range.max ? range.max : rounded;
  // Floating point can put `value` a few steps off when the offset dwarfs
  // the factor; look as far as that error can reach.
  const error = ((Math.abs(physical) + Math.abs(signal.offset)) * Number.EPSILON) / Math.abs(signal.factor);
  const window = BigInt(Math.min(64, Math.ceil(error) + 1));

  let best: bigint | undefined;
  let bestDiff = Infinity;
  const consider = (raw: bigint) => {
    if (raw < range.min || raw > range.max) return;
    const diff = Math.abs(toPhysical(signal, Number(raw)) - physical);
    if (diff < bestDiff) {
      best = raw;
      bestDiff = diff;
    }
  };
  consider(center);
  for (let k = 1n; k <= window; k++) {
    consider(center - k);
    consider(center + k);
  }
  if (best === undefined || bestDiff > Math.abs(signal.factor) / 2) return { ok: false, reason: 'range' };
  return { ok: true, raw: best };
}

export type EncodeProblem =
  /** The value lies outside what the signal's bits can hold. */
  | { kind: 'range'; index: number }
  /** The value is not a finite number. */
  | { kind: 'notFinite'; index: number }
  /** The signal does not fit into the frame's data area. */
  | { kind: 'outOfBounds'; index: number }
  /** Another signal's bits changed this signal's value in the encoded frame. */
  | { kind: 'overwritten'; index: number };

export interface EncodedSignal {
  /** The signal's multiplexing condition holds in the encoded frame. */
  active: boolean;
  /** The given value was written into the frame. */
  written: boolean;
  /** What the decoder reads from the encoded frame; absent when the signal leaves the data area. */
  decoded?: DecodedSignal;
}

export interface EncodedFrame {
  data: Uint8Array;
  /** One entry per signal, in the order of the signal list. */
  signals: EncodedSignal[];
  problems: EncodeProblem[];
}

/**
 * Encode a frame from physical values, one per signal (`undefined` keeps the
 * signal's bits from `base`, or zero). Multiplexed signals are written only
 * when the multiplexor values being encoded select them, by the decoder's own
 * rules: simple m<N> signals switch on the root multiplexor, extended ones on
 * their SG_MUL_VAL_ switch, recursively.
 */
export function encodeFrame(
  signals: DbcSignal[],
  dlc: number,
  physical: ReadonlyArray<number | undefined>,
  base?: Uint8Array,
): EncodedFrame {
  const data = new Uint8Array(Math.max(0, dlc));
  if (base) data.set(base.subarray(0, data.length));
  const baseData = data.slice();
  const problems: EncodeProblem[] = [];

  const raws = signals.map((signal, index): bigint | undefined => {
    const value = physical[index];
    if (value === undefined) return undefined;
    if (signalOutOfBounds(signal, data.length)) {
      problems.push({ kind: 'outOfBounds', index });
      return undefined;
    }
    const result = physicalToRaw(signal, value);
    if (!result.ok) {
      problems.push({ kind: result.reason, index });
      return undefined;
    }
    return result.raw;
  });

  // What the decoder will read for a signal: the value being encoded, or the base bits.
  const indexOf = new Map(signals.map((s, i) => [s, i]));
  const plannedRaw = (signal: DbcSignal): number | null => {
    const raw = raws[indexOf.get(signal)!];
    if (raw === undefined) return extractRawValue(signal, baseData);
    const scratch = new Uint8Array(data.length);
    insertRawValue(signal, scratch, raw);
    return extractRawValue(signal, scratch);
  };

  // decodeFrame's activity rule, evaluated on the planned values.
  const byName = new Map(signals.map((s) => [s.name, s]));
  const rootMux = signals.find((s) => s.multiplex.role === 'multiplexor');
  const memo = new Map<string, boolean>();
  const isActive = (s: DbcSignal, visiting: Set<string>): boolean => {
    const known = memo.get(s.name);
    if (known !== undefined) return known;
    if (visiting.has(s.name)) return false;
    visiting.add(s.name);
    let active = true;
    const mux = s.multiplex;
    if (mux.role === 'multiplexed' || mux.role === 'both') {
      if (mux.extended) {
        const sw = byName.get(mux.extended.switchName);
        const swRaw = sw ? plannedRaw(sw) : null;
        active =
          sw !== undefined &&
          swRaw !== null &&
          isActive(sw, visiting) &&
          mux.extended.ranges.some(([lo, hi]) => swRaw >= lo && swRaw <= hi);
      } else {
        const root = rootMux !== s ? rootMux : undefined;
        const rootRaw = root ? plannedRaw(root) : null;
        active = root === undefined || (rootRaw !== null && rootRaw === mux.switchValue);
      }
    }
    visiting.delete(s.name);
    memo.set(s.name, active);
    return active;
  };

  const written = signals.map((signal, index) => {
    const raw = raws[index];
    return raw !== undefined && isActive(signal, new Set()) && insertRawValue(signal, data, raw);
  });

  // Decode the result: a written value, or a switch the plan relied on, that
  // reads back differently was overwritten by an overlapping signal.
  const switchNames = new Set(signals.flatMap((s) => (s.multiplex.extended ? [s.multiplex.extended.switchName] : [])));
  const isSwitch = (s: DbcSignal) => s === rootMux || s.multiplex.role === 'both' || switchNames.has(s.name);
  const decoded = new Map(decodeFrame(signals, data).map((d) => [d.signal, d]));
  signals.forEach((signal, index) => {
    if (!written[index] && !isSwitch(signal)) return;
    const expected = written[index] ? BigInt.asUintN(signalBitPositions(signal).length, raws[index]!) : readRawBits(signal, baseData);
    if (readRawBits(signal, data) !== expected) problems.push({ kind: 'overwritten', index });
  });
  problems.sort((a, b) => a.index - b.index);

  return {
    data,
    signals: signals.map((signal, index) => ({
      active: decoded.get(signal)?.active ?? false,
      written: written[index],
      decoded: decoded.get(signal),
    })),
    problems,
  };
}

/**
 * A physical value as a person types it: '' is no value (undefined), a
 * decimal comma counts as a point ("12,5"), anything else that is not a
 * finite number is null.
 */
export function parsePhysicalInput(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(/^[+-]?\d*,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The physical values the signal's bits can express, lowest first; null for IEEE float signals. */
export function physicalRange(signal: DbcSignal): [number, number] | null {
  const range = rawRange(signal);
  if (!range) return null;
  const a = toPhysical(signal, Number(range.min));
  const b = toPhysical(signal, Number(range.max));
  return a <= b ? [a, b] : [b, a];
}
