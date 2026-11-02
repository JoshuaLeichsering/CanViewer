// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb } from '../test/fixtures';
import type { DbcDatabase } from '../lib/dbc/types';
import { NetworkGraph } from './NetworkGraph';

function show(db: DbcDatabase) {
  const onSelect = vi.fn();
  renderWithProviders(<NetworkGraph db={db} fileName="demo.dbc" onSelect={onSelect} />);
  return onSelect;
}

const nodeGroup = (name: string) =>
  [...document.querySelectorAll('.ng-node')].find((g) => g.querySelector('title')?.textContent === name) as Element;
const edgeHit = (from: string, to: string) =>
  [...document.querySelectorAll('.ng-hit')].find((p) =>
    p.querySelector('title')?.textContent?.startsWith(`${from} → ${to}:`),
  ) as Element;
const nodeClasses = () =>
  Object.fromEntries(
    [...document.querySelectorAll('.ng-node')].map((g) => [g.querySelector('title')?.textContent, g.getAttribute('class')]),
  );
const side = () => document.querySelector('.side-card') as HTMLElement;

describe('NetworkGraph', () => {
  it('draws every ECU and every sender → receiver connection', () => {
    show(demoDb());
    expect(screen.getByText('demo.dbc · Topology')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'ECU network' })).toBeTruthy();
    expect(screen.getByText(/Arrows point from sender to receiver/)).toBeTruthy();
    expect([...document.querySelectorAll('.ng-label')].map((e) => e.textContent)).toEqual([
      'ECM',
      'TCM',
      'ABS',
      'IC',
      'Tester',
    ]);
    expect([...document.querySelectorAll('.ng-hit title')].map((e) => e.textContent)).toEqual([
      'ECM → TCM: 1 message',
      'ECM → ABS: 3 messages',
      'ECM → IC: 5 messages',
      'TCM → IC: 1 message',
      'TCM → ECM: 2 messages',
      'TCM → ABS: 1 message',
      'ABS → IC: 1 message',
      'ABS → ECM: 1 message',
      'Tester → ECM: 1 message',
    ]);
    // J1939_EEC1's signals name no receiver.
    expect(document.querySelector('.graph-note')?.textContent).toBe(
      '1 message has no sender or no receivers and is not shown.',
    );
    expect(screen.getByText('Click an ECU or a connection in the graph to list the messages behind it.')).toBeTruthy();
  });

  it('traces a node on hover and lets go again', () => {
    show(demoDb());
    fireEvent.mouseEnter(nodeGroup('Tester'));
    const traced = nodeClasses();
    expect(traced.Tester).toContain('sel');
    // ECM is Tester's only neighbour; the others are dimmed.
    expect(traced.ECM).toBe('ng-node ');
    expect(traced.ABS).toContain('dim');
    expect(document.querySelectorAll('.ng-edge.hi')).toHaveLength(1);
    expect(document.querySelectorAll('.ng-edge.dim')).toHaveLength(8);
    // The highlighted connection shows its message count.
    expect([...document.querySelectorAll('.ng-count')].map((e) => e.textContent)).toEqual(['1']);
    fireEvent.mouseLeave(nodeGroup('Tester'));
    expect(Object.values(nodeClasses()).every((c) => c === 'ng-node ')).toBe(true);
  });

  it('lists a clicked node’s connections, opens one, and opens a message from it', () => {
    const onSelect = show(demoDb());
    fireEvent.click(nodeGroup('ABS'));
    expect(within(side()).getByText('ECU')).toBeTruthy();
    expect(within(side()).getByRole('heading', { name: 'ABS' })).toBeTruthy();
    const rows = [...side().querySelectorAll('.link-row')].map((r) => r.textContent);
    expect(rows).toEqual(['→ IC1 msg', '→ ECM1 msg', '← ECM3 msg', '← TCM1 msg']);

    fireEvent.click(within(side()).getByText('← ECM'));
    expect(within(side()).getByText('Connection')).toBeTruthy();
    expect(within(side()).getByRole('heading', { name: 'ECM → ABS' })).toBeTruthy();
    expect(within(side()).getByText('3 messages')).toBeTruthy();
    expect([...side().querySelectorAll('.msg-row .name')].map((e) => e.textContent)).toEqual([
      'EngineData',
      'GearboxData',
      'AdasObjects',
    ]);
    // Both ends of the selected connection are marked.
    expect(nodeClasses().ECM).toContain('sel');
    expect(nodeClasses().ABS).toContain('sel');
    expect(nodeClasses().IC).toContain('dim');

    fireEvent.click(within(side()).getByText('AdasObjects'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 1536, occ: 0 });
  });

  it('opens the node view from a selected ECU', () => {
    const onSelect = show(demoDb());
    fireEvent.click(nodeGroup('IC'));
    // IC sends nothing.
    expect(within(side()).getByText('nothing')).toBeTruthy();
    fireEvent.click(within(side()).getByRole('button', { name: 'Open node' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'node', name: 'IC' });
  });

  it('selects a connection by clicking its line, and clears the selection on the background', () => {
    show(demoDb());
    fireEvent.click(edgeHit('TCM', 'ECM'));
    expect(within(side()).getByRole('heading', { name: 'TCM → ECM' })).toBeTruthy();
    expect(within(side()).getByText('2 messages')).toBeTruthy();
    expect(document.querySelectorAll('.ng-edge.hi')).toHaveLength(1);
    fireEvent.click(document.querySelector('svg.netgraph')!);
    expect(screen.getByText(/Click an ECU or a connection/)).toBeTruthy();
    expect(document.querySelectorAll('.ng-edge.hi, .ng-edge.dim')).toHaveLength(0);
  });

  it('draws nothing but says why when no message links two nodes', () => {
    show(dbcOf('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" Vector__XXX'));
    expect(screen.getByText(/contains no sender → receiver relationships/)).toBeTruthy();
    expect(document.querySelector('svg.netgraph')).toBeNull();
  });

  it('names isolated nodes, skips self-links, and includes receivers missing from BU_', () => {
    const db = dbcOf(
      'BU_: A Lonely\nBO_ 1 ToB: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" B\n' +
        'BO_ 2 ToSelf: 8 A\n SG_ T : 0|8@1+ (1,0) [0|255] "" A',
    );
    show(db);
    expect([...document.querySelectorAll('.ng-label')].map((e) => e.textContent)).toEqual(['A', 'B']);
    expect(document.querySelector('.graph-note')?.textContent).toBe(
      'Not connected: Lonely. 1 message has no sender or no receivers and is not shown.',
    );
    // B is not declared in BU_, so there is no node view to open.
    fireEvent.click(nodeGroup('B'));
    expect(within(side()).getByRole('heading', { name: 'B' })).toBeTruthy();
    expect(within(side()).queryByRole('button', { name: 'Open node' })).toBeNull();
  });
});
