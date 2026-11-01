import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDbc } from '../lib/dbc/parser';
import { SignalTable, type SignalTableState } from './SignalTable';

const demo = parseDbc(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo.dbc'), 'utf8'),
);
const engine = demo.messages.find((m) => m.name === 'EngineData')!;

// The markup is React's own server rendering, so plain patterns read it reliably.
function render(initial?: Partial<SignalTableState>, selectedSignal?: string) {
  const html = renderToStaticMarkup(
    <SignalTable message={engine} selectedSignal={selectedSignal} onToggleSignal={() => {}} initial={initial} />,
  );
  const headerCells = [...html.matchAll(/<th\b([^>]*)>(.*?)<\/th>/g)].map(([, attrs, inner]) => ({
    sort: /aria-sort="(\w+)"/.exec(attrs)?.[1],
    buttons: (inner.match(/<button\b/g) ?? []).length,
    label: inner.replace(/<[^>]+>/g, ''),
  }));
  const body = /<tbody>(.*)<\/tbody>/s.exec(html)![1];
  const rows = [...body.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/g)].map(([, row]) => row);
  // Name cell: <span class="sig-chip tone-N">NN</span>Name
  const named = rows.flatMap((row) => {
    const m = /<span class="sig-chip tone-(\d)">(\d+)<\/span>([^<]+)<\/span>/.exec(row);
    return m ? [{ tone: Number(m[1]), chip: m[2], name: m[3] }] : [];
  });
  const filterRow = /<tr[^>]*class="tbl-filter-row"[^>]*>/.exec(html)?.[0] ?? '';
  const inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attrs]) => ({
    label: /aria-label="([^"]*)"/.exec(attrs)?.[1],
    value: /value="([^"]*)"/.exec(attrs)?.[1] ?? '',
    invalid: /aria-invalid="true"/.test(attrs),
  }));
  return { html, headerCells, rows, named, filterRowHidden: /\bhidden=""/.test(filterRow), inputs };
}

describe('SignalTable', () => {
  it('has a sort button in every column header and no sort at first', () => {
    const { headerCells, named } = render();
    expect(headerCells.map((h) => h.label)).toEqual([
      'Name',
      'Mux',
      'Start',
      'Length',
      'Byte order',
      'Type',
      'Factor',
      'Offset',
      'Min',
      'Max',
      'Unit',
      'Receivers',
    ]);
    expect(headerCells.every((h) => h.buttons === 1)).toBe(true);
    expect(headerCells.every((h) => h.sort === undefined)).toBe(true);
    expect(named.map((r) => r.name)).toEqual(engine.signals.map((s) => s.name));
    expect(named.map((r) => r.chip)).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  it('marks the sorted column with aria-sort and keeps every signal’s number and tone', () => {
    const { headerCells, named } = render({ sort: { column: 'startBit', direction: 'descending' } });
    expect(headerCells.filter((h) => h.sort !== undefined)).toEqual([
      expect.objectContaining({ label: 'Start', sort: 'descending' }),
    ]);
    expect(named.map((r) => r.name)).toEqual([
      'EngineRunning',
      'TorqueRequest',
      'EngineTorque',
      'ThrottlePosition',
      'EngineTemp',
      'EngineSpeed',
    ]);
    // Chip numbers and tones follow the signal's position in the message, as in the bit layout.
    expect(named.map((r) => r.chip)).toEqual(['06', '05', '04', '03', '02', '01']);
    expect(named.map((r) => r.tone)).toEqual([2, 1, 0, 2, 1, 0]);

    const asc = render({ sort: { column: 'name', direction: 'ascending' } });
    expect(asc.headerCells.find((h) => h.sort)).toEqual(expect.objectContaining({ label: 'Name', sort: 'ascending' }));
  });

  it('keeps the filter row hidden until it is opened', () => {
    const closed = render();
    expect(closed.filterRowHidden).toBe(true);
    const open = render({ filtersOpen: true });
    expect(open.filterRowHidden).toBe(false);
    expect(open.inputs.map((i) => i.label)).toEqual([
      'Filter Name',
      'Filter Mux',
      'Filter Start',
      'Filter Length',
      'Filter Byte order',
      'Filter Type',
      'Filter Factor',
      'Filter Offset',
      'Filter Min',
      'Filter Max',
      'Filter Unit',
      'Filter Receivers',
    ]);
    expect(open.html).toContain('aria-expanded="true"');
    expect(closed.html).toContain('aria-expanded="false"');
  });

  it('shows only the signals that match the filters, and how many of them', () => {
    const { named, html, inputs } = render({ filtersOpen: true, filters: { unit: 'Nm', startBit: '>40' } });
    expect(named.map((r) => r.name)).toEqual(['TorqueRequest']);
    expect(named.map((r) => r.chip)).toEqual(['05']);
    expect(html).toContain('1 of 6 shown');
    expect(html).toContain('Clear filters');
    expect(inputs.find((i) => i.label === 'Filter Unit')!.value).toBe('Nm');
  });

  it('marks a number filter it cannot read and ignores it', () => {
    const { named, inputs, html } = render({ filtersOpen: true, filters: { length: '>>' } });
    expect(named).toHaveLength(6);
    expect(inputs.filter((i) => i.invalid).map((i) => i.label)).toEqual(['Filter Length']);
    expect(html).toContain('The Length filter cannot be read and is ignored.');
  });

  it('says so when no signal matches, with a way out', () => {
    const { rows } = render({ filtersOpen: true, filters: { name: 'nothing like this' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/colspan="12"/i);
    expect(rows[0]).toContain('No signals match the filters.');
    expect(rows[0]).toContain('Clear filters');
  });

  it('highlights the selected signal wherever it is sorted to', () => {
    const { html, named } = render({ sort: { column: 'name', direction: 'ascending' } }, 'EngineTemp');
    expect(named.map((r) => r.name).indexOf('EngineTemp')).toBe(2);
    const body = /<tbody>(.*)<\/tbody>/s.exec(html)![1];
    const classes = [...body.matchAll(/<tr class="([^"]*)"/g)].map(([, c]) => c.trim());
    expect(classes).toEqual(['clickable', 'clickable', 'clickable selected', 'clickable', 'clickable', 'clickable']);
  });
});
