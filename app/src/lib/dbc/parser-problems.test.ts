// SPDX-License-Identifier: GPL-2.0-or-later
// Every statement the parser cannot use becomes a visible problem with a
// reason, or a counted skip, and never takes the rest of the file with it.
import { describe, expect, it } from 'vitest';
import { parseDbc } from './parser';

const HEADER = [
  'VERSION ""',
  'BU_: A',
  'BO_ 1 M: 8 A',
  ' SG_ S : 0|8@1+ (1,0) [0|255] "" A',
  'EV_ Env: 0 [0|1] "" 0 1 DUMMY_NODE_VECTOR0 Vector__XXX;',
].join('\n');

/** Parse the header plus one statement; the header alone parses cleanly. */
const withStatement = (statement: string) => parseDbc(`${HEADER}\n${statement}\n`);

describe('parser problems', () => {
  it('parses the header without problems', () => {
    expect(withStatement('').problems).toEqual([]);
  });

  it.each([
    ['BO_TX_BU_ 99 : A;', 'BO_TX_BU_ references unknown message id'],
    ['CM_ BU_ Nobody "x";', 'CM_ BU_ references unknown node'],
    ['CM_ BO_ 99 "x";', 'CM_ BO_ references unknown message id'],
    ['CM_ SG_ 1 Nope "x";', 'CM_ SG_ references unknown signal'],
    ['CM_ what is this;', 'malformed CM_ comment'],
    ['VAL_TABLE_ T', 'malformed VAL_TABLE_'],
    ['VAL_TABLE_ T 0 "a" junk ;', 'malformed VAL_TABLE_ value pairs'],
    ['VAL_ ;', 'malformed VAL_'],
    ['VAL_ 1 Nope 0 "a" ;', 'VAL_ references unknown signal'],
    ['VAL_ 1 S 0 "a" 1 ;', 'malformed VAL_ value pairs'],
    ['SIG_VALTYPE_ 1 S : x;', 'malformed SIG_VALTYPE_'],
    ['SIG_VALTYPE_ 1 Nope : 1;', 'SIG_VALTYPE_ references unknown signal'],
    ['SG_MUL_VAL_ 1 S;', 'malformed SG_MUL_VAL_'],
    ['SG_MUL_VAL_ 1 Nope S 1-1;', 'SG_MUL_VAL_ references unknown signal'],
    ['BA_DEF_ BO_ Unquoted INT 0 1;', 'malformed BA_DEF_'],
    ['BA_DEF_DEF_ Unquoted 1;', 'malformed BA_DEF_DEF_'],
    ['BA_ "X" BU_ Nobody 1;', 'BA_ BU_ references unknown node'],
    ['BA_ "X" BO_ 99 1;', 'BA_ BO_ references unknown message id'],
    ['BA_ "X" SG_ 1 Nope 1;', 'BA_ SG_ references unknown signal'],
    ['BA_ X;', 'malformed BA_'],
  ])('reports %s', (statement, reason) => {
    const db = withStatement(statement);
    expect(db.problems.map((p) => p.reason)).toEqual([reason]);
    expect(db.problems[0]).toMatchObject({ line: 6, text: statement });
    // The rest of the file is still there.
    expect(db.messages[0].signals.map((s) => s.name)).toEqual(['S']);
  });

  it('reports a signal outside a message, a malformed signal and an impossible one', () => {
    const db = parseDbc(
      [
        'VERSION ""',
        'BU_: A',
        ' SG_ Early : 0|8@1+ (1,0) [0|255] "" A',
        'BO_ 1 M: 8 A',
        ' SG_ Broken : what',
        ' SG_ Huge : 0|600@1+ (1,0) [0|1] "" A',
        ' SG_ Fine : 0|8@1+ (1,0) [0|255] "" A',
        '',
      ].join('\n'),
    );
    expect(db.problems.map((p) => [p.line, p.reason])).toEqual([
      [3, 'SG_ signal outside of a BO_ message block'],
      [5, 'malformed SG_ signal definition'],
      [6, 'signal "Huge" has an invalid start bit or length — skipped'],
    ]);
    expect(db.messages[0].signals.map((s) => s.name)).toEqual(['Fine']);
  });

  it('counts statements about environment variables as skipped, not as problems', () => {
    const db = parseDbc(
      [HEADER, 'CM_ EV_ Env "comment";', 'VAL_ Env 0 "Off" 1 "On" ;', 'BA_DEF_ EV_ "EvAttr" INT 0 1;', 'BA_ "EvAttr" EV_ Env 1;', ''].join(
        '\n',
      ),
    );
    expect(db.problems).toEqual([]);
    expect(db.skipped).toMatchObject({ 'CM_ EV_': 1, 'VAL_ (env var)': 1, 'BA_ EV_': 1 });
  });

  it('reads SIG_VALTYPE_ 2 as double, and leaves 0 as it is', () => {
    const db = parseDbc(
      [
        'VERSION ""',
        'BU_: A',
        'BO_ 1 M: 8 A',
        ' SG_ D : 0|64@1- (1,0) [0|1] "" A',
        ' SG_ I : 0|8@1+ (1,0) [0|255] "" A',
        'SIG_VALTYPE_ 1 D : 2;',
        'SIG_VALTYPE_ 1 I : 0;',
        '',
      ].join('\n'),
    );
    expect(db.messages[0].signals.map((s) => s.valueType)).toEqual(['double', 'unsigned']);
  });

  it('keeps the last statement of a file that ends without a newline', () => {
    const db = parseDbc('VERSION ""\nBU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\nCM_ "last";');
    expect(db.comment).toBe('last');
    expect(db.problems).toEqual([]);
  });

  it('keeps a statement whose terminator never comes, at the end of the file', () => {
    // A wrapped BA_DEF_ waits for its ';' and meets the end of the file instead.
    const db = parseDbc('VERSION ""\nBU_: A\nBA_DEF_ BO_ "Kind" ENUM "A",\n  "B"');
    expect(db.attributeDefinitions).toEqual([{ name: 'Kind', objectType: 'BO_', valueType: 'ENUM', enumValues: ['A', 'B'] }]);
  });
});
