// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Selection } from '../App';
import { parseDbc } from '../lib/dbc/parser';
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

/** A database of `count` standard frames named Msg_0000, Msg_0001, ... with one signal each. */
function generated(count: number): DbcDatabase {
  const lines = ['VERSION ""', 'BU_: ECU', ''];
  for (let i = 0; i < count; i++) {
    lines.push(`BO_ ${i} Msg_${String(i).padStart(4, '0')}: 8 ECU`, ` SG_ S${i} : 0|8@1+ (1,0) [0|255] "" ECU`, '');
  }
  return parseDbc(lines.join('\n'));
}

function renderList(db: DbcDatabase, { search = '', filter = 'all' as MessageFilter, selection = { kind: 'overview' } as Selection } = {}) {
  const html = renderToStaticMarkup(
    <ListPane
      db={db}
      kind="messages"
      selection={selection}
      onSelect={() => {}}
      search={search}
      onSearch={() => {}}
      filter={filter}
      onFilter={() => {}}
    />,
  );
  const titles = [...html.matchAll(/<span class="title">([^<]*)<\/span>/g)].map(([, title]) => title);
  const virtual = html.includes('data-testid="tbl-virtual-list"');
  // React writes 0 without a unit: padding-top:0;padding-bottom:57660px
  const padding = /padding-top:(\d+)(?:px)?;padding-bottom:(\d+)(?:px)?/.exec(html);
  return { html, titles, virtual, padTop: Number(padding?.[1] ?? 0), padBottom: Number(padding?.[2] ?? 0) };
}

describe('ListPane: the message list above 1000 messages', () => {
  // The list measures its rows in layout effects. Server rendering, which these
  // tests use to read the markup, skips them and says so on every render; only
  // that warning is silenced, any other error still shows.
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('renders every message of a database with 1000 messages', () => {
    const { titles, virtual } = renderList(generated(1000));
    expect(virtual).toBe(false);
    expect(titles).toHaveLength(1000);
    expect(titles[titles.length - 1]).toBe('Msg_0999');
  });

  it('renders only the first rows of a database with more than 1000 messages, with space for the rest', () => {
    const { titles, virtual, html, padTop, padBottom } = renderList(generated(1001));
    expect(virtual).toBe(true);
    // Before the first layout says how many rows fit, the list renders 40.
    expect(titles).toHaveLength(40);
    expect(titles[0]).toBe('Msg_0000');
    expect(titles[titles.length - 1]).toBe('Msg_0039');
    // The padding stands in for the other rows (60 px each until measured),
    // so the scrollbar has the length of the whole list.
    expect(padTop).toBe(0);
    expect(padBottom).toBe((1001 - 40) * 60);
    expect(html).toContain('Messages · 1001');
  });

  it('decides by the size of the database, not by how many messages the search leaves', () => {
    const db = generated(5000);
    const search = renderList(db, { search: 'Msg_00' });
    expect(search.html).toContain('Messages · 100 / 5000');
    expect(search.virtual).toBe(true);
    expect(search.titles).toHaveLength(40);
    expect(search.padBottom).toBe((100 - 40) * 60);

    const one = renderList(db, { search: 'Msg_4321' });
    expect(one.titles).toEqual(['Msg_4321']);
    expect([one.padTop, one.padBottom]).toEqual([0, 0]);
  });

  it('shows the empty note in a virtualized list as well', () => {
    const { titles, html } = renderList(generated(2000), { search: 'no such message' });
    expect(titles).toEqual([]);
    expect(html).toContain('No messages match “no such message”.');
  });

  it('marks the selected message in a virtualized list', () => {
    const db = generated(2000);
    const { html } = renderList(db, { selection: { kind: 'message', rawId: 3, occ: 0 } });
    const active = [...html.matchAll(/<button class="list-item state active"[^>]*>.*?<span class="title">([^<]*)</g)];
    expect(active.map(([, title]) => title)).toEqual(['Msg_0003']);
    expect(html).toContain('aria-current="true"');
  });
});
