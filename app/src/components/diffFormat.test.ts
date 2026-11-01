import { describe, expect, it } from 'vitest';
import { parseDbc } from '../lib/dbc/parser';
import { diffDatabases } from '../lib/diff/diff';
import type { MsgKey, TParams } from '../lib/i18n';
import { changedFields, fieldLabel, formatValue, muxNotation, signalNotation, signalTally } from './diffFormat';

/** A stand-in for the translation function: the key and its parameters. */
const t = (key: MsgKey, params?: TParams) => (params ? `${key}${JSON.stringify(params)}` : key);

describe('diff mode presentation', () => {
  it('labels fields as the rest of the UI does', () => {
    expect(fieldLabel('factor', t)).toBe('thFactor');
    expect(fieldLabel('startBit', t)).toBe('thStart');
    expect(fieldLabel('min', t)).toBe('Min');
    expect(fieldLabel('values[-1]', t)).toBe('difFieldValue{"raw":"-1"}');
    expect(fieldLabel('attr[GenMsgCycleTime]', t)).toBe('difFieldAttribute{"name":"GenMsgCycleTime"}');
    expect(fieldLabel('somethingNew', t)).toBe('somethingNew');
  });

  it('formats values in the viewer’s notation, and an absent or empty one as nothing', () => {
    expect(formatValue('factor', 0.1 + 0.2, t)).toBe('0.3');
    expect(formatValue('byteOrder', 'motorola', t)).toBe('Motorola');
    expect(formatValue('frameFormat', 'fd', t)).toBe('CAN FD');
    expect(formatValue('frameFormat', 'classic', t)).toBe('difFormatClassic');
    expect(formatValue('isExtended', true, t)).toBe('pillExtended');
    expect(formatValue('isExtended', false, t)).toBe('difStandard');
    expect(formatValue('j1939Database', true, t)).toBe('difYes');
    expect(formatValue('receivers', 'ECU1,ECU2', t)).toBe('ECU1, ECU2');
    expect(formatValue('multiplex', 'multiplexed 2', t)).toBe('m2');
    expect(formatValue('comment', '', t)).toBeUndefined();
    expect(formatValue('unit', undefined, t)).toBeUndefined();
    expect(formatValue('comment', 'Two\nlines', t)).toBe('Two\nlines');
  });

  it('writes multiplexing in DBC notation', () => {
    expect(muxNotation('none')).toBeUndefined();
    expect(muxNotation('multiplexor')).toBe('M');
    expect(muxNotation('multiplexed 0')).toBe('m0');
    expect(muxNotation('both 3')).toBe('m3M');
    expect(muxNotation('multiplexed 2 by Sel [2-2, 4-6]')).toBe('m2 (Sel 2-2, 4-6)');
    expect(muxNotation('unexpected')).toBe('unexpected');
  });

  it('writes a signal in DBC notation', () => {
    const db = parseDbc(
      'BU_: A\nBO_ 1 M: 8 A\n SG_ S : 7|16@0- (0.25,-10) [-10|100] "km/h" A\n SG_ F : 16|32@1- (1,0) [0|0] "" A\nSIG_VALTYPE_ 1 F : 1;\n',
    );
    expect(signalNotation(db.messages[0].signals[0])).toBe('7|16@0- (0.25,-10) [-10|100] "km/h"');
    expect(signalNotation(db.messages[0].signals[1])).toBe('16|32@1- float (1,0) [0|0] ""');
  });

  it('sums up a changed message', () => {
    const before = parseDbc('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|0] "" A\n SG_ R : 8|8@1+ (1,0) [0|0] "" A\n');
    const after = parseDbc('BU_: A\nBO_ 1 N: 4 A\n SG_ S : 0|8@1+ (2,0) [0|0] "" A\n SG_ T : 8|8@1+ (1,0) [0|0] "" A\n');
    const [m] = diffDatabases(before, after).messages;
    expect(signalTally(m)).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(changedFields(m, t)).toEqual(['thName', 'dlc']);
  });
});
