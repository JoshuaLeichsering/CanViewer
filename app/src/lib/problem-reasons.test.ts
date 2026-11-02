// SPDX-License-Identifier: GPL-2.0-or-later
// Every reason the DBC parser and the canmatrix adapter store has a German
// text, and the English text is the stored reason itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDbc } from './dbc/parser';
import { translate as inLang, type MsgKey, type TParams } from './i18n';
import { problemContentText, problemReasonKey, problemReasonText } from './problem-reasons';

const translate = (lang: 'en' | 'de') => (key: MsgKey, params?: TParams) => inLang(lang, key, params);

/** A file with one statement of every kind the parser reports. */
const BROKEN = [
  'VERSION ""',
  'BU_: A',
  ' SG_ Early : 0|8@1+ (1,0) [0|255] "" A',
  'BO_ 1 M: 8 A',
  ' SG_ S : 0|8@1+ (1,0) [0|255] "" A',
  ' SG_ Broken : what',
  ' SG_ Huge : 0|600@1+ (1,0) [0|1] "" A',
  'BO_ 1 Again: 8 A',
  'BO_ nonsense',
  'BO_TX_BU_ 99 : A;',
  'CM_ BU_ Nobody "x";',
  'CM_ BO_ 99 "x";',
  'CM_ SG_ 1 Nope "x";',
  'CM_ what is this;',
  'VAL_TABLE_ T',
  'VAL_TABLE_ T 0 "a" junk ;',
  'VAL_ ;',
  'VAL_ 1 Nope 0 "a" ;',
  'VAL_ 1 S 0 "a" 1 ;',
  'SIG_VALTYPE_ 1 S : x;',
  'SIG_VALTYPE_ 1 Nope : 1;',
  'SG_MUL_VAL_ 1 S;',
  'SG_MUL_VAL_ 1 Nope S 1-1;',
  'BA_DEF_ BO_ Unquoted INT 0 1;',
  'BA_DEF_DEF_ Unquoted 1;',
  'BA_ "X" BU_ Nobody 1;',
  'BA_ "X" BO_ 99 1;',
  'BA_ "X" SG_ 1 Nope 1;',
  'BA_ X;',
  'FOO_ bar;',
  '"quoted";',
].join('\n');

