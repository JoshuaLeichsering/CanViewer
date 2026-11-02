// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { revealScrollTop, rowSegments, rowWindow, shouldVirtualize, VIRTUALIZE_ABOVE } from './virtual-window';

describe('shouldVirtualize', () => {
  it('virtualizes databases with more than 1000 messages only', () => {
    expect(VIRTUALIZE_ABOVE).toBe(1000);
    expect(shouldVirtualize(0)).toBe(false);
    expect(shouldVirtualize(1000)).toBe(false);
    expect(shouldVirtualize(1001)).toBe(true);
    expect(shouldVirtualize(5000)).toBe(true);
  });
});

describe('rowWindow', () => {
  const base = { count: 5000, rowHeight: 60, viewportHeight: 600, overscan: 5 };

  it('renders the visible rows and the overscan below them at the top', () => {
    expect(rowWindow({ ...base, scrollTop: 0 })).toEqual({ start: 0, end: 15, padTop: 0, padBottom: (5000 - 15) * 60 });
  });

  it('renders the overscan on both sides in the middle', () => {
    // Rows 1000 to 1009 are visible at scrollTop 60 000; 5 more on each side.
    const w = rowWindow({ ...base, scrollTop: 60_000 });
    expect(w).toEqual({ start: 995, end: 1015, padTop: 995 * 60, padBottom: (5000 - 1015) * 60 });
  });

  it('counts a partly visible row as visible', () => {
    const w = rowWindow({ ...base, overscan: 0, scrollTop: 30 });
    expect([w.start, w.end]).toEqual([0, 11]);
  });

  it('keeps the total height constant: padding plus rendered rows', () => {
    for (const scrollTop of [0, 1234, 150_000, 299_400, 1e9]) {
      const w = rowWindow({ ...base, scrollTop });
      expect(w.padTop + (w.end - w.start) * base.rowHeight + w.padBottom).toBe(5000 * 60);
    }
  });

  it('clamps at the end of the list and past it', () => {
    const end = rowWindow({ ...base, scrollTop: 5000 * 60 - 600 });
    expect([end.start, end.end, end.padBottom]).toEqual([4985, 5000, 0]);
    const past = rowWindow({ ...base, scrollTop: 1e9 });
    expect([past.start, past.end]).toEqual([5000, 5000]);
  });

  it('treats a negative scroll position (overscroll bounce) as the top', () => {
    expect(rowWindow({ ...base, scrollTop: -80 }).start).toBe(0);
  });

  it('subtracts the offset of the rows inside the scroll container', () => {
    const w = rowWindow({ ...base, overscan: 0, scrollTop: 600, offsetTop: 120 });
    // 480 px of rows are above the viewport: rows 8 to 17 are visible.
    expect([w.start, w.end]).toEqual([8, 18]);
  });

  it('renders nothing for an empty list and everything for a short one', () => {
    expect(rowWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(rowWindow({ ...base, count: 3, scrollTop: 0 })).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 });
  });

  it('renders the first rows when the viewport has no height yet', () => {
    const w = rowWindow({ ...base, viewportHeight: 0, scrollTop: 0 });
    expect([w.start, w.end]).toEqual([0, 5]);
  });

  it('falls back to rendering every row for a row height it cannot use', () => {
    for (const rowHeight of [0, -1, Number.NaN]) {
      expect(rowWindow({ ...base, rowHeight, scrollTop: 0 })).toEqual({ start: 0, end: 5000, padTop: 0, padBottom: 0 });
    }
  });
});

describe('revealScrollTop', () => {
  const view = { rowHeight: 60, viewportHeight: 600 };

  it('leaves a fully visible row where it is', () => {
    expect(revealScrollTop({ ...view, index: 12, scrollTop: 600 })).toBeNull();
    expect(revealScrollTop({ ...view, index: 10, scrollTop: 600 })).toBeNull();
    expect(revealScrollTop({ ...view, index: 19, scrollTop: 600 })).toBeNull();
  });

  it('scrolls up to a row above the viewport, aligning it to the top', () => {
    expect(revealScrollTop({ ...view, index: 3, scrollTop: 600 })).toBe(180);
    expect(revealScrollTop({ ...view, index: 9, scrollTop: 590 })).toBe(540);
  });

  it('scrolls down to a row below the viewport, aligning it to the bottom', () => {
    expect(revealScrollTop({ ...view, index: 20, scrollTop: 600 })).toBe(660);
    expect(revealScrollTop({ ...view, index: 4999, scrollTop: 0 })).toBe(5000 * 60 - 600);
  });

  it('takes the offset of the rows into account', () => {
    expect(revealScrollTop({ ...view, index: 0, scrollTop: 200, offsetTop: 100 })).toBe(100);
    expect(revealScrollTop({ ...view, index: 9, scrollTop: 0, offsetTop: 100 })).toBe(100);
  });

  it('aligns a row taller than the viewport to the top', () => {
    expect(revealScrollTop({ rowHeight: 60, viewportHeight: 40, index: 5, scrollTop: 0 })).toBe(300);
  });

  it('does nothing for an index outside the list or an unusable row height', () => {
    expect(revealScrollTop({ ...view, index: -1, scrollTop: 0 })).toBeNull();
    expect(revealScrollTop({ ...view, rowHeight: 0, index: 5, scrollTop: 0 })).toBeNull();
  });
});

describe('rowSegments', () => {
  it('renders just the window without a focused row, or with one inside it', () => {
    expect(rowSegments(100, 130, 5000)).toEqual([[100, 130]]);
    expect(rowSegments(100, 130, 5000, -1)).toEqual([[100, 130]]);
    expect(rowSegments(100, 130, 5000, 115)).toEqual([[100, 130]]);
  });

  it('adds the focused row and its neighbours before or after the window', () => {
    expect(rowSegments(100, 130, 5000, 3)).toEqual([
      [2, 5],
      [100, 130],
    ]);
    expect(rowSegments(100, 130, 5000, 4000)).toEqual([
      [100, 130],
      [3999, 4002],
    ]);
  });

  it('merges a focused row next to the window or overlapping its edge into one segment', () => {
    // Row 98's neighbour 99 touches the window: no gap of zero rows between them.
    expect(rowSegments(100, 130, 5000, 98)).toEqual([[97, 130]]);
    expect(rowSegments(100, 130, 5000, 99)).toEqual([[98, 130]]);
    expect(rowSegments(100, 130, 5000, 130)).toEqual([[100, 132]]);
    expect(rowSegments(100, 130, 5000, 131)).toEqual([[100, 133]]);
    expect(rowSegments(100, 130, 5000, 133)).toEqual([
      [100, 130],
      [132, 135],
    ]);
  });

  it('keeps the neighbours inside the list at its ends', () => {
    expect(rowSegments(100, 130, 5000, 0)).toEqual([
      [0, 2],
      [100, 130],
    ]);
    expect(rowSegments(100, 130, 5000, 4999)).toEqual([
      [100, 130],
      [4998, 5000],
    ]);
  });

  it('ignores a focused index outside the list, and renders the focused row of an empty window', () => {
    expect(rowSegments(0, 20, 20, 20)).toEqual([[0, 20]]);
    expect(rowSegments(0, 20, 20, -5)).toEqual([[0, 20]]);
    expect(rowSegments(0, 0, 0, 0)).toEqual([]);
    expect(rowSegments(10, 10, 50, 30)).toEqual([[29, 32]]);
  });
});
