// SPDX-License-Identifier: GPL-2.0-or-later
import type { MsgKey, TParams } from './i18n';

/**
 * The reasons of parse problems, in the UI's language.
 *
 * A problem's reason is stored as English text: the DBC parser
 * (lib/dbc/parser.ts) and the canmatrix adapter (canmatrix/canviewer_adapter.py)
 * write it, and the pinned baselines and the JSON export keep it as it is.
 * Every reason either of them writes matches one of the patterns below, whose
 * English strings in i18n.tsx are exactly that text, so only the display
 * changes with the language. What the problem's line or message says stays as
 * the file or the reader wrote it.
 */
const PATTERNS: Array<[RegExp, MsgKey, string[]]> = [
  // DBC parser
  [/^malformed BO_ message definition$/, 'prbMalformedMessage', []],
  [/^malformed SG_ signal definition$/, 'prbMalformedSignal', []],
  [/^malformed CM_ comment$/, 'prbMalformedComment', []],
  [/^malformed (\S+) value pairs$/, 'prbMalformedValuePairs', ['stmt']],
  [/^malformed (\S+)$/, 'prbMalformed', ['stmt']],
  [/^(.+) references unknown message id$/, 'prbUnknownMessage', ['stmt']],
  [/^(.+) references unknown node$/, 'prbUnknownNode', ['stmt']],
  [/^(.+) references unknown signal$/, 'prbUnknownSignal', ['stmt']],
  [/^duplicate message id (\d+) — comments\/attributes attach to the first definition$/, 'prbDuplicateId', ['id']],
  [/^SG_ signal outside of a BO_ message block$/, 'prbSignalOutside', []],
  [/^signal "(.*)" has an invalid start bit or length — skipped$/s, 'prbSignalBits', ['name']],
  [/^unrecognized statement$/, 'prbUnrecognized', []],
  [/^unrecognized statement "(.*)"$/s, 'prbUnrecognizedKeyword', ['keyword']],
  [/^more than (\d+) problems — this is probably not a DBC file; further problems suppressed$/, 'prbTooMany', ['n']],
  // canmatrix adapter
  [/^canmatrix could not read this line$/, 'prbCanmatrixUnreadable', []],
  [/^canmatrix printed$/, 'prbCanmatrixPrinted', []],
  [/^canmatrix error$/, 'prbCanmatrixError', []],
  [/^canmatrix warning$/, 'prbCanmatrixWarning', []],
  [/^canmatrix (\S+)$/, 'prbCanmatrixLogged', ['level']],
  [/^import note$/, 'prbImportNote', []],
];

/** The message key and its parameters for a stored reason, or null for a reason no pattern knows. */
export function problemReasonKey(reason: string): { key: MsgKey; params: TParams } | null {
  for (const [pattern, key, names] of PATTERNS) {
    const m = reason.match(pattern);
    if (m) return { key, params: Object.fromEntries(names.map((name, i) => [name, m[i + 1]])) };
  }
  return null;
}

/** A stored reason in the UI's language; a reason no pattern knows is shown as it is. */
export function problemReasonText(reason: string, t: (key: MsgKey, params?: TParams) => string): string {
  const known = problemReasonKey(reason);
  return known ? t(known.key, known.params) : reason;
}
