// SPDX-License-Identifier: GPL-2.0-or-later
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Keyboard navigation: "/" focuses the message search, and ↑/↓/Home/End move
 * through the list panes (messages, nodes, value tables).
 */

/**
 * The index a key moves to in a list of `count` items from `current` (-1 when
 * no item is current), or null when the key does not move. ↓ from nothing goes
 * to the first item and ↑ from nothing to the last; both stop at the ends.
 */
export function listKeyTarget(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(current + 1, count - 1);
    case 'ArrowUp':
      return current < 0 ? count - 1 : Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Input types that take no typed text, so shortcuts still work on them. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** True when key presses on `target` type text, where single-key shortcuts must not act. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(el.getAttribute('type') ?? 'text');
}

/** True for the "/" that focuses the search: no modifier (Shift is fine, it types "/" on some layouts), not while typing. */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  return e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !isTypingTarget(e.target);
}

/** The attribute that numbers the items of a list pane, for the handler below. */
export const LIST_INDEX_ATTRIBUTE = 'data-rgh-index';

/**
 * Key handler for a list pane's scroll container: ↑/↓/Home/End select the
 * neighbouring item and move the focus to it. The items carry their position
 * in LIST_INDEX_ATTRIBUTE. `onAboveFirst` runs for ↑ on the first item.
 */
export function onListKeyDown(
  e: ReactKeyboardEvent<HTMLElement>,
  count: number,
  select: (index: number) => void,
  onAboveFirst?: () => void,
): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const focused = (e.target as HTMLElement).closest<HTMLElement>(`[${LIST_INDEX_ATTRIBUTE}]`);
  const current = focused ? Number(focused.getAttribute(LIST_INDEX_ATTRIBUTE)) : -1;
  if (e.key === 'ArrowUp' && current === 0 && onAboveFirst) {
    e.preventDefault();
    onAboveFirst();
    return;
  }
  const next = listKeyTarget(e.key, current, count);
  if (next === null) return;
  e.preventDefault();
  select(next);
  const item = e.currentTarget.querySelector<HTMLElement>(`[${LIST_INDEX_ATTRIBUTE}="${next}"]`);
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: 'nearest' });
}

/**
 * Props that make a clickable table row work from the keyboard as well: it
 * takes the focus with Tab, and Enter or Space activates it like a click.
 */
export function activateProps(onActivate: () => void) {
  return {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      // Keys pressed on a control inside the row keep their own meaning.
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      onActivate();
    },
  };
}
