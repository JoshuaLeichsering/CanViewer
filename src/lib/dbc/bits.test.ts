import { describe, expect, it } from 'vitest';
import {
  canCoexist,
  decodeFrame,
  extractRawValue,
  parseHexBytes,
  signalBitPositions,
  signalOutOfBounds,
  signalsConflict,
  signalsOverlap,
  toPhysical,
} from './bits';
import type { DbcSignal } from './types';

function makeSignal(overrides: Partial<DbcSignal>): DbcSignal {
  return {
    name: 'S',
    startBit: 0,
    length: 8,
    byteOrder: 'intel',
    valueType: 'unsigned',
    factor: 1,
    offset: 0,
    min: 0,
    max: 255,
    unit: '',
    receivers: [],
    multiplex: { role: 'none' },
    attributes: {},
    ...overrides,
  };
}

describe('signalBitPositions', () => {
  it('intel: LSB at start bit, ascending', () => {
    const pos = signalBitPositions({ startBit: 0, length: 16, byteOrder: 'intel' });
    expect(pos).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('motorola: MSB at start bit, sawtooth wrap', () => {
    const pos = signalBitPositions({ startBit: 7, length: 16, byteOrder: 'motorola' });
    expect(pos).toEqual([7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8]);
  });

  it('motorola: partial byte crossing', () => {
    const pos = signalBitPositions({ startBit: 39, length: 10, byteOrder: 'motorola' });
    expect(pos).toEqual([39, 38, 37, 36, 35, 34, 33, 32, 47, 46]);
  });

  it('caps pathological signal lengths instead of freezing', () => {
    const pos = signalBitPositions({ startBit: 0, length: 999999999, byteOrder: 'intel' });
    expect(pos.length).toBe(512);
  });
});

describe('signalOutOfBounds / signalsOverlap', () => {
  it('flags signals exceeding the dlc', () => {
    expect(signalOutOfBounds({ startBit: 56, length: 8, byteOrder: 'intel' }, 8)).toBe(false);
    expect(signalOutOfBounds({ startBit: 56, length: 9, byteOrder: 'intel' }, 8)).toBe(true);
    expect(signalOutOfBounds({ startBit: 7, length: 16, byteOrder: 'motorola' }, 1)).toBe(true);
  });

  it('detects overlapping signals', () => {
    const a = makeSignal({ startBit: 0, length: 8 });
    const b = makeSignal({ startBit: 7, length: 2 });
    const c = makeSignal({ startBit: 8, length: 8 });
    expect(signalsOverlap(a, b)).toBe(true);
    expect(signalsOverlap(a, c)).toBe(false);
  });

  it('mux alternatives on the same bits are not a conflict', () => {
    const m0 = makeSignal({ startBit: 8, length: 8, multiplex: { role: 'multiplexed', switchValue: 0 } });
    const m1 = makeSignal({ startBit: 8, length: 8, multiplex: { role: 'multiplexed', switchValue: 1 } });
    const m1b = makeSignal({ startBit: 8, length: 8, multiplex: { role: 'multiplexed', switchValue: 1 } });
    const plain = makeSignal({ startBit: 8, length: 8 });
    expect(canCoexist(m0, m1)).toBe(false);
    expect(signalsConflict(m0, m1)).toBe(false);
    expect(signalsConflict(m1, m1b)).toBe(true);
    expect(signalsConflict(m0, plain)).toBe(true);
  });

  it('extended mux ranges conflict only when they intersect on the same switch', () => {
    const ext = (ranges: Array<[number, number]>, switchName = 'Mux') =>
      makeSignal({
        startBit: 8,
        length: 8,
        multiplex: { role: 'multiplexed', extended: { switchName, ranges } },
      });
    expect(signalsConflict(ext([[0, 3]]), ext([[3, 5]]))).toBe(true);
    expect(signalsConflict(ext([[0, 3]]), ext([[4, 5]]))).toBe(false);
    expect(signalsConflict(ext([[0, 3]]), ext([[0, 3]], 'Other'))).toBe(true);
  });
});

describe('extractRawValue', () => {
  it('decodes intel unsigned', () => {
    const s = makeSignal({ startBit: 0, length: 16, factor: 0.25 });
    const raw = extractRawValue(s, new Uint8Array([0x10, 0x27, 0, 0, 0, 0, 0, 0]));
    expect(raw).toBe(0x2710);
    expect(toPhysical(s, raw!)).toBe(2500);
  });

  it('decodes motorola unsigned', () => {
    const s = makeSignal({ startBit: 7, length: 16, byteOrder: 'motorola', factor: 0.01 });
    const raw = extractRawValue(s, new Uint8Array([0x12, 0x34, 0, 0, 0, 0]));
    expect(raw).toBe(0x1234);
    expect(toPhysical(s, raw!)).toBeCloseTo(46.6);
  });

  it('decodes signed two-complement', () => {
    const s = makeSignal({ startBit: 0, length: 8, valueType: 'signed' });
    expect(extractRawValue(s, new Uint8Array([0xff]))).toBe(-1);
    expect(extractRawValue(s, new Uint8Array([0x80]))).toBe(-128);
    expect(extractRawValue(s, new Uint8Array([0x7f]))).toBe(127);
  });

  it('decodes ieee float', () => {
    const s = makeSignal({ startBit: 0, length: 32, valueType: 'float' });
    // 13.5f = 0x41580000, little endian in the frame
    const raw = extractRawValue(s, new Uint8Array([0x00, 0x00, 0x58, 0x41]));
    expect(raw).toBeCloseTo(13.5);
  });

  it('returns null when data is too short', () => {
    const s = makeSignal({ startBit: 0, length: 16 });
    expect(extractRawValue(s, new Uint8Array([0x01]))).toBeNull();
  });

  it('decodes signals across a full 64-byte CAN FD frame', () => {
    // Signal in the last two bytes of a 64-byte frame (bits 496..511).
    const s = makeSignal({ startBit: 496, length: 16, factor: 0.5 });
    const data = new Uint8Array(64);
    data[62] = 0x10; // little endian: raw = 0x2710 = 10000
    data[63] = 0x27;
    expect(extractRawValue(s, data)).toBe(10000);
    expect(toPhysical(s, 10000)).toBe(5000);
    expect(signalOutOfBounds(s, 64)).toBe(false);
    expect(signalOutOfBounds(s, 63)).toBe(true);
  });
});

describe('decodeFrame multiplexing', () => {
  const mux = makeSignal({ name: 'Mux', startBit: 0, length: 8, multiplex: { role: 'multiplexor' } });
  const s0 = makeSignal({
    name: 'A',
    startBit: 8,
    length: 8,
    multiplex: { role: 'multiplexed', switchValue: 0 },
  });
  const s1 = makeSignal({
    name: 'B',
    startBit: 8,
    length: 8,
    multiplex: { role: 'multiplexed', switchValue: 1 },
  });

  it('marks only the matching multiplexed signal active', () => {
    const decoded = decodeFrame([mux, s0, s1], new Uint8Array([0x01, 0x42]));
    expect(decoded.find((d) => d.signal.name === 'A')!.active).toBe(false);
    expect(decoded.find((d) => d.signal.name === 'B')!.active).toBe(true);
    expect(decoded.find((d) => d.signal.name === 'B')!.raw).toBe(0x42);
  });

  it('honours extended multiplexing ranges', () => {
    const ext = makeSignal({
      name: 'C',
      startBit: 8,
      length: 8,
      multiplex: { role: 'multiplexed', extended: { switchName: 'Mux', ranges: [[2, 4]] } },
    });
    expect(decodeFrame([mux, ext], new Uint8Array([0x03, 0x42]))[1].active).toBe(true);
    expect(decodeFrame([mux, ext], new Uint8Array([0x05, 0x42]))[1].active).toBe(false);
  });

  it('simple m<N> signals compare against the root multiplexor, not a sub-multiplexor listed first', () => {
    const sub = makeSignal({
      name: 'Sub',
      startBit: 8,
      length: 8,
      multiplex: { role: 'both', switchValue: 0, extended: { switchName: 'Root', ranges: [[0, 0]] } },
    });
    const root = makeSignal({ name: 'Root', startBit: 0, length: 8, multiplex: { role: 'multiplexor' } });
    const simple = makeSignal({ name: 'S', startBit: 16, length: 8, multiplex: { role: 'multiplexed', switchValue: 2 } });
    const decoded = decodeFrame([sub, root, simple], new Uint8Array([0x02, 0x00, 0x42]));
    expect(decoded.find((d) => d.signal.name === 'S')!.active).toBe(true);
    expect(decoded.find((d) => d.signal.name === 'Sub')!.active).toBe(false);
  });

  it('nested extended mux: child is inactive while its parent switch is inactive', () => {
    const root = makeSignal({ name: 'Root', startBit: 0, length: 8, multiplex: { role: 'multiplexor' } });
    const subMux = makeSignal({
      name: 'SubMux',
      startBit: 8,
      length: 8,
      multiplex: { role: 'both', switchValue: 0, extended: { switchName: 'Root', ranges: [[0, 0]] } },
    });
    const child = makeSignal({
      name: 'Child',
      startBit: 16,
      length: 8,
      multiplex: { role: 'multiplexed', extended: { switchName: 'SubMux', ranges: [[5, 5]] } },
    });
    // Root = 1: SubMux inactive, so Child must be inactive even though SubMux's raw value is 5.
    const inactive = decodeFrame([root, subMux, child], new Uint8Array([0x01, 0x05, 0x42]));
    expect(inactive.find((d) => d.signal.name === 'SubMux')!.active).toBe(false);
    expect(inactive.find((d) => d.signal.name === 'Child')!.active).toBe(false);
    // Root = 0: the whole chain is active.
    const active = decodeFrame([root, subMux, child], new Uint8Array([0x00, 0x05, 0x42]));
    expect(active.find((d) => d.signal.name === 'Child')!.active).toBe(true);
  });
});

describe('parseHexBytes', () => {
  it('accepts spaced, prefixed and packed formats', () => {
    expect([...parseHexBytes('12 AB 00', 3)!]).toEqual([0x12, 0xab, 0x00]);
    expect([...parseHexBytes('0x12,0xAB', 3)!]).toEqual([0x12, 0xab, 0x00]);
    expect([...parseHexBytes('12AB00', 3)!]).toEqual([0x12, 0xab, 0x00]);
  });

  it('pads short input and truncates excess', () => {
    expect([...parseHexBytes('FF', 4)!]).toEqual([0xff, 0, 0, 0]);
    expect([...parseHexBytes('01020304', 2)!]).toEqual([1, 2]);
  });

  it('rejects invalid input', () => {
    expect(parseHexBytes('XYZ', 8)).toBeNull();
    expect(parseHexBytes('123', 8)).toBeNull();
  });

  it('returns zeroed frame for empty input', () => {
    expect([...parseHexBytes('', 3)!]).toEqual([0, 0, 0]);
  });
});
