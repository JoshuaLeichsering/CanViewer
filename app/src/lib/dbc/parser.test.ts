import { describe, expect, it } from 'vitest';
import { parseDbc } from './parser';
import demo from '../../../../examples/demo.dbc?raw';

describe('parseDbc on demo database', () => {
  const db = parseDbc(demo);

  it('parses without problems', () => {
    expect(db.problems).toEqual([]);
  });

  it('reads version and network comment', () => {
    expect(db.version).toBe('CanViewer Demo 1.0');
    expect(db.comment).toContain('demo database');
  });

  it('reads nodes with comments and attributes', () => {
    expect(db.nodes.map((n) => n.name)).toEqual(['ECM', 'TCM', 'ABS', 'IC', 'Tester']);
    expect(db.nodes[0].comment).toBe('Engine Control Module');
    expect(db.nodes[0].attributes.NodeAddress).toBe(16);
  });

  it('reads messages', () => {
    expect(db.messages).toHaveLength(9);
    const engine = db.messages.find((m) => m.name === 'EngineData')!;
    expect(engine.id).toBe(256);
    expect(engine.dlc).toBe(8);
    expect(engine.sender).toBe('ECM');
    expect(engine.isExtended).toBe(false);
    expect(engine.signals).toHaveLength(6);
    expect(engine.comment).toBe('Engine status broadcast, 10 ms cycle.');
  });

  it('detects extended frame ids', () => {
    const j1939 = db.messages.find((m) => m.name === 'J1939_EEC1')!;
    expect(j1939.isExtended).toBe(true);
    expect(j1939.id).toBe(0x0cf00400);
    expect(j1939.rawId).toBe(2364539904);
  });

  it('parses signal details', () => {
    const engine = db.messages.find((m) => m.name === 'EngineData')!;
    const speed = engine.signals.find((s) => s.name === 'EngineSpeed')!;
    expect(speed.startBit).toBe(0);
    expect(speed.length).toBe(16);
    expect(speed.byteOrder).toBe('intel');
    expect(speed.valueType).toBe('unsigned');
    expect(speed.factor).toBe(0.25);
    expect(speed.offset).toBe(0);
    expect(speed.max).toBe(16383.75);
    expect(speed.unit).toBe('rpm');
    expect(speed.receivers).toEqual(['TCM', 'ABS', 'IC']);
    expect(speed.comment).toBe('Crankshaft rotational speed.');

    const torqueReq = engine.signals.find((s) => s.name === 'TorqueRequest')!;
    expect(torqueReq.valueType).toBe('signed');
    expect(torqueReq.min).toBe(-1024);

    const temp = engine.signals.find((s) => s.name === 'EngineTemp')!;
    expect(temp.offset).toBe(-40);
  });

  it('parses motorola signals', () => {
    const brake = db.messages.find((m) => m.name === 'BrakeData')!;
    const fl = brake.signals.find((s) => s.name === 'WheelSpeedFL')!;
    expect(fl.byteOrder).toBe('motorola');
    expect(fl.startBit).toBe(7);
    expect(fl.length).toBe(16);
  });

  it('parses multiplexing', () => {
    const diag = db.messages.find((m) => m.name === 'DiagData')!;
    expect(diag.signals.find((s) => s.name === 'MuxSelector')!.multiplex.role).toBe('multiplexor');
    const voltage = diag.signals.find((s) => s.name === 'SensorVoltage')!;
    expect(voltage.multiplex.role).toBe('multiplexed');
    expect(voltage.multiplex.switchValue).toBe(0);
    const error = diag.signals.find((s) => s.name === 'ErrorCode')!;
    expect(error.multiplex.extended).toEqual({ switchName: 'MuxSelector', ranges: [[2, 2]] });
  });

  it('parses value descriptions and value tables', () => {
    const gear = db.messages
      .find((m) => m.name === 'GearboxData')!
      .signals.find((s) => s.name === 'GearPosition')!;
    expect(gear.values![15]).toBe('Reverse');
    expect(gear.values![0]).toBe('Neutral');
    expect(db.valueTables).toHaveLength(2);
    expect(db.valueTables[0].name).toBe('GearPositions');
    expect(db.valueTables[0].values[15]).toBe('Reverse');
  });

  it('parses multi-line comments', () => {
    const diag = db.messages.find((m) => m.name === 'DiagData')!;
    expect(diag.comment).toBe('Diagnostic data message.\nSecond line of this comment.');
  });

  it('parses attributes with enum resolution and defaults', () => {
    expect(db.attributes.BusType).toBe('CAN');
    const engine = db.messages.find((m) => m.name === 'EngineData')!;
    expect(engine.attributes.GenMsgCycleTime).toBe(10);
    expect(engine.attributes.GenMsgSendType).toBe('Cyclic');
    const sendType = db.attributeDefinitions.find((d) => d.name === 'GenMsgSendType')!;
    expect(sendType.defaultValue).toBe('NoMsgSendType');
    const cycle = db.attributeDefinitions.find((d) => d.name === 'GenMsgCycleTime')!;
    expect(cycle.min).toBe(0);
    expect(cycle.max).toBe(10000);
  });

  it('parses the CAN FD demo message with VFrameFormat attributes', () => {
    const fd = db.messages.find((m) => m.name === 'AdasObjects')!;
    expect(fd.dlc).toBe(24);
    expect(fd.signals).toHaveLength(6);
    expect(fd.attributes.VFrameFormat).toBe('StandardCAN_FD');
    const j1939 = db.messages.find((m) => m.name === 'J1939_EEC1')!;
    expect(j1939.attributes.VFrameFormat).toBe('J1939PG');
  });

  it('applies SIG_VALTYPE_ float', () => {
    const batt = db.messages
      .find((m) => m.name === 'PowerData')!
      .signals.find((s) => s.name === 'BatteryVoltage')!;
    expect(batt.valueType).toBe('float');
  });

  it('parses BO_TX_BU_ additional transmitters', () => {
    const gearbox = db.messages.find((m) => m.name === 'GearboxData')!;
    expect(gearbox.transmitters).toEqual(['ECM']);
  });
});

