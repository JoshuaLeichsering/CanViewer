import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDbc } from '../lib/dbc/parser';
import type { DbcDatabase } from '../lib/dbc/types';
import { ListPane, type MessageFilter } from './ListPane';
import type { Selection } from '../App';

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

describe('the message list', () => {
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
