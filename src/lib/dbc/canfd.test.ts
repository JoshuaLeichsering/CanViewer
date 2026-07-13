import { describe, expect, it } from 'vitest';
import {
  CAN_FD_SIZES,
  declaredFrameFormat,
  isCanFd,
  isJ1939Pg,
  isValidFrameSize,
  paddedFdSize,
} from './canfd';
import { parseDbc } from './parser';

const emptyDb = { attributeDefinitions: [] };

const msg = (
  dlc: number,
  vff?: string | number,
): { dlc: number; attributes: Record<string, string | number> } => ({
  dlc,
  attributes: vff === undefined ? {} : { VFrameFormat: vff },
});

describe('isCanFd', () => {
  it('uses dlc > 8 as heuristic when VFrameFormat is absent', () => {
    expect(isCanFd(emptyDb, msg(8))).toBe(false);
    expect(isCanFd(emptyDb, msg(12))).toBe(true);
    expect(isCanFd(emptyDb, msg(64))).toBe(true);
  });

  it('trusts an explicit VFrameFormat over the dlc', () => {
    expect(isCanFd(emptyDb, msg(8, 'StandardCAN_FD'))).toBe(true);
    expect(isCanFd(emptyDb, msg(8, 'ExtendedCAN_FD'))).toBe(true);
    expect(isCanFd(emptyDb, msg(64, 'StandardCAN'))).toBe(false);
    // J1939 PGs can exceed 8 bytes without being FD
    expect(isCanFd(emptyDb, msg(24, 'J1939PG'))).toBe(false);
  });

  it('understands unresolved numeric enum indexes (14/15 = FD, 3 = J1939PG, 0/1 = classic)', () => {
    expect(isCanFd(emptyDb, msg(8, 14))).toBe(true);
    expect(isCanFd(emptyDb, msg(8, 15))).toBe(true);
    expect(isCanFd(emptyDb, msg(24, 3))).toBe(false);
    expect(isCanFd(emptyDb, msg(24, 0))).toBe(false);
    expect(isJ1939Pg(emptyDb, msg(24, 3))).toBe(true);
    expect(isJ1939Pg(emptyDb, msg(24, 'J1939PG'))).toBe(true);
    expect(isJ1939Pg(emptyDb, msg(24))).toBe(false);
  });

  it('falls back to the BA_DEF_DEF_ default when no per-message BA_ exists', () => {
    // Real J1939 databases declare VFrameFormat only as a default.
    const db = parseDbc(
      [
        'BO_ 2566844926 TP_ProprietaryB: 1785 ECM',
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";',
        'BA_DEF_DEF_ "VFrameFormat" 3;',
      ].join('\n'),
    );
    const pg = db.messages[0];
    expect(pg.attributes.VFrameFormat).toBeUndefined();
    expect(declaredFrameFormat(db, pg)).toBe('j1939pg');
    expect(isJ1939Pg(db, pg)).toBe(true);
    expect(isCanFd(db, pg)).toBe(false);
  });

  it('lets an explicit BA_ value override the default', () => {
    const db = parseDbc(
      [
        'BO_ 256 FdMsg: 24 ECM',
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG","r","r","r","r","r","r","r","r","r","r","StandardCAN_FD","ExtendedCAN_FD";',
        'BA_DEF_DEF_ "VFrameFormat" 3;',
        'BA_ "VFrameFormat" BO_ 256 14;',
      ].join('\n'),
    );
    expect(declaredFrameFormat(db, db.messages[0])).toBe('fd');
    expect(isCanFd(db, db.messages[0])).toBe(true);
  });
});

describe('declaredFrameFormat', () => {
  it('recognizes explicit classic declarations', () => {
    expect(declaredFrameFormat(emptyDb, msg(13, 'StandardCAN'))).toBe('classic');
    expect(declaredFrameFormat(emptyDb, msg(13, 'ExtendedCAN'))).toBe('classic');
    expect(declaredFrameFormat(emptyDb, msg(13, 0))).toBe('classic');
    expect(declaredFrameFormat(emptyDb, msg(13))).toBeUndefined();
    expect(declaredFrameFormat(emptyDb, msg(13, 'reserved'))).toBeUndefined();
  });
});

describe('frame sizes', () => {
  it('accepts classic and FD wire sizes only', () => {
    for (const s of [0, 1, 8, ...CAN_FD_SIZES]) expect(isValidFrameSize(s)).toBe(true);
    for (const s of [9, 10, 13, 25, 63, 65, 100]) expect(isValidFrameSize(s)).toBe(false);
  });

  it('pads to the next FD size', () => {
    expect(paddedFdSize(8)).toBe(8);
    expect(paddedFdSize(9)).toBe(12);
    expect(paddedFdSize(13)).toBe(16);
    expect(paddedFdSize(24)).toBe(24);
    expect(paddedFdSize(49)).toBe(64);
    expect(paddedFdSize(65)).toBeNull();
  });
});
