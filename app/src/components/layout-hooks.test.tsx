// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The two hooks that react to layout (W6): the search field's "/" hint gives
// way when the placeholder would not fit beside it, and a container that
// scrolls sideways takes the keyboard focus. jsdom lays nothing out, so the
// sizes, the text measurement and ResizeObserver are stubbed here; the browser
// checks in e2e/ui-checks.mjs measure the real layout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Selection } from '../App';
import { renderWithProviders } from '../test/render';
import { demoDb } from '../test/fixtures';
import { ListPane, type MessageFilter } from './ListPane';
import { useFocusableWhenScrolling } from './useFocusableWhenScrolling';

/** Every ResizeObserver the code under test made, so that a test can report a resize. */
const observers: Array<{ callback: () => void; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }> = [];
class FakeResizeObserver {
  observed: Element[] = [];
  disconnect = vi.fn();
  constructor(public callback: () => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
}
const resize = () => act(() => observers.forEach((o) => o.callback()));

/** Sizes the stubbed layout reports. */
const size = { input: 300, kbd: 20, scroll: 0, client: 0 };
const restore: Array<() => void> = [];
function stubGetter<T extends object>(proto: T, name: string, get: (this: HTMLElement) => number) {
  const own = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, { configurable: true, get });
  restore.push(() => (own ? Object.defineProperty(proto, name, own) : delete (proto as Record<string, unknown>)[name]));
}

beforeEach(() => {
  observers.length = 0;
  Object.assign(size, { input: 300, kbd: 20, scroll: 0, client: 0 });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // Seven pixels per character, whatever the font.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) }) as unknown as CanvasRenderingContext2D,
  );
  stubGetter(HTMLElement.prototype, 'clientWidth', function () {
    return this instanceof HTMLInputElement ? size.input : size.client;
  });
  stubGetter(HTMLElement.prototype, 'scrollWidth', () => size.scroll);
  stubGetter(HTMLElement.prototype, 'offsetWidth', function () {
    return this.tagName === 'KBD' ? size.kbd : 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restore.splice(0).forEach((undo) => undo());
  document.head.innerHTML = '';
});

describe('the "/" hint in the message search', () => {
  // The padding the placeholder needs besides its text, and the hint off the flow.
  const css = '.search-field input { padding-left: 8px; padding-right: 8px } .rgh-kbd-off { position: absolute }';

  function Pane({ initialSearch = '' }: { initialSearch?: string }) {
    const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
    const [search, setSearch] = useState(initialSearch);
    const [filter, setFilter] = useState<MessageFilter>('all');
    return (
      <ListPane
        db={demoDb()}
        kind="messages"
        selection={selection}
        onSelect={setSelection}
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
      />
    );
  }
  const hint = () => document.querySelector('.search-field kbd');

  beforeEach(() => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  });

  // "Search messages, signals, IDs" is 29 characters: 203 px, plus 16 px of padding.
  it('shows while the placeholder fits beside it', () => {
    size.input = 219;
    renderWithProviders(<Pane />);
    expect(hint()?.className).toBe('rgh-kbd');
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([document.querySelector('.search-field')]);
  });

  it('gives way when the field is too narrow, and comes back when it widens', () => {
    size.input = 218;
    renderWithProviders(<Pane />);
    expect(hint()?.className).toBe('rgh-kbd rgh-kbd-off');

    // Off the flow, the hint leaves its own width to the input; that alone is
    // not taken as room for the hint.
    size.input = 219 + 19;
    resize();
    expect(hint()?.className).toBe('rgh-kbd rgh-kbd-off');

    size.input = 219 + 20;
    resize();
    expect(hint()?.className).toBe('rgh-kbd');
  });

  it('measures again once the web font has loaded', () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    restore.push(() => delete (document as { fonts?: unknown }).fonts);
    size.input = 400;
    const { unmount } = renderWithProviders(<Pane />);
    expect(hint()?.className).toBe('rgh-kbd');
    size.input = 100;
    act(() => {
      fonts.dispatchEvent(new Event('loadingdone'));
    });
    expect(hint()?.className).toBe('rgh-kbd rgh-kbd-off');

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    // Unsubscribed: a later font load measures nothing.
    fonts.dispatchEvent(new Event('loadingdone'));
  });

  it('is not shown, nor measured, while the search has text', () => {
    renderWithProviders(<Pane initialSearch="Engine" />);
    expect(hint()).toBeNull();
    expect(observers).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(hint()).not.toBeNull();
    expect(observers).toHaveLength(1);
  });
});

describe('a container that may scroll sideways', () => {
  function Wide({ show = true }: { show?: boolean }) {
    const ref = useFocusableWhenScrolling<HTMLDivElement>();
    return show ? (
      <div ref={ref} data-testid="scroller">
        <table />
      </div>
    ) : null;
  }
  const scroller = () => screen.getByTestId('scroller');

  it('takes the focus with Tab only while its content overflows', () => {
    size.client = 300;
    size.scroll = 300;
    const { rerender } = render(<Wide />);
    expect(scroller().hasAttribute('tabindex')).toBe(false);
    // The container itself and its table are observed: either can change size.
    expect(observers[0].observed).toEqual([scroller(), scroller().querySelector('table')]);

    size.scroll = 480;
    resize();
    expect(scroller().getAttribute('tabindex')).toBe('0');

    size.client = 480;
    resize();
    expect(scroller().hasAttribute('tabindex')).toBe(false);

    rerender(<Wide show={false} />);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });
});
