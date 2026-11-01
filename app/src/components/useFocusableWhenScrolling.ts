import { useCallback, useRef } from 'react';

/**
 * A ref for a container that may scroll sideways, such as a wide table on a
 * narrow screen. While its content overflows, the container takes the keyboard
 * focus, so that it can be scrolled with the arrow keys; otherwise Tab skips
 * it. Tables whose rows are focusable do not need this.
 */
export function useFocusableWhenScrolling<T extends HTMLElement>() {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      if (el.scrollWidth > el.clientWidth) el.tabIndex = 0;
      else el.removeAttribute('tabindex');
    };
    observer.current = new ResizeObserver(update);
    // The container changes size with the window, its table with the data.
    observer.current.observe(el);
    for (const child of el.children) observer.current.observe(child);
    update();
  }, []);
}
