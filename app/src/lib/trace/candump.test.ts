// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCandump } from './candump';
import type { TraceFrame } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sample = readFileSync(join(root, 'examples/demo-candump.log'), 'utf8');
const hex = (data: Uint8Array) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
/** The fields a test cares about, with the payload as hex. */
const brief = (f: TraceFrame) => ({ ...f, data: hex(f.data) });

describe('parseCandump: candump -l log files', () => {
  const log = parseCandump(sample);

  it('reads every line of examples/demo-candump.log', () => {
    expect(log.format).toBe('candump');
    expect(log.problems).toEqual([]);
    expect(log.skipped).toEqual({});
    expect(log.timestamps).toBe('epoch');
    expect(log.frames.length).toBe(17);
    expect(log.frames.map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('reads standard frames with their time stamp and channel', () => {
    expect(brief(log.frames[0])).toEqual({
      line: 1,
      time: 1793520000,
      channel: 'can0',
      id: 0x100,
      isExtended: false,
      kind: 'data',
      isFd: false,
      data: '40 1F 82 32 2C C1 FE 01',
    });
    expect(log.frames[1].time).toBeCloseTo(1793520000.004, 6);
    expect(hex(log.frames[3].data)).toBe('13 88 13 BA 32 20');
  });

  it('tells extended ids by their eight digits', () => {
    expect(log.frames[9]).toMatchObject({ id: 0x0cf00400, isExtended: true, kind: 'data' });
    expect(log.frames[10]).toMatchObject({ id: 0x18fef117, isExtended: true });
  });

  it('reads CAN FD frames with their flags', () => {
    const fd = log.frames[12];
    expect(fd).toMatchObject({ channel: 'can1', id: 0x600, isFd: true, brs: true, esi: false, kind: 'data' });
    expect(fd.data.length).toBe(24);
    expect(hex(fd.data.subarray(0, 11))).toBe('02 D2 04 6A FF 64 00 88 13 C8 00');
  });

  it('reads remote and error frames without inventing data', () => {
    expect(brief(log.frames[13])).toMatchObject({ id: 0x7ff, kind: 'remote', data: '' });
    // SocketCAN marks error frames with CAN_ERR_FLAG (0x20000000); the payload holds the error details.
    expect(brief(log.frames[15])).toMatchObject({ id: 0x4, kind: 'error', isExtended: false, data: '00 00 00 00 00 00 00 00' });
    expect(brief(log.frames[16])).toMatchObject({ id: 0x100, data: '40 1F' });
  });

  it('accepts dots in the payload, a remote length, a direction mark and CRLF line ends', () => {
    const r = parseCandump(
      '(1.000000) vcan0 123#11.22.33\r\n(2.000000) vcan0 00000123#R4\r\n(3.000000) vcan0 1FFFFFFF#F0 R\r\n(4.000000) vcan0 321##3AA T\r\n',
    );
    expect(r.problems).toEqual([]);
    expect(r.frames.map(brief)).toEqual([
      { line: 1, time: 1, channel: 'vcan0', id: 0x123, isExtended: false, kind: 'data', isFd: false, data: '11 22 33' },
      { line: 2, time: 2, channel: 'vcan0', id: 0x123, isExtended: true, kind: 'remote', isFd: false, data: '', dlc: 4 },
      { line: 3, time: 3, channel: 'vcan0', id: 0x1fffffff, isExtended: true, kind: 'data', isFd: false, data: 'F0', direction: 'rx' },
      { line: 4, time: 4, channel: 'vcan0', id: 0x321, isExtended: false, kind: 'data', isFd: true, brs: true, esi: true, data: 'AA', direction: 'tx' },
    ]);
  });

  it('reports lines it cannot read, with their line numbers, and keeps the rest', () => {
    const r = parseCandump(
      [
        '(1.0) can0 100#0102',
        '(2.0) can0 1000#01',
        '(3.0) can0 100#0G',
        '(4.0) can0 100#010',
        '(5.0) can0 100#010203040506070809',
        '(6.0) can0 800#01',
        'this is not a frame',
        '',
        '(7.0) can0 101#03',
      ].join('\n'),
    );
    expect(r.frames.map((f) => [f.line, f.id])).toEqual([
      [1, 0x100],
      [9, 0x101],
    ]);
    expect(r.problems).toEqual([
      { line: 2, text: '(2.0) can0 1000#01', reason: 'badId' },
      { line: 3, text: '(3.0) can0 100#0G', reason: 'badData' },
      { line: 4, text: '(4.0) can0 100#010', reason: 'badData' },
      { line: 5, text: '(5.0) can0 100#010203040506070809', reason: 'badData' },
      { line: 6, text: '(6.0) can0 800#01', reason: 'badId' },
      { line: 7, text: 'this is not a frame', reason: 'unrecognized' },
    ]);
  });
});

describe('parseCandump: candump screen output', () => {
  it('reads the default format without time stamps', () => {
    const r = parseCandump(
      ['  vcan0  0C8   [8]  F0 00 00 00 00 00 00 00', '  vcan0  00000123   [3]  01 02 03', '  vcan0  00000123   [0]  remote request'].join('\n'),
    );
    expect(r.problems).toEqual([]);
    expect(r.timestamps).toBe('none');
    expect(r.frames.map(brief)).toEqual([
      { line: 1, time: null, channel: 'vcan0', id: 0xc8, isExtended: false, kind: 'data', isFd: false, data: 'F0 00 00 00 00 00 00 00' },
      { line: 2, time: null, channel: 'vcan0', id: 0x123, isExtended: true, kind: 'data', isFd: false, data: '01 02 03' },
      { line: 3, time: null, channel: 'vcan0', id: 0x123, isExtended: true, kind: 'remote', isFd: false, data: '', dlc: 0 },
    ]);
  });

  it('reads absolute (-ta) and date (-tA) time stamps', () => {
    const ta = parseCandump('(1613749650.388103)  can1       0AD  [08]  A6 55 3B CF 3F 1A F5 2A');
    expect(ta.timestamps).toBe('epoch');
    expect(ta.frames[0]).toMatchObject({ channel: 'can1', id: 0xad, isFd: true, time: 1613749650.388103 });
    const tA = parseCandump(' (2020-12-19 12:04:45.485261)  vcan0  0C8   [8]  F0 00 00 00 00 00 00 00');
    expect(tA.timestamps).toBe('epoch');
    expect(tA.frames[0].time).toBeCloseTo(Date.UTC(2020, 11, 19, 12, 4, 45) / 1000 + 0.485261, 6);
  });

  it('keeps time since start (-tz) and sums deltas (-td)', () => {
    const tz = parseCandump('(000.000000)  vcan0  064   [1]  F0\n(002.047817)  vcan0  064   [1]  F1\n(012.831664)  vcan0  064   [1]  F2');
    expect(tz.timestamps).toBe('sinceStart');
    expect(tz.frames.map((f) => f.time)).toEqual([0, 2.047817, 12.831664]);
    // Time going backwards in a short format means candump -td wrote the gap to the previous frame.
    const td = parseCandump('(000.000000)  vcan0  064   [1]  F0\n(000.250000)  vcan0  064   [1]  F1\n(000.125000)  vcan0  064   [1]  F2');
    expect(td.timestamps).toBe('delta');
    expect(td.frames.map((f) => f.time)).toEqual([0, 0.25, 0.375]);
  });

  it('reads -x extra columns, error frames and the -a ASCII column', () => {
    const r = parseCandump(
      [
        ' (1.000000)  can0  RX B -  123  [12]  00 11 22 33 44 55 66 77 88 99 AA BB',
        ' (2.000000)  can0  TX - -  124   [2]  01 02   \'..\'',
        '  vcan0  20000004   [8]  00 00 00 00 00 00 00 00   ERRORFRAME',
      ].join('\n'),
    );
    expect(r.problems).toEqual([]);
    expect(r.frames.map(brief)).toEqual([
      { line: 1, time: 1, channel: 'can0', id: 0x123, isExtended: false, kind: 'data', isFd: true, brs: true, esi: false, direction: 'rx', data: '00 11 22 33 44 55 66 77 88 99 AA BB' },
      // B and E belong to CAN FD; candump prints "- -" for classic frames.
      { line: 2, time: 2, channel: 'can0', id: 0x124, isExtended: false, kind: 'data', isFd: false, direction: 'tx', data: '01 02' },
      { line: 3, time: null, channel: 'vcan0', id: 0x4, isExtended: false, kind: 'error', isFd: false, data: '00 00 00 00 00 00 00 00' },
    ]);
  });

  it('reports a frame with fewer bytes than its length says', () => {
    const r = parseCandump('  vcan0  123   [4]  01 02 03');
    expect(r.frames).toEqual([]);
    expect(r.problems).toEqual([{ line: 1, text: '  vcan0  123   [4]  01 02 03', reason: 'lengthMismatch' }]);
  });
});
