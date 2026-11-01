import { emptyLog, parseHexPayload, splitLines, type TraceFrame, type TraceLog, type TraceProblemReason } from './types';

/**
 * Reader for SocketCAN candump logs (can-utils), in both of candump's formats:
 *
 * - log files (candump -l, -L): `(1793520000.000000) can0 100#401F82322CC1FE01`,
 *   with `123#R` for remote frames and `123##1AABB` for CAN FD (the digit
 *   after ## holds the flags: 1 = BRS, 2 = ESI);
 * - screen output: `  can0  100   [8]  40 1F 82 32 2C C1 FE 01`, optionally
 *   with a time stamp from -ta, -tz, -td or -tA in front, and with -x's
 *   direction and flag columns. A two-digit length (`[08]`) marks CAN FD.
 *
 * Ids with three digits are standard, with eight extended; SocketCAN marks
 * error frames with CAN_ERR_FLAG in an eight-digit id.
 */

const CAN_ERR_FLAG = 0x20000000;
const CAN_EFF_MASK = 0x1fffffff;

const LOG_LINE = /^\s*\(([^)]*)\)\s+(\S+)\s+([^\s#]+)(##?)(\S*)(?:\s+([RT]))?\s*$/;
const SCREEN_LINE =
  /^\s*(?:\(([^)]*)\)\s+)?(\S+)\s+(?:(RX|TX)\s+([B-])\s+([E-])\s+)?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})\s+\[(\d{1,2})\]\s*(.*)$/;

class LineProblem extends Error {
  constructor(readonly reason: TraceProblemReason) {
    super(reason);
  }
}

/** The id field: standard (3 digits), extended (8 digits) or an error frame's error class. */
function parseId(text: string): Pick<TraceFrame, 'id' | 'isExtended' | 'kind'> {
  if (!/^[0-9A-Fa-f]+$/.test(text) || (text.length !== 3 && text.length !== 8)) throw new LineProblem('badId');
  const raw = parseInt(text, 16);
  if (text.length === 3) {
    if (raw > 0x7ff) throw new LineProblem('badId');
    return { id: raw, isExtended: false, kind: 'data' };
  }
  if (raw & CAN_ERR_FLAG) return { id: raw & CAN_EFF_MASK, isExtended: false, kind: 'error' };
  if (raw > CAN_EFF_MASK) throw new LineProblem('badId');
  return { id: raw, isExtended: true, kind: 'data' };
}

interface Stamp {
  seconds: number;
  /** Seconds since 1970, rather than a short time since the start or since the previous frame. */
  epoch: boolean;
}

function parseStamp(text: string): Stamp {
  if (/^\d+\.\d+$/.test(text)) {
    const seconds = Number(text);
    return { seconds, epoch: seconds >= 1e8 };
  }
  // candump -tA: a local date and time.
  const d = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)$/.exec(text.trim());
  if (d) {
    const whole = Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) / 1000;
    return { seconds: whole + Number(`0.${d[7]}`), epoch: true };
  }
  throw new LineProblem('badTime');
}

/** A `#` / `##` payload of the log format. */
function logPayload(frame: TraceFrame, separator: string, payload: string): void {
  if (separator === '##') {
    const flags = parseInt(payload[0] ?? '', 16);
    const data = parseHexPayload(payload.slice(1));
    if (Number.isNaN(flags) || !data || data.length > 64) throw new LineProblem('badData');
    frame.isFd = true;
    frame.brs = (flags & 1) !== 0;
    frame.esi = (flags & 2) !== 0;
    frame.data = data;
    return;
  }
  if (frame.kind !== 'error' && /^[Rr]/.test(payload)) {
    // R, optionally followed by the requested length and a len8_dlc suffix.
    const remote = /^[Rr](\d)?(?:_[0-9A-Fa-f])?$/.exec(payload);
    if (!remote) throw new LineProblem('badData');
    frame.kind = 'remote';
    if (remote[1] !== undefined) frame.dlc = Number(remote[1]);
    return;
  }
  // An optional `_<dlc>` suffix records a classic DLC above 8 (len8_dlc); the payload stays 8 bytes.
  const data = parseHexPayload(payload.replace(/_[0-9A-Fa-f]$/, ''));
  if (!data || data.length > 8) throw new LineProblem('badData');
  frame.data = data;
}

