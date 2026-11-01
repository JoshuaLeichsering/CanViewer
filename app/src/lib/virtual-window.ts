/**
 * The arithmetic behind the virtualized message list: which rows of a long
 * list of equally tall rows to render for a scroll position, and where to
 * scroll to bring a row into view. Kept free of the DOM so it can be tested.
 */

/** Lists of databases with more messages than this render only the rows in view. */
export const VIRTUALIZE_ABOVE = 1000;

export function shouldVirtualize(messageCount: number): boolean {
  return messageCount > VIRTUALIZE_ABOVE;
}

export interface RowWindowInput {
  /** Number of rows in the list. */
  count: number;
  /** Height of one row in CSS pixels. */
  rowHeight: number;
  /** scrollTop of the scroll container. */
  scrollTop: number;
  /** clientHeight of the scroll container. */
  viewportHeight: number;
  /** Rows rendered beyond each edge of the viewport, so fast scrolling shows no gaps. */
  overscan: number;
  /** Distance from the top of the scrolled content to the first row. */
  offsetTop?: number;
}

export interface RowWindow {
  /** First rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
  /** Space that stands in for the rows above the window, in pixels. */
  padTop: number;
  /** Space that stands in for the rows below the window, in pixels. */
  padBottom: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rowWindow({ count, rowHeight, scrollTop, viewportHeight, overscan, offsetTop = 0 }: RowWindowInput): RowWindow {
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  // Without a usable row height nothing can be skipped safely.
  if (!(rowHeight > 0)) return { start: 0, end: count, padTop: 0, padBottom: 0 };
  const top = Math.max(0, scrollTop - offsetTop);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight);
  const start = clamp(first - overscan, 0, count);
  const end = clamp(last + overscan, start, count);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

export interface RevealInput {
  index: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  offsetTop?: number;
}

/**
 * The scrollTop that brings row `index` fully into view with the least
 * movement (like scrollIntoView's block: 'nearest'), or null if it is in view.
 */
export function revealScrollTop({ index, rowHeight, scrollTop, viewportHeight, offsetTop = 0 }: RevealInput): number | null {
  if (index < 0 || !(rowHeight > 0)) return null;
  const top = offsetTop + index * rowHeight;
  const bottom = top + rowHeight;
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return null;
  const target = top < scrollTop || rowHeight > viewportHeight ? top : bottom - viewportHeight;
  return target === scrollTop ? null : Math.max(0, target);
}
