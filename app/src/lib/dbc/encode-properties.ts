// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Round-trip properties of the frame encoder, shared by the property tests
 * for examples/demo.dbc (encode.property.test.ts) and for the OEM corpus
 * (encode.corpus.test.ts). Test-only: the app does not import this file.
 */
import fc from 'fast-check';
import { decodeFrame, extractRawValue, signalOutOfBounds, signalsOverlap, toPhysical } from './bits';
import { encodeFrame, insertRawValue, physicalToRaw, rawRange, readRawBits } from './encode';
import type { DbcMessage, DbcSignal } from './types';

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** The signal on its own, without multiplexing, so that it is always active. */
export function standalone(signal: DbcSignal): DbcSignal {
  return { ...signal, multiplex: { role: 'none' } };
}

const isIeee = (s: DbcSignal) => rawRange(s) === null;

/** Raw values over the signal's whole bit width (IEEE signals: bit patterns of non-NaN values). */
export function rawArbitrary(signal: DbcSignal, safeOnly = false): fc.Arbitrary<bigint> {
  if (signal.length === 32 && isIeee(signal)) {
    return fc.float({ noNaN: true, noDefaultInfinity: true }).map((v) => {
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, v);
      return BigInt(view.getUint32(0));
    });
  }
  if (isIeee(signal)) {
    return fc.double({ noNaN: true, noDefaultInfinity: true }).map((v) => {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, v);
      return view.getBigUint64(0);
    });
  }
  const { min, max } = rawRange(signal)!;
  if (!safeOnly) return fc.bigInt({ min, max });
  return fc.bigInt({ min: min < -SAFE ? -SAFE : min, max: max > SAFE ? SAFE : max });
}

/** The decoder's reading of a raw value, worked out without the decoder. */
function expectedRaw(signal: DbcSignal, raw: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  if (isIeee(signal) && signal.length === 32) {
    view.setUint32(0, Number(raw));
    return view.getFloat32(0);
  }
  if (isIeee(signal)) {
    view.setBigUint64(0, raw);
    return view.getFloat64(0);
  }
  return Number(raw);
}

/** What the decoder reads for a raw value: write it into an empty frame and decode it. */
export function decodedRaw(signal: DbcSignal, dlc: number, raw: bigint): number {
  const data = new Uint8Array(dlc);
  insertRawValue(signal, data, raw);
  return extractRawValue(signal, data)!;
}

/**
 * Raw level, the whole bit width: write any raw value and the decoder reads
 * it back exactly; nothing outside the signal's bits changes.
 */
export function rawRoundTrip(signal: DbcSignal, dlc: number, numRuns: number): void {
  const s = standalone(signal);
  if (signalOutOfBounds(s, dlc)) {
    const data = new Uint8Array(dlc);
    if (insertRawValue(s, data, 1n)) throw new Error(`${signal.name}: wrote a signal outside the data area`);
    return;
  }
  fc.assert(
    fc.property(rawArbitrary(s), fc.uint8Array({ minLength: dlc, maxLength: dlc }), (raw, base) => {
      const data = base.slice();
      if (!insertRawValue(s, data, raw)) return false;
      if (readRawBits(s, data) !== BigInt.asUintN(s.length, raw)) return false;
      // The bits of other signals are untouched: clearing the signal's bits in both gives the same frame.
      const a = data.slice();
      const b = base.slice();
      insertRawValue(s, a, 0n);
      insertRawValue(s, b, 0n);
      if (a.some((v, i) => v !== b[i])) return false;
      const [decoded] = decodeFrame([s], data);
      return Object.is(decoded.raw, expectedRaw(s, raw));
    }),
    { numRuns },
  );
}

/** An IEEE float with a scale does not round-trip exactly: the encoder rounds (p − offset) / factor to a float. */
const exactScale = (s: DbcSignal) => !isIeee(s) || (s.factor === 1 && s.offset === 0);

/**
 * Physical level: for every physical value the decoder can produce (from raw
 * values within JavaScript's exact integer range), encoding it and decoding the
 * frame gives exactly that physical value back, with no problem reported.
 */
export function physicalRoundTrip(signal: DbcSignal, dlc: number, numRuns: number): void {
  const s = standalone(signal);
  if (signalOutOfBounds(s, dlc)) {
    const r = encodeFrame([s], dlc, [s.offset]);
    if (r.problems.length !== 1 || r.problems[0].kind !== 'outOfBounds') {
      throw new Error(`${signal.name}: no outOfBounds problem for a signal outside the data area`);
    }
    return;
  }
  const exact = exactScale(s);
  fc.assert(
    fc.property(rawArbitrary(s, true), (raw) => {
      const physical = toPhysical(s, decodedRaw(s, dlc, raw));
      if (!Number.isFinite(physical)) return true;
      const r = encodeFrame([s], dlc, [physical]);
      if (r.problems.length > 0 || !r.signals[0].written) return false;
      const [decoded] = decodeFrame([s], r.data);
      if (decoded.physical !== r.signals[0].decoded?.physical) return false;
      if (exact) return decoded.physical === physical;
      return Math.abs(decoded.physical - physical) <= Math.abs(physical) * 1e-6 + Math.abs(s.factor) * 1e-6;
    }),
    { numRuns },
  );
}