describe('problem reasons', () => {
  const reasons = [...new Set(parseDbc(BROKEN).problems.map((p) => p.reason))];
  // The parser's reason literals, read from its source, so that a new one
  // cannot be added without a pattern here.
  const source = readFileSync(new URL('./dbc/parser.ts', import.meta.url), 'utf8');
  const literals = [...source.matchAll(/problem\(stmt, (['`])(.*?)\1\)/g)].map((m) => m[2]);

  it('the broken file gives every reason the parser has', () => {
    expect(literals.length).toBeGreaterThan(20);
    // "unrecognized statement" comes with and without its keyword.
    expect(reasons).toHaveLength(literals.length + 1);
  });

  it.each(reasons)('"%s" has a key whose English text is the reason itself, and a German text', (reason) => {
    expect(problemReasonKey(reason)).not.toBeNull();
    expect(problemReasonText(reason, translate('en'))).toBe(reason);
    expect(problemReasonText(reason, translate('de'))).not.toBe(reason);
  });

  it('keeps the parameters: the statement, the id, the name and the keyword', () => {
    const de = translate('de');
    expect(problemReasonText('BA_ SG_ references unknown signal', de)).toBe('BA_ SG_ verweist auf ein unbekanntes Signal');
    expect(problemReasonText('malformed VAL_ value pairs', de)).toBe('fehlerhafte Wertepaare in VAL_');
    expect(problemReasonText('malformed SIG_VALTYPE_', de)).toBe('fehlerhaftes SIG_VALTYPE_');
    expect(problemReasonText('duplicate message id 1 — comments/attributes attach to the first definition', de)).toMatch(/^doppelte Botschafts-ID 1 /);
    expect(problemReasonText('signal "Huge" has an invalid start bit or length — skipped', de)).toMatch(/^Signal „Huge“ /);
    expect(problemReasonText('unrecognized statement "FOO_"', de)).toBe('unbekannte Anweisung „FOO_“');
    expect(problemReasonText('unrecognized statement', de)).toBe('unbekannte Anweisung');
  });

  it('translates the cap on problems', () => {
    const many = parseDbc(['VERSION ""', ...Array.from({ length: 1001 }, () => 'FOO_;')].join('\n')).problems;
    const last = many[many.length - 1].reason;
    expect(problemReasonText(last, translate('en'))).toBe(last);
    expect(problemReasonText(last, translate('de'))).toBe(
      'mehr als 1000 Probleme — vermutlich keine DBC-Datei; weitere Probleme werden nicht gemeldet',
    );
  });

  it('translates every reason the canmatrix adapter writes', () => {
    const adapter = readFileSync(new URL('./canmatrix/canviewer_adapter.py', import.meta.url), 'utf8');
    const fixed = [...adapter.matchAll(/"reason": "([^"]+)"(?! \+)/g)].map((m) => m[1]);
    expect(fixed.sort()).toEqual(['canmatrix could not read this line', 'canmatrix printed', 'import note']);
    // The logged ones are "canmatrix " and the level, as Python's logging names it.
    expect(adapter).toContain('"reason": "canmatrix " + level.lower()');
    const de = translate('de');
    for (const reason of [...fixed, 'canmatrix error', 'canmatrix warning', 'canmatrix info', 'canmatrix critical']) {
      expect(problemReasonText(reason, translate('en'))).toBe(reason);
      expect(problemReasonText(reason, de)).not.toBe(reason);
    }
    expect(problemReasonText('canmatrix warning', de)).toBe('Warnung von canmatrix');
    expect(problemReasonText('canmatrix info', de)).toBe('Meldung von canmatrix (info)');
    expect(problemReasonText('import note', de)).toBe('Hinweis zum Import');
  });

  it('shows a reason no pattern knows as it is', () => {
    expect(problemReasonKey('something new')).toBeNull();
    expect(problemReasonText('something new', translate('de'))).toBe('something new');
  });
});

describe('the canmatrix adapter\'s notes', () => {
  const adapter = readFileSync(new URL('./canmatrix/canviewer_adapter.py', import.meta.url), 'utf8');
  const baseline = JSON.parse(readFileSync(new URL('./canmatrix/import-corpus-baseline.json', import.meta.url), 'utf8')) as {
    reads: Record<string, { log: string[] }>;
  };
  // A read's log holds what canmatrix logged and then the adapter's notes, in full.
  const notes = [...new Set(Object.values(baseline.reads).flatMap((r) => r.log.filter((line) => line.startsWith('NOTE canviewer_adapter: '))))];
  const note = (text: string) => ({ reason: 'import note', text });

  it('the adapter writes two kinds, and the corpus has both', () => {
    expect([...adapter.matchAll(/"NOTE canviewer_adapter: /g)]).toHaveLength(2);
    expect(notes.some((n) => n.includes(' contained PDU'))).toBe(true);
    expect(notes.some((n) => n.includes('no CAN frames found per cluster'))).toBe(true);
  });

  it.each(notes)('"%s" reads the same in English, and is in German', (text) => {
    expect(problemContentText(note(text), translate('en'))).toBe(text);
    const de = problemContentText(note(text), translate('de'));
    expect(de).not.toBe(text);
    expect(de).toMatch(/^HINWEIS canviewer_adapter: /);
  });

  it('keeps the frame, the cluster and the counts, in the singular and the plural', () => {
    const en = translate('en');
    const de = translate('de');
    const one = 'NOTE canviewer_adapter: frame F1 of cluster Body holds 1 contained PDU with 1 signal, which CanViewer does not show';
    expect(problemContentText(note(one), en)).toBe(one);
    expect(problemContentText(note(one), de)).toBe(
      'HINWEIS canviewer_adapter: Frame F1 im Cluster Body enthält 1 Contained PDU mit 1 Signal, die CanViewer nicht anzeigt',
    );
    const many = 'NOTE canviewer_adapter: frame TestFrame holds 3 contained PDUs with 9 signals, which CanViewer does not show';
    expect(problemContentText(note(many), de)).toBe(
      'HINWEIS canviewer_adapter: Frame TestFrame enthält 3 Contained PDUs mit 9 Signalen, die CanViewer nicht anzeigt',
    );
    expect(problemContentText(note('NOTE canviewer_adapter: no CAN frames found per cluster; read again with arxmlIgnoreClusterInfo=True'), de)).toBe(
      'HINWEIS canviewer_adapter: keine CAN-Frames je Cluster gefunden; neu gelesen mit arxmlIgnoreClusterInfo=True',
    );
  });

  it('leaves the file\'s lines, what canmatrix wrote, and a note it does not know as they are', () => {
    const de = translate('de');
    const logged = 'ERROR canmatrix.formats.arxml: PDU X is a Container-sub-PDU with no header';
    expect(problemContentText({ reason: 'canmatrix error', text: logged }, de)).toBe(logged);
    expect(problemContentText({ reason: 'malformed BO_ message definition', text: 'BO_ nonsense' }, de)).toBe('BO_ nonsense');
    // The same words outside an import note are the file's, not the adapter's.
    const quoted = 'NOTE canviewer_adapter: no CAN frames found per cluster; read again with arxmlIgnoreClusterInfo=True';
    expect(problemContentText({ reason: 'canmatrix printed', text: quoted }, de)).toBe(quoted);
    expect(problemContentText(note('NOTE canviewer_adapter: something new'), de)).toBe('NOTE canviewer_adapter: something new');
  });
});
