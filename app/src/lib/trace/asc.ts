// SPDX-License-Identifier: GPL-2.0-or-later
import { countSkipped, emptyLog, splitLines, type TraceFrame, type TraceLog, type TraceProblemReason } from './types';

/**
 * Reader for Vector ASC logs (CANoe, CANalyzer and many other tools):
 *
 *   date Sun Nov 1 08:00:00.000 am 2026
 *   base hex  timestamps absolute
 *      0.001000 1  100             Rx   d 8 40 1F 82 32 2C C1 FE 01  Length = …
 *      0.026000 1  CF00400x        Rx   d 8 FF FF 7D E0 2E FF FF FF
 *      0.031000 CANFD   2 Rx        600  AdasObjects  1 0 c 24 02 D2 …
 *      0.032000 1  7FF             Rx   r
 *      0.034000 1  ErrorFrame
 *
 * `base` says whether ids and bytes are hex or decimal; `timestamps relative`
 * means each time stamp is the gap to the previous event. An `x` after the
 * id marks an extended frame. A CANFD line gives BRS, ESI, the DLC code and
 * the data length (always decimal), optionally after a symbolic name.
 */

class LineProblem extends Error {
  constructor(readonly reason: TraceProblemReason) {
    super(reason);
  }
}

const HEADER_DATE = /^\s*date\s+(.*?)\s*$/i;
const HEADER_BASE = /^\s*base\s+(hex|dec)(?:\s+timestamps\s+(absolute|relative))?\s*$/i;
const HEADER_OTHER = /^\s*(?:(?:no\s+)?internal\s+events\s+logged|begin\s+triggerblock\b.*|end\s+triggerblock)\s*$/i;
const COMMENT = /^\s*\/\//;
const EVENT = /^\s*(\d+(?:\.\d+)?)\s+(\S.*?)\s*$/;

