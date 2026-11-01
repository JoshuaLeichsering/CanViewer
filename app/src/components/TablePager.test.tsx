import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDbc } from '../lib/dbc/parser';
import type { DbcDatabase } from '../lib/dbc/types';
import { Overview } from './Overview';
import { TablePager } from './TablePager';

/** A database of `count` standard frames named Msg_0000, Msg_0001, ... with one signal each. */
function generated(count: number): DbcDatabase {
  const lines = ['VERSION ""', 'BU_: ECU', ''];
  for (let i = 0; i < count; i++) {
    lines.push(`BO_ ${i} Msg_${String(i).padStart(4, '0')}: 8 ECU`, ` SG_ S${i} : 0|8@1+ (1,0) [0|255] "" ECU`, '');
  }
  return parseDbc(lines.join('\n'));
}

/** The Overview's message table: the names in its rows, and its pager's markup if it has one. */
function renderOverview(db: DbcDatabase) {
  const html = renderToStaticMarkup(<Overview db={db} fileName="generated.dbc" onSelect={() => {}} />);
  const card = /<h2>Messages<\/h2>(.*?)<\/table>/s.exec(html)![1];
  const names = [...card.matchAll(/<td class="strong nowrap">([^<]*)/g)].map(([, name]) => name);
  const pager = /<div class="tbl-pager"[^>]*>.*?<\/div>/s.exec(card)?.[0] ?? null;
  return { names, pager };
}

describe("the Overview's message table", () => {
  it('shows every message of a database with 1000 messages, without a pager', () => {
    const { names, pager } = renderOverview(generated(1000));
    expect(names).toHaveLength(1000);
    expect(names[999]).toBe('Msg_0999');
    expect(pager).toBeNull();
  });

  it('shows the first 200 messages of a larger database, with a pager', () => {
    const { names, pager } = renderOverview(generated(1001));
    expect(names).toHaveLength(200);
    expect([names[0], names[199]]).toEqual(['Msg_0000', 'Msg_0199']);
    expect(pager).toContain('role="group" aria-label="Pages of the message table"');
    expect(pager).toContain('1–200 of 1001');
  });
});

describe('TablePager', () => {
  const render = (page: number, pages: number, start: number, end: number, total: number) => {
    const html = renderToStaticMarkup(
      <TablePager pager={{ page, pages, start, end, setPage: () => {} }} total={total} label="Pages" />,
    );
    return {
      range: /<span class="tbl-pager-range"[^>]*>([^<]*)</.exec(html)![1],
      buttons: [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
        label: /aria-label="([^"]*)"/.exec(attrs)![1],
        disabled: /aria-disabled="true"/.test(attrs),
      })),
      html,
    };
  };

  it('labels its four buttons and marks those at an end aria-disabled, not disabled', () => {
    const first = render(0, 25, 0, 200, 5000);
    expect(first.range).toBe('1–200 of 5000');
    expect(first.buttons).toEqual([
      { label: 'First page', disabled: true },
      { label: 'Previous page', disabled: true },
      { label: 'Next page', disabled: false },
      { label: 'Last page', disabled: false },
    ]);
    // A disabled button would drop the keyboard focus when it reaches the end.
    expect(first.html).not.toMatch(/\sdisabled=""/);

    const middle = render(12, 25, 2400, 2600, 5000);
    expect(middle.range).toBe('2401–2600 of 5000');
    expect(middle.buttons.map((b) => b.disabled)).toEqual([false, false, false, false]);

    const last = render(24, 25, 4800, 5000, 5000);
    expect(last.range).toBe('4801–5000 of 5000');
    expect(last.buttons.map((b) => b.disabled)).toEqual([false, false, true, true]);
  });

  it('announces the range when it changes', () => {
    expect(render(0, 2, 0, 200, 300).html).toContain('<span class="tbl-pager-range" aria-live="polite">');
  });
});
