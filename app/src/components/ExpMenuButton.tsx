import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import './export-menu.css';

export interface ExpMenuItem {
  /** Stable key, also the item's test id suffix. */
  key: string;
  label: string;
  /**
   * Does the work; resolves with the confirmation to announce. To report a
   * failure in words of its own it rejects with an ExpMenuError; any other
   * rejection shows the menu's `errorText`.
   */
  run: () => Promise<string>;
}

/** A failure whose message is written for the user, in the interface language. */
export class ExpMenuError extends Error {}

type Status = { kind: 'ok' | 'error'; text: string };

/**
 * A Material 3 menu button: an outlined button that opens a menu of
 * actions. Keyboard: Enter, Space or the arrow keys open it on the first or
 * last item, the arrow keys, Home and End move, Escape closes it and returns
 * to the button, Tab leaves it. After an action the button shows a check
 * (or an error mark) and a short word for a moment, and a live region
 * announces the full message.
 *
 * The menu is fixed to the viewport rather than to the page, so that a
 * scrolling container cannot clip it, and it is kept on screen.
 */
export function ExpMenuButton({
  label,
  title,
  icon,
  items,
  okLabel,
  errorLabel,
  errorText,
  testId,
  className,
}: {
  label: string;
  title: string;
  icon: IconName;
  items: ExpMenuItem[];
  okLabel: string;
  /** The button's short word after a failure. */
  errorLabel: string;
  /** The message for a failure that brings no ExpMenuError of its own. */
  errorText: string;
  testId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  // Place the open menu below the button, right-aligned with it, inside the
  // viewport, and above the button when there is no room below. It follows
  // the button when anything scrolls or the window changes size.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      const menu = popoverRef.current;
      if (!button || !menu) return;
      const margin = 8;
      const { width, height } = menu.getBoundingClientRect();
      const left = Math.max(margin, Math.min(button.right - width, window.innerWidth - margin - width));
      const below = button.bottom + 4;
      const above = button.top - 4 - height;
      const top = below + height > window.innerHeight - margin && above >= margin ? above : below;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Close on a click outside (Escape is handled by the menu's own keys).
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  useEffect(() => {
    // The menu is placed in the viewport already: focusing must not scroll the page.
    if (open) itemRefs.current[focusIndex]?.focus({ preventScroll: true });
  }, [open, focusIndex]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), status.kind === 'ok' ? 2500 : 6000);
    return () => clearTimeout(timer);
  }, [status]);

  const openAt = (index: number) => {
    setFocusIndex(index);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choose = async (item: ExpMenuItem) => {
    close();
    try {
      setStatus({ kind: 'ok', text: await item.run() });
    } catch (e) {
      // Only text written for the user reaches the screen: an exception from
      // the browser would show its own words, in English.
      setStatus({ kind: 'error', text: e instanceof ExpMenuError ? e.message : errorText });
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const last = items.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: focusIndex === last ? 0 : focusIndex + 1,
      ArrowUp: focusIndex === 0 ? last : focusIndex - 1,
      Home: 0,
      End: last,
    };
    // Keys the menu handles stay in the menu, away from any shortcut on the page.
    if (e.key in moves) {
      e.preventDefault();
      e.stopPropagation();
      setFocusIndex(moves[e.key]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const shown = status ? (status.kind === 'ok' ? okLabel : errorLabel) : label;
  return (
    <div className={`exp-menu ${className ?? ''}`} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn outlined with-icon state exp-menu-button ${status ? `exp-${status.kind}` : ''}`}
        title={status?.text ?? title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={testId}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            openAt(0);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            openAt(items.length - 1);
          }
        }}
      >
        <Icon name={status ? (status.kind === 'ok' ? 'check' : 'error') : icon} size={18} />
        <span className="exp-menu-label">{shown}</span>
        <Icon name="arrow_drop_down" size={18} className="exp-menu-caret" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="exp-menu-popover"
          role="menu"
          id={menuId}
          aria-label={title}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === focusIndex ? 0 : -1}
              className="menu-item state"
              data-testid={`${testId.replace(/-button$/, '')}-${item.key}`}
              onClick={() => void choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <span className="visually-hidden" role="status">
        {status?.kind === 'ok' ? status.text : ''}
      </span>
      {/* Only while there is an error: other code reads any [role=alert] as a failed import. */}
      {status?.kind === 'error' && (
        <span className="visually-hidden" role="alert">
          {status.text}
        </span>
      )}
    </div>
  );
}
