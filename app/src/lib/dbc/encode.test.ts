// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFrame } from './bits';
import { encodeFrame, insertRawValue, parsePhysicalInput, physicalRange, physicalToRaw, rawRange, readRawBits } from './encode';
import { parseDbc } from './parser';
import type { DbcMessage, DbcSignal } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const demo = parseDbc(readFileSync(join(root, 'examples/demo.dbc'), 'utf8'));
const message = (name: string): DbcMessage => demo.messages.find((m) => m.name === name)!;
const hex = (data: Uint8Array) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Encode named physical values; signals left out keep the base (zero) bits. */
function encode(m: DbcMessage, values: Record<string, number>, base?: Uint8Array) {
  return encodeFrame(m.signals, m.dlc, m.signals.map((s) => values[s.name]), base);
}

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
    max: 0,
    unit: '',
    receivers: [],
    multiplex: { role: 'none' },
    attributes: {},
    ...overrides,
  };
}

describe('rawRange', () => {
  it('covers the bit width of unsigned and signed signals', () => {
    expect(rawRange(makeSignal({ length: 12 }))).toEqual({ min: 0n, max: 4095n });
    expect(rawRange(makeSignal({ length: 12, valueType: 'signed' }))).toEqual({ min: -2048n, max: 2047n });
    expect(rawRange(makeSignal({ length: 64 }))).toEqual({ min: 0n, max: 2n ** 64n - 1n });
  });

  it('has no integer range for IEEE floats, like the decoder', () => {
    expect(rawRange(makeSignal({ length: 32, valueType: 'float' }))).toBeNull();
    expect(rawRange(makeSignal({ length: 64, valueType: 'double' }))).toBeNull();
    // The decoder reads a "float" of another length as an unsigned integer.
    expect(rawRange(makeSignal({ length: 16, valueType: 'float' }))).toEqual({ min: 0n, max: 65535n });
  });
});

describe('insertRawValue / readRawBits', () => {
  it('writes intel and motorola bit patterns the decoder reads back', () => {
    const intel = makeSignal({ startBit: 4, length: 12 });
    const motorola = makeSignal({ startBit: 7, length: 12, byteOrder: 'motorola' });
    const data = new Uint8Array(4);
    insertRawValue(intel, data, 0xabcn);
    expect(hex(data)).toBe('C0 AB 00 00');
    expect(readRawBits(intel, data)).toBe(0xabcn);
    data.fill(0);
    insertRawValue(motorola, data, 0xabcn);
    expect(hex(data)).toBe('AB C0 00 00');
    expect(readRawBits(motorola, data)).toBe(0xabcn);
  });

  it('writes negative values as two’s complement and keeps the other bits', () => {
    const signal = makeSignal({ startBit: 8, length: 8, valueType: 'signed' });
    const data = Uint8Array.from([0x11, 0x00, 0x33]);
    insertRawValue(signal, data, -2n);
    expect(hex(data)).toBe('11 FE 33');
  });

  it('refuses a signal that leaves the data area', () => {
    const data = new Uint8Array(2);
    expect(insertRawValue(makeSignal({ startBit: 12, length: 8 }), data, 1n)).toBe(false);
    expect(hex(data)).toBe('00 00');
  });
});

