import { describe, expect, it } from 'vitest';
import { parseDbc } from '../dbc/parser';
import { compareDatabases } from './compare';
import { canmatrixFormatFor } from './formats';

const BASE = `VERSION ""
BU_: ECU1 ECU2
BO_ 2566834709 EngineData: 8 ECU1
 SG_ Speed : 7|16@0+ (0.25,0) [0|16383.75] "km/h" ECU2
 SG_ Mode : 16|2@1+ (1,0) [0|0] "" ECU2
CM_ SG_ 2566834709 Speed "Vehicle speed";
VAL_ 2566834709 Mode 0 "Off" 1 "On" ;
`;

describe('compareDatabases', () => {
  it('finds nothing to report between a database and itself', () => {
    expect(compareDatabases(parseDbc(BASE), parseDbc(BASE))).toEqual([]);
  });

  it('reports a lost extended flag once, not as a missing and an extra message', () => {
    const lost = parseDbc(BASE.replace(/2566834709/g, String(2566834709 - 0x80000000)));
    expect(compareDatabases(parseDbc(BASE), lost)).toEqual(['x0x18FECA15 EngineData: isExtended true -> false']);
  });

  it('reports field changes per signal', () => {
    const changed = parseDbc(BASE.replace('(0.25,0)', '(0.2,0)').replace('7|16@0+', '0|16@1+'));
    expect(compareDatabases(parseDbc(BASE), changed)).toEqual([
      'x0x18FECA15 EngineData / Speed: startBit 7 -> 0',
      'x0x18FECA15 EngineData / Speed: byteOrder "motorola" -> "intel"',
      'x0x18FECA15 EngineData / Speed: factor 0.25 -> 0.2',
    ]);
  });

  it('skips min/max when the DBC leaves the range at [0|0]', () => {
    const ranged = parseDbc(BASE.replace('[0|0]', '[0|3]'));
    expect(compareDatabases(parseDbc(BASE), ranged)).toEqual([]);
    expect(compareDatabases(ranged, parseDbc(BASE))).toEqual([
      'x0x18FECA15 EngineData / Mode: max 3 -> 0',
    ]);
  });

  it('reports value descriptions per raw value, and lost ones in one line', () => {
    const relabelled = parseDbc(BASE.replace('1 "On"', '1 "Running"'));
    expect(compareDatabases(parseDbc(BASE), relabelled)).toEqual([
      'x0x18FECA15 EngineData / Mode: values[1] "On" -> "Running"',
    ]);
    const lost = parseDbc(BASE.replace(/^VAL_.*$/m, ''));
    expect(compareDatabases(parseDbc(BASE), lost)).toEqual([
      'x0x18FECA15 EngineData / Mode: values 2 entries -> 0 entries',
    ]);
  });

  it('reports missing and extra messages and signals', () => {
    const other = parseDbc(BASE.replace('SG_ Mode', 'SG_ Gear').replace(/^(VAL_|CM_).*$/gm, '') +
      'BO_ 100 Extra: 1 ECU1\n');
    expect(compareDatabases(parseDbc(BASE), other)).toEqual([
      'x0x18FECA15 EngineData / Speed: comment "Vehicle speed" -> ""',
      'x0x18FECA15 EngineData / Mode: signal missing',
      'x0x18FECA15 EngineData / Gear: signal not in the DBC twin',
      '0x64 Extra: message not in the DBC twin',
    ]);
  });
});

describe('canmatrixFormatFor', () => {
  it('leaves .dbc to the TypeScript parser', () => {
    expect(canmatrixFormatFor('car.dbc')).toBeUndefined();
    expect(canmatrixFormatFor('car.DBC')).toBeUndefined();
  });

  it('maps extensions to canmatrix import types and their packages', () => {
    expect(canmatrixFormatFor('System.ARXML')).toEqual({ importType: 'arxml', packages: ['lxml'] });
    expect(canmatrixFormatFor('bus.xml')?.importType).toBe('fibex');
    expect(canmatrixFormatFor('matrix.yml')?.importType).toBe('yaml');
    expect(canmatrixFormatFor('notes.txt')).toBeUndefined();
  });
});
