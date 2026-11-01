// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The arithmetic of the Traces table, which renders only the rows in view: kept
 * apart from the component so that it can be tested without a browser.
 */

/**
 * The rows to render, `first` up to but not including `last`: those in view and
 * `overscan` more on either side, always within the list.
 *
 * A scroll position past the end of the list, left over from a longer list
 * until the browser catches up, gives the last rows of the list. Without that
 * clamp it would give no rows under a spacer as high as the old list, and the
 * table would stay blank while the browser shrinks the scroll position a
 * viewport at a time.
 */
export function frameWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan: number,
): { first: number; last: number } {
  const inView = Math.ceil(viewportHeight / rowHeight);
  const first = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, count - inView - overscan));
  const last = Math.min(count, Math.max(first, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan));
  return { first, last };
}

/**
 * Where a new list (another filter or search) starts: with the selected row in
 * the middle of the body if the list holds it (`position` is its place in the
 * list, -1 if it is not there), otherwise at the top. The scroll position of
 * the old list means nothing in the new one.
 */
export function scrollTopForNewList(position: number, rowHeight: number, bodyHeight: number): number {
  if (position < 0) return 0;
  return Math.max(0, Math.round(position * rowHeight - (bodyHeight - rowHeight) / 2));
}
