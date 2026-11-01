// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// Keyboard access in the components (W6): the list panes, the settings menu
// and the network graph's nodes. The browser checks in e2e/ui-checks.mjs run
// the same keys against the built app; these pin the components' own handling.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Selection } from '../App';
import type { DbcDatabase } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { demoDb } from '../test/fixtures';
import { ListPane, type MessageFilter } from './ListPane';
import { NavRail, type Destination } from './NavRail';
import { NetworkGraph } from './NetworkGraph';

/** ListPane as App holds it, with onSelect (opens the detail) and onBrowse (moves the selection) apart. */
function Harness({
  db,
  kind,
  initialSearch = '',
  onSelect,
  onBrowse,
}: {
  db: DbcDatabase;
  kind: 'messages' | 'nodes' | 'tables';
  initialSearch?: string;
  onSelect: (s: Selection) => void;
  onBrowse: (s: Selection) => void;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<MessageFilter>('all');
  return (
    <ListPane
      db={db}
      kind={kind}
      selection={selection}
      onSelect={(s) => {
        setSelection(s);
        onSelect(s);
      }}
      onBrowse={(s) => {
        setSelection(s);
        onBrowse(s);
      }}
      search={search}
      onSearch={setSearch}
      filter={filter}
      onFilter={setFilter}
    />
  );
}

function showList(kind: 'messages' | 'nodes' | 'tables', initialSearch = '') {
  const onSelect = vi.fn();
  const onBrowse = vi.fn();
  const { unmount } = renderWithProviders(
    <Harness db={demoDb()} kind={kind} initialSearch={initialSearch} onSelect={onSelect} onBrowse={onBrowse} />,
  );
  return { onSelect, onBrowse, unmount };
}

const items = () => [...document.querySelectorAll<HTMLElement>('.list-scroll [data-rgh-index]')];
const item = (title: string) => screen.getByText(title).closest<HTMLElement>('[data-rgh-index]')!;
const focusedTitle = () => (document.activeElement as HTMLElement).querySelector('.title')?.textContent;
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement!, { key, ...init });

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('list panes: arrow keys, Home and End', () => {
  it('moves through the messages, selecting and focusing each, and stops at the ends', () => {
    const { onBrowse, onSelect } = showList('messages');
    expect(items().map((i) => i.dataset.rghIndex)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    item('EngineData').focus();

    press('ArrowDown');
    expect(onBrowse).toHaveBeenLastCalledWith({ kind: 'message', rawId: 512, occ: 0 });
    expect(focusedTitle()).toBe('GearboxData');
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });

    press('End');
    expect(focusedTitle()).toBe('J1939_CCVS1');
    press('ArrowDown');
    expect(focusedTitle()).toBe('J1939_CCVS1');

    press('Home');
    expect(focusedTitle()).toBe('EngineData');
    expect(item('EngineData').getAttribute('aria-current')).toBe('true');
    // Moving only browses; Enter or a click opens the detail.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('goes back to the search with ↑ on the first message', () => {
    showList('messages');
    item('EngineData').focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search messages, signals, IDs'));
  });

  it('leaves keys with a modifier, and other keys, alone', () => {
    const { onBrowse } = showList('messages');
    item('BrakeData').focus();
    press('ArrowDown', { shiftKey: true });
    press('ArrowDown', { ctrlKey: true });
    press('PageDown');
    expect(onBrowse).not.toHaveBeenCalled();
    expect(focusedTitle()).toBe('BrakeData');
  });

  it('moves through the nodes and the value tables', () => {
    const nodes = showList('nodes');
    item('ECM').focus();
    press('ArrowDown');
    expect(nodes.onBrowse).toHaveBeenLastCalledWith({ kind: 'node', name: 'TCM' });
    press('End');
    expect(nodes.onBrowse).toHaveBeenLastCalledWith({ kind: 'node', name: 'Tester' });
    nodes.unmount();

    const tables = showList('tables');
    item('GearPositions').focus();
    press('ArrowDown');
    expect(tables.onBrowse).toHaveBeenLastCalledWith({ kind: 'valueTable', name: 'OnOff' });
  });
});

describe('the message search: ↓ and Enter', () => {
  const searchField = () => screen.getByPlaceholderText('Search messages, signals, IDs');

  it('↓ selects the first match and moves the focus to it', () => {
    const { onBrowse } = showList('messages', 'Data');
    searchField().focus();
    press('ArrowDown');
    expect(onBrowse).toHaveBeenCalledWith({ kind: 'message', rawId: 256, occ: 0 });
    expect(focusedTitle()).toBe('EngineData');
  });

  it('Enter opens the first match', () => {
    const { onSelect } = showList('messages', 'Brake');
    searchField().focus();
    press('Enter');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 768, occ: 0 });
  });

  it('does nothing when nothing matches', () => {
    const { onSelect, onBrowse } = showList('messages', 'no such message');
    searchField().focus();
    press('ArrowDown');
    press('Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBrowse).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(searchField());
  });
});

describe('the settings menu', () => {
  const ALL: Record<Destination, boolean> = { overview: true, messages: true, network: true, nodes: true, tables: true };
  const open = () => {
    renderWithProviders(
      <NavRail active="overview" enabled={ALL} badges={{}} onNavigate={() => {}} onOpenFile={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  };
  const focusedItem = () => document.activeElement?.textContent;

  it('focuses the checked language on opening, and the arrow keys, Home and End move between the items', () => {
    open();
    expect(focusedItem()).toBe('English');
    press('ArrowDown');
    expect(focusedItem()).toBe('Deutsch');
    press('Home');
    expect(focusedItem()).toBe('English');
    press('End');
    expect(focusedItem()).toBe('Deutsch');
    press('ArrowUp');
    expect(focusedItem()).toBe('English');
    press('x');
    expect(focusedItem()).toBe('English');
  });

  it('closes with Tab', () => {
    open();
    press('Tab');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the focus moves outside it, but not when it goes nowhere', () => {
    open();
    const menu = screen.getByRole('menu');
    // No related target, as on a click in Safari: the menu stays.
    fireEvent.blur(within(menu).getByText('English').closest('button')!, { relatedTarget: null });
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.blur(within(menu).getByText('English').closest('button')!, {
      relatedTarget: screen.getByRole('button', { name: 'Open file' }),
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the network graph from the keyboard', () => {
  const node = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('.ng-node')].find((g) => g.querySelector('title')?.textContent === name)!;
  const side = () => document.querySelector('.side-card') as HTMLElement;

  it('traces a node while it has the focus, and opens it with Enter or Space', () => {
    renderWithProviders(<NetworkGraph db={demoDb()} fileName="demo.dbc" onSelect={() => {}} />);
    const tester = node('Tester');
    expect(tester.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(tester);
    expect(tester.getAttribute('class')).toContain('sel');
    expect(node('ABS').getAttribute('class')).toContain('dim');
    fireEvent.blur(tester);
    expect(node('ABS').getAttribute('class')).toBe('ng-node ');

    fireEvent.keyDown(tester, { key: 'a' });
    expect(tester.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(tester, { key: 'Enter' });
    expect(tester.getAttribute('aria-pressed')).toBe('true');
    expect(within(side()).getByRole('heading', { name: 'Tester' })).toBeTruthy();

    fireEvent.keyDown(node('ECM'), { key: ' ' });
    expect(within(side()).getByRole('heading', { name: 'ECM' })).toBeTruthy();
    // From the node's card, one of the connections it sends on.
    fireEvent.click(within(side()).getByText('→ TCM'));
    expect(within(side()).getByRole('heading', { name: 'ECM → TCM' })).toBeTruthy();
  });
});
