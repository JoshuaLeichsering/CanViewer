// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from './dbc/parser';
import type { DbcSignal } from './dbc/types';
import {
  SIGNAL_COLUMNS,
  columnText,
  compileFilter,
  hasActiveFilter,
  nextSort,
  parseNumberFilter,
  signalRows,
  type SignalColumn,
} from './signal-table';

const demo = parseDbc(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo.dbc'), 'utf8'),
);
const messageNamed = (name: string) => demo.messages.find((m) => m.name === name)!;
const engine = messageNamed('EngineData');
const brake = messageNamed('BrakeData');
const diag = messageNamed('DiagData');

const names = (rows: Array<{ signal: DbcSignal }>) => rows.map((r) => r.signal.name);
const indexes = (rows: Array<{ index: number }>) => rows.map((r) => r.index);

/** A signal with neutral defaults, for edge cases demo.dbc does not have. */
function signal(overrides: Partial<DbcSignal>): DbcSignal {
  return {
    name: 'S',
    startBit: 0,
    length: 8,
    byteOrder: 'intel',
    valueType: 'unsigned',
    factor: 1,
    offset: 0,
    min: 0,
    max: 255,
    unit: '',
    receivers: [],
    multiplex: { role: 'none' },
    attributes: {},
    ...overrides,
  };
}

describe('signal table columns', () => {
  it('has the twelve columns of the signal table, in display order', () => {
    expect(SIGNAL_COLUMNS.map((c) => c.key)).toEqual([
      'name',
      'mux',
      'startBit',
      'length',
      'byteOrder',
      'valueType',
      'factor',
      'offset',
      'min',
      'max',
      'unit',
      'receivers',
    ]);
    expect(SIGNAL_COLUMNS.filter((c) => c.numeric).map((c) => c.key)).toEqual([
      'startBit',
      'length',
      'factor',
      'offset',
      'min',
      'max',
    ]);
  });

  it('shows the text each cell displays', () => {
    const speed = engine.signals[0];
    const text = (column: SignalColumn) => columnText(speed, column);
    expect(text('name')).toBe('EngineSpeed');
    expect(text('mux')).toBe('');
    expect(text('startBit')).toBe('0');
    expect(text('length')).toBe('16');
    expect(text('byteOrder')).toBe('Intel');
    expect(text('valueType')).toBe('unsigned');
    expect(text('factor')).toBe('0.25');
    expect(text('offset')).toBe('0');
    expect(text('min')).toBe('0');
    expect(text('max')).toBe('16383.75');
    expect(text('unit')).toBe('rpm');
    expect(text('receivers')).toBe('TCM, ABS, IC');
    expect(columnText(brake.signals[0], 'byteOrder')).toBe('Motorola');
    expect(diag.signals.map((s) => columnText(s, 'mux'))).toEqual(['M', 'm0', 'm1', 'm2']);
  });
});

describe('nextSort', () => {
  it('cycles a column through ascending, descending and back to file order', () => {
    const asc = nextSort(null, 'startBit');
    expect(asc).toEqual({ column: 'startBit', direction: 'ascending' });
    const desc = nextSort(asc, 'startBit');
    expect(desc).toEqual({ column: 'startBit', direction: 'descending' });
    expect(nextSort(desc, 'startBit')).toBeNull();
  });

  it('starts ascending when another column is chosen', () => {
    expect(nextSort({ column: 'name', direction: 'descending' }, 'unit')).toEqual({
      column: 'unit',
      direction: 'ascending',
    });
  });
});

