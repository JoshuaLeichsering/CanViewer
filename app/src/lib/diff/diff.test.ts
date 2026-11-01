// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { countChanges, diffDatabases, diffLines, type DatabaseDiff } from './diff';

/** A small database with something of every kind diff mode compares. */
const BASE = `VERSION "1.0"
BU_: ECU1 ECU2 ECU3
VAL_TABLE_ OnOff 0 "Off" 1 "On" ;
BO_ 256 Engine: 8 ECU1
 SG_ Speed : 0|16@1+ (0.25,0) [0|16383.75] "rpm" ECU2,ECU3
 SG_ Temp : 16|8@1+ (1,-40) [-40|215] "degC" ECU2
 SG_ Mode : 24|2@1+ (1,0) [0|0] "" ECU2
BO_ 512 Gearbox: 8 ECU2
 SG_ Gear : 0|4@1+ (1,0) [0|15] "" ECU1
BO_ 2566834709 J1939_Msg: 8 ECU1
 SG_ Load : 0|8@1+ (1,0) [0|250] "%" ECU2
BO_TX_BU_ 512 : ECU2,ECU3;
CM_ "Test database.";
CM_ BU_ ECU1 "Engine control";
CM_ BO_ 256 "Engine status.";
CM_ SG_ 256 Speed "Crankshaft speed.";
BA_DEF_ BO_ "GenMsgCycleTime" INT 0 10000;
BA_DEF_ SG_ "GenSigStartValue" FLOAT 0 100000;
BA_DEF_ BU_ "NodeAddress" HEX 0 255;
BA_DEF_ "BusType" STRING;
BA_DEF_DEF_ "GenMsgCycleTime" 0;
BA_DEF_DEF_ "BusType" "CAN";
BA_ "BusType" "CAN";
BA_ "GenMsgCycleTime" BO_ 256 10;
BA_ "NodeAddress" BU_ ECU1 16;
BA_ "GenSigStartValue" SG_ 256 Speed 0;
VAL_ 256 Mode 0 "Off" 1 "On" 2 "Error" ;
`;

const base = () => parseDbc(BASE);
/** The base database with text replacements applied, as a new version of it. */
const edited = (...edits: Array<[string | RegExp, string]>) =>
  parseDbc(edits.reduce((text, [from, to]) => text.replace(from, to), BASE));
const lines = (after: ReturnType<typeof parseDbc>) => diffLines(diffDatabases(base(), after));

describe('diffDatabases on identical databases', () => {
  it('finds no change between a database and itself, or a second parse of the same text', () => {
    for (const after of [base(), parseDbc(BASE)]) {
      const diff = diffDatabases(base(), after);
      expect(diffLines(diff)).toEqual([]);
      expect(diff.messages.map((m) => m.kind)).toEqual(['unchanged', 'unchanged', 'unchanged']);
      expect(countChanges(diff).messages).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 3 });
      expect(countChanges(diff).signals).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 5 });
    }
  });
});

