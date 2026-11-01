import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAsc } from './asc';
import type { TraceFrame } from './types';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sample = readFileSync(join(root, 'examples/demo.asc'), 'utf8');
const hex = (data: Uint8Array) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const brief = (f: TraceFrame) => ({ ...f, data: hex(f.data) });

describe('parseAsc: examples/demo.asc', () => {
  const log = parseAsc(sample);

  it('reads every frame and accounts for every other line', () => {
    expect(log.format).toBe('asc');
    expect(log.problems).toEqual([]);
    expect(log.frames.length).toBe(17);
    // date, base, internal events, Begin/End Triggerblock; the version comment; start of measurement; statistics.
    expect(log.skipped).toEqual({ header: 5, comment: 1, event: 1, statistic: 1 });
    expect(log.timestamps).toBe('sinceStart');
    expect(log.startedAt).toBe('Sun Nov 1 08:00:00.000 am 2026');
  });

  it('reads classic frames, ignoring the trailing length and bit count', () => {
    expect(brief(log.frames[0])).toEqual({
      line: 7,
      time: 0.001,
      channel: '1',
      id: 0x100,
      isExtended: false,
      kind: 'data',
      isFd: false,
      direction: 'rx',
      data: '40 1F 82 32 2C C1 FE 01',
    });
    expect(brief(log.frames[3])).toMatchObject({ id: 0x300, data: '13 88 13 BA 32 20' });
    expect(log.frames[4]).toMatchObject({ id: 0x400, direction: 'tx' });
  });

  it('reads extended ids marked with x', () => {
    expect(log.frames[9]).toMatchObject({ id: 0x0cf00400, isExtended: true });
    expect(log.frames[11]).toMatchObject({ id: 0x0c000003, isExtended: true });
  });

  it('reads CAN FD frames by their data length, with BRS and ESI', () => {
    const fd = log.frames[12];
    expect(fd).toMatchObject({ line: 19, time: 0.031, channel: '2', id: 0x600, isFd: true, brs: true, esi: false, direction: 'rx' });
    expect(fd.data.length).toBe(24);
    expect(hex(fd.data.subarray(0, 11))).toBe('02 D2 04 6A FF 64 00 88 13 C8 00');
  });

  it('reads remote and error frames', () => {
    expect(brief(log.frames[13])).toMatchObject({ id: 0x7ff, kind: 'remote', data: '' });
    expect(brief(log.frames[15])).toMatchObject({ line: 22, channel: '1', kind: 'error', data: '' });
    expect(brief(log.frames[16])).toMatchObject({ id: 0x100, data: '40 1F' });
  });
});

describe('parseAsc: header variants and other lines', () => {
  it('reads decimal logs', () => {
    const r = parseAsc(['base dec  timestamps absolute', '   1.5 2  256   Rx   d 3 1 2 255', '   1.6 2  217056256x Tx d 1 16'].join('\n'));
    expect(r.problems).toEqual([]);
    expect(r.frames.map(brief)).toEqual([
      { line: 2, time: 1.5, channel: '2', id: 256, isExtended: false, kind: 'data', isFd: false, direction: 'rx', data: '01 02 FF' },
      { line: 3, time: 1.6, channel: '2', id: 0x0cf00400, isExtended: true, kind: 'data', isFd: false, direction: 'tx', data: '10' },
    ]);
  });

  it('sums relative time stamps', () => {
    const r = parseAsc(['base hex  timestamps relative', '0.5 1 10 Rx d 1 01', '0.25 1 10 Rx d 1 02', '0.125 1 10 Rx d 1 03'].join('\n'));
    expect(r.timestamps).toBe('delta');
    expect(r.frames.map((f) => f.time)).toEqual([0.5, 0.75, 0.875]);
  });

  it('reads a remote frame with a length, an FD frame without a name and an FD error frame', () => {
    const r = parseAsc(
      [
        'base hex  timestamps absolute',
        '0.1 1 123 Rx r 4',
        '0.2 CANFD 1 Tx 1A2x 0 1 2 2 AA BB 0 0 0 0 0 0 0 0',
        '0.3 CANFD 1 Rx ErrorFrame 1 0 0 0 0',
      ].join('\n'),
    );
    expect(r.problems).toEqual([]);
    expect(r.frames.map(brief)).toEqual([
      { line: 2, time: 0.1, channel: '1', id: 0x123, isExtended: false, kind: 'remote', isFd: false, direction: 'rx', data: '', dlc: 4 },
      { line: 3, time: 0.2, channel: '1', id: 0x1a2, isExtended: true, kind: 'data', isFd: true, brs: false, esi: true, direction: 'tx', data: 'AA BB' },
      { line: 4, time: 0.3, channel: '1', id: 0, isExtended: false, kind: 'error', isFd: true, direction: 'rx', data: '' },
    ]);
  });

  it('counts status lines, transmit requests and other buses instead of reading them as frames', () => {
    const r = parseAsc(
      [
        'base hex  timestamps absolute',
        'no internal events logged',
        '0.1 CAN 1 Status:chip status error active',
        '0.2 1 123 TxRq d 1 01',
        '0.3 Li 2 Rx 3c 8 00 00 00 00 00 00 00 00',
        '0.4 1 ChipStat: ...',
        '0.5 1 123 Rx d 1 01',
      ].join('\n'),
    );
    expect(r.problems).toEqual([]);
    expect(r.frames.map((f) => f.line)).toEqual([7]);
    expect(r.skipped).toEqual({ header: 2, status: 2, txRequest: 1, event: 1 });
  });

  it('reports what it cannot read, with the line number', () => {
    const r = parseAsc(
      [
        'base hex  timestamps absolute',
        '0.1 1 12G Rx d 1 01',
        '0.2 1 123 Rx d 4 01 02',
        '0.3 1 123 Rx d 1 0x1',
        '0.4 1 123 Up d 1 01',
        'garbage',
        '0.5 1 124 Rx d 1 01',
        '0.6 1 125 Rx d 3 01 02  Length = 120000 BitCount = 62 ID = 293',
        '0.7 1 800 Rx d 1 01',
      ].join('\n'),
    );
    expect(r.frames.map((f) => f.line)).toEqual([7]);
    expect(r.problems).toEqual([
      { line: 2, text: '0.1 1 12G Rx d 1 01', reason: 'badId' },
      { line: 3, text: '0.2 1 123 Rx d 4 01 02', reason: 'lengthMismatch' },
      { line: 4, text: '0.3 1 123 Rx d 1 0x1', reason: 'badData' },
      { line: 5, text: '0.4 1 123 Up d 1 01', reason: 'unrecognized' },
      { line: 6, text: 'garbage', reason: 'unrecognized' },
      { line: 8, text: '0.6 1 125 Rx d 3 01 02  Length = 120000 BitCount = 62 ID = 293', reason: 'lengthMismatch' },
      { line: 9, text: '0.7 1 800 Rx d 1 01', reason: 'badId' },
    ]);
  });
});