describe('physicalToRaw', () => {
  it('inverts factor and offset', () => {
    const temp = message('EngineData').signals.find((s) => s.name === 'EngineTemp')!;
    expect(physicalToRaw(temp, 90)).toEqual({ ok: true, raw: 130n });
    expect(physicalToRaw(temp, -40)).toEqual({ ok: true, raw: 0n });
  });

  it('picks the raw value whose physical value is nearest, without float noise', () => {
    const signal = makeSignal({ length: 16, factor: 0.1 });
    // 0.3 / 0.1 is 2.9999999999999996 in floating point.
    expect(physicalToRaw(signal, 0.3)).toEqual({ ok: true, raw: 3n });
    expect(physicalToRaw(signal, 0.34)).toEqual({ ok: true, raw: 3n });
    expect(physicalToRaw(signal, 0.36)).toEqual({ ok: true, raw: 4n });
  });

  it('reports values the bits cannot hold instead of clamping them', () => {
    const signal = makeSignal({ length: 8, factor: 0.5 });
    expect(physicalToRaw(signal, 127.5)).toEqual({ ok: true, raw: 255n });
    expect(physicalToRaw(signal, 127.7)).toEqual({ ok: true, raw: 255n });
    expect(physicalToRaw(signal, 128)).toEqual({ ok: false, reason: 'range' });
    expect(physicalToRaw(signal, -0.5)).toEqual({ ok: false, reason: 'range' });
    expect(physicalToRaw(signal, Number.NaN)).toEqual({ ok: false, reason: 'notFinite' });
  });

  it('handles 64-bit signals exactly where the number allows it', () => {
    const signal = makeSignal({ length: 64 });
    expect(physicalToRaw(signal, 2 ** 63)).toEqual({ ok: true, raw: 2n ** 63n });
    // The decoder turns all ones into a JavaScript number, which rounds to 2^64.
    expect(physicalToRaw(signal, 2 ** 64)).toEqual({ ok: true, raw: 2n ** 64n - 1n });
    expect(physicalToRaw(signal, 2 ** 65)).toEqual({ ok: false, reason: 'range' });
  });

  it('encodes IEEE floats bit for bit', () => {
    const float = makeSignal({ length: 32, valueType: 'float' });
    expect(physicalToRaw(float, 12.5)).toEqual({ ok: true, raw: 0x41480000n });
    const double = makeSignal({ length: 64, valueType: 'double' });
    expect(physicalToRaw(double, -2)).toEqual({ ok: true, raw: 0xc000000000000000n });
    expect(physicalToRaw(float, 1e39)).toEqual({ ok: false, reason: 'range' });
  });

  it('accepts only the offset for a signal with factor 0', () => {
    const signal = makeSignal({ factor: 0, offset: 7 });
    expect(physicalToRaw(signal, 7)).toEqual({ ok: true, raw: 0n });
    expect(physicalToRaw(signal, 8)).toEqual({ ok: false, reason: 'range' });
  });
});

describe('encodeFrame on demo.dbc', () => {
  it('encodes an Intel message with a signed signal', () => {
    const r = encode(message('EngineData'), {
      EngineSpeed: 2000,
      EngineTemp: 90,
      ThrottlePosition: 20,
      EngineTorque: 150,
      TorqueRequest: -10,
      EngineRunning: 1,
    });
    expect(r.problems).toEqual([]);
    expect(hex(r.data)).toBe('40 1F 82 32 2C C1 FE 01');
  });

  it('encodes a Motorola message', () => {
    const r = encode(message('BrakeData'), { WheelSpeedFL: 50, WheelSpeedFR: 50.5, BrakePressure: 100, AbsActive: 1 });
    expect(r.problems).toEqual([]);
    expect(hex(r.data)).toBe('13 88 13 BA 32 20');
  });

  it('encodes an IEEE float signal', () => {
    const r = encode(message('PowerData'), { BatteryVoltage: 12.5, Consumption: 7.5 });
    expect(hex(r.data)).toBe('00 00 48 41 4B 00 00 00');
  });

  it('writes only the multiplexed signals the multiplexor selects', () => {
    const diag = message('DiagData');
    const all = { SensorVoltage: 12.345, SensorCurrent: 2.5, ErrorCode: 3 };
    const r0 = encode(diag, { MuxSelector: 0, ...all });
    const r1 = encode(diag, { MuxSelector: 1, ...all });
    const r2 = encode(diag, { MuxSelector: 2, ...all });
    expect(hex(r0.data)).toBe('00 39 30 00 00 00 00 00');
    expect(hex(r1.data)).toBe('01 FA 00 00 00 00 00 00');
    expect(hex(r2.data)).toBe('02 03 00 00 00 00 00 00');
    expect([r0, r1, r2].flatMap((r) => r.problems)).toEqual([]);
    const active = (r: ReturnType<typeof encode>) => diag.signals.filter((_, i) => r.signals[i].active).map((s) => s.name);
    expect(active(r1)).toEqual(['MuxSelector', 'SensorCurrent']);
    expect(r1.signals[diag.signals.findIndex((s) => s.name === 'SensorVoltage')].written).toBe(false);
  });

  it('encodes a 24-byte CAN FD message', () => {
    const r = encode(message('AdasObjects'), {
      ObjCount: 2,
      Obj1Dist: 12.34,
      Obj1Speed: -1.5,
      Obj1Angle: 10,
      Obj2Dist: 50,
      Obj2Speed: 2,
    });
    expect(r.data.length).toBe(24);
    expect(hex(r.data)).toBe('02 D2 04 6A FF 64 00 88 13 C8 00' + ' 00'.repeat(13));
  });

  it('keeps the bits of a base frame for signals without a value', () => {
    const base = Uint8Array.from([0x40, 0x1f, 0x82, 0x32, 0x2c, 0xc1, 0xfe, 0x01]);
    const r = encode(message('EngineData'), { EngineTemp: 100 }, base);
    expect(hex(r.data)).toBe('40 1F 8C 32 2C C1 FE 01');
    // The base itself is not modified.
    expect(base[2]).toBe(0x82);
  });

  it('decodes back to the values it was given', () => {
    const m = message('GearboxData');
    const r = encode(m, { GearPosition: 3, GearboxTemp: 80, TorqueConverterLock: 1, OutputShaftSpeed: 1000 });
    expect(hex(r.data)).toBe('03 78 01 40 1F 00 00 00');
    const decoded = decodeFrame(m.signals, r.data);
    expect(decoded.map((d) => [d.signal.name, d.physical, d.label])).toEqual([
      ['GearPosition', 3, 'Gear 3'],
      ['GearboxTemp', 80, undefined],
      ['TorqueConverterLock', 1, 'Locked'],
      ['OutputShaftSpeed', 1000, undefined],
    ]);
    expect(r.signals.map((s) => s.decoded?.physical)).toEqual([3, 80, 1, 1000]);
  });
});