describe('diffDatabases on messages', () => {
  it('reports an added message with its signals as added', () => {
    const diff = diffDatabases(base(), edited([/^BO_TX_BU_/m, 'BO_ 768 Brake: 4 ECU3\n SG_ Pressure : 0|16@1+ (0.1,0) [0|6553.5] "bar" ECU1\n\nBO_TX_BU_']));
    expect(diffLines(diff)).toEqual(['message 0x300 Brake: added']);
    const brake = diff.messages.find((m) => m.after?.name === 'Brake')!;
    expect(brake.kind).toBe('added');
    expect(brake.before).toBeUndefined();
    expect(brake.signals.map((s) => [s.name, s.kind])).toEqual([['Pressure', 'added']]);
    expect(countChanges(diff).messages).toMatchObject({ added: 1, unchanged: 3 });
    expect(countChanges(diff).signals).toMatchObject({ added: 1, unchanged: 5 });
  });

  it('reports a removed message with its signals as removed', () => {
    const diff = diffDatabases(base(), edited([/^BO_ 512 Gearbox.*\n.*\n/m, ''], [/^BO_TX_BU_.*\n/m, '']));
    expect(diffLines(diff)).toEqual(['message 0x200 Gearbox: removed']);
    expect(countChanges(diff).messages).toMatchObject({ removed: 1, unchanged: 2 });
    expect(countChanges(diff).signals).toMatchObject({ removed: 1, unchanged: 4 });
  });

  it('reports changed message properties: name, DLC, sender, transmitters, comment', () => {
    expect(
      lines(
        edited(
          ['BO_ 256 Engine: 8 ECU1', 'BO_ 256 EngineStatus: 6 ECU3'],
          ['CM_ BO_ 256 "Engine status.";', 'CM_ BO_ 256 "Engine status, 10 ms.";'],
          ['BO_TX_BU_ 512 : ECU2,ECU3;', 'BO_TX_BU_ 512 : ECU2;'],
        ),
      ),
    ).toEqual([
      'message 0x100 Engine: name "Engine" -> "EngineStatus"',
      'message 0x100 Engine: dlc 8 -> 6',
      'message 0x100 Engine: sender "ECU1" -> "ECU3"',
      'message 0x100 Engine: comment "Engine status." -> "Engine status, 10 ms."',
      // Additional transmitters: the sender (ECU2) is not one of them.
      'message 0x200 Gearbox: transmitters "ECU3" -> ""',
    ]);
  });

  it('reports a changed frame format, by CanViewer’s rules', () => {
    expect(lines(edited(['BO_ 512 Gearbox: 8', 'BO_ 512 Gearbox: 12']))).toEqual([
      'message 0x200 Gearbox: dlc 8 -> 12',
      'message 0x200 Gearbox: frameFormat "classic" -> "fd"',
    ]);
  });

  it('reports added, removed and changed message attributes', () => {
    expect(
      lines(
        edited(
          ['BA_ "GenMsgCycleTime" BO_ 256 10;', 'BA_ "GenMsgCycleTime" BO_ 256 20;\nBA_ "GenMsgCycleTime" BO_ 512 50;'],
        ),
      ),
    ).toEqual(['message 0x100 Engine: attr[GenMsgCycleTime] 10 -> 20', 'message 0x200 Gearbox: attr[GenMsgCycleTime] (none) -> 50']);
    expect(lines(edited(['BA_ "GenMsgCycleTime" BO_ 256 10;', '']))).toEqual([
      'message 0x100 Engine: attr[GenMsgCycleTime] 10 -> (none)',
    ]);
  });

  it('reports a lost extended flag as one change, not a removed and an added message', () => {
    const diff = diffDatabases(base(), edited([/2566834709/g, String(2566834709 - 0x80000000)]));
    expect(diffLines(diff)).toEqual([
      'message 0x18FECA15 J1939_Msg: isExtended true -> false',
    ]);
    expect(countChanges(diff).messages).toMatchObject({ changed: 1, added: 0, removed: 0 });
  });

  it('pairs a message that moved to another id by its name, and reports the id', () => {
    const diff = diffDatabases(base(), edited([/\b512\b/g, '640']));
    expect(diffLines(diff)).toEqual(['message 0x200 Gearbox: id "0x200" -> "0x280"']);
    expect(countChanges(diff).messages).toMatchObject({ changed: 1, added: 0, removed: 0 });
  });

  it('reports a message with a new id and a new name as removed and added', () => {
    expect(lines(edited([/\b512\b/g, '640'], ['Gearbox', 'Transmission']))).toEqual([
      'message 0x200 Gearbox: removed',
      'message 0x280 Transmission: added',
    ]);
  });

  it('matches messages that share an id by their order in the file', () => {
    const dup = 'BO_ 1024 Dup: 8 ECU1\n SG_ A : 0|8@1+ (1,0) [0|0] "" ECU2\nBO_ 1024 Dup: 8 ECU1\n SG_ B : 0|8@1+ (1,0) [0|0] "" ECU2\n';
    const before = parseDbc(BASE + dup);
    const after = parseDbc(BASE + dup.replace('SG_ B :', 'SG_ C :'));
    expect(diffLines(diffDatabases(before, after))).toEqual([
      'message 0x400 Dup / B: removed',
      'message 0x400 Dup / C: added',
    ]);
  });

  it('lists messages by id, the after side’s id for a changed one', () => {
    const diff = diffDatabases(
      base(),
      edited([/^BO_TX_BU_/m, 'BO_ 16 First: 1 ECU1\n\nBO_TX_BU_'], [/\b512\b/g, '4000']),
    );
    expect(diff.messages.map((m) => (m.after ?? m.before)!.name)).toEqual(['First', 'Engine', 'Gearbox', 'J1939_Msg']);
  });
});

