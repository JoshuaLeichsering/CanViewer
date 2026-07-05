import type { DbcDatabase, DbcMessage } from './types';

/**
 * Files with duplicate message ids are invalid but occur in the wild; the raw
 * id alone is then ambiguous. The occurrence index (0-based position among
 * messages sharing the same raw id) disambiguates selections and React keys.
 */
const occCache = new WeakMap<DbcDatabase, Map<DbcMessage, number>>();

function occMap(db: DbcDatabase): Map<DbcMessage, number> {
  let map = occCache.get(db);
  if (!map) {
    map = new Map();
    const counts = new Map<number, number>();
    for (const message of db.messages) {
      const count = counts.get(message.rawId) ?? 0;
      map.set(message, count);
      counts.set(message.rawId, count + 1);
    }
    occCache.set(db, map);
  }
  return map;
}

export function occurrenceOf(db: DbcDatabase, message: DbcMessage): number {
  return occMap(db).get(message) ?? 0;
}

export function findMessageByOccurrence(
  db: DbcDatabase,
  rawId: number,
  occurrence: number,
): DbcMessage | undefined {
  let seen = 0;
  for (const message of db.messages) {
    if (message.rawId === rawId) {
      if (seen === occurrence) return message;
      seen++;
    }
  }
  return undefined;
}
