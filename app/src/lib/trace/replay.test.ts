// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { detectTraceFormat, isTraceFileName, parseTrace } from './index';
import { decodeRow, replayTrace, rowMatches, type ReplayRow } from './replay';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (name: string) => readFileSync(join(root, 'examples', name), 'utf8');
const demo = parseDbc(read('demo.dbc'));

/** A row as "message: signal=value unit, …", the way a reader would check it. */
function decoded(row: ReplayRow): string {
  const signals = decodeRow(row);
  if (!signals) return `${row.message?.name ?? '?'}: —`;
  const values = signals
    .filter((d) => d.active)
    .map((d) => `${d.signal.name}=${Number(d.physical.toPrecision(10))}${d.signal.unit ? ' ' + d.signal.unit : ''}${d.label ? ` (${d.label})` : ''}`);
  return `${row.message!.name}: ${values.join(', ')}`;
}

describe('detectTraceFormat / parseTrace', () => {
  it('tells the sample logs apart by their content', () => {
    expect(detectTraceFormat(read('demo-candump.log'))).toBe('candump');
    expect(detectTraceFormat(read('demo.asc'))).toBe('asc');
    expect(detectTraceFormat('  vcan0  123   [1]  01')).toBe('candump');
    expect(detectTraceFormat('   0.5 1  123 Rx d 1 01')).toBe('asc');
  });

  it('recognises neither a DBC file nor empty text as a log', () => {
    expect(detectTraceFormat(read('demo.dbc'))).toBeNull();
    expect(detectTraceFormat('')).toBeNull();
    expect(parseTrace(read('demo.dbc'))).toBeNull();
  });

  it('knows log files by their extension', () => {
    expect(isTraceFileName('drive.asc')).toBe(true);
    expect(isTraceFileName('candump-2026-11-01.LOG')).toBe(true);
    expect(isTraceFileName('demo.dbc')).toBe(false);
    expect(isTraceFileName('notes.txt')).toBe(false);
  });
});

describe('replayTrace: examples/demo-candump.log through examples/demo.dbc', () => {
  const log = parseTrace(read('demo-candump.log'))!;
  const replay = replayTrace(demo, log);
  const rows = replay.rows;

  it('decodes every frame the database describes', () => {
    expect(rows.map(decoded)).toEqual([
      'EngineData: EngineSpeed=2000 rpm, EngineTemp=90 degC, ThrottlePosition=20 %, EngineTorque=150 Nm, TorqueRequest=-10 Nm, EngineRunning=1 (Running)',
      'GearboxData: GearPosition=3 (Gear 3), GearboxTemp=80 degC, TorqueConverterLock=1 (Locked), OutputShaftSpeed=1000 rpm',
      'EngineData: EngineSpeed=2100 rpm, EngineTemp=91 degC, ThrottlePosition=22 %, EngineTorque=160 Nm, TorqueRequest=-8 Nm, EngineRunning=1 (Running)',
      'BrakeData: WheelSpeedFL=50 km/h, WheelSpeedFR=50.5 km/h, BrakePressure=100 bar, AbsActive=1 (Active)',
      'DiagData: MuxSelector=1, SensorCurrent=2.5 A',
      'DiagData: MuxSelector=2, ErrorCode=3 (Sensor open circuit)',
      'DiagData: MuxSelector=0, SensorVoltage=12.345 V',
      'EngineData: EngineSpeed=2000 rpm, EngineTemp=90 degC, ThrottlePosition=20 %, EngineTorque=150 Nm, TorqueRequest=-10 Nm, EngineRunning=1 (Running)',
      'PowerData: BatteryVoltage=12.5 V, Consumption=7.5 l/h',
      'J1939_EEC1: ActualEnginePercentTorque=0 %, EngineSpeedJ1939=1500 rpm',
      'J1939_CCVS1: ParkingBrakeSwitch=1, WheelBasedVehicleSpeed=80 km/h, CruiseCtrlActive=1',
      'J1939_TSC1: EngOverrideCtrlMode=1, EngRequestedSpeed=800 rpm',
      'AdasObjects: ObjCount=2, Obj1Dist=12.34 m, Obj1Speed=-1.5 m/s, Obj1Angle=10 deg, Obj2Dist=50 m, Obj2Speed=2 m/s',
      '?: —',
      '?: —',
      '?: —',
      'EngineData: EngineSpeed=2000 rpm',
    ]);
  });

  it('matches J1939 frames from another source address by their PGN', () => {
    expect(rows.map((r) => r.matchedBy ?? null)).toEqual([
      'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'pgn', 'id', 'id', null, null, null, 'id',
    ]);
  });

  it('times frames from the first one, and from the previous frame with the same id', () => {
    expect(replay.start).toBe(1793520000);
    expect(replay.duration).toBeCloseTo(0.034, 6);
    expect(rows.map((r) => (r.time === null ? null : Math.round(r.time * 1e6)))).toEqual([
      0, 4000, 10000, 12000, 15000, 16000, 17000, 20000, 20500, 25000, 26000, 27000, 30000, 31000, 32000, 33000, 34000,
    ]);
    expect(rows.filter((r) => r.frame.id === 0x100).map((r) => (r.delta === null ? null : Math.round(r.delta * 1e6)))).toEqual([
      null, 10000, 10000, 14000,
    ]);
  });

  it('counts what it found', () => {
    expect(replay).toMatchObject({ frames: 17, matchedFrames: 14, ids: 11, unknownIds: 2, remoteFrames: 1, errorFrames: 1 });
  });

  it('decodes a short frame only as far as its bytes reach', () => {
    const short = rows[16];
    expect(short.frame.data.length).toBe(2);
    expect(decodeRow(short)!.map((d) => d.signal.name)).toEqual(['EngineSpeed']);
  });

  it('filters rows by message, signal or id', () => {
    const names = (q: string) => rows.filter((r) => rowMatches(r, q)).map((r) => r.index);
    expect(names('diag')).toEqual([4, 5, 6]);
    expect(names('ErrorCode')).toEqual([4, 5, 6]);
    expect(names('0x300')).toEqual([3]);
    expect(names('18fef117')).toEqual([10]);
    expect(names('7ff')).toEqual([13]);
    expect(names('')).toHaveLength(17);
  });
});

describe('replayTrace: examples/demo.asc through examples/demo.dbc', () => {
  it('gives the same decoded values as the candump log', () => {
    const candump = replayTrace(demo, parseTrace(read('demo-candump.log'))!).rows.map(decoded);
    const asc = replayTrace(demo, parseTrace(read('demo.asc'))!);
    expect(asc.rows.map(decoded)).toEqual(candump);
    expect(asc.start).toBe(0.001);
    expect(asc.rows[1].time).toBeCloseTo(0.004, 9);
  });

  it('replays the same log through another database', () => {
    const other = parseDbc('VERSION ""\nBU_: A\nBO_ 291 Other: 4 A\n SG_ Word : 0|32@1+ (1,0) [0|0] "" A\n');
    const r = replayTrace(other, parseTrace(read('demo.asc'))!);
    expect(r.matchedFrames).toBe(1);
    expect(decoded(r.rows[14])).toBe('Other: Word=4022250974');
  });
});
