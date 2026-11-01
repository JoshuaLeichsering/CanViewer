// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { decomposeJ1939Id, isJ1939Database, PGN_NAMES } from './j1939';
import { parseDbc } from './parser';

describe('decomposeJ1939Id', () => {
  it('decodes a PDU2 broadcast id (EEC1)', () => {
    const j = decomposeJ1939Id(0x0cf00400);
    expect(j.priority).toBe(3);
    expect(j.extendedDataPage).toBe(0);
    expect(j.dataPage).toBe(0);
    expect(j.pduFormat).toBe(0xf0);
    expect(j.pduType).toBe('PDU2');
    expect(j.destinationAddress).toBeUndefined();
    expect(j.pgn).toBe(61444);
    expect(j.sourceAddress).toBe(0);
    expect(PGN_NAMES[j.pgn]).toContain('EEC1');
  });

  it('decodes a PDU1 destination-specific id (TSC1 from transmission to engine)', () => {
    const j = decomposeJ1939Id(0x0c000003);
    expect(j.priority).toBe(3);
    expect(j.pduFormat).toBe(0);
    expect(j.pduType).toBe('PDU1');
    expect(j.destinationAddress).toBe(0);
    expect(j.pgn).toBe(0);
    expect(j.sourceAddress).toBe(3);
  });

  it('decodes CCVS1 with priority 6', () => {
    const j = decomposeJ1939Id(0x18fef100);
    expect(j.priority).toBe(6);
    expect(j.pgn).toBe(65265);
    expect(j.sourceAddress).toBe(0);
  });

  it('includes the data page bit in the PGN', () => {
    const j = decomposeJ1939Id(0x19f00300);
    expect(j.dataPage).toBe(1);
    expect(j.pgn).toBe((1 << 16) | 0xf003);
  });
});

describe('isJ1939Database', () => {
  it('detects the network ProtocolType attribute (explicit and default)', () => {
    const explicit = parseDbc(
      ['BO_ 256 M: 8 A', 'BA_DEF_ "ProtocolType" STRING;', 'BA_ "ProtocolType" "J1939";'].join(
        '\n',
      ),
    );
    expect(isJ1939Database(explicit)).toBe(true);

    const viaDefault = parseDbc(
      ['BO_ 256 M: 8 A', 'BA_DEF_ "ProtocolType" STRING;', 'BA_DEF_DEF_ "ProtocolType" "J1939";'].join(
        '\n',
      ),
    );
    expect(isJ1939Database(viaDefault)).toBe(true);
  });

  it('detects databases with J1939 PG messages, but not plain CAN', () => {
    const withPg = parseDbc(
      [
        'BO_ 2364539904 EEC1: 8 ECM',
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";',
        'BA_ "VFrameFormat" BO_ 2364539904 3;',
      ].join('\n'),
    );
    expect(isJ1939Database(withPg)).toBe(true);

    const plain = parseDbc('BO_ 256 M: 8 A\nBO_ 2364539904 X: 8 A');
    expect(isJ1939Database(plain)).toBe(false);
  });
});