export function parseAsc(text: string): TraceLog {
  const log = emptyLog('asc');
  let radix = 16;
  let relative = false;
  let elapsed = 0;

  const parseId = (token: string | undefined): Pick<TraceFrame, 'id' | 'isExtended'> => {
    const m = token === undefined ? null : (radix === 16 ? /^([0-9A-Fa-f]+)(x?)$/ : /^(\d+)(x?)$/).exec(token);
    if (!m) throw new LineProblem('badId');
    const id = parseInt(m[1], radix);
    const isExtended = m[2] === 'x';
    if (id > (isExtended ? 0x1fffffff : 0x7ff)) throw new LineProblem('badId');
    return { id, isExtended };
  };
  const isByte = (token: string) =>
    radix === 16 ? /^[0-9A-Fa-f]{1,2}$/.test(token) : /^\d{1,3}$/.test(token) && Number(token) <= 255;
  const parseBytes = (tokens: string[], count: number): Uint8Array => {
    const bytes: number[] = [];
    for (const token of tokens.slice(0, count)) {
      if (!isByte(token)) break;
      bytes.push(parseInt(token, radix));
    }
    if (bytes.length < count) {
      // The line ends, or the trailing "Length = …" begins: the payload is short. Anything else is bad data.
      const next = tokens[bytes.length];
      throw new LineProblem(next === undefined || next === 'Length' ? 'lengthMismatch' : 'badData');
    }
    return Uint8Array.from(bytes);
  };
  const direction = (token: string | undefined): 'rx' | 'tx' | 'txRequest' => {
    if (token === 'Rx') return 'rx';
    if (token === 'Tx') return 'tx';
    if (token === 'TxRq') return 'txRequest';
    throw new LineProblem('unrecognized');
  };

  /** A classic frame after the channel: `<id> <dir> d <dlc> <bytes>` or `<id> <dir> r [<dlc>]`. */
  const classic = (frame: TraceFrame, tokens: string[]): TraceFrame | 'txRequest' => {
    const dir = direction(tokens[1]);
    const type = tokens[2];
    if (type !== 'd' && type !== 'r') throw new LineProblem('unrecognized');
    Object.assign(frame, parseId(tokens[0]));
    if (dir === 'txRequest') return dir;
    frame.direction = dir;
    if (type === 'r') {
      frame.kind = 'remote';
      if (tokens[3] !== undefined) {
        const dlc = parseInt(tokens[3], radix);
        if (Number.isNaN(dlc)) throw new LineProblem('badData');
        frame.dlc = dlc;
      }
      return frame;
    }
    const dlc = tokens[3] === undefined ? NaN : parseInt(tokens[3], radix);
    if (Number.isNaN(dlc) || dlc > 15) throw new LineProblem('badData');
    // Classic CAN carries at most 8 bytes; DLC codes 9 to 15 mean 8.
    frame.data = parseBytes(tokens.slice(4), Math.min(8, dlc));
    return frame;
  };

  /** A CANFD line after `CANFD`: `<ch> <dir> <id> [<name>] <brs> <esi> <dlc> <length> <bytes> …`. */
  const fd = (frame: TraceFrame, tokens: string[]): TraceFrame | 'txRequest' => {
    if (!/^\d+$/.test(tokens[0] ?? '')) throw new LineProblem('unrecognized');
    frame.channel = tokens[0];
    frame.isFd = true;
    const dir = direction(tokens[1]);
    if (dir === 'txRequest') return dir;
    frame.direction = dir;
    if (tokens[2]?.toLowerCase() === 'errorframe') {
      frame.kind = 'error';
      return frame;
    }
    Object.assign(frame, parseId(tokens[2]));
    const k = /^\d+$/.test(tokens[3] ?? '') ? 3 : 4;
    const [brs, esi, , lengthText] = tokens.slice(k, k + 4);
    if (!/^[01]$/.test(brs ?? '') || !/^[01]$/.test(esi ?? '') || !/^\d+$/.test(lengthText ?? '')) {
      throw new LineProblem('badData');
    }
    const length = Number(lengthText);
    if (length > 64) throw new LineProblem('badData');
    frame.brs = brs === '1';
    frame.esi = esi === '1';
    frame.data = parseBytes(tokens.slice(k + 4), length);
    return frame;
  };

  splitLines(text).forEach((content, index) => {
    const line = index + 1;
    if (content.trim() === '') return;
    const date = HEADER_DATE.exec(content);
    if (date) {
      log.startedAt = date[1];
      countSkipped(log, 'header');
      return;
    }
    const base = HEADER_BASE.exec(content);
    if (base) {
      radix = base[1].toLowerCase() === 'dec' ? 10 : 16;
      relative = base[2]?.toLowerCase() === 'relative';
      countSkipped(log, 'header');
      return;
    }
    if (HEADER_OTHER.test(content)) return countSkipped(log, 'header');
    if (COMMENT.test(content)) return countSkipped(log, 'comment');

    const event = EVENT.exec(content);
    if (!event) {
      log.problems.push({ line, text: content, reason: 'unrecognized' });
      return;
    }
    const stamp = Number(event[1]);
    const tokens = event[2].split(/\s+/);
    const time = relative ? elapsed + stamp : stamp;
    try {
      const frame: TraceFrame = { line, time, channel: tokens[0], id: 0, isExtended: false, kind: 'data', isFd: false, data: new Uint8Array(0) };
      let result: TraceFrame | 'txRequest';
      if (/^start\s+of\s+measurement$/i.test(event[2])) {
        countSkipped(log, 'event');
      } else if (tokens[0] === 'CANFD') {
        result = fd(frame, tokens.slice(1));
        if (result === 'txRequest') countSkipped(log, 'txRequest');
        else log.frames.push(result);
      } else if (/^\d+$/.test(tokens[0])) {
        const what = tokens[1] ?? '';
        if (what.toLowerCase() === 'errorframe') {
          frame.kind = 'error';
          log.frames.push(frame);
        } else if (/^statistic:$/i.test(what)) {
          countSkipped(log, 'statistic');
        } else if (/^(?:chipstat|status):$/i.test(what)) {
          countSkipped(log, 'status');
        } else if (what.endsWith(':')) {
          countSkipped(log, 'event');
        } else {
          result = classic(frame, tokens.slice(1));
          if (result === 'txRequest') countSkipped(log, 'txRequest');
          else log.frames.push(result);
        }
      } else if (tokens[0] === 'CAN' && /status:/i.test(event[2])) {
        countSkipped(log, 'status');
      } else if (/^[A-Za-z]/.test(tokens[0])) {
        // Other buses (LIN, FlexRay, Ethernet), system variables, markers.
        countSkipped(log, 'event');
      } else {
        throw new LineProblem('unrecognized');
      }
      // A relative time stamp counts from the previous event, whatever it was.
      elapsed = time;
    } catch (e) {
      if (!(e instanceof LineProblem)) throw e;
      log.problems.push({ line, text: content, reason: e.reason });
    }
  });

  log.timestamps = relative ? 'delta' : 'sinceStart';
  return log;
}