describe('diffDatabases on signals', () => {
  it('reports added and removed signals where they are in the message', () => {
    const diff = diffDatabases(
      base(),
      edited(
        [' SG_ Temp : 16|8@1+ (1,-40) [-40|215] "degC" ECU2\n', ''],
        [' SG_ Mode :', ' SG_ Torque : 32|12@1+ (0.5,0) [0|2047.5] "Nm" ECU2\n SG_ Mode :'],
      ),
    );
    expect(diffLines(diff)).toEqual(['message 0x100 Engine / Temp: removed', 'message 0x100 Engine / Torque: added']);
    const engine = diff.messages.find((m) => m.before?.name === 'Engine')!;
    expect(engine.kind).toBe('changed');
    expect(engine.changes).toEqual([]);
    expect(engine.signals.map((s) => `${s.kind} ${s.name}`)).toEqual([
      'unchanged Speed',
      'removed Temp',
      'added Torque',
      'unchanged Mode',
    ]);
    expect(countChanges(diff).signals).toEqual({ added: 1, removed: 1, changed: 0, unchanged: 4 });
    expect(countChanges(diff).messages).toMatchObject({ changed: 1, unchanged: 2 });
  });

  it('reports the layout: start bit, length and byte order', () => {
    expect(lines(edited(['Speed : 0|16@1+', 'Speed : 15|12@0+']))).toEqual([
      'message 0x100 Engine / Speed: startBit 0 -> 15',
      'message 0x100 Engine / Speed: length 16 -> 12',
      'message 0x100 Engine / Speed: byteOrder "intel" -> "motorola"',
    ]);
  });

  it('reports the value type, factor, offset, range and unit', () => {
    expect(lines(edited(['Temp : 16|8@1+ (1,-40) [-40|215] "degC"', 'Temp : 16|8@1- (0.5,-50) [-50|77.5] "°C"']))).toEqual([
      'message 0x100 Engine / Temp: valueType "unsigned" -> "signed"',
      'message 0x100 Engine / Temp: factor 1 -> 0.5',
      'message 0x100 Engine / Temp: offset -40 -> -50',
      'message 0x100 Engine / Temp: min -40 -> -50',
      'message 0x100 Engine / Temp: max 215 -> 77.5',
      'message 0x100 Engine / Temp: unit "degC" -> "°C"',
    ]);
  });

  it('reports a range given where the old version left it at [0|0]', () => {
    expect(lines(edited(['[0|0] ""', '[0|3] ""']))).toEqual(['message 0x100 Engine / Mode: max 0 -> 3']);
  });

  it('reports a float signal', () => {
    expect(lines(edited([/$/, 'SIG_VALTYPE_ 256 Speed : 1;\n']))).toEqual([
      'message 0x100 Engine / Speed: valueType "unsigned" -> "float"',
    ]);
  });

  it('reports receivers, comparing them as a set', () => {
    expect(lines(edited(['"rpm" ECU2,ECU3', '"rpm" ECU3,ECU2']))).toEqual([]);
    expect(lines(edited(['"rpm" ECU2,ECU3', '"rpm" ECU1,ECU3']))).toEqual([
      'message 0x100 Engine / Speed: receivers "ECU2,ECU3" -> "ECU1,ECU3"',
    ]);
  });

  it('reports multiplexing', () => {
    expect(
      lines(edited(['SG_ Mode : 24|2@1+', 'SG_ Mode M : 24|2@1+'], ['SG_ Temp : 16|8@1+', 'SG_ Temp m1 : 16|8@1+'])),
    ).toEqual([
      'message 0x100 Engine / Temp: multiplex "none" -> "multiplexed 1"',
      'message 0x100 Engine / Mode: multiplex "none" -> "multiplexor"',
    ]);
  });

  it('reports value descriptions per raw value: added, removed and changed', () => {
    expect(lines(edited(['0 "Off" 1 "On" 2 "Error" ;', '0 "Off" 1 "Running" 3 "Fault" ;']))).toEqual([
      'message 0x100 Engine / Mode: values[1] "On" -> "Running"',
      'message 0x100 Engine / Mode: values[2] "Error" -> (none)',
      'message 0x100 Engine / Mode: values[3] (none) -> "Fault"',
    ]);
    expect(lines(edited([/^VAL_ 256.*\n/m, '']))).toEqual([
      'message 0x100 Engine / Mode: values[0] "Off" -> (none)',
      'message 0x100 Engine / Mode: values[1] "On" -> (none)',
      'message 0x100 Engine / Mode: values[2] "Error" -> (none)',
    ]);
  });

  it('writes an absent side as (none), apart from a text that reads "(none)"', () => {
    expect(lines(edited(['2 "Error" ;', '2 "(none)" 3 "(none)" ;']))).toEqual([
      'message 0x100 Engine / Mode: values[2] "Error" -> "(none)"',
      'message 0x100 Engine / Mode: values[3] (none) -> "(none)"',
    ]);
  });

  it('reports comments and attributes', () => {
    expect(
      lines(
        edited(
          ['CM_ SG_ 256 Speed "Crankshaft speed.";', 'CM_ SG_ 256 Temp "Coolant temperature.";'],
          ['BA_ "GenSigStartValue" SG_ 256 Speed 0;', 'BA_ "GenSigStartValue" SG_ 256 Speed 800;'],
        ),
      ),
    ).toEqual([
      'message 0x100 Engine / Speed: comment "Crankshaft speed." -> ""',
      'message 0x100 Engine / Speed: attr[GenSigStartValue] 0 -> 800',
      'message 0x100 Engine / Temp: comment "" -> "Coolant temperature."',
    ]);
  });

  it('counts a signal as changed once, however many of its fields changed', () => {
    const diff = diffDatabases(base(), edited(['Speed : 0|16@1+ (0.25,0)', 'Speed : 0|12@1+ (0.5,0)']));
    const speed = diff.messages[0].signals[0];
    expect(speed.kind).toBe('changed');
    expect(speed.changes.map((c) => c.field)).toEqual(['length', 'factor']);
    expect(countChanges(diff).signals).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 4 });
  });
});

