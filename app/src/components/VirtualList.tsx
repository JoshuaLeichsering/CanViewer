import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { revealScrollTop, rowWindow } from '../lib/virtual-window';

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN = 10;
/** Rows rendered before the first layout tells how many fit. */
const INITIAL_ROWS = 40;

/**
 * A scroll container that renders only the rows in view when `virtual` is
 * set, and every row otherwise. Rows must be equally tall; the height is
 * measured from the rendered rows, `estimatedRowHeight` only bridges the
 * first frame. Padding above and below the rendered rows stands in for the
 * rest, so the scrollbar keeps the length of the whole list.
 *
 * When the active row changes (by click, keyboard or deep link), it is
 * scrolled into view, even if it was not rendered.
 */
export function VirtualList<T>({
  items,
  virtual,
  renderItem,
  estimatedRowHeight,
  activeKey,
  activeIndex,
  className,
  children,
}: {
  items: readonly T[];
  virtual: boolean;
  renderItem: (item: T, index: number) => ReactNode;
  estimatedRowHeight: number;
  /** Identifies the active item; a change scrolls it into view. */
  activeKey?: string;
  /** Position of the active item in `items`, or -1. */
  activeIndex: number;
  className?: string;
  /** Rendered after the rows, such as an empty-list note. */
  children?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(estimatedRowHeight);
  const [range, setRange] = useState<[number, number]>([0, Math.min(items.length, INITIAL_ROWS)]);
  const count = items.length;

  /** Distance of the first row from the top of the scrolled content. */
  const offsetTop = () => {
    const scroller = scrollRef.current;
    const rows = rowsRef.current;
    if (!scroller || !rows) return 0;
    return rows.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  };

  const sync = useCallback(() => {
    const scroller = scrollRef.current;
    if (!virtual || !scroller) return;
    const w = rowWindow({
      count,
      rowHeight,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      overscan: OVERSCAN,
      offsetTop: offsetTop(),
    });
    setRange((r) => (r[0] === w.start && r[1] === w.end ? r : [w.start, w.end]));
  }, [virtual, count, rowHeight]);
  // React would render a scroll event's update after the frame that shows
  // the new scroll position, which would paint padding where rows belong.
  const onScroll = useCallback(() => flushSync(sync), [sync]);

  // Measure the real row height from two neighbouring rows (margins included).
  useLayoutEffect(() => {
    const rows = rowsRef.current?.children;
    if (!virtual || !rows || rows.length === 0) return;
    const first = rows[0] as HTMLElement;
    const measured = rows.length > 1 ? (rows[1] as HTMLElement).offsetTop - first.offsetTop : first.offsetHeight;
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
  });

  // Bring the active row into view when it changes, then render what is in view.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (virtual && scroller && activeIndex >= 0) {
      const top = revealScrollTop({
        index: activeIndex,
        rowHeight,
        scrollTop: scroller.scrollTop,
        viewportHeight: scroller.clientHeight,
        offsetTop: offsetTop(),
      });
      if (top !== null) scroller.scrollTop = top;
    }
    sync();
    // Only a change of the active item (or of the row height) reveals it, not
    // a change of its position: filtering the list must not scroll it.
  }, [activeKey, virtual, rowHeight]);

  // A new list length, row height or viewport size changes what is in view.
  useLayoutEffect(sync, [sync]);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!virtual || !scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [virtual, sync]);

  if (!virtual) {
    return (
      <div className={className}>
        {items.map(renderItem)}
        {children}
      </div>
    );
  }

  const start = Math.min(range[0], count);
  const end = Math.min(Math.max(range[1], start), count);
  return (
    <div className={className} ref={scrollRef} onScroll={onScroll} data-testid="tbl-virtual-list">
      <div
        ref={rowsRef}
        className="tbl-virtual-rows"
        style={{ paddingTop: start * rowHeight, paddingBottom: (count - end) * rowHeight }}
      >
        {items.slice(start, end).map((item, i) => renderItem(item, start + i))}
      </div>
      {children}
    </div>
  );
}
