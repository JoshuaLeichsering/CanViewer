import { describe, expect, it } from 'vitest';
import { parseDbc } from './parser';
import { writeDbc } from './writer';
import {
  editMessage,
  editSignal,
  messageDraft,
  parseNumber,
  receiverOptions,
  replaceMessage,
  replaceSignal,
  signalDraft,
} from './edit';
import demo from '../../../../examples/demo.dbc?raw';

const fresh = () => parseDbc(demo);
const byName = (db: ReturnType<typeof fresh>, name: string) => db.messages.find((m) => m.name === name)!;

describe('message edits', () => {
  it('an untouched draft gives back the identical message', () => {
    const db = fresh();
    for (const message of db.messages) {
      const result = editMessage(db, message, messageDraft(message));
      expect(result.errors).toEqual({});
      expect(result.value).toEqual(message);
    }
  });

  it('applies name, id, DLC, sender and comment, and writes them out', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const draft = { ...messageDraft(engine), name: 'EngineData2', id: '0x123', dlc: '6', sender: 'TCM', comment: 'New "comment"' };
    const { errors, value } = editMessage(db, engine, draft);
    expect(errors).toEqual({});
    expect(value).toMatchObject({ name: 'EngineData2', id: 0x123, rawId: 0x123, isExtended: false, dlc: 6, sender: 'TCM', comment: 'New "comment"' });

    const edited = replaceMessage(db, engine, value!);
    expect(edited.messages).toHaveLength(db.messages.length);
    expect(edited.messages[db.messages.indexOf(engine)]).toBe(value);
    expect(db.messages[0].name).toBe('EngineData'); // the original database is untouched

    const { text, issues } = writeDbc(edited);
    expect(issues).toEqual([]);
    expect(text).toContain('BO_ 291 EngineData2: 6 TCM');
    const reread = byName(parseDbc(text), 'EngineData2');
    expect(reread).toEqual(value);
  });

  it('makes an id extended by setting the flag bit in the raw id', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const { errors, value } = editMessage(db, engine, { ...messageDraft(engine), id: '0x18FF1234', extended: true });
    expect(errors).toEqual({});
    expect(value).toMatchObject({ id: 0x18ff1234, rawId: 0x18ff1234 + 0x80000000, isExtended: true });
  });

  it('accepts decimal ids', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    expect(editMessage(db, engine, { ...messageDraft(engine), id: '1000' }).value?.id).toBe(1000);
  });

  it('rejects what DBC or the database cannot hold', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const base = messageDraft(engine);
    const err = (patch: Partial<typeof base>) => editMessage(db, engine, { ...base, ...patch }).errors;
    expect(err({ name: '' })).toEqual({ name: { key: 'edtErrRequired' } });
    expect(err({ name: 'Engine Data' })).toEqual({ name: { key: 'edtErrIdentifier' } });
    expect(err({ name: '1Engine' })).toEqual({ name: { key: 'edtErrIdentifier' } });
    expect(err({ name: 'GearboxData' })).toEqual({ name: { key: 'edtErrMessageNameTaken', params: { name: 'GearboxData' } } });
    expect(err({ id: 'zz' })).toEqual({ id: { key: 'edtErrId' } });
    expect(err({ id: '0x800' })).toEqual({ id: { key: 'edtErrIdRange', params: { bits: 11, max: '0x7FF' } } });
    expect(err({ id: '0x20000000', extended: true })).toEqual({ id: { key: 'edtErrIdRange', params: { bits: 29, max: '0x1FFFFFFF' } } });
    expect(err({ id: '0x200' })).toEqual({ id: { key: 'edtErrIdTaken', params: { name: 'GearboxData' } } });
    expect(err({ dlc: '-1' })).toEqual({ dlc: { key: 'edtErrDlc' } });
    expect(err({ dlc: '2000' })).toEqual({ dlc: { key: 'edtErrDlc' } });
    expect(err({ dlc: '7.5' })).toEqual({ dlc: { key: 'edtErrDlc' } });
    expect(err({ comment: 'C:\\temp\\' })).toEqual({ comment: { key: 'edtErrBackslash' } });
  });

  it('keeps a raw id the editor could not produce, as long as the id is not touched', () => {
    // VECTOR__INDEPENDENT_SIG_MSG-style raw ids carry more than the extended flag.
    const db = parseDbc('BO_ 3221225472 VECTOR__INDEPENDENT_SIG_MSG: 0 Vector__XXX\n');
    const message = db.messages[0];
    const { errors, value } = editMessage(db, message, { ...messageDraft(message), comment: 'kept' });
    expect(errors).toEqual({});
    expect(value).toMatchObject({ rawId: 3221225472, id: 0x40000000, isExtended: true, comment: 'kept' });
  });

  it('removes an empty comment, and drops the new sender from the extra transmitters', () => {
    const db = parseDbc('BU_: A B C\nBO_ 1 M: 8 A\nBO_TX_BU_ 1 : B,C;\nCM_ BO_ 1 "old";\n');
    const message = db.messages[0];
    const { value } = editMessage(db, message, { ...messageDraft(message), comment: '', sender: 'B' });
    expect(value).not.toHaveProperty('comment');
    expect(value?.sender).toBe('B');
    expect(value?.transmitters).toEqual(['C']);
    expect(writeDbc(replaceMessage(db, message, value!)).issues).toEqual([]);
  });

  it('a sender of "(none)" writes as Vector__XXX', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const { value } = editMessage(db, engine, { ...messageDraft(engine), sender: '' });
    expect(writeDbc(replaceMessage(db, engine, value!)).text).toContain('BO_ 256 EngineData: 8 Vector__XXX');
  });
});

