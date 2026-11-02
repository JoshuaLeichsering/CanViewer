// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDbc } from './parser';
import { dbcAddressing, notWritten, writeDbc, type DbcWriteIssue } from './writer';
import type { DbcDatabase } from './types';
import demo from '../../../../examples/demo.dbc?raw';

/** The model without the two parse diagnostics, which describe the source text. */
function model(db: DbcDatabase) {
  const { problems: _problems, skipped: _skipped, ...rest } = db;
  return rest;
}

function roundTrip(text: string) {
  const first = parseDbc(text);
  const written = writeDbc(first);
  const second = parseDbc(written.text);
  return { first, second, ...written };
}

const kinds = (issues: DbcWriteIssue[]) => issues.map((i) => `${i.kind} ${i.where} ${i.field}`);

describe('writeDbc', () => {
  it('round-trips demo.dbc to the same model, with no issues and no problems', () => {
    const { first, second, issues } = roundTrip(demo);
    expect(issues).toEqual([]);
    expect(second.problems).toEqual([]);
    expect(JSON.stringify(model(second))).toBe(JSON.stringify(model(first)));
  });

  it('writes the conventional section order', () => {
    const { text } = writeDbc(parseDbc(demo));
    const order = ['VERSION', 'NS_ :', 'BS_:', 'BU_:', 'VAL_TABLE_', 'BO_', 'BO_TX_BU_', 'CM_', 'BA_DEF_', 'BA_DEF_DEF_', 'BA_ ', 'VAL_ ', 'SIG_VALTYPE_', 'SG_MUL_VAL_'];
    const firstLine = (prefix: string) => text.split('\n').findIndex((l) => l.startsWith(prefix));
    const positions = order.map(firstLine).filter((p) => p >= 0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text.startsWith('VERSION "CanViewer Demo 1.0"\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('writes messages and signals in the usual DBC form', () => {
    const { text } = writeDbc(parseDbc(demo));
    expect(text).toContain('BO_ 256 EngineData: 8 ECM\n');
    expect(text).toContain(' SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383.75] "rpm" TCM,ABS,IC\n');
    expect(text).toContain(' SG_ TorqueRequest : 44|12@1- (0.5,0) [-1024|1023.5] "Nm" TCM\n');
    expect(text).toContain(' SG_ WheelSpeedFL : 7|16@0+ (0.01,0) [0|655.35] "km/h" IC,ECM\n');
    expect(text).toContain(' SG_ MuxSelector M : 0|8@1+ (1,0) [0|255] "" ECM\n');
    expect(text).toContain(' SG_ SensorVoltage m0 : 8|16@1+ (0.001,0) [0|65.535] "V" ECM\n');
    // An extended id keeps its flag bit; no receiver is written as Vector__XXX.
    expect(text).toContain('BO_ 2364539904 J1939_EEC1: 8 ECM\n');
    expect(text).toContain('"%" Vector__XXX\n');
  });

  it('keeps every number exactly, including ones that need an exponent', () => {
    const src = [
      'BU_: A',
      'BO_ 1 M: 8 A',
      ' SG_ S : 0|8@1+ (1e-7,-0.30000000000000004) [-1.7976931348623157e+308|5e-324] "" A',
      ' SG_ T : 8|8@1+ (0.1,0.2) [|] "" A',
    ].join('\n');
    const { first, second, issues } = roundTrip(src);
    expect(issues).toEqual([]);
    expect(second.messages[0].signals).toEqual(first.messages[0].signals);
    expect(second.messages[0].signals[0].factor).toBe(1e-7);
    expect(second.messages[0].signals[0].min).toBe(-Number.MAX_VALUE);
    expect(second.messages[0].signals[0].max).toBe(5e-324);
  });

  it('keeps extended multiplexing, float types and m<N>M signals', () => {
    const src = [
      'BU_: A',
      'BO_ 2 Mux: 8 A',
      ' SG_ Sw M : 0|8@1+ (1,0) [0|0] "" A',
      ' SG_ Sub m1M : 8|8@1+ (1,0) [0|0] "" A',
      ' SG_ Leaf m3 : 16|32@1- (1,0) [0|0] "" A',
      ' SG_ D : 0|64@1- (1,0) [0|0] "" A',
      'SG_MUL_VAL_ 2 Leaf Sub 3-3, 5-7;',
      'SIG_VALTYPE_ 2 Leaf : 1;',
      'SIG_VALTYPE_ 2 D : 2;',
    ].join('\n');
    const { first, second, issues, text } = roundTrip(src);
    expect(issues).toEqual([]);
    expect(second.messages).toEqual(first.messages);
    expect(text).toContain(' SG_ Sub m1M : 8|8@1+');
    expect(text).toContain('SG_MUL_VAL_ 2 Leaf Sub 3-3, 5-7;');
    expect(text).toContain('SIG_VALTYPE_ 2 Leaf : 1;');
    expect(text).toContain('SIG_VALTYPE_ 2 D : 2;');
  });

  it('writes a bare lowercase m multiplexor as M, which reads back the same', () => {
    const { first, second, text } = roundTrip('BO_ 3 V: 8 X\n SG_ Sel m : 0|8@1+ (1,0) [0|0] "" X\n');
    expect(first.messages[0].signals[0].multiplex).toEqual({ role: 'multiplexor' });
    expect(text).toContain(' SG_ Sel M : ');
    expect(second.messages).toEqual(first.messages);
  });

  it('escapes double quotes in comments and string attributes, and keeps line breaks', () => {
    const db = parseDbc(demo);
    db.comment = 'Say "hi"\nsecond line with a \\ backslash and \\"escaped\\" text';
    db.messages[0].comment = 'a "quoted" word';
    db.attributes.BusType = 'C"AN';
    const second = parseDbc(writeDbc(db).text);
    expect(second.comment).toBe(db.comment);
    expect(second.messages[0].comment).toBe('a "quoted" word');
    expect(second.attributes.BusType).toBe('C"AN');
    expect(writeDbc(db).issues).toEqual([]);
  });

  it('writes enum attribute values as their index, and defaults as the label', () => {
    const src = [
      'BU_: A',
      'BO_ 4 E: 8 A',
      'BA_DEF_ BO_ "Kind" ENUM "Off","On";',
      'BA_DEF_DEF_ "Kind" "Off";',
      'BA_ "Kind" BO_ 4 1;',
    ].join('\n');
    const { first, second, text, issues } = roundTrip(src);
    expect(first.messages[0].attributes.Kind).toBe('On');
    expect(text).toContain('BA_ "Kind" BO_ 4 1;');
    expect(text).toContain('BA_DEF_DEF_ "Kind" "Off";');
    expect(issues).toEqual([]);
    expect(model(second)).toEqual(model(first));
  });

  it('keeps attribute definitions of every type, with and without a range', () => {
    const src = [
      'BA_DEF_ "Net" STRING ;',
      'BA_DEF_ BU_ "Addr" HEX 0 255;',
      'BA_DEF_ BO_ "Cycle" INT 0 65535;',
      'BA_DEF_ SG_ "Gain" FLOAT -1.5 1e6;',
      'BA_DEF_ EV_ "EvOnly" INT;',
      'BA_DEF_ SG_ "Empty" ENUM ;',
      'BA_DEF_DEF_ "Cycle" 100;',
      'BA_DEF_DEF_ "Net" "";',
      'BA_ "Net" "x";',
    ].join('\n');
    const { first, second, issues } = roundTrip(src);
    expect(issues).toEqual([]);
    expect(second.attributeDefinitions).toEqual(first.attributeDefinitions);
    expect(second.attributes).toEqual({ Net: 'x' });
  });

  it('keeps value tables, value descriptions with negative keys, and empty ones', () => {
    const src = [
      'VAL_TABLE_ T 2 "two" -1 "minus one" 0 "zero" ;',
      'VAL_TABLE_ None ;',
      'BO_ 5 V: 8 X',
      ' SG_ S : 0|8@1- (1,0) [0|0] "" X',
      ' SG_ E : 8|8@1+ (1,0) [0|0] "" X',
      'VAL_ 5 S -2 "neg" 1 "one" ;',
      'VAL_ 5 E ;',
    ].join('\n');
    const { first, second, issues } = roundTrip(src);
    expect(issues).toEqual([]);
    expect(JSON.stringify(second.valueTables)).toBe(JSON.stringify(first.valueTables));
    expect(JSON.stringify(second.messages)).toBe(JSON.stringify(first.messages));
    expect(second.messages[0].signals[1].values).toEqual({});
  });

  it('keeps transmitters, node comments and node attributes', () => {
    const { first, second, issues, text } = roundTrip(demo);
    expect(issues).toEqual([]);
    expect(second.nodes).toEqual(first.nodes);
    const withTx = first.messages.filter((m) => m.transmitters.length > 0);
    for (const m of withTx) expect(text).toContain(`BO_TX_BU_ ${m.rawId} : ${m.transmitters.join(',')};`);
  });

  it('writes an empty database that reads back empty', () => {
    const { first, second, issues } = roundTrip('');
    expect(issues).toEqual([]);
    expect(model(second)).toEqual(model(first));
  });

  it('writes duplicate message ids faithfully, so the parser reports them again', () => {
    const src = 'BO_ 6 A: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] "" X\nBO_ 6 B: 8 X\n SG_ T : 0|8@1+ (1,0) [0|0] "" X\n';
    const { first, second, issues } = roundTrip(src);
    expect(issues).toEqual([]);
    expect(second.messages).toEqual(first.messages);
    expect(second.problems.map((p) => p.reason)).toEqual(first.problems.map((p) => p.reason));
  });

  describe('reports what DBC cannot hold, instead of losing it silently', () => {
    it('names that are not identifiers', () => {
      const db = parseDbc(demo);
      db.messages[0].name = 'Engine Data';
      db.messages[0].signals[0].name = 'speed-1';
      db.valueTables[0].name = 'Gear.Positions';
      expect(kinds(writeDbc(db).issues)).toEqual([
        'identifier VAL_TABLE_ Gear.Positions name',
        'identifier BO_ 256 Engine Data name',
        'identifier SG_ Engine Data.speed-1 name',
      ]);
    });

    it('double quotes and trailing backslashes in strings', () => {
      const db = parseDbc(demo);
      db.version = 'v"1';
      db.messages[0].signals[0].unit = 'r"pm';
      db.messages[0].signals[1].comment = 'ends with \\';
      expect(kinds(writeDbc(db).issues)).toEqual([
        'quote VERSION version',
        'quote SG_ EngineData.EngineSpeed unit',
        'backslash SG_ EngineData.EngineTemp comment',
      ]);
    });

    it('node names that cannot stand in a list', () => {
      const db = parseDbc(demo);
      db.messages[0].signals[0].receivers = ['TCM', 'Two Words', 'Vector__XXX'];
      db.messages[0].transmitters = [db.messages[0].sender];
      // One issue per property, however many names in it are wrong.
      expect(kinds(writeDbc(db).issues)).toEqual([
        'listName SG_ EngineData.EngineSpeed receivers',
        'listName BO_ 256 EngineData transmitters',
      ]);
    });

    it('numbers the grammar reads differently', () => {
      const db = parseDbc(demo);
      db.messages[0].dlc = 8.5;
      db.messages[0].signals[0].startBit = 512;
      db.messages[0].signals[1].length = 0;
      db.messages[3].signals[1].multiplex = { role: 'multiplexed' };
      expect(kinds(writeDbc(db).issues)).toEqual([
        'integer BO_ 256 EngineData dlc',
        'signalBits SG_ EngineData.EngineSpeed startBit',
        'signalBits SG_ EngineData.EngineTemp length',
        'integer SG_ DiagData.SensorVoltage multiplex.switchValue',
      ]);
    });

    it('an enum index that would read back as a label', () => {
      const db = parseDbc('BO_ 4 E: 8 A\nBA_DEF_ BO_ "Kind" ENUM "Off","On";\nBA_ "Kind" BO_ 4 1;\n');
      db.messages[0].attributes.Kind = 0;
      expect(kinds(writeDbc(db).issues)).toEqual(['enumIndex BO_ 4 E attributes.Kind']);
    });

    it('an enum value read before its definition, which stays a number', () => {
      // The parser resolves BA_ values with the definitions it has seen so far.
      const db = parseDbc('BO_ 4 E: 8 A\nBA_ "Kind" BO_ 4 1;\nBA_DEF_ BO_ "Kind" ENUM "Off","On";\n');
      expect(db.messages[0].attributes.Kind).toBe(1);
      expect(kinds(writeDbc(db).issues)).toEqual(['enumIndex BO_ 4 E attributes.Kind']);
    });

    it('properties of a second signal with the same name, which no statement can address', () => {
      const db = parseDbc('BO_ 7 D: 8 X\n SG_ S : 0|8@1+ (1,0) [0|0] "" X\n SG_ S : 8|8@1+ (1,0) [0|0] "" X\n');
      db.messages[0].signals[1].comment = 'second';
      const { issues, text } = writeDbc(db);
      expect(kinds(issues)).toEqual(['ambiguous SG_ D.S comment']);
      expect(text).not.toContain('"second"');
    });
  });
});

/** Statements CanViewer recognizes but does not model, and a CM_ for a signal the file does not define. */
const UNMODELED = [
  'VERSION ""',
  'NS_ :',
  '\tCM_',
  'BS_:',
  'BU_: A B',
  'BO_ 1 M: 8 A',
  ' SG_ S : 0|8@1+ (1,0) [0|255] "" B',
  'EV_ Env: 0 [0|1] "" 0 1 DUMMY_NODE_VECTOR0 Vector__XXX;',
  'CM_ SG_ 1 Ghost "dangling";',
  'BA_DEF_REL_ BU_SG_REL_ "Timeout" INT 0 100;',
  'BA_REL_ "Timeout" BU_SG_REL_ A SG_ 1 S 5;',
  'BA_REL_ "Timeout" BU_SG_REL_ B SG_ 1 S 6;',
  'SIG_GROUP_ 1 Group 1 : S;',
  '',
].join('\n');

describe('notWritten', () => {
  it('is empty for a file the model holds in full', () => {
    expect(notWritten(parseDbc(demo))).toEqual({ skipped: [], problems: 0 });
  });

  it('lists the statements CanViewer does not model and counts the lines it could not use', () => {
    const db = parseDbc(UNMODELED);
    expect(db.skipped).toEqual({ NS_: 1, BS_: 1, EV_: 1, BA_DEF_REL_: 1, BA_REL_: 2, SIG_GROUP_: 1 });
    expect(db.problems.map((p) => p.reason)).toEqual(['CM_ SG_ references unknown signal']);
    expect(notWritten(db)).toEqual({
      skipped: [
        ['EV_', 1],
        ['BA_DEF_REL_', 1],
        ['BA_REL_', 2],
        ['SIG_GROUP_', 1],
      ],
      problems: 1,
    });
  });

  it('is what the written file lacks: the rest of the model round-trips, and writing again loses nothing more', () => {
    const first = parseDbc(UNMODELED);
    const { text, issues } = writeDbc(first);
    expect(issues).toEqual([]);
    for (const keyword of ['EV_ ', 'BA_DEF_REL_ ', 'BA_REL_ ', 'SIG_GROUP_ ', 'Ghost']) expect(text).not.toContain(keyword);
    const second = parseDbc(text);
    expect({ ...second, problems: first.problems, skipped: first.skipped }).toEqual(first);
    expect(notWritten(second)).toEqual({ skipped: [], problems: 0 });
  });

  it('does not count a duplicate message id, whose message is kept and written', () => {
    const db = parseDbc('BO_ 1 First: 8 A\nBO_ 1 Second: 8 A\n');
    // Pins the parser wording that notWritten recognizes.
    expect(db.problems.map((p) => p.reason)).toEqual(['duplicate message id 1 — comments/attributes attach to the first definition']);
    expect(notWritten(db)).toEqual({ skipped: [], problems: 0 });
    expect(writeDbc(db).text).toContain('BO_ 1 First: 8 A\n\nBO_ 1 Second: 8 A\n');
  });

  it('counts what an import reports, which the model does not hold either', () => {
    const db = parseDbc(demo);
    db.skipped = { EV_: 2, SIG_GROUP_: 1 };
    db.problems = [{ line: 12, text: 'canmatrix could not read this line', reason: 'canmatrix warning' }];
    expect(notWritten(db)).toEqual({
      skipped: [
        ['EV_', 2],
        ['SIG_GROUP_', 1],
      ],
      problems: 1,
    });
  });
});

describe('dbcAddressing', () => {
  it('addresses the first message with an id and the first signal with a name, as the parser attaches statements', () => {
    const db = parseDbc(
      'BO_ 1 First: 8 A\n SG_ S : 0|8@1+ (1,0) [0|0] "" A\n SG_ S : 8|8@1+ (1,0) [0|0] "" A\n SG_ T : 16|8@1+ (1,0) [0|0] "" A\n' +
        'BO_ 1 Second: 8 A\n SG_ U : 0|8@1+ (1,0) [0|0] "" A\nBO_ 2 Other: 8 A\n',
    );
    const addressable = dbcAddressing(db);
    const [first, second, other] = db.messages;
    expect([first, second, other].map((m) => addressable(m))).toEqual([true, false, true]);
    expect(first.signals.map((s) => addressable(first, s))).toEqual([true, false, true]);
    expect(addressable(second, second.signals[0])).toBe(false);
  });
});