describe('encodeFrame problems', () => {
  it('reports a value out of range and leaves its bits alone', () => {
    const m = message('EngineData');
    const r = encode(m, { EngineTemp: 300, EngineRunning: 1 });
    expect(r.problems).toEqual([{ kind: 'range', index: 1 }]);
    expect(hex(r.data)).toBe('00 00 00 00 00 00 00 01');
  });

  it('reports a signal outside the data area', () => {
    const signals = [makeSignal({ name: 'A', startBit: 0 }), makeSignal({ name: 'B', startBit: 12 })];
    const r = encodeFrame(signals, 2, [1, 2]);
    expect(r.problems).toEqual([{ kind: 'outOfBounds', index: 1 }]);
    expect(hex(r.data)).toBe('01 00');
  });

  it('reports overlapping signals that overwrite each other', () => {
    const signals = [makeSignal({ name: 'A', startBit: 0, length: 8 }), makeSignal({ name: 'B', startBit: 4, length: 8 })];
    const r = encodeFrame(signals, 2, [0xff, 0x00]);
    expect(hex(r.data)).toBe('0F 00');
    expect(r.problems).toEqual([{ kind: 'overwritten', index: 0 }]);
    // Equal bits in the overlap are no conflict.
    expect(encodeFrame(signals, 2, [0x0f, 0x00]).problems).toEqual([]);
  });

  it('follows nested extended multiplexing', () => {
    const signals = [
      makeSignal({ name: 'Root', startBit: 0, length: 4, multiplex: { role: 'multiplexor' } }),
      makeSignal({
        name: 'Sub',
        startBit: 4,
        length: 4,
        multiplex: { role: 'both', switchValue: 1, extended: { switchName: 'Root', ranges: [[1, 1]] } },
      }),
      makeSignal({
        name: 'Leaf',
        startBit: 8,
        length: 8,
        multiplex: { role: 'multiplexed', switchValue: 5, extended: { switchName: 'Sub', ranges: [[5, 6]] } },
      }),
    ];
    expect(hex(encodeFrame(signals, 2, [1, 6, 0xaa]).data)).toBe('61 AA');
    // With Root = 2, Sub and with it Leaf are inactive and stay unwritten.
    const off = encodeFrame(signals, 2, [2, 6, 0xaa]);
    expect(hex(off.data)).toBe('02 00');
    expect(off.signals.map((s) => s.active)).toEqual([true, false, false]);
    expect(off.problems).toEqual([]);
  });
});

describe('parsePhysicalInput / physicalRange', () => {
  it('reads what a person types, decimal comma included', () => {
    expect(parsePhysicalInput('')).toBeUndefined();
    expect(parsePhysicalInput('   ')).toBeUndefined();
    expect(parsePhysicalInput(' 12.5 ')).toBe(12.5);
    expect(parsePhysicalInput('12,5')).toBe(12.5);
    expect(parsePhysicalInput('-,5')).toBe(-0.5);
    expect(parsePhysicalInput('1e3')).toBe(1000);
    expect(parsePhysicalInput('1,000.5')).toBeNull();
    expect(parsePhysicalInput('abc')).toBeNull();
    expect(parsePhysicalInput('Infinity')).toBeNull();
  });

  it('gives the physical span of the raw range, lowest first', () => {
    const temp = message('EngineData').signals.find((s) => s.name === 'EngineTemp')!;
    expect(physicalRange(temp)).toEqual([-40, 215]);
    expect(physicalRange(makeSignal({ length: 8, factor: -2 }))).toEqual([-510, 0]);
    expect(physicalRange(makeSignal({ length: 32, valueType: 'float' }))).toBeNull();
  });
});
