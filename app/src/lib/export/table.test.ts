import { describe, expect, it } from 'vitest';
import { isCanFd } from '../dbc/canfd';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase } from '../dbc/types';
import { hexId } from '../format';
import { exportFile } from './download';
import { j1939Of, num } from './layout';
import { csv, exportStem, MESSAGE_COLUMNS, messagesCsv, messagesJson, muxNotation, SIGNAL_COLUMNS, signalsCsv } from './table';
import { CORPUS_TIMEOUT, corpusDb, corpusFiles, corpusPresent, demo, expectPinned, messageNamed, PINNED_CORPUS } from './test-fixtures';

/** An RFC 4180 reader, to check that what the export writes reads back field for field. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  expect(quoted, 'unterminated quote').toBe(false);
  expect(field === '' && row.length === 0, 'the last record ends with CRLF').toBe(true);
  return rows;
}

/**
 * What a CSV field holds for a model value: numbers as `num` writes them, and
 * text as it is, except text of two or more characters that starts with = + - @
 * tab or CR, which gets an apostrophe in front so that spreadsheets do not run it.
 */
const text = (v: string | number | boolean | undefined) =>
  v === undefined ? '' : typeof v === 'number' ? num(v) : typeof v === 'string' && v.length > 1 && '=+-@\t\r'.includes(v[0]) ? `'${v}` : String(v);
const sorted = (db: DbcDatabase) => [...db.messages].sort((a, b) => a.id - b.id);

/** Every row and column of both CSV files holds exactly the model's value. */
function expectCsvMatchesModel(db: DbcDatabase) {
  const messages = sorted(db);
  const [mHeader, ...mRows] = readCsv(messagesCsv(db));
  expect(mHeader.slice(0, MESSAGE_COLUMNS.length)).toEqual([...MESSAGE_COLUMNS]);
  expect(mRows).toHaveLength(messages.length);
  messages.forEach((m, i) => {
    const row = Object.fromEntries(mHeader.map((h, j) => [h, mRows[i][j]]));
    expect(row.id).toBe(String(m.id));
    expect(row.idHex).toBe(hexId(m.id, m.isExtended));
    expect(row.name).toBe(text(m.name));
    expect(row.dlc).toBe(String(m.dlc));
    expect(row.canFd).toBe(String(isCanFd(db, m)));
    expect(row.j1939Pgn).toBe(text(j1939Of(db, m)?.pgn));
    expect(row.sender).toBe(text(m.sender));
    expect(row.comment).toBe(text(m.comment));
    for (const h of mHeader.filter((h) => h.startsWith('attr.'))) expect(row[h]).toBe(text(m.attributes[h.slice(5)]));
  });

  const signals = messages.flatMap((m) => m.signals.map((s) => ({ m, s })));
  const [sHeader, ...sRows] = readCsv(signalsCsv(db));
  expect(sHeader.slice(0, SIGNAL_COLUMNS.length)).toEqual([...SIGNAL_COLUMNS]);
  expect(sRows).toHaveLength(signals.length);
  signals.forEach(({ m, s }, i) => {
    const row = Object.fromEntries(sHeader.map((h, j) => [h, sRows[i][j]]));
    expect(row.messageName).toBe(text(m.name));
    expect(row.name).toBe(text(s.name));
    for (const key of ['startBit', 'length', 'factor', 'offset', 'min', 'max'] as const) expect(row[key]).toBe(num(s[key]));
    expect(row.byteOrder).toBe(s.byteOrder);
    expect(row.valueType).toBe(s.valueType);
    expect(row.unit).toBe(text(s.unit));
    expect(row.receivers).toBe(text(s.receivers.join(', ')));
    expect(row.multiplex).toBe(muxNotation(s.multiplex));
    expect(row.comment).toBe(text(s.comment));
    for (const h of sHeader.filter((h) => h.startsWith('attr.'))) expect(row[h]).toBe(text(s.attributes[h.slice(5)]));
  });
}

/** The JSON holds the model's messages and signals, with nothing dropped and nothing filled in. */
function expectJsonMatchesModel(db: DbcDatabase) {
  const out = JSON.parse(messagesJson(db, 'x.dbc'));
  expect(out.messages).toHaveLength(db.messages.length);
  sorted(db).forEach((m, i) => {
    const got = out.messages[i];
    expect(got.id).toBe(m.id);
    expect(got.name).toBe(m.name);
    expect(got.comment).toBe(m.comment);
    expect(got.attributes).toEqual(m.attributes);
    expect(got.j1939).toEqual(j1939Of(db, m) ? JSON.parse(JSON.stringify(j1939Of(db, m))) : undefined);
    // JSON turns the numeric keys of value descriptions into strings; the rest round-trips as is.
    expect(got.signals).toEqual(JSON.parse(JSON.stringify(m.signals)));
  });
}

