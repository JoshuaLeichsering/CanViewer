import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../lib/dbc/parser';
import { isJ1939Database } from '../lib/dbc/j1939';
import { messageTag } from './MessageTag';

const demo = parseDbc(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo.dbc'), 'utf8'),
);
const tagOf = (name: string) =>
  messageTag(demo, demo.messages.find((m) => m.name === name)!, isJ1939Database(demo));

describe('messageTag', () => {
  it('tags CAN FD, J1939 and plain frames in demo.dbc', () => {
    expect(tagOf('EngineData')).toBe('');
    expect(tagOf('AdasObjects')).toBe('FD');
    expect(tagOf('J1939_EEC1')).toBe('J1939');
    expect(tagOf('J1939_TSC1')).toBe('J1939');
  });

  it('falls back to EXT for extended frames outside J1939', () => {
    const db = parseDbc('VERSION ""\nBU_: A\nBO_ 2147484000 Ext: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n');
    expect(messageTag(db, db.messages[0], isJ1939Database(db))).toBe('EXT');
  });
});
