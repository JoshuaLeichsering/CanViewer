// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb } from '../test/fixtures';
import type { DbcDatabase } from '../lib/dbc/types';
import { ValueTableDetail } from './ValueTableDetail';
import { AttributesCard } from './AttributesCard';

function show(db: DbcDatabase, name: string) {
  const onSelect = vi.fn();
  const table = db.valueTables.find((t) => t.name === name)!;
  renderWithProviders(<ValueTableDetail db={db} fileName="demo.dbc" table={table} onSelect={onSelect} />);
  return onSelect;
}

const rows = () =>
  [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe('ValueTableDetail', () => {
  it('lists the entries sorted by raw value, with the raw value in hex', () => {
    show(demoDb(), 'GearPositions');
    expect(screen.getByRole('heading', { level: 1, name: 'GearPositions' })).toBeTruthy();
    expect(screen.getByText('demo.dbc · Value table')).toBeTruthy();
    expect(rows()).toEqual([
      ['0', '0x00', 'Neutral'],
      ['1', '0x01', 'Gear 1'],
      ['2', '0x02', 'Gear 2'],
      ['3', '0x03', 'Gear 3'],
      ['4', '0x04', 'Gear 4'],
      ['5', '0x05', 'Gear 5'],
      ['6', '0x06', 'Gear 6'],
      ['15', '0x0F', 'Reverse'],
    ]);
  });

  it('names the signals whose value descriptions are the same, and opens one', () => {
    const onSelect = show(demoDb(), 'GearPositions');
    expect(screen.getByText('Same values used by')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'GearboxData.GearPosition' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'message', rawId: 512, occ: 0, signal: 'GearPosition' });
  });

  it('shows no back-references when no signal has the same values', () => {
    // OnOff is 0 "Off" 1 "On"; no signal in demo.dbc uses exactly that.
    show(demoDb(), 'OnOff');
    expect(screen.queryByText('Same values used by')).toBeNull();
  });

  it('leaves the hex column empty for negative raw values', () => {
    show(dbcOf('VAL_TABLE_ Signed -1 "Minus one" 1 "One" ;'), 'Signed');
    expect(rows()).toEqual([
      ['-1', '', 'Minus one'],
      ['1', '0x01', 'One'],
    ]);
  });
});

describe('AttributesCard', () => {
  it('lists the attributes under its title', () => {
    renderWithProviders(<AttributesCard title="Message attributes" attributes={{ GenMsgCycleTime: 10, Kind: 'Cyclic' }} />);
    expect(screen.getByRole('heading', { name: 'Message attributes' })).toBeTruthy();
    expect(rows()).toEqual([
      ['GenMsgCycleTime', '10'],
      ['Kind', 'Cyclic'],
    ]);
  });

  it('renders nothing without attributes', () => {
    const { container } = renderWithProviders(<AttributesCard title="Message attributes" attributes={{}} />);
    expect(container.innerHTML).toBe('');
  });
});
