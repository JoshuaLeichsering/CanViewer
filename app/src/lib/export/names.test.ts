import { describe, expect, it } from 'vitest';
import type { DbcSignal } from '../dbc/types';
import { cIdentifier, messageIdentifier, signalIdentifiers } from './names';

const signals = (...names: string[]) => names.map((name) => ({ name }) as DbcSignal);

describe('cIdentifier', () => {
  it('keeps names that are valid C identifiers', () => {
    expect(cIdentifier('EngineSpeed')).toBe('EngineSpeed');
    expect(cIdentifier('_private')).toBe('_private');
    expect(cIdentifier('Engine_Speed_2')).toBe('Engine_Speed_2');
  });

  it('replaces characters C does not allow', () => {
    expect(cIdentifier('Wheel.Speed-FL')).toBe('Wheel_Speed_FL');
    expect(cIdentifier('Öltemperatur')).toBe('_ltemperatur');
    expect(cIdentifier('a b')).toBe('a_b');
    expect(cIdentifier('')).toBe('unnamed');
  });

  it('prefixes names that start with a digit or a reserved underscore', () => {
    expect(cIdentifier('1stGear')).toBe('x1stGear');
    expect(cIdentifier('__init')).toBe('x__init');
    expect(cIdentifier('_Bool')).toBe('x_Bool');
  });

  it('avoids keywords, <stdint.h> names and predefined macros', () => {
    expect(cIdentifier('int')).toBe('int_');
    expect(cIdentifier('default')).toBe('default_');
    expect(cIdentifier('bool')).toBe('bool_');
    expect(cIdentifier('UINT8_MAX')).toBe('UINT8_MAX_');
    expect(cIdentifier('INT_LEAST16_MIN')).toBe('INT_LEAST16_MIN_');
    expect(cIdentifier('uint32_t')).toBe('uint32_t_');
    expect(cIdentifier('linux')).toBe('linux_');
    expect(cIdentifier('NULL')).toBe('NULL_');
  });

  it('avoids the names it is told to', () => {
    expect(cIdentifier('MSG_ID', new Set(['MSG_ID']))).toBe('MSG_ID_');
  });
});

describe('signalIdentifiers', () => {
  it('numbers repeated names', () => {
    expect(signalIdentifiers(signals('A', 'A', 'B', 'A'))).toEqual(['A', 'A_2', 'B', 'A_3']);
  });

  it('keeps sanitized names apart from each other and from existing ones', () => {
    expect(signalIdentifiers(signals('a.b', 'a_b', 'a-b'))).toEqual(['a_b', 'a_b_2', 'a_b_3']);
    expect(signalIdentifiers(signals('X_2', 'X', 'X'))).toEqual(['X_2', 'X', 'X_3']);
  });

  it('avoids reserved names', () => {
    expect(signalIdentifiers(signals('ENGINE_ID', 'ENGINE_ID'), new Set(['ENGINE_ID']))).toEqual([
      'ENGINE_ID_',
      'ENGINE_ID__2',
    ]);
  });
});

describe('messageIdentifier', () => {
  it('names the struct type after the message, never after a <stdint.h> type', () => {
    expect(messageIdentifier({ name: 'EngineData' })).toBe('EngineData');
    expect(messageIdentifier({ name: 'uint8' })).toBe('uint8_');
    expect(messageIdentifier({ name: 'int_fast16' })).toBe('int_fast16_');
  });
});
