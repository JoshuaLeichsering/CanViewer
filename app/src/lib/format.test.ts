import { describe, expect, it } from 'vitest';
import { fmtNum, hexId, muxLabel } from './format';

describe('fmtNum', () => {
  it('prints integers as they are and drops float noise', () => {
    expect(fmtNum(42)).toBe('42');
    expect(fmtNum(-40)).toBe('-40');
    expect(fmtNum(0.1 + 0.2)).toBe('0.3');
    expect(fmtNum(0.00390625)).toBe('0.00390625');
    expect(fmtNum(16383.75)).toBe('16383.75');
    expect(fmtNum(1e-12)).toBe('1e-12');
  });
});

describe('hexId', () => {
  it('pads standard ids to three digits and extended ids to eight', () => {
    expect(hexId(0x64, false)).toBe('0x064');
    expect(hexId(0x7ff, false)).toBe('0x7FF');
    expect(hexId(0xcf00400, true)).toBe('0x0CF00400');
    expect(hexId(0, true)).toBe('0x00000000');
  });
});

describe('muxLabel', () => {
  it('labels every multiplexing role as a DBC file writes it', () => {
    expect(muxLabel({ role: 'none' })).toBe('');
    expect(muxLabel({ role: 'multiplexor' })).toBe('M');
    expect(muxLabel({ role: 'multiplexed', switchValue: 3 })).toBe('m3');
    expect(muxLabel({ role: 'both', switchValue: 1 })).toBe('m1M');
  });
});
