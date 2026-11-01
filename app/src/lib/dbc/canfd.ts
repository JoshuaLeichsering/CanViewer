// SPDX-License-Identifier: GPL-2.0-or-later
import type { AttrValue, DbcDatabase, DbcMessage } from './types';

/** Payload sizes above 8 bytes that a CAN FD frame can carry on the wire. */
export const CAN_FD_SIZES = [12, 16, 20, 24, 32, 48, 64];

type DbLike = Pick<DbcDatabase, 'attributeDefinitions'>;
type MessageLike = Pick<DbcMessage, 'dlc' | 'attributes'>;

export type FrameFormat = 'classic' | 'fd' | 'j1939pg';

/**
 * DBC attribute semantics: an object without an explicit BA_ value falls
 * back to the BA_DEF_DEF_ default. Real J1939 databases in particular declare
 * VFrameFormat only as a default, so ignoring it breaks the PG exemption.
 */
function effectiveVFrameFormat(db: DbLike, message: MessageLike): AttrValue | undefined {
  if ('VFrameFormat' in message.attributes) return message.attributes.VFrameFormat;
  return db.attributeDefinitions.find(
    (d) => d.name === 'VFrameFormat' && d.objectType === 'BO_',
  )?.defaultValue;
}

/**
 * The frame type pinned by Vector's VFrameFormat attribute, if any (ENUM
 * indexes: 0 StandardCAN, 1 ExtendedCAN, 3 J1939PG, 14 StandardCAN_FD,
 * 15 ExtendedCAN_FD). Numeric values cover files whose BA_DEF_ is missing so
 * the enum index was never resolved to its label.
 */
export function declaredFrameFormat(db: DbLike, message: MessageLike): FrameFormat | undefined {
  const vff = effectiveVFrameFormat(db, message);
  if (typeof vff === 'string') {
    if (vff.includes('_FD')) return 'fd';
    if (vff === 'J1939PG') return 'j1939pg';
    if (vff === 'StandardCAN' || vff === 'ExtendedCAN') return 'classic';
    return undefined;
  }
  if (typeof vff === 'number') {
    if (vff === 14 || vff === 15) return 'fd';
    if (vff === 3) return 'j1939pg';
    if (vff === 0 || vff === 1) return 'classic';
  }
  return undefined;
}

/** An explicit VFrameFormat wins; otherwise a payload above 8 bytes means FD. */
export function isCanFd(db: DbLike, message: MessageLike): boolean {
  const declared = declaredFrameFormat(db, message);
  return declared !== undefined ? declared === 'fd' : message.dlc > 8;
}

/** J1939 parameter groups may legitimately exceed 8 (or even 64) bytes. */
export function isJ1939Pg(db: DbLike, message: MessageLike): boolean {
  return declaredFrameFormat(db, message) === 'j1939pg';
}

/** True if a frame of exactly `size` bytes can exist on a classic or FD bus. */
export function isValidFrameSize(size: number): boolean {
  return (size >= 0 && size <= 8) || CAN_FD_SIZES.includes(size);
}

/** Smallest FD wire size that fits `size` bytes, or null if nothing does. */
export function paddedFdSize(size: number): number | null {
  if (size <= 8) return size;
  return CAN_FD_SIZES.find((s) => s >= size) ?? null;
}
