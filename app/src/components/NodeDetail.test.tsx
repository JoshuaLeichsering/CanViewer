// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb } from '../test/fixtures';
import type { DbcDatabase } from '../lib/dbc/types';
import { NodeDetail } from './NodeDetail';

function show(db: DbcDatabase, name: string) {
  const onSelect = vi.fn();
  const node = db.nodes.find((n) => n.name === name)!;
  renderWithProviders(<NodeDetail db={db} fileName="demo.dbc" node={node} onSelect={onSelect} />);
  return onSelect;
}

const fact = (label: string) =>
  [...document.querySelectorAll('.facts .fact')].find((f) => f.querySelector('.k')?.textContent === label)
    ?.querySelector('.v')?.textContent;
const card = (heading: string) => screen.getByRole('heading', { name: heading }).closest('.card') as HTMLElement;
const rowsOf = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe('NodeDetail', () => {
  it('shows the node with its comment, traffic counts and attributes', () => {
    show(demoDb(), 'TCM');
    expect(screen.getByRole('heading', { level: 1, name: 'TCM' })).toBeTruthy();
    expect(screen.getByText('demo.dbc · Node')).toBeTruthy();
    expect(screen.getByText('Transmission Control Module')).toBeTruthy();
    expect(fact('Transmits')).toBe('2 messages');
    expect(fact('Receives')).toBe('4 signals');
    expect(fact('NodeAddress')).toBe('24');
  });

  it('lists what the node transmits, extra transmitters included, and opens a message', () => {
    const onSelect = show(demoDb(), 'ECM');
    const rows = rowsOf(card('Transmitted messages'));
    expect(rows.map((r) => r[1])).toEqual([
      'EngineData',
      'GearboxData',
      'PowerData',
      'J1939_EEC1J1939',
      'J1939_CCVS1J1939',
      'AdasObjectsFD',
    ]);
    expect(rows[0]).toEqual(['0x100', 'EngineData', '8', '6', '10']);
    // PowerData has no cycle time.
    expect(rows[2][4]).toBe('');
    fireEvent.click(screen.getByText('PowerData').closest('tr')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 1280, occ: 0 });
  });

  it('lists the signals the node receives, and opens one in its message', () => {
    const onSelect = show(demoDb(), 'TCM');
    const rows = rowsOf(card('Received signals'));
    expect(rows[0]).toEqual(['EngineSpeed', 'EngineData', '0x100', 'rpm', 'ECM']);
    expect(rows.map((r) => r[0])).toEqual(['EngineSpeed', 'ThrottlePosition', 'EngineTorque', 'TorqueRequest']);
    fireEvent.click(screen.getByText('TorqueRequest').closest('tr')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 256, occ: 0, signal: 'TorqueRequest' });
  });

  it('says so when a node receives nothing', () => {
    show(demoDb(), 'Tester');
    expect(fact('Receives')).toBe('0 signals');
    expect(screen.getByText('This node receives no signals.')).toBeTruthy();
  });

  it('says so when a node transmits nothing, and dashes a missing unit', () => {
    const db = dbcOf('BU_: Rx Tx\nBO_ 1 M: 8 Tx\n SG_ S : 0|8@1+ (1,0) [0|255] "" Rx');
    show(db, 'Rx');
    expect(fact('Transmits')).toBe('0 messages');
    expect(fact('Receives')).toBe('1 signal');
    expect(screen.getByText('This node transmits no messages.')).toBeTruthy();
    expect(rowsOf(card('Received signals'))[0]).toEqual(['S', 'M', '0x001', '—', 'Tx']);
  });

  it('says "1 message" for a single transmitted message', () => {
    show(demoDb(), 'Tester');
    expect(fact('Transmits')).toBe('1 message');
  });
});
