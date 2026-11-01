// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Selection } from '../App';
import type { DbcDatabase } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb } from '../test/fixtures';
import { ListPane, type MessageFilter } from './ListPane';

/** ListPane is controlled; this holds its state the way App does. */
function Harness({
  db,
  kind,
  initial = { kind: 'overview' },
  onSelect,
}: {
  db: DbcDatabase;
  kind: 'messages' | 'nodes' | 'tables';
  initial?: Selection;
  onSelect?: (s: Selection) => void;
}) {
  const [selection, setSelection] = useState<Selection>(initial);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MessageFilter>('all');
  return (
    <ListPane
      db={db}
      kind={kind}
      selection={selection}
      onSelect={(s) => {
        setSelection(s);
        onSelect?.(s);
      }}
      search={search}
      onSearch={setSearch}
      filter={filter}
      onFilter={setFilter}
    />
  );
}

const titles = () => [...document.querySelectorAll('.list-item .title')].map((e) => e.textContent);
const search = (q: string) => fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: q } });

describe('ListPane: messages', () => {
  it('lists every message sorted by id, with sender, signal count, cycle time and tag', () => {
    renderWithProviders(<Harness db={demoDb()} kind="messages" />);
    expect(screen.getByText('Messages · 9')).toBeTruthy();
    expect(titles()).toEqual([
      'EngineData',
      'GearboxData',
      'BrakeData',
      'DiagData',
      'PowerData',
      'AdasObjects',
      'J1939_TSC1',
      'J1939_EEC1',
      'J1939_CCVS1',
    ]);
    const engine = screen.getByText('EngineData').closest('button')!;
    expect(within(engine).getByText('0x100')).toBeTruthy();
    expect(within(engine).getByText('ECM · 6 signals · 10 ms')).toBeTruthy();
    const adas = screen.getByText('AdasObjects').closest('button')!;
    expect(adas.querySelector('.tag')?.textContent).toBe('FD');
    const eec1 = screen.getByText('J1939_EEC1').closest('button')!;
    expect(eec1.querySelector('.tag')?.textContent).toBe('J1939');
    expect(within(eec1).getByText('0x0CF00400')).toBeTruthy();
    // No cycle time attribute: the sub line leaves it out.
    expect(within(screen.getByText('DiagData').closest('button')!).getByText('Tester · 4 signals')).toBeTruthy();
  });

  it('says "1 signal" for a single signal and leaves out a zero cycle time', () => {
    const db = dbcOf(
      'BU_: A\nBO_ 1 One: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n' +
        'BA_DEF_ BO_ "GenMsgCycleTime" INT 0 1000;\nBA_ "GenMsgCycleTime" BO_ 1 0;',
    );
    renderWithProviders(<Harness db={db} kind="messages" />);
    expect(screen.getByText('A · 1 signal')).toBeTruthy();
  });

  it('selects a message on click and marks it as current', () => {
    const onSelect = vi.fn();
    renderWithProviders(<Harness db={demoDb()} kind="messages" onSelect={onSelect} />);
    const item = screen.getByText('BrakeData').closest('button')!;
    expect(item.getAttribute('aria-current')).toBeNull();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 768, occ: 0 });
    expect(item.getAttribute('aria-current')).toBe('true');
    expect(item.className).toContain('active');
  });

  it('searches names, signal names, hex ids with or without 0x and leading zeros, and decimal ids', () => {
    renderWithProviders(<Harness db={demoDb()} kind="messages" />);
    search('gearbox');
    expect(titles()).toEqual(['GearboxData']);
    expect(screen.getByText('Messages · 1 / 9')).toBeTruthy();
    // A signal name finds its message.
    search('Wheel');
    expect(titles()).toEqual(['BrakeData', 'J1939_CCVS1']);
    // The zero-padded form as displayed, and the bare hex digits.
    search('0x0CF0');
    expect(titles()).toEqual(['J1939_EEC1']);
    search('0x00000300');
    expect(titles()).toEqual(['BrakeData']);
    search('cf00400');
    expect(titles()).toEqual(['J1939_EEC1']);
    // Decimal ids.
    search('1280');
    expect(titles()).toEqual(['PowerData']);
  });

  it('shows an empty state for a search without matches, and clears the search', () => {
    renderWithProviders(<Harness db={demoDb()} kind="messages" />);
    search('no such thing');
    expect(titles()).toEqual([]);
    expect(screen.getByText('No messages match “no such thing”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(titles()).toHaveLength(9);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('filters extended and CAN FD frames with the chips', () => {
    renderWithProviders(<Harness db={demoDb()} kind="messages" />);
    const chips = screen.getAllByRole('radio');
    expect(chips.map((c) => c.textContent)).toEqual(['All', 'Extended', 'CAN FD']);
    expect(chips[0].getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Extended' }));
    expect(titles()).toEqual(['J1939_TSC1', 'J1939_EEC1', 'J1939_CCVS1']);
    expect(screen.getByRole('radio', { name: 'Extended' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Messages · 3 / 9')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'CAN FD' }));
    expect(titles()).toEqual(['AdasObjects']);

    // Filter and search combine.
    search('Engine');
    expect(titles()).toEqual([]);
    expect(screen.getByText('No messages match “Engine”.')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    // EngineSpeedJ1939 is a signal of J1939_EEC1.
    expect(titles()).toEqual(['EngineData', 'J1939_EEC1']);
  });

  it('says so when a filter matches nothing', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Classic: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A');
    renderWithProviders(<Harness db={db} kind="messages" />);
    fireEvent.click(screen.getByRole('radio', { name: 'CAN FD' }));
    expect(screen.getByText('No messages of this kind.')).toBeTruthy();
  });

  it('keeps messages with a duplicate id apart by their occurrence', () => {
    const db = dbcOf(
      'BU_: A\nBO_ 5 First: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\nBO_ 5 Second: 8 A\n SG_ T : 0|8@1+ (1,0) [0|255] "" A',
    );
    const onSelect = vi.fn();
    renderWithProviders(<Harness db={db} kind="messages" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Second').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 5, occ: 1 });
    expect(screen.getByText('First').closest('button')!.getAttribute('aria-current')).toBeNull();
  });
});

describe('ListPane: nodes', () => {
  it('lists the nodes with their comment and traffic counts, and selects one', () => {
    const onSelect = vi.fn();
    renderWithProviders(<Harness db={demoDb()} kind="nodes" onSelect={onSelect} />);
    expect(screen.getByText('Nodes · 5')).toBeTruthy();
    expect(titles()).toEqual(['ECM', 'TCM', 'ABS', 'IC', 'Tester']);
    // ECM sends EngineData, PowerData, AdasObjects, two J1939 PGs and (as an
    // extra transmitter) GearboxData; 12 signals name it as a receiver.
    expect(screen.getByText('Engine Control Module · 6 tx · 12 rx')).toBeTruthy();
    // Tester has no comment: the counts alone.
    expect(screen.getByText('1 tx · 0 rx')).toBeTruthy();
    const ic = screen.getByText('Instrument Cluster · 0 tx · 17 rx').closest('button')!;
    expect(ic.querySelector('.avatar')?.textContent).toBe('IC');
    fireEvent.click(ic);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'node', name: 'IC' });
    expect(ic.getAttribute('aria-current')).toBe('true');
  });
});

describe('ListPane: value tables', () => {
  it('lists the value tables with their entry counts, and selects one', () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <Harness db={demoDb()} kind="tables" initial={{ kind: 'valueTable', name: 'GearPositions' }} onSelect={onSelect} />,
    );
    expect(screen.getByText('Value tables · 2')).toBeTruthy();
    expect(screen.getByText('8 entries')).toBeTruthy();
    expect(screen.getByText('2 entries')).toBeTruthy();
    expect(screen.getByText('GearPositions').closest('button')!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByText('OnOff').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'valueTable', name: 'OnOff' });
  });

  it('says "1 entry" for a single entry', () => {
    const db = dbcOf('VAL_TABLE_ Single 0 "Only" ;');
    renderWithProviders(<Harness db={db} kind="tables" />);
    expect(screen.getByText('1 entry')).toBeTruthy();
  });
});
