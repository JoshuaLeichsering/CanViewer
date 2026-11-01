/** A CAN trace read from a log file: the frames as they were recorded, plus what could not be read. */

export type TraceFormat = 'candump' | 'asc';

export interface TraceFrame {
  /** Line in the log file, 1-based. */
  line: number;
  /** Seconds, as the log's time stamps give them (see TraceLog.timestamps); null when the log has none. */
  time: number | null;
  /** Interface (candump, e.g. "can0") or channel number (ASC, e.g. "1"). */
  channel: string;
  /** Arbitration id without flag bits. */
  id: number;
  isExtended: boolean;
  kind: 'data' | 'remote' | 'error';
  isFd: boolean;
  /** CAN FD bit rate switch and error state indicator, where the log records them. */
  brs?: boolean;
  esi?: boolean;
  /** Received or sent, where the log records it. */
  direction?: 'rx' | 'tx';
  /** The payload; empty for remote frames and for error frames without one. */
  data: Uint8Array;
  /** Remote frames: the requested length, where the log gives it. */
  dlc?: number;
}

export type TraceProblemReason =
  /** Not a line of this log format. */
  | 'unrecognized'
  /** The identifier is not a valid CAN id. */
  | 'badId'
  /** The payload is not valid hex bytes, or too long for the frame type. */
  | 'badData'
  /** The payload has fewer bytes than the length the line states. */
  | 'lengthMismatch'
  /** The time stamp cannot be read. */
  | 'badTime';

export interface TraceProblem {
  line: number;
  text: string;
  reason: TraceProblemReason;
}

/** Lines that are understood but are not frames. */
export type TraceSkipReason =
  /** ASC header lines: date, base, internal events, Begin/End Triggerblock. */
  | 'header'
  /** ASC comments (//). */
  | 'comment'
  /** Other events: start of measurement, other buses, system variables. */
  | 'event'
  /** Controller status lines. */
  | 'status'
  /** Bus statistics. */
  | 'statistic'
  /** Transmit requests (TxRq), which echo a frame that is logged again when it is sent. */
  | 'txRequest';

export interface TraceLog {
  format: TraceFormat;
  frames: TraceFrame[];
  /** Lines that could not be read; never silently dropped. */
  problems: TraceProblem[];
  /** Lines that were understood but are not frames, by kind. */
  skipped: Partial<Record<TraceSkipReason, number>>;
  /**
   * What the time stamps mean: seconds since 1970 (`epoch`), since the start
   * of the measurement (`sinceStart`), or gaps to the previous line that were
   * summed up to time since the start (`delta`); `none` when the log has none.
   */
  timestamps: 'epoch' | 'sinceStart' | 'delta' | 'none';
  /** ASC: the measurement's start as the header writes it. */
  startedAt?: string;
}

export function emptyLog(format: TraceFormat): TraceLog {
  return { format, frames: [], problems: [], skipped: {}, timestamps: 'none' };
}

export function countSkipped(log: TraceLog, reason: TraceSkipReason): void {
  log.skipped[reason] = (log.skipped[reason] ?? 0) + 1;
}

/** Hex bytes, optionally separated by dots ("1122", "11.22"); null when not valid. */
export function parseHexPayload(text: string): Uint8Array | null {
  const clean = text.replace(/\./g, '');
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(clean)) return null;
  const data = new Uint8Array(clean.length / 2);
  for (let i = 0; i < data.length; i++) data[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return data;
}

/** Split text into lines, accepting LF and CRLF line ends. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