describe('sorting', () => {
  it('keeps file order and each signal’s position without a sort', () => {
    const rows = signalRows(engine.signals, null, {});
    expect(names(rows)).toEqual(engine.signals.map((s) => s.name));
    expect(indexes(rows)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('sorts text columns alphabetically and keeps the original position of each signal', () => {
    const rows = signalRows(engine.signals, { column: 'name', direction: 'ascending' }, {});
    expect(names(rows)).toEqual([
      'EngineRunning',
      'EngineSpeed',
      'EngineTemp',
      'EngineTorque',
      'ThrottlePosition',
      'TorqueRequest',
    ]);
    // The index is the signal's position in the message: the number on its chip
    // and its color in the bit layout must not change when the table is sorted.
    expect(indexes(rows)).toEqual([5, 0, 1, 3, 2, 4]);

    const desc = signalRows(engine.signals, { column: 'name', direction: 'descending' }, {});
    expect(names(desc)).toEqual([...names(rows)].reverse());
  });

  it('sorts numeric columns by value, not by text', () => {
    const lengths = signalRows(engine.signals, { column: 'length', direction: 'ascending' }, {});
    expect(lengths.map((r) => r.signal.length)).toEqual([1, 8, 8, 12, 12, 16]);
    const max = signalRows(engine.signals, { column: 'max', direction: 'descending' }, {});
    expect(max.map((r) => r.signal.max)).toEqual([16383.75, 2047.5, 1023.5, 215, 100, 1]);
    const offsets = signalRows(engine.signals, { column: 'offset', direction: 'ascending' }, {});
    expect(offsets[0].signal.name).toBe('EngineTemp'); // offset -40
  });

  it('breaks ties by file order in both directions', () => {
    const asc = signalRows(engine.signals, { column: 'length', direction: 'ascending' }, {});
    expect(names(asc)).toEqual([
      'EngineRunning',
      'EngineTemp',
      'ThrottlePosition',
      'EngineTorque',
      'TorqueRequest',
      'EngineSpeed',
    ]);
    const desc = signalRows(engine.signals, { column: 'length', direction: 'descending' }, {});
    expect(names(desc)).toEqual([
      'EngineSpeed',
      'EngineTorque',
      'TorqueRequest',
      'EngineTemp',
      'ThrottlePosition',
      'EngineRunning',
    ]);
  });

  it('compares numbers inside names naturally and ignores case', () => {
    const signals = ['sig10', 'Sig2', 'sig1', 'SIG3'].map((name) => signal({ name }));
    expect(names(signalRows(signals, { column: 'name', direction: 'ascending' }, {}))).toEqual([
      'sig1',
      'Sig2',
      'SIG3',
      'sig10',
    ]);
  });

  it('puts empty cells last in either direction', () => {
    const signals = [signal({ name: 'a', unit: '' }), signal({ name: 'b', unit: 'V' }), signal({ name: 'c', unit: 'A' })];
    expect(names(signalRows(signals, { column: 'unit', direction: 'ascending' }, {}))).toEqual(['c', 'b', 'a']);
    expect(names(signalRows(signals, { column: 'unit', direction: 'descending' }, {}))).toEqual(['b', 'c', 'a']);
  });

  it('orders the multiplexor before the multiplexed signals and those by switch value', () => {
    const signals = [
      signal({ name: 'plain' }),
      signal({ name: 'm10', multiplex: { role: 'multiplexed', switchValue: 10 } }),
      signal({ name: 'm2', multiplex: { role: 'multiplexed', switchValue: 2 } }),
      signal({ name: 'mux', multiplex: { role: 'multiplexor' } }),
      signal({ name: 'm2M', multiplex: { role: 'both', switchValue: 2 } }),
    ];
    expect(names(signalRows(signals, { column: 'mux', direction: 'ascending' }, {}))).toEqual([
      'mux',
      'm2',
      'm2M',
      'm10',
      'plain',
    ]);
  });

  it('does not change the array it is given', () => {
    const before = engine.signals.map((s) => s.name);
    signalRows(engine.signals, { column: 'name', direction: 'descending' }, { unit: 'Nm' });
    expect(engine.signals.map((s) => s.name)).toEqual(before);
  });
});

describe('text filters', () => {
  it('match what the cell shows, ignoring case', () => {
    expect(names(signalRows(engine.signals, null, { name: 'torque' }))).toEqual(['EngineTorque', 'TorqueRequest']);
    expect(names(signalRows(engine.signals, null, { unit: 'NM' }))).toEqual(['EngineTorque', 'TorqueRequest']);
    expect(names(signalRows(brake.signals, null, { byteOrder: 'moto' }))).toEqual(brake.signals.map((s) => s.name));
    expect(signalRows(brake.signals, null, { byteOrder: 'intel' })).toEqual([]);
    expect(names(signalRows(diag.signals, null, { mux: 'm1' }))).toEqual(['SensorCurrent']);
    // "unsigned" contains "signed": a plain filter finds both.
    expect(signalRows(engine.signals, null, { valueType: 'signed' })).toHaveLength(6);
  });

  it('match the whole cell when they start with =', () => {
    expect(names(signalRows(engine.signals, null, { valueType: '=signed' }))).toEqual(['TorqueRequest']);
    expect(names(signalRows(engine.signals, null, { valueType: '= UNSIGNED' }))).toHaveLength(5);
    expect(names(signalRows(diag.signals, null, { mux: '=M' }))).toEqual(['MuxSelector']);
    expect(names(signalRows(diag.signals, null, { mux: '=m2' }))).toEqual(['ErrorCode']);
    expect(names(signalRows(engine.signals, null, { unit: '=' }))).toEqual(['EngineRunning']); // empty unit
  });

  it('match one receiver exactly with =', () => {
    const receivers = [
      signal({ name: 'a', receivers: ['ECM', 'IC'] }),
      signal({ name: 'b', receivers: ['ECM2'] }),
      signal({ name: 'c', receivers: [] }),
    ];
    expect(names(signalRows(receivers, null, { receivers: 'ecm' }))).toEqual(['a', 'b']);
    expect(names(signalRows(receivers, null, { receivers: '=ecm' }))).toEqual(['a']);
    expect(names(signalRows(receivers, null, { receivers: '=ic' }))).toEqual(['a']);
    expect(names(signalRows(receivers, null, { receivers: '=' }))).toEqual(['c']);
  });

  it('search the whole receiver list', () => {
    expect(names(signalRows(engine.signals, null, { receivers: 'abs' }))).toEqual(['EngineSpeed', 'EngineTorque']);
    expect(names(signalRows(engine.signals, null, { receivers: 'TCM, ABS' }))).toEqual(['EngineSpeed', 'EngineTorque']);
  });

  it('ignore surrounding white space, and an empty filter matches everything', () => {
    expect(names(signalRows(engine.signals, null, { name: '  temp ' }))).toEqual(['EngineTemp']);
    expect(signalRows(engine.signals, null, { name: '', unit: '   ' })).toHaveLength(6);
  });

  it('combine across columns: a signal must match every filter', () => {
    expect(names(signalRows(engine.signals, null, { name: 'engine', receivers: 'tcm' }))).toEqual([
      'EngineSpeed',
      'EngineTorque',
    ]);
    expect(signalRows(engine.signals, null, { name: 'engine', unit: 'bar' })).toEqual([]);
  });
});

describe('number filters', () => {
  const pick = (column: SignalColumn, text: string) => names(signalRows(engine.signals, null, { [column]: text }));

  it('take an exact value', () => {
    expect(pick('startBit', '24')).toEqual(['ThrottlePosition']);
    expect(pick('startBit', '=24')).toEqual(['ThrottlePosition']);
    expect(pick('factor', '0.5')).toEqual(['EngineTorque', 'TorqueRequest']);
    expect(pick('offset', '-40')).toEqual(['EngineTemp']);
  });

  it('take a comparison', () => {
    expect(pick('length', '>8')).toEqual(['EngineSpeed', 'EngineTorque', 'TorqueRequest']);
    expect(pick('length', '>=12')).toEqual(['EngineSpeed', 'EngineTorque', 'TorqueRequest']);
    expect(pick('length', '<8')).toEqual(['EngineRunning']);
    expect(pick('length', '<= 8')).toEqual(['EngineTemp', 'ThrottlePosition', 'EngineRunning']);
    expect(pick('length', '≥ 16')).toEqual(['EngineSpeed']);
    expect(pick('length', '≤1')).toEqual(['EngineRunning']);
    expect(pick('min', '<0')).toEqual(['EngineTemp', 'TorqueRequest']);
  });

  it('take an inclusive range, in either order', () => {
    expect(pick('startBit', '16..32')).toEqual(['EngineTemp', 'ThrottlePosition', 'EngineTorque']);
    expect(pick('startBit', '32..16')).toEqual(['EngineTemp', 'ThrottlePosition', 'EngineTorque']);
    expect(pick('offset', '-50..-30')).toEqual(['EngineTemp']);
  });

  it('accept a decimal comma and exponents', () => {
    expect(pick('factor', '0,25')).toEqual(['EngineSpeed']);
    expect(pick('max', '>1e3')).toEqual(['EngineSpeed', 'EngineTorque', 'TorqueRequest']);
  });

  it('compare without float noise', () => {
    const noisy = [signal({ name: 'n', factor: 0.1 + 0.2 })];
    expect(names(signalRows(noisy, null, { factor: '0.3' }))).toEqual(['n']);
  });

  it('are ignored and marked invalid when they cannot be read', () => {
    for (const text of ['abc', '>', '1..', '..2', '>>3', '1 2', '0x10']) {
      expect(parseNumberFilter(text), text).toBeNull();
      expect(compileFilter('length', text).valid, text).toBe(false);
      expect(pick('length', text), text).toHaveLength(6);
    }
    expect(compileFilter('length', '').valid).toBe(true);
    expect(compileFilter('name', '>>').valid).toBe(true); // text columns take any text
  });
});

describe('hasActiveFilter', () => {
  it('is true only for a filter with text in it', () => {
    expect(hasActiveFilter({})).toBe(false);
    expect(hasActiveFilter({ name: '', unit: '  ' })).toBe(false);
    expect(hasActiveFilter({ unit: 'V' })).toBe(true);
  });
});

describe('sorting and filtering together', () => {
  it('sorts what the filters leave', () => {
    const rows = signalRows(
      engine.signals,
      { column: 'startBit', direction: 'descending' },
      { receivers: 'tcm' },
    );
    expect(names(rows)).toEqual(['TorqueRequest', 'EngineTorque', 'ThrottlePosition', 'EngineSpeed']);
    expect(indexes(rows)).toEqual([4, 3, 2, 0]);
  });
});
