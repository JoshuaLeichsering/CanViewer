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

type T = (key: MsgKey, params?: TParams) => string;
const count = (t: T, one: MsgKey, many: MsgKey, n: string) => t(Number(n) === 1 ? one : many, { n });

/**
 * The notes the canmatrix adapter writes as the text of an "import note"
 * (canviewer_adapter.py). Unlike the lines canmatrix printed or logged, these
 * sentences are CanViewer's own, so they are shown in the UI's language too.
 * As with the reasons, the stored text stays English, and the English strings
 * in i18n.tsx put together give exactly that text.
 */
const NOTE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray, t: T) => string]> = [
  [
    /^NOTE canviewer_adapter: frame (.+?)(?: of cluster (.+))? holds (\d+) contained PDUs? with (\d+) signals?, which CanViewer does not show$/s,
    (m, t) =>
      t('prbNoteContainedPdus', {
        where: m[2] === undefined ? t('prbNoteFrame', { frame: m[1] }) : t('prbNoteFrameOfCluster', { frame: m[1], cluster: m[2] }),
        pdus: count(t, 'prbNotePdusOne', 'prbNotePdusMany', m[3]),
        signals: count(t, 'prbNoteSignalsOne', 'prbNoteSignalsMany', m[4]),
      }),
  ],
  [
    /^NOTE canviewer_adapter: no CAN frames found per cluster; read again with arxmlIgnoreClusterInfo=True$/,
    (_m, t) => t('prbNoteNoFramesPerCluster'),
  ],
];

/**
 * What the problem table shows in its content column: an adapter's note in
 * the UI's language, and anything else (the file's line, what canmatrix
 * printed or logged) as it is.
 */
export function problemContentText(problem: { reason: string; text: string }, t: T): string {
  if (problem.reason !== 'import note') return problem.text;
  for (const [pattern, render] of NOTE_PATTERNS) {
    const m = problem.text.match(pattern);
    if (m) return render(m, t);
  }
  return problem.text;
}
