import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEventHandler,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { revealScrollTop, rowSegments, rowWindow } from '../lib/virtual-window';

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN = 10;
/** Rows rendered before the first layout tells how many fit. */
const INITIAL_ROWS = 40;

/**
 * A scroll container that renders only the rows in view when `virtual` is
 * set, and every row otherwise. Rows must be equally tall, and `renderItem`
 * must return one element per item; the height is measured from the rendered
 * rows, `estimatedRowHeight` only bridges the first frame. Padding above and
 * below the rendered rows stands in for the rest, so the scrollbar keeps the
 * length of the whole list.
 *
 * When the active row changes (by click, keyboard or deep link), it is
 * scrolled into view, whether the list is virtual or not, and even if the row
 * was not rendered. A row with the keyboard focus stays rendered, with its two
 * neighbours, while it is scrolled out of view: the focus stays on it, and Tab
 * and Shift+Tab move on to the rows next to it, as in a list without
 * virtualization.
 */
export function VirtualList<T>({
  items,
  virtual,
  renderItem,
  estimatedRowHeight,
  activeKey,
  activeIndex,
  className,
  containerRef,
  onKeyDown,
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
  /** Receives the scroll container, for callers that look up their rows in it. */
  containerRef?: MutableRefObject<HTMLDivElement | null>;
  /** Key handler of the scroll container, such as the list panes' arrow-key navigation. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Rendered after the rows, such as an empty-list note. */
  children?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      if (containerRef) containerRef.current = el;
    },
    [containerRef],
  );
  const rowsRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(estimatedRowHeight);
  const [range, setRange] = useState<[number, number]>([0, Math.min(items.length, INITIAL_ROWS)]);
  /** The item whose row has the keyboard focus, or null. */
  const [focused, setFocused] = useState<T | null>(null);
  const count = items.length;

  const start = Math.min(range[0], count);
  const end = Math.min(Math.max(range[1], start), count);
  const segments = virtual ? rowSegments(start, end, count, focused === null ? -1 : items.indexOf(focused)) : [];
  /** For each child of the rows element, the index of its item, or -1 for a gap. */
  const childItems: number[] = [];
  segments.forEach(([from, to], s) => {
    if (s > 0) childItems.push(-1);
    for (let i = from; i < to; i++) childItems.push(i);
  });

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
    const pair = childItems.findIndex((index, i) => index >= 0 && childItems[i + 1] === index + 1);
    const measured =
      pair >= 0
        ? (rows[pair + 1] as HTMLElement).offsetTop - (rows[pair] as HTMLElement).offsetTop
        : ((rows[childItems.findIndex((index) => index >= 0)] as HTMLElement | undefined)?.offsetHeight ?? 0);
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
  });

  // Bring the active row into view when it changes, then render what is in view.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && activeIndex >= 0) {
      let top: number | null = null;
      if (virtual) {
        top = revealScrollTop({
          index: activeIndex,
          rowHeight,
          scrollTop: scroller.scrollTop,
          viewportHeight: scroller.clientHeight,
          offsetTop: offsetTop(),
        });
      } else {
        // Every row is rendered: measure the active one where it is.
        const row = scroller.children[activeIndex] as HTMLElement | undefined;
        if (row) {
          top = revealScrollTop({
            index: 0,
            rowHeight: row.offsetHeight,
            scrollTop: scroller.scrollTop,
            viewportHeight: scroller.clientHeight,
            offsetTop: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
          });
        }
      }
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
      <div className={className} ref={setScroller} onKeyDown={onKeyDown}>
        {items.map(renderItem)}
        {children}
      </div>
    );
  }

  // Remember which row has the focus, so that it stays rendered.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const rows = rowsRef.current?.children ?? [];
    const child = Array.prototype.findIndex.call(rows, (row: Element) => row.contains(e.target));
    const index = child >= 0 ? childItems[child] : -1;
    setFocused(index >= 0 ? items[index] : null);
  };
  // Focus that moves elsewhere in the page releases the row, checked once the
  // focus has moved. When the whole window loses the focus (another app), the
  // row keeps it (document.activeElement stays), so the focus can return to it.
  const onBlur = () => {
    setTimeout(() => {
      if (!scrollRef.current?.contains(document.activeElement)) setFocused(null);
    }, 0);
  };

  const first = segments[0]?.[0] ?? 0;
  const last = segments[segments.length - 1]?.[1] ?? 0;
  return (
    <div
      className={className}
      ref={setScroller}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      data-testid="tbl-virtual-list"
    >
      <div
        ref={rowsRef}
        className="tbl-virtual-rows"
        style={{ paddingTop: first * rowHeight, paddingBottom: (count - last) * rowHeight }}
      >
        {/* One flat list of keyed rows, so React keeps a row's element (and its
            focus) when the row moves from the window to the focused segment. */}
        {childItems.map((index, child) => {
          if (index >= 0) return renderItem(items[index], index);
          // The rows between the two segments.
          const hidden = childItems[child + 1] - childItems[child - 1] - 1;
          return <div key="tbl-gap" aria-hidden="true" style={{ height: hidden * rowHeight }} />;
        })}
      </div>
      {children}
    </div>
  );
}