describe('signal edits', () => {
  it('an untouched draft gives back the identical signal', () => {
    const db = fresh();
    for (const message of db.messages) {
      for (const signal of message.signals) {
        const result = editSignal(message, signal, signalDraft(signal));
        expect(result.errors).toEqual({});
        expect(result.value).toEqual(signal);
      }
    }
  });

  it('applies every property and writes it out', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const speed = engine.signals[0];
    const draft = {
      ...signalDraft(speed),
      name: 'EngineRpm',
      startBit: '8',
      length: '12',
      byteOrder: 'motorola' as const,
      valueType: 'signed' as const,
      factor: '0,5',
      offset: '-10',
      min: '-1e3',
      max: '1000.25',
      unit: 'U/min',
      receivers: ['IC'],
      comment: 'Edited.',
    };
    const { errors, value } = editSignal(engine, speed, draft);
    expect(errors).toEqual({});
    expect(value).toMatchObject({
      name: 'EngineRpm', startBit: 8, length: 12, byteOrder: 'motorola', valueType: 'signed',
      factor: 0.5, offset: -10, min: -1000, max: 1000.25, unit: 'U/min', receivers: ['IC'], comment: 'Edited.',
    });

    const edited = replaceSignal(db, engine, speed, value!);
    expect(edited.message.signals[0]).toBe(value);
    expect(edited.db.messages).toContain(edited.message);
    const { text, issues } = writeDbc(edited.db);
    expect(issues).toEqual([]);
    expect(text).toContain(' SG_ EngineRpm : 8|12@0- (0.5,-10) [-1000|1000.25] "U/min" IC');
    expect(byName(parseDbc(text), 'EngineData').signals[0]).toEqual(value);
  });

  it('writes float and double types through SIG_VALTYPE_', () => {
    const db = fresh();
    const power = byName(db, 'PowerData');
    const voltage = power.signals[0];
    const { errors, value } = editSignal(power, voltage, { ...signalDraft(voltage), valueType: 'float' });
    expect(errors).toEqual({});
    const { text } = writeDbc(replaceSignal(db, power, voltage, value!).db);
    expect(text).toContain(`SIG_VALTYPE_ ${power.rawId} BatteryVoltage : 1;`);
  });

  it('renaming a switch signal renames it in the extended multiplexing of its message', () => {
    const db = parseDbc(
      'BO_ 2 Mux: 8 A\n SG_ Sw M : 0|8@1+ (1,0) [0|0] "" A\n SG_ Leaf m3 : 8|8@1+ (1,0) [0|0] "" A\nSG_MUL_VAL_ 2 Leaf Sw 3-3;\n',
    );
    const message = db.messages[0];
    const { value } = editSignal(message, message.signals[0], { ...signalDraft(message.signals[0]), name: 'Selector' });
    const edited = replaceSignal(db, message, message.signals[0], value!);
    expect(edited.message.signals[1].multiplex.extended?.switchName).toBe('Selector');
    expect(writeDbc(edited.db).text).toContain('SG_MUL_VAL_ 2 Leaf Selector 3-3;');
  });

  it('rejects what DBC or the message cannot hold', () => {
    const db = fresh();
    const engine = byName(db, 'EngineData');
    const speed = engine.signals[0];
    const base = signalDraft(speed);
    const err = (patch: Partial<typeof base>) => editSignal(engine, speed, { ...base, ...patch }).errors;
    expect(err({ name: 'Engine-Speed' })).toEqual({ name: { key: 'edtErrIdentifier' } });
    expect(err({ name: 'EngineTemp' })).toEqual({ name: { key: 'edtErrSignalNameTaken', params: { name: 'EngineTemp' } } });
    expect(err({ startBit: '512' })).toEqual({ startBit: { key: 'edtErrStartBit' } });
    expect(err({ startBit: '' })).toEqual({ startBit: { key: 'edtErrStartBit' } });
    expect(err({ length: '0' })).toEqual({ length: { key: 'edtErrLength' } });
    expect(err({ length: '513' })).toEqual({ length: { key: 'edtErrLength' } });
    expect(err({ factor: '' })).toEqual({ factor: { key: 'edtErrNumber' } });
    expect(err({ offset: 'abc' })).toEqual({ offset: { key: 'edtErrNumber' } });
    expect(err({ max: 'Infinity' })).toEqual({ max: { key: 'edtErrNumber' } });
    expect(err({ unit: 'in"' })).toEqual({ unit: { key: 'edtErrQuote' } });
    expect(err({ unit: 'a\\' })).toEqual({ unit: { key: 'edtErrBackslash' } });
    expect(err({ comment: 'x\\' })).toEqual({ comment: { key: 'edtErrBackslash' } });
    expect(err({ valueType: 'float' })).toEqual({ length: { key: 'edtErrFloatLength', params: { type: 'float', n: 32 } } });
    expect(err({ valueType: 'double', length: '32' })).toEqual({ length: { key: 'edtErrFloatLength', params: { type: 'double', n: 64 } } });
  });

  it('offers the database nodes as receivers, plus any receiver the file names without defining it', () => {
    const db = parseDbc('BU_: A B\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|0] "" B,Ghost\n');
    expect(receiverOptions(db, db.messages[0].signals[0])).toEqual(['A', 'B', 'Ghost']);
  });
});

describe('parseNumber', () => {
  it('reads what people type, a decimal comma included', () => {
    expect(parseNumber('0.25')).toBe(0.25);
    expect(parseNumber(' -40 ')).toBe(-40);
    expect(parseNumber('1e-7')).toBe(1e-7);
    expect(parseNumber('0,5')).toBe(0.5);
    expect(parseNumber('-1,25e3')).toBe(-1250);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('1,000.5')).toBeNull();
    expect(parseNumber('NaN')).toBeNull();
    expect(parseNumber('-Infinity')).toBeNull();
  });
});