describe('csv', () => {
  it('quotes fields with commas, quotes and line breaks, and ends every record with CRLF', () => {
    expect(csv(['a', 'b'], [['plain', 'with, comma'], ['say "hi"', 'two\nlines'], ['cr\rhere', '']])).toBe(
      'a,b\r\nplain,"with, comma"\r\n"say ""hi""","two\nlines"\r\n"cr\rhere",\r\n',
    );
  });

  it('writes numbers exactly, booleans as true/false, and nothing for a missing value', () => {
    expect(csv(['n'], [[0.1], [6.7e-6], [-40], [true], [undefined], [12345678901234567]])).toBe(
      'n\r\n0.1\r\n0.0000067\r\n-40\r\ntrue\r\n\r\n12345678901234568\r\n',
    );
  });

  it('puts an apostrophe before text that a spreadsheet would run as a formula', () => {
    expect(
      csv(['c'], [['=1+1'], ['+49 30'], ['-3'], ['@SUM(A1)'], ['\tx'], ['\rx'], ['=HYPERLINK("http://example.invalid/")']]),
    ).toBe(
      'c\r\n\'=1+1\r\n\'+49 30\r\n\'-3\r\n\'@SUM(A1)\r\n\'\tx\r\n"\'\rx"\r\n"\'=HYPERLINK(""http://example.invalid/"")"\r\n',
    );
  });

  it('leaves numbers, single characters and text that only contains formula characters as they are', () => {
    expect(csv(['c'], [[-40], [-0.5], ['-'], ['='], ['a=b'], [' =1'], ['0x1F'], ["'quoted'"]])).toBe(
      "c\r\n-40\r\n-0.5\r\n-\r\n=\r\na=b\r\n =1\r\n0x1F\r\n'quoted'\r\n",
    );
  });

  it('guards formulas that a file puts into comments, units, names and attributes', () => {
    const db = parseDbc(
      [
        'VERSION ""',
        'BU_: A',
        'BO_ 1 Engine: 8 A',
        ' SG_ Speed : 0|8@1- (1,-40) [-40|215] "=1+2" A',
        'CM_ BO_ 1 "=WEBSERVICE(\\"http://example.invalid/\\")";',
        'CM_ SG_ 1 Speed "-1 means not available";',
        'BA_DEF_ BO_ "Note" STRING;',
        'BA_ "Note" BO_ 1 "@risk";',
        'VAL_ 1 Speed -1 "Not available" 0 "Stopped";',
        '',
      ].join('\n'),
    );
    expect(db.problems).toEqual([]);
    const [, message] = readCsv(messagesCsv(db));
    expect(message[MESSAGE_COLUMNS.indexOf('comment')]).toBe('\'=WEBSERVICE("http://example.invalid/")');
    expect(message[MESSAGE_COLUMNS.length]).toBe("'@risk");
    const [, signal] = readCsv(signalsCsv(db));
    const cell = (column: (typeof SIGNAL_COLUMNS)[number]) => signal[SIGNAL_COLUMNS.indexOf(column)];
    expect(cell('unit')).toBe("'=1+2");
    expect(cell('comment')).toBe("'-1 means not available");
    expect(cell('values')).toBe('\'-1 "Not available" 0 "Stopped"');
    // Numbers stay numbers.
    expect([cell('offset'), cell('min'), cell('max')]).toEqual(['-40', '-40', '215']);
    // The JSON keeps every value exactly.
    const json = JSON.parse(messagesJson(db, 'x.dbc'));
    expect(json.messages[0].comment).toBe('=WEBSERVICE("http://example.invalid/")');
    expect(json.messages[0].signals[0].unit).toBe('=1+2');
  });
});

describe('exportFile', () => {
  it('names the files after the database and marks CSV as UTF-8', () => {
    const csvFile = exportFile(demo, 'demo.dbc', 'messagesCsv');
    expect(csvFile.name).toBe('demo.messages.csv');
    expect(csvFile.type).toBe('text/csv;charset=utf-8');
    expect(csvFile.text).toBe('﻿' + messagesCsv(demo));
    expect(exportFile(demo, 'demo.dbc', 'signalsCsv').name).toBe('demo.signals.csv');
    const json = exportFile(demo, 'demo.dbc', 'messagesJson');
    expect(json.name).toBe('demo.messages.json');
    expect(json.type).toBe('application/json');
    expect(json.text.startsWith('{')).toBe(true);
  });

  it('keeps every part of the file name but the extension', () => {
    expect(exportStem('demo.dbc')).toBe('demo');
    expect(exportStem('system-4.2.arxml')).toBe('system-4.2');
    expect(exportStem('noext')).toBe('noext');
    expect(exportStem('.dbc')).toBe('canviewer');
  });
});

describe('message and signal list, pinned', () => {
  it('demo.dbc', () => {
    expectPinned('demo.messages.csv', messagesCsv(demo));
    expectPinned('demo.signals.csv', signalsCsv(demo));
    expectPinned('demo.messages.json', messagesJson(demo, 'demo.dbc'));
  });

  describe.skipIf(!corpusPresent)('corpus', () => {
    it.each(PINNED_CORPUS.map((p) => [`${p.file} ${p.message}`, p] as const))('%s', (_, p) => {
      const db = corpusDb(p.file);
      const one = { ...db, messages: [messageNamed(db, p.message)] };
      expectPinned(`${p.dir}/messages.csv`, messagesCsv(one));
      expectPinned(`${p.dir}/signals.csv`, signalsCsv(one));
      expectPinned(`${p.dir}/messages.json`, messagesJson(one, p.file.split('/').pop()!));
    });
  });
});

describe('message and signal list, read back', () => {
  it('demo.dbc', () => {
    expectCsvMatchesModel(demo);
    expectJsonMatchesModel(demo);
  });

  describe.skipIf(corpusFiles().length === 0)('corpus', () => {
    it.each(corpusFiles())('%s: CSV and JSON read back as the model', (file) => {
      const db = corpusDb(file);
      expectCsvMatchesModel(db);
      expectJsonMatchesModel(db);
    }, CORPUS_TIMEOUT);
  });
});