/** Switch values worth trying for a multiplexor: the ones its multiplexed signals wait for. */
function switchValues(message: DbcMessage, switchSignal: DbcSignal, root: DbcSignal | undefined): number[] {
  const values = new Set<number>();
  for (const s of message.signals) {
    const mux = s.multiplex;
    if (mux.extended?.switchName === switchSignal.name) {
      for (const [lo, hi] of mux.extended.ranges) {
        values.add(lo);
        values.add(hi);
      }
    } else if (!mux.extended && switchSignal === root && mux.switchValue !== undefined) {
      values.add(mux.switchValue);
    }
  }
  return [...values];
}

/** One test case for a whole message: an optional physical value per signal and a base frame. */
export function messageArbitrary(message: DbcMessage): fc.Arbitrary<{ values: Array<number | undefined>; base: Uint8Array }> {
  const root = message.signals.find((s) => s.multiplex.role === 'multiplexor');
  const isSwitch = (signal: DbcSignal) =>
    signal === root ||
    signal.multiplex.role === 'both' ||
    message.signals.some((s) => s.multiplex.extended?.switchName === signal.name);
  const perSignal = message.signals.map((signal) => {
    const physical = (raw: bigint): number | undefined => {
      const value = toPhysical(signal, decodedRaw(signal, message.dlc, raw));
      return Number.isFinite(value) ? value : undefined;
    };
    const fromRaw = rawArbitrary(signal, true).map(physical);
    // Multiplexors mostly take the values their multiplexed signals wait for.
    const range = rawRange(signal);
    const candidates = isSwitch(signal) && range
      ? switchValues(message, signal, root).filter((v) => BigInt(v) >= range.min && BigInt(v) <= range.max)
      : [];
    const value = candidates.length
      ? fc.oneof(
          { weight: 3, arbitrary: fc.constantFrom(...candidates).map((v) => physical(BigInt(v))) },
          { weight: 1, arbitrary: fromRaw },
        )
      : fromRaw;
    // Now and then leave a signal out, so that it keeps the base bits.
    return fc.option(value, { freq: 6, nil: undefined });
  });
  return fc.record({
    values: fc.tuple(...perSignal),
    base: fc.oneof(
      fc.constant(new Uint8Array(message.dlc)),
      fc.uint8Array({ minLength: message.dlc, maxLength: message.dlc }),
    ),
  });
}

/**
 * Whole messages, multiplexing included. After encoding:
 * - only signals outside the data area get an outOfBounds problem, and valid
 *   values never get a range problem;
 * - every written signal that is not reported as overwritten decodes to the
 *   value it was given, and every one reported reads back differently;
 * - no overwritten problem is reported unless written signals (or a written
 *   signal and a multiplexor) share bits;
 * - without problems, a signal with a value is written exactly when the
 *   decoder finds it active in the encoded frame.
 */
export function messageRoundTrip(message: DbcMessage, numRuns: number): void {
  const { signals, dlc } = message;
  const root = signals.find((s) => s.multiplex.role === 'multiplexor');
  const switchNames = new Set(signals.flatMap((s) => (s.multiplex.extended ? [s.multiplex.extended.switchName] : [])));
  const isSwitch = (s: DbcSignal) => s === root || s.multiplex.role === 'both' || switchNames.has(s.name);
  fc.assert(
    fc.property(messageArbitrary(message), ({ values, base }) => {
      const r = encodeFrame(signals, dlc, values, base);
      const decoded = new Map(decodeFrame(signals, r.data).map((d) => [d.signal, d]));
      const overwritten = new Set(r.problems.filter((p) => p.kind === 'overwritten').map((p) => p.index));
      for (const p of r.problems) {
        if (p.kind === 'range' || p.kind === 'notFinite') return false;
        if (p.kind === 'outOfBounds' && (values[p.index] === undefined || !signalOutOfBounds(signals[p.index], dlc))) return false;
      }
      for (let i = 0; i < signals.length; i++) {
        if (values[i] !== undefined && signalOutOfBounds(signals[i], dlc) && !r.problems.some((p) => p.kind === 'outOfBounds' && p.index === i)) {
          return false;
        }
        if (!r.signals[i].written) continue;
        const d = decoded.get(signals[i]);
        const intended = physicalToRaw(signals[i], values[i]!);
        if (!d || !intended.ok) return false;
        // Compare raw values, which tell an overwrite even where the scaling would hide it.
        const intact = Object.is(d.raw, expectedRaw(signals[i], intended.raw));
        if (overwritten.has(i) === intact) return false;
        if (intact && exactScale(signals[i]) && d.physical !== values[i]) return false;
      }
      const relevant = signals.filter((s, i) => r.signals[i].written || isSwitch(s));
      const shareBits = relevant.some((a, i) => relevant.some((b, j) => j > i && signalsOverlap(a, b)));
      if (overwritten.size > 0 && !shareBits) return false;
      if (r.problems.length === 0) {
        for (let i = 0; i < signals.length; i++) {
          if (values[i] !== undefined && r.signals[i].written !== r.signals[i].active) return false;
        }
      }
      return true;
    }),
    { numRuns },
  );
}