describe('parseDbc robustness', () => {
  it('collects problems for malformed lines without dying', () => {
    const db = parseDbc('BO_ garbage nonsense\nBU_: A B\nTOTALLY_UNKNOWN foo bar');
    expect(db.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(db.problems.length).toBe(2);
  });

  it('handles empty sender Vector__XXX', () => {
    const db = parseDbc('BO_ 1 Foo: 8 Vector__XXX\n SG_ S1 : 0|8@1+ (1,0) [0|255] "" Vector__XXX');
    expect(db.messages[0].sender).toBe('');
    expect(db.messages[0].signals[0].receivers).toEqual([]);
  });

  it('tolerates scientific notation and negative factors', () => {
    const db = parseDbc('BO_ 1 Foo: 8 N\n SG_ S1 : 0|16@1- (1E-005,-1.5) [-2|2] "m/s" N2');
    const s = db.messages[0].signals[0];
    expect(s.factor).toBeCloseTo(0.00001);
    expect(s.offset).toBe(-1.5);
  });

  it('parses signals with whitespace-separated receivers', () => {
    const db = parseDbc('BO_ 1 Foo: 8 N\n SG_ S1 : 0|8@1+ (1,0) [0|255] "" A B');
    expect(db.messages[0].signals[0].receivers).toEqual(['A', 'B']);
  });

  it('handles escaped quotes in comments without swallowing following statements', () => {
    const db = parseDbc(
      [
        'BO_ 291 M1: 8 ECU1',
        ' SG_ WHEEL : 0|8@1+ (1,0) [0|255] "" ECU1',
        'CM_ SG_ 291 WHEEL "fits 12\\" wheels";',
        'BO_ 292 M2: 8 ECU1',
        ' SG_ S2 : 0|8@1+ (1,0) [0|255] "" ECU1',
        'VAL_ 292 S2 0 "Off" 1 "On";',
        'BO_ 293 M3: 8 ECU1',
      ].join('\n'),
    );
    expect(db.problems).toEqual([]);
    expect(db.messages.map((m) => m.name)).toEqual(['M1', 'M2', 'M3']);
    expect(db.messages[0].signals[0].comment).toBe('fits 12" wheels');
    expect(db.messages[1].signals[0].values).toEqual({ 0: 'Off', 1: 'On' });
  });

  it('recovers from an unclosed quote instead of discarding the rest of the file', () => {
    const db = parseDbc(
      [
        'CM_ BO_ 100 "unclosed comment',
        'BO_ 200 Second: 8 A',
        ' SG_ Lost : 0|8@1+ (1,0) [0|255] "" B',
        'BO_ 300 Third: 8 A',
      ].join('\n'),
    );
    expect(db.messages.map((m) => m.name)).toEqual(['Second', 'Third']);
    expect(db.messages[0].signals).toHaveLength(1);
    expect(db.problems).toHaveLength(1);
  });

  it('joins line-wrapped BA_DEF_ ENUM lists', () => {
    const db = parseDbc(
      [
        'BO_ 291 M: 8 A',
        'BA_DEF_ BO_ "GenMsgSendType" ENUM "cyclic","spontaneous",',
        '"IfActive","cyclicIfActive";',
        'BA_ "GenMsgSendType" BO_ 291 2;',
      ].join('\n'),
    );
    expect(db.problems).toEqual([]);
    const def = db.attributeDefinitions.find((d) => d.name === 'GenMsgSendType')!;
    expect(def.enumValues).toEqual(['cyclic', 'spontaneous', 'IfActive', 'cyclicIfActive']);
    expect(db.messages[0].attributes.GenMsgSendType).toBe('IfActive');
  });

  it('joins BU_ node lists continued on indented lines', () => {
    const db = parseDbc('BU_: A B\n  C D\nBO_ 1 M: 8 A');
    expect(db.nodes.map((n) => n.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(db.messages).toHaveLength(1);
    expect(db.problems).toEqual([]);
  });

  it('skips valid-but-unmodeled keywords without reporting problems', () => {
    const db = parseDbc(
      'SIGTYPE_VALTYPE_ 291 S1 : mytype;\nCAT_DEF_ 1 categoryname 2;\nNS_DESC_ something',
    );
    expect(db.problems).toEqual([]);
    expect(db.skipped.SIGTYPE_VALTYPE_).toBe(1);
    expect(db.skipped.CAT_DEF_).toBe(1);
    expect(db.skipped.NS_DESC_).toBe(1);
  });

  it('keeps both duplicate-id messages, attaches metadata to the first, and reports it', () => {
    const db = parseDbc(
      [
        'BO_ 100 First: 8 A',
        ' SG_ S1 : 0|8@1+ (1,0) [0|255] "" B',
        'BO_ 100 Second: 8 A',
        ' SG_ S2 : 8|8@1+ (1,0) [0|255] "" B',
        'CM_ BO_ 100 "important note";',
      ].join('\n'),
    );
    expect(db.messages.map((m) => m.name)).toEqual(['First', 'Second']);
    expect(db.messages[0].comment).toBe('important note');
    expect(db.problems.some((p) => p.reason.includes('duplicate message id'))).toBe(true);
  });

  it('treats a bare lowercase "m" mux tag as the multiplexor (vw_pq.dbc style)', () => {
    const db = parseDbc(
      'BO_ 648 Motor_2: 8 Motor\n SG_ Mp_Code m : 6|2@1+ (1,0) [0|3] "" GW\n SG_ CAN_Vers m0 : 0|6@1+ (1,0) [0|63] "" GW',
    );
    expect(db.problems).toEqual([]);
    const [mp, vers] = db.messages[0].signals;
    expect(mp.multiplex.role).toBe('multiplexor');
    expect(vers.multiplex).toEqual({ role: 'multiplexed', switchValue: 0 });
  });

  it('rejects signals with pathological start bit or length', () => {
    const db = parseDbc('BO_ 7 M: 8 A\n SG_ Evil : 0|999999999@1+ (1,0) [0|0] "" Vector__XXX');
    expect(db.messages[0].signals).toHaveLength(0);
    expect(db.problems.some((p) => p.reason.includes('invalid start bit or length'))).toBe(true);
  });

  it('caps the problems list for non-DBC input', () => {
    const garbage = Array.from({ length: 5000 }, (_, i) => `garbage line ${i}`).join('\n');
    const db = parseDbc(garbage);
    expect(db.problems.length).toBe(1001);
    expect(db.problems[1000].reason).toContain('suppressed');
  });
});
