// SPDX-License-Identifier: GPL-2.0-or-later
import { parseAsc } from './asc';
import { parseCandump } from './candump';
import type { TraceFormat, TraceLog } from './types';

export type { TraceFormat, TraceFrame, TraceLog, TraceProblem, TraceProblemReason, TraceSkipReason } from './types';

/** Log files CanViewer opens as traces rather than as databases. */
export function isTraceFileName(name: string): boolean {
  return /\.(?:asc|log)$/i.test(name);
}

const ASC_HEADER = /^\s*(?:date\s|base\s+(?:hex|dec)\b|begin\s+triggerblock\b)/i;
const ASC_EVENT = /^\s*\d+\.\d+\s+(?:\d+|CANFD)\s+\S/;
const CANDUMP_LOG = /^\s*\([^)]*\)\s+\S+\s+[0-9A-Fa-f]+##?\S*/;
const CANDUMP_SCREEN = /^\s*(?:\([^)]*\)\s+)?\S+\s+(?:(?:RX|TX)\s+\S\s+\S\s+)?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})\s+\[\d{1,2}\]/;

/**
 * Which log format the text is in, judged by its first 200 non-empty lines:
 * an ASC header settles it, otherwise the format with more frame-like lines
 * wins. Null when no line looks like either.
 */
export function detectTraceFormat(text: string): TraceFormat | null {
  let asc = 0;
  let candump = 0;
  let seen = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    if (ASC_HEADER.test(line)) return 'asc';
    if (CANDUMP_LOG.test(line) || CANDUMP_SCREEN.test(line)) candump++;
    else if (ASC_EVENT.test(line)) asc++;
    if (++seen >= 200) break;
  }
  if (asc === 0 && candump === 0) return null;
  return candump >= asc ? 'candump' : 'asc';
}

/** Read a log in whichever format it is in; null when it is neither a candump nor an ASC log. */
export function parseTrace(text: string): TraceLog | null {
  switch (detectTraceFormat(text)) {
    case 'asc':
      return parseAsc(text);
    case 'candump':
      return parseCandump(text);
    default:
      return null;
  }
}

/** Logs are ASCII; fall back to Windows-1252 for comments or names that are not UTF-8. */
export async function readTraceFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** A log opened in the app. `id` tells two openings of the same file apart. */
export interface LoadedTrace {
  id: number;
  name: string;
  log: TraceLog;
}

let opened = 0;

/** Read a log file in this tab; null when it is neither a candump nor an ASC log. */
export async function openTraceFile(file: File): Promise<LoadedTrace | null> {
  const log = parseTrace(await readTraceFile(file));
  return log ? { id: ++opened, name: file.name, log } : null;
}
