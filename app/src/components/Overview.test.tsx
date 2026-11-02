// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb } from '../test/fixtures';
import { Overview } from './Overview';
import type { DbcDatabase } from '../lib/dbc/types';

function show(db: DbcDatabase, fileName = 'demo.dbc') {
  const onSelect = vi.fn();
  renderWithProviders(<Overview db={db} fileName={fileName} onSelect={onSelect} />);
  return onSelect;
}

const stat = (label: string) =>
  [...document.querySelectorAll('.facts .fact')].find((f) => f.querySelector('.k')?.textContent === label)
    ?.querySelector('.v')?.textContent;
const card = (heading: string) => screen.getByRole('heading', { name: heading }).closest('.card') as HTMLElement;
const rowsOf = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe('Overview', () => {
  it('shows the file, its version, comment and counts', () => {
    show(demoDb());
    expect(screen.getByRole('heading', { level: 1, name: 'demo.dbc' })).toBeTruthy();
    expect(screen.getByText('Database · version “CanViewer Demo 1.0”')).toBeTruthy();
    expect(screen.getByText('CanViewer demo database with typical powertrain messages.')).toBeTruthy();
    expect(stat('Messages')).toBe('9');
    expect(stat('Signals')).toBe('33');
    expect(stat('Nodes')).toBe('5');
    expect(stat('Value tables')).toBe('2');
    expect(stat('Attribute defs')).toBe('6');
  });

  it('reports a clean parse and what it detected', () => {
    show(demoDb());
    expect(screen.getByText(/Parsed without problems\./).textContent).toBe(
      'Parsed without problems. 3 J1939 parameter groups and 1 CAN FD frame detected.',
    );
  });

  it('uses the singular for one J1939 parameter group, and says nothing for a plain file', () => {
    const j1939 = dbcOf(
      'BU_: A\nBO_ 2364539904 Pg: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n' +
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";\n' +
        'BA_ "VFrameFormat" BO_ 2364539904 3;',
    );
    show(j1939, 'one.dbc');
    expect(screen.getByText(/Parsed without problems\./).textContent).toBe(
      'Parsed without problems. 1 J1939 parameter group detected.',
    );
  });

  it('says "Database" without a version, and shows no comment', () => {
    show(dbcOf('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A'), 'plain.dbc');
    expect(screen.getByText('Database')).toBeTruthy();
    expect(screen.getByText('Parsed without problems.')).toBeTruthy();
    expect(document.querySelector('.lead')).toBeNull();
    // No attribute definitions: no card for them.
    expect(screen.queryByRole('heading', { name: 'Attribute definitions' })).toBeNull();
  });

  it('lists the messages sorted by id with a PGN column for J1939 databases, and opens one on click', () => {
    const onSelect = show(demoDb());
    const rows = rowsOf(card('Messages'));
    expect(rows.map((r) => r[2])).toEqual([
      'EngineData',
      'GearboxData',
      'BrakeData',
      'DiagData',
      'PowerData',
      'AdasObjectsFD',
      'J1939_TSC1J1939',
      'J1939_EEC1J1939',
      'J1939_CCVS1J1939',
    ]);
    expect(rows[0]).toEqual(['0x100', '', 'EngineData', '8', '6', 'ECM', '10', 'Engine status broadcast, 10 ms cycle.']);
    // The PGN of EEC1, and only the first line of a two-line comment.
    expect(rows[7][1]).toBe('61444');
    expect(rows[3][7]).toBe('Diagnostic data message.');
    fireEvent.click(screen.getByText('BrakeData').closest('tr')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 768, occ: 0 });
  });

  it('has no PGN column outside J1939', () => {
    show(dbcOf('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A'), 'plain.dbc');
    const headers = [...card('Messages').querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['ID', 'Name', 'DLC', 'Signals', 'Sender', 'Cycle (ms)', 'Comment']);
    expect(rowsOf(card('Messages'))[0][4]).toBe('A');
  });

  it('shows a dash for a message without sender', () => {
    // Imported formats can leave the sender empty.
    const db = dbcOf('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A');
    db.messages[0].sender = '';
    show(db, 'nosender.dbc');
    expect(rowsOf(card('Messages'))[0][4]).toBe('—');
  });

  it('lists the attribute definitions with what they apply to', () => {
    show(demoDb());
    const rows = rowsOf(card('Attribute definitions'));
    expect(rows).toContainEqual(['GenMsgCycleTime', 'Message', 'INT', '0', '10000', '0', '']);
    expect(rows).toContainEqual(['GenMsgSendType', 'Message', 'ENUM', '', '', 'NoMsgSendType', 'Cyclic, Event, IfActive, NoMsgSendType']);
    expect(rows).toContainEqual(['GenSigStartValue', 'Signal', 'FLOAT', '0', '100000', '0', '']);
    expect(rows).toContainEqual(['NodeAddress', 'Node', 'HEX', '0', '255', '0', '']);
    expect(rows).toContainEqual(['BusType', 'Network', 'STRING', '', '', 'CAN', '']);
  });

  it('names environment variable attributes', () => {
    show(dbcOf('BA_DEF_ EV_ "EvAttr" INT 0 1;'), 'ev.dbc');
    expect(rowsOf(card('Attribute definitions'))[0].slice(0, 2)).toEqual(['EvAttr', 'Env var']);
  });

  it('shows network attributes and the statements it skipped', () => {
    show(dbcOf('BU_: A\nEV_ Env: 0 [0|1] "" 0 1 DUMMY_NODE_VECTOR0 Vector__XXX;\nBA_DEF_ "Bus" STRING;\nBA_ "Bus" "CAN";'), 'x.dbc');
    const strips = [...document.querySelectorAll('.strip')].map((s) => s.textContent);
    expect(strips).toContain('Network attributesBus CAN');
    expect(strips).toContain('Not displayed (parsed & skipped)EV_ (1×)');
  });

  it('lists parse problems instead of the all-clear', () => {
    const db = dbcOf('BU_: A\nBO_ 1 M: 8 A\n SG_ Broken this is not a signal\nBO_ nonsense');
    show(db, 'broken.dbc');
    expect(screen.queryByText(/Parsed without problems/)).toBeNull();
    const banner = document.querySelector('.banner.error') as HTMLElement;
    expect(banner.textContent).toBe(
      `${db.problems.length} parse problems. These lines could not be understood and were skipped — the rest of the file is loaded normally.`,
    );
    const problems = card(`Parse problems (${db.problems.length})`);
    const rows = rowsOf(problems);
    expect(rows).toHaveLength(db.problems.length);
    expect(rows[0]).toEqual([String(db.problems[0].line), db.problems[0].reason, db.problems[0].text]);
  });

  it('gives the reasons in German, and the lines as the file has them', () => {
    localStorage.setItem('canviewer.lang', 'de');
    const db = dbcOf('BU_: A\nBO_ 1 M: 8 A\nCM_ SG_ 1 Nope "x";\nBO_ nonsense\nFOO_ bar;');
    show(db, 'broken.dbc');
    const rows = rowsOf(card(`Parse-Probleme (${db.problems.length})`));
    expect(rows).toEqual([
      [String(db.problems[0].line), 'CM_ SG_ verweist auf ein unbekanntes Signal', 'CM_ SG_ 1 Nope "x";'],
      [String(db.problems[1].line), 'fehlerhafte Botschaftsdefinition (BO_)', 'BO_ nonsense'],
      [String(db.problems[2].line), 'unbekannte Anweisung „FOO_“', 'FOO_ bar;'],
    ]);
  });

  it('gives the canmatrix adapter\'s own notes in German, and what canmatrix logged as it wrote it', () => {
    localStorage.setItem('canviewer.lang', 'de');
    const db = dbcOf('BU_: A');
    const logged = 'ERROR canmatrix.formats.arxml: PDU P is a Container-sub-PDU with no header';
    db.problems = [
      { line: 0, reason: 'canmatrix error', text: logged },
      {
        line: 0,
        reason: 'import note',
        text: 'NOTE canviewer_adapter: frame TestFrame holds 3 contained PDUs with 9 signals, which CanViewer does not show',
      },
    ];
    show(db, 'ARXMLContainerTest.arxml');
    expect(rowsOf(card('Parse-Probleme (2)'))).toEqual([
      ['0', 'Fehler von canmatrix', logged],
      ['0', 'Hinweis zum Import', 'HINWEIS canviewer_adapter: Frame TestFrame enthält 3 Contained PDUs mit 9 Signalen, die CanViewer nicht anzeigt'],
    ]);
  });

  it('says "1 parse problem" for one', () => {
    show(dbcOf('BU_: A\nBO_ nonsense'), 'one.dbc');
    expect(within(document.querySelector('.banner.error') as HTMLElement).getByText('1 parse problem.')).toBeTruthy();
  });

  it('shows at most 200 problem rows and says how many more there are', () => {
    const db = dbcOf('BU_: A');
    db.problems = Array.from({ length: 205 }, (_, i) => ({ line: i + 1, text: `junk ${i}`, reason: 'unknown statement' }));
    show(db, 'junk.dbc');
    expect(rowsOf(card('Parse problems (205)'))).toHaveLength(200);
    expect(screen.getByText('… and 5 more problems not shown.')).toBeTruthy();
  });
});
