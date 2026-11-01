// SPDX-License-Identifier: GPL-2.0-or-later
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import { isCanFd, isJ1939Pg } from '../lib/dbc/canfd';

/**
 * The one tag a message gets in lists and tables, most specific first:
 * FD for CAN FD frames, J1939 for parameter groups (declared, or any extended
 * frame in a J1939 database), EXT for other extended frames.
 */
export function messageTag(db: DbcDatabase, message: DbcMessage, j1939Db: boolean): string {
  if (isCanFd(db, message)) return 'FD';
  if (isJ1939Pg(db, message) || (j1939Db && message.isExtended)) return 'J1939';
  return message.isExtended ? 'EXT' : '';
}

export function MessageTag({ tag }: { tag: string }) {
  return tag ? <span className="tag">{tag}</span> : null;
}