/** The bytes, remote marker and error marker after `[len]` in screen output. */
function screenPayload(frame: TraceFrame, length: number, rest: string): void {
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens[0] === 'remote' && tokens[1] === 'request') {
    frame.kind = 'remote';
    frame.dlc = length;
    return;
  }
  if (length > 64) throw new LineProblem('badData');
  const bytes: number[] = [];
  for (const token of tokens.slice(0, length)) {
    if (!/^[0-9A-Fa-f]{2}$/.test(token)) break;
    bytes.push(parseInt(token, 16));
  }
  if (bytes.length < length) {
    // Fewer bytes before the end, an error marker or -a's ASCII column: the payload is short.
    const next = tokens[bytes.length];
    const short = next === undefined || next === 'ERRORFRAME' || next.startsWith("'");
    throw new LineProblem(short ? 'lengthMismatch' : 'badData');
  }
  frame.data = Uint8Array.from(bytes);
  if (tokens.slice(length).includes('ERRORFRAME')) frame.kind = 'error';
}

export function parseCandump(text: string): TraceLog {
  const log = emptyLog('candump');
  const stamps = new Map<TraceFrame, Stamp>();

  splitLines(text).forEach((content, index) => {
    const line = index + 1;
    if (content.trim() === '') return;
    try {
      const logLine = LOG_LINE.exec(content);
      if (logLine) {
        const [, stamp, channel, id, separator, payload, mark] = logLine;
        const frame: TraceFrame = { line, time: null, channel, ...parseId(id), isFd: false, data: new Uint8Array(0) };
        const parsedStamp = parseStamp(stamp);
        logPayload(frame, separator, payload);
        if (mark) frame.direction = mark === 'R' ? 'rx' : 'tx';
        stamps.set(frame, parsedStamp);
        log.frames.push(frame);
        return;
      }
      const screen = SCREEN_LINE.exec(content);
      if (screen) {
        const [, stamp, channel, dir, brs, esi, id, lengthText, rest] = screen;
        const length = Number(lengthText);
        const frame: TraceFrame = {
          line,
          time: null,
          channel,
          ...parseId(id),
          isFd: lengthText.length === 2 || length > 8,
          data: new Uint8Array(0),
        };
        const parsedStamp = stamp !== undefined ? parseStamp(stamp) : undefined;
        if (dir) frame.direction = dir === 'RX' ? 'rx' : 'tx';
        if (dir && frame.isFd) {
          frame.brs = brs === 'B';
          frame.esi = esi === 'E';
        }
        screenPayload(frame, length, rest);
        if (parsedStamp) stamps.set(frame, parsedStamp);
        log.frames.push(frame);
        return;
      }
      log.problems.push({ line, text: content, reason: 'unrecognized' });
    } catch (e) {
      if (!(e instanceof LineProblem)) throw e;
      log.problems.push({ line, text: content, reason: e.reason });
    }
  });

  resolveTimes(log, stamps);
  return log;
}

/**
 * Turn the time stamps into seconds. Ten-digit stamps (-ta, -l) and dates
 * (-tA) are times since 1970. Short stamps are time since the start (-tz),
 * unless time goes backwards somewhere: then they are the gaps to the
 * previous frame (-td), and are summed up.
 */
function resolveTimes(log: TraceLog, stamps: Map<TraceFrame, Stamp>): void {
  const stamped = log.frames.filter((f) => stamps.has(f));
  if (stamped.length === 0) {
    log.timestamps = 'none';
    return;
  }
  if (stamped.every((f) => stamps.get(f)!.epoch)) {
    log.timestamps = 'epoch';
    for (const f of stamped) f.time = stamps.get(f)!.seconds;
    return;
  }
  const values = stamped.map((f) => stamps.get(f)!.seconds);
  const backwards = values.some((v, i) => i > 0 && v < values[i - 1]);
  log.timestamps = backwards ? 'delta' : 'sinceStart';
  let sum = 0;
  stamped.forEach((f, i) => {
    sum += values[i];
    f.time = backwards ? sum : values[i];
  });
}
