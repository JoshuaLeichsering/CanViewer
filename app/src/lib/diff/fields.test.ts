import { describe, expect, it } from 'vitest';
import { parseDbc } from '../dbc/parser';
import { attributeChanges, muxText, same, signalChanges, valueChanges } from './fields';

const signal = (line: string) => parseDbc(`BU_: A B\nBO_ 1 M: 8 A\n${line}\n`).messages[0].signals[0];

describe('the shared field comparison', () => {
  it('treats float noise as equal, and nothing else', () => {
    expect(same(0.1 + 0.2, 0.3)).toBe(true);
    expect(same(0.25, 0.2500001)).toBe(false);
    expect(same('1', 1)).toBe(false);
    expect(same(undefined, undefined)).toBe(true);
  });

  it('compares min and max unless asked to leave a [0|0] range alone', () => {
    const unset = signal(' SG_ S : 0|8@1+ (1,0) [0|0] "" B');
    const ranged = signal(' SG_ S : 0|8@1+ (1,0) [0|255] "" B');
    expect(signalChanges(unset, ranged)).toEqual([{ field: 'max', before: 0, after: 255 }]);
    expect(signalChanges(unset, ranged, { zeroRangeUnset: true })).toEqual([]);
    expect(signalChanges(ranged, unset, { zeroRangeUnset: true })).toEqual([{ field: 'max', before: 255, after: 0 }]);
  });

  it('compares value descriptions one by one, or as counts when one side has none', () => {
    expect(valueChanges({ 0: 'Off', 1: 'On ' }, { 1: 'On', 2: 'Error' })).toEqual([
      { field: 'values[0]', before: 'Off', after: undefined },
      { field: 'values[2]', before: undefined, after: 'Error' },
    ]);
    expect(valueChanges({ 0: 'Off' }, {}, { valueCountWhenOneSideEmpty: true })).toEqual([
      { field: 'values', before: 1, after: 0 },
    ]);
    expect(valueChanges({}, {}, { valueCountWhenOneSideEmpty: true })).toEqual([]);
  });

  it('compares attributes by name, sorted, naming the attribute', () => {
    expect(attributeChanges({ B: 1, A: 'x' }, { A: 'y', C: 2 })).toEqual([
      { field: 'attr[A]', before: 'x', after: 'y', attribute: 'A' },
      { field: 'attr[B]', before: 1, after: undefined, attribute: 'B' },
      { field: 'attr[C]', before: undefined, after: 2, attribute: 'C' },
    ]);
  });

  it('writes multiplexing as one comparable text', () => {
    expect(muxText({ role: 'none' })).toBe('none');
    expect(muxText({ role: 'multiplexed', switchValue: 3 })).toBe('multiplexed 3');
    expect(muxText({ role: 'both', switchValue: 1, extended: { switchName: 'Sw', ranges: [[1, 2], [5, 5]] } })).toBe(
      'both 1 by Sw [1-2, 5-5]',
    );
  });
});
