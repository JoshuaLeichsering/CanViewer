import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { frameWindow, scrollTopForNewList } from './trc-window';

const ROW = 36;
const VIEW = 600;
const OVERSCAN = 10;

describe('frameWindow', () => {
  it('renders the rows in view and the overscan around them', () => {
    expect(frameWindow(0, VIEW, ROW, 1000, OVERSCAN)).toEqual({ first: 0, last: 27 });
    expect(frameWindow(3600, VIEW, ROW, 1000, OVERSCAN)).toEqual({ first: 90, last: 127 });
    expect(frameWindow(0, VIEW, ROW, 5, OVERSCAN)).toEqual({ first: 0, last: 5 });
    expect(frameWindow(0, VIEW, ROW, 0, OVERSCAN)).toEqual({ first: 0, last: 0 });
  });

  it('renders the end of a shorter list while the scroll position still belongs to a longer one', () => {
    // The review's case: scrolled to the bottom of 200,001 frames, then a filter
    // that leaves one. The old arithmetic rendered no row under a 7-million-pixel spacer.
    expect(frameWindow(7_199_452, VIEW, ROW, 1, OVERSCAN)).toEqual({ first: 0, last: 1 });
    expect(frameWindow(3_600_000, VIEW, ROW, 33_334, OVERSCAN)).toEqual({ first: 33_307, last: 33_334 });
    expect(frameWindow(52_012, VIEW, ROW, 0, OVERSCAN)).toEqual({ first: 0, last: 0 });
  });

  it('always covers the viewport with rows from inside the list, and the spacers add up to the list', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 20, max: 60 }),
        fc.nat({ max: 400_000 }),
        fc.nat({ max: 20 }),
        (scrollTop, height, rowHeight, count, overscan) => {
          const { first, last } = frameWindow(scrollTop, height, rowHeight, count, overscan);
          expect(0 <= first && first <= last && last <= count).toBe(true);
          // The top spacer, the rows and the bottom spacer are exactly as high as the list.
          expect(first * rowHeight + (last - first) * rowHeight + (count - last) * rowHeight).toBe(count * rowHeight);
          // Wherever the browser can scroll to in this list, the rows there are rendered.
          const maxTop = Math.max(0, count * rowHeight - height);
          const top = Math.min(scrollTop, maxTop);
          if (count > 0) {
            expect(first * rowHeight).toBeLessThanOrEqual(top);
            expect(last * rowHeight).toBeGreaterThanOrEqual(Math.min(count * rowHeight, top + height));
          }
        },
      ),
    );
  });
});

describe('scrollTopForNewList', () => {
  it('starts at the top when the new list does not hold the selected row', () => {
    expect(scrollTopForNewList(-1, ROW, VIEW)).toBe(0);
  });

  it('puts the selected row in the middle of the body', () => {
    expect(scrollTopForNewList(1000, ROW, VIEW)).toBe(1000 * ROW - (VIEW - ROW) / 2);
    const top = scrollTopForNewList(1000, ROW, VIEW);
    const rowTop = 1000 * ROW - top;
    expect(rowTop).toBeGreaterThan(0);
    expect(rowTop + ROW).toBeLessThan(VIEW);
  });

  it('does not scroll above the top for a selected row near the start', () => {
    expect(scrollTopForNewList(0, ROW, VIEW)).toBe(0);
    expect(scrollTopForNewList(3, ROW, VIEW)).toBe(0);
  });
});
