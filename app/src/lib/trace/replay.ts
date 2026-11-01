import { decodeFrame, type DecodedSignal } from '../dbc/bits';
import { isJ1939Pg } from '../dbc/canfd';
import { decomposeJ1939Id, isJ1939Database } from '../dbc/j1939';
import type { DbcDatabase, DbcMessage } from '../dbc/types';
import type { TraceFrame, TraceLog } from './types';

/**
 * Replaying a trace through a database: every frame is matched to the
 * database's message for its id, and decoded on demand with the decoder that
 * the message view uses (decodeFrame), all in this browser tab.
 */

export interface ReplayRow {
  /** Position in the log, 0-based. */
  index: number;
  frame: TraceFrame;
  /** Seconds since the first time stamp of the log; null when the log has none. */
  time: number | null;
  /** Seconds since the previous frame with the same id on the same channel. */
  delta: number | null;
  message?: DbcMessage;
  /** How the message was found: by the exact id, or (J1939) by the parameter group number. */
  matchedBy?: 'id' | 'pgn';
}

export interface Replay {
  rows: ReplayRow[];
  /** The first time stamp, as the log gives it; null when the log has none. */
  start: number | null;
  /** Seconds from the first to the last time stamp. */
  duration: number | null;
  frames: number;
  /** Data frames matched to a message of the database. */
  matchedFrames: number;
  /** Distinct ids of data and remote frames, and how many of them the database does not know. */
  ids: number;
  unknownIds: number;
  remoteFrames: number;
  errorFrames: number;
}

const idKey = (isExtended: boolean, id: number) => (isExtended ? `x${id}` : `s${id}`);

/**
 * Match a log's frames to a database. A frame takes the first message with
 * its id. An extended frame without one, in a J1939 database, takes the
 * message of its parameter group: J1939 ids also carry the priority and the
 * source (and for PDU1 the destination) address, which change from bus to bus.
 */
export function replayTrace(db: DbcDatabase, log: TraceLog): Replay {
  const byId = new Map<string, DbcMessage>();
  const byPgn = new Map<number, DbcMessage>();
  const j1939 = isJ1939Database(db);
  for (const message of db.messages) {
    const key = idKey(message.isExtended, message.id);
    if (!byId.has(key)) byId.set(key, message);
    if (message.isExtended && (j1939 || isJ1939Pg(db, message))) {
      const pgn = decomposeJ1939Id(message.id).pgn;
      if (!byPgn.has(pgn)) byPgn.set(pgn, message);
    }
  }

  const first = log.frames.find((f) => f.time !== null);
  const start = first ? first.time : null;
  let last: number | null = null;
  const previous = new Map<string, number>();
  const ids = new Set<string>();
  const unknown = new Set<string>();
  let matchedFrames = 0;
  let remoteFrames = 0;
  let errorFrames = 0;

  const rows = log.frames.map((frame, index): ReplayRow => {
    const row: ReplayRow = { index, frame, time: null, delta: null };
    if (frame.time !== null && start !== null) {
      row.time = frame.time - start;
      last = frame.time;
    }
    if (frame.kind === 'error') {
      errorFrames++;
      return row;
    }
    if (frame.kind === 'remote') remoteFrames++;

    const key = idKey(frame.isExtended, frame.id);
    ids.add(key);
    const exact = byId.get(key);
    const pgn = !exact && frame.isExtended && byPgn.size > 0 ? byPgn.get(decomposeJ1939Id(frame.id).pgn) : undefined;
    if (exact || pgn) {
      row.message = exact ?? pgn;
      row.matchedBy = exact ? 'id' : 'pgn';
      if (frame.kind === 'data') matchedFrames++;
    } else {
      unknown.add(key);
    }

    if (frame.time !== null) {
      const channelKey = `${frame.channel} ${key}`;
      const before = previous.get(channelKey);
      if (before !== undefined) row.delta = frame.time - before;
      previous.set(channelKey, frame.time);
    }
    return row;
  });

  return {
    rows,
    start,
    duration: start !== null && last !== null ? last - start : null,
    frames: rows.length,
    matchedFrames,
    ids: ids.size,
    unknownIds: unknown.size,
    remoteFrames,
    errorFrames,
  };
}

/** The decoded signals of a data frame with a message; null otherwise. Bits beyond the frame's bytes are not decoded. */
export function decodeRow(row: ReplayRow): DecodedSignal[] | null {
  if (!row.message || row.frame.kind !== 'data') return null;
  return decodeFrame(row.message.signals, row.frame.data);
}

/** The frame's id as the trace table shows it: three hex digits for standard ids, eight for extended ones. */
export function traceIdHex(frame: Pick<TraceFrame, 'id' | 'isExtended'>): string {
  return frame.id.toString(16).toUpperCase().padStart(frame.isExtended ? 8 : 3, '0');
}

const haystacks = new WeakMap<DbcMessage, string>();

/** Search: the message name, any of its signal names, or the hex id (with or without 0x). */
export function rowMatches(row: ReplayRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const id = traceIdHex(row.frame).toLowerCase();
  if (id.includes(q.replace(/^0x/, ''))) return true;
  if (!row.message) return false;
  let hay = haystacks.get(row.message);
  if (hay === undefined) {
    hay = [row.message.name, ...row.message.signals.map((s) => s.name)].join('\n').toLowerCase();
    haystacks.set(row.message, hay);
  }
  return hay.includes(q);
}