describe('diffDatabases on nodes, value tables, attribute definitions and the database', () => {
  it('reports nodes added, removed and changed', () => {
    expect(
      lines(
        edited(
          ['BU_: ECU1 ECU2 ECU3', 'BU_: ECU1 ECU2 Gateway'],
          ['CM_ BU_ ECU1 "Engine control";', 'CM_ BU_ ECU1 "Engine control unit";'],
          ['BA_ "NodeAddress" BU_ ECU1 16;', 'BA_ "NodeAddress" BU_ ECU1 17;'],
        ),
      ),
    ).toEqual([
      'node ECU1: comment "Engine control" -> "Engine control unit"',
      'node ECU1: attr[NodeAddress] 16 -> 17',
      'node ECU3: removed',
      'node Gateway: added',
    ]);
  });

  it('reports value tables added, removed and changed', () => {
    expect(lines(edited(['VAL_TABLE_ OnOff 0 "Off" 1 "On" ;', 'VAL_TABLE_ OnOff 0 "Off" 1 "Active" ;\nVAL_TABLE_ Gears 0 "N" ;']))).toEqual([
      'value table OnOff: values[1] "On" -> "Active"',
      'value table Gears: added',
    ]);
    expect(lines(edited([/^VAL_TABLE_.*\n/m, '']))).toEqual(['value table OnOff: removed']);
  });

  it('reports attribute definitions added, removed and changed', () => {
    expect(
      lines(
        edited(
          ['BA_DEF_ BO_ "GenMsgCycleTime" INT 0 10000;', 'BA_DEF_ BO_ "GenMsgCycleTime" INT 0 60000;\nBA_DEF_ BO_ "GenMsgDelayTime" INT 0 1000;'],
          ['BA_DEF_DEF_ "GenMsgCycleTime" 0;', 'BA_DEF_DEF_ "GenMsgCycleTime" 100;'],
          ['BA_DEF_ SG_ "GenSigStartValue" FLOAT 0 100000;\n', ''],
        ),
      ),
    ).toEqual([
      'definition BO_ GenMsgCycleTime: max 10000 -> 60000',
      'definition BO_ GenMsgCycleTime: default 0 -> 100',
      'definition SG_ GenSigStartValue: removed',
      'definition BO_ GenMsgDelayTime: added',
    ]);
  });

  it('reports the version, the comment and network attributes', () => {
    expect(
      lines(edited(['VERSION "1.0"', 'VERSION "1.1"'], ['CM_ "Test database.";', 'CM_ "Test database, revised.";'], ['BA_ "BusType" "CAN";', 'BA_ "BusType" "CAN FD";'])),
    ).toEqual([
      'database: version "1.0" -> "1.1"',
      'database: comment "Test database." -> "Test database, revised."',
      'database: attr[BusType] "CAN" -> "CAN FD"',
    ]);
  });

  it('reports when CanViewer starts treating the database as J1939', () => {
    const j1939 = edited(['BA_DEF_ "BusType" STRING;', 'BA_DEF_ "BusType" STRING;\nBA_DEF_ "ProtocolType" STRING;'], [/$/, 'BA_ "ProtocolType" "J1939";\n']);
    const diff = diffDatabases(base(), j1939);
    expect(diffLines(diff)).toEqual([
      'database: attr[ProtocolType] (none) -> "J1939"',
      'database: j1939Database false -> true',
      'definition network ProtocolType: added',
    ]);
    expect(countChanges(diff).database).toBe(2);
    expect(countChanges(diff).attributeDefinitions).toMatchObject({ added: 1 });
  });
});

describe('diffDatabases in both directions', () => {
  type Change = { field: string; before: unknown; after: unknown };
  type Item = { kind: string; before?: { name: string }; after?: { name: string }; changes: Change[] };
  /** The diff in a form that does not depend on its direction, flipped if asked. */
  const canonical = (diff: DatabaseDiff, flip: boolean) => {
    const kind = (k: string) => (flip ? ({ added: 'removed', removed: 'added' } as Record<string, string>)[k] ?? k : k);
    const change = (c: Change) => (flip ? [c.field, c.after, c.before] : [c.field, c.before, c.after]);
    const item = (d: Item) => ({
      kind: kind(d.kind),
      pair: flip ? [d.after, d.before] : [d.before, d.after],
      changes: d.changes.map(change),
    });
    const name = (d: Item) => (d.after ?? d.before)!.name;
    return {
      database: diff.database.map(change),
      nodes: [...diff.nodes].sort((x, y) => name(x).localeCompare(name(y))).map(item),
      messages: diff.messages.map((m) => ({
        ...item(m),
        signals: [...m.signals].sort((x, y) => name(x).localeCompare(name(y))).map(item),
      })),
    };
  };

  it('gives the mirror image when the versions are swapped', () => {
    const a = base();
    const b = edited(
      ['BO_ 256 Engine: 8 ECU1', 'BO_ 256 Engine: 6 ECU1'],
      [' SG_ Temp : 16|8@1+ (1,-40) [-40|215] "degC" ECU2\n', ''],
      ['(0.25,0)', '(0.5,0)'],
      [/^BO_ 512 Gearbox.*\n.*\n/m, 'BO_ 768 Brake: 4 ECU3\n'],
      ['VERSION "1.0"', 'VERSION "2.0"'],
      ['BU_: ECU1 ECU2 ECU3', 'BU_: ECU1 ECU2 Gateway'],
    );
    const forward = diffDatabases(a, b);
    expect(diffLines(forward).length).toBeGreaterThan(5);
    expect(canonical(diffDatabases(b, a), false)).toEqual(canonical(forward, true));
  });
});

describe('the example versions', () => {
  const examples = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples');
  const example = (name: string) => parseDbc(readFileSync(join(examples, name), 'utf8'));

  it('examples/demo-v2.dbc is a later version of demo.dbc with a change of every kind', () => {
    const before = example('demo.dbc');
    const after = example('demo-v2.dbc');
    expect(after.problems).toEqual([]);
    const diff = diffDatabases(before, after);
    expect(diffLines(diff)).toEqual([
      'database: version "CanViewer Demo 1.0" -> "CanViewer Demo 1.1"',
      'definition BO_ GenMsgStartDelayTime: added',
      'node BCM: added',
      'value table GearPositions: values[7] (none) -> "Gear 7"',
      'message 0x100 EngineData / EngineSpeed: comment "Crankshaft rotational speed." -> "Crankshaft rotational speed, filtered."',
      'message 0x100 EngineData / EngineTemp: offset -40 -> -50',
      'message 0x100 EngineData / EngineTemp: min -40 -> -50',
      'message 0x100 EngineData / EngineTemp: max 215 -> 205',
      'message 0x100 EngineData / OilPressure: added',
      'message 0x200 GearboxData / GearPosition: values[7] (none) -> "Gear 7"',
      'message 0x200 GearboxData / TorqueConverterLock: removed',
      'message 0x300 BrakeData: dlc 6 -> 8',
      'message 0x300 BrakeData: attr[GenMsgCycleTime] 20 -> 10',
      'message 0x300 BrakeData / BrakeLightOn: added',
      'message 0x500 PowerData: name "PowerData" -> "BatteryData"',
      'message 0x700 BodyStatus: added',
      'message 0x0C000003 J1939_TSC1: removed',
    ]);
    expect(countChanges(diff)).toEqual({
      messages: { added: 1, removed: 1, changed: 4, unchanged: 4 },
      signals: { added: 4, removed: 3, changed: 3, unchanged: 27 },
      nodes: { added: 1, removed: 0, changed: 0, unchanged: 5 },
      valueTables: { added: 0, removed: 0, changed: 1, unchanged: 1 },
      attributeDefinitions: { added: 1, removed: 0, changed: 0, unchanged: 6 },
      database: 1,
    });
  });
});
