import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { activateProps, isSearchShortcut, isTypingTarget, listKeyTarget } from './keyboard';

describe('listKeyTarget', () => {
  it('moves down and up one item at a time, and stops at the ends', () => {
    expect(listKeyTarget('ArrowDown', 0, 3)).toBe(1);
    expect(listKeyTarget('ArrowDown', 2, 3)).toBe(2);
    expect(listKeyTarget('ArrowUp', 2, 3)).toBe(1);
    expect(listKeyTarget('ArrowUp', 0, 3)).toBe(0);
  });

  it('jumps to the first and the last item', () => {
    expect(listKeyTarget('Home', 2, 3)).toBe(0);
    expect(listKeyTarget('End', 0, 3)).toBe(2);
  });

  it('starts at the first item going down and at the last going up when no item is current', () => {
    expect(listKeyTarget('ArrowDown', -1, 3)).toBe(0);
    expect(listKeyTarget('ArrowUp', -1, 3)).toBe(2);
  });

  it('does not move in an empty list or for other keys', () => {
    expect(listKeyTarget('ArrowDown', -1, 0)).toBeNull();
    expect(listKeyTarget('End', -1, 0)).toBeNull();
    expect(listKeyTarget('Enter', 1, 3)).toBeNull();
    expect(listKeyTarget('ArrowLeft', 1, 3)).toBeNull();
  });
});

/** Just enough of an element for the checks. */
const element = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) =>
  ({ tagName, isContentEditable: false, getAttribute: () => extra.type ?? null, ...extra }) as unknown as EventTarget;

describe('isTypingTarget', () => {
  it('is true in text fields and editable content', () => {
    expect(isTypingTarget(element('INPUT'))).toBe(true);
    expect(isTypingTarget(element('INPUT', { type: 'search' }))).toBe(true);
    expect(isTypingTarget(element('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(element('SELECT'))).toBe(true);
    expect(isTypingTarget(element('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('is false on buttons, checkboxes and everything else', () => {
    expect(isTypingTarget(element('BUTTON'))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(element('INPUT', { type: 'radio' }))).toBe(false);
    expect(isTypingTarget(element('BODY'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('isSearchShortcut', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: element('BODY'), ...extra }) as KeyboardEvent;

  it('is "/" outside text fields', () => {
    expect(isSearchShortcut(key('/'))).toBe(true);
    // On a German keyboard "/" is Shift+7.
    expect(isSearchShortcut(key('/', { shiftKey: true }))).toBe(true);
  });

  it('is not "/" while typing, with a modifier, or during composition', () => {
    expect(isSearchShortcut(key('/', { target: element('INPUT') }))).toBe(false);
    expect(isSearchShortcut(key('/', { ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { metaKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { altKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { isComposing: true }))).toBe(false);
  });

  it('is not another key', () => {
    expect(isSearchShortcut(key('7', { shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key('?'))).toBe(false);
  });
});

describe('activateProps', () => {
  const press = (key: string, onTheRow = true) => {
    let activated = 0;
    let prevented = false;
    const props = activateProps(() => activated++);
    const row = {};
    props.onKeyDown({
      key,
      target: onTheRow ? row : {},
      currentTarget: row,
      preventDefault: () => (prevented = true),
    } as unknown as ReactKeyboardEvent<HTMLElement>);
    return { activated, prevented };
  };

  it('makes the row focusable and keeps the click', () => {
    let clicked = 0;
    const props = activateProps(() => clicked++);
    expect(props.tabIndex).toBe(0);
    props.onClick();
    expect(clicked).toBe(1);
  });

  it('activates on Enter and Space, without scrolling the page', () => {
    expect(press('Enter')).toEqual({ activated: 1, prevented: true });
    expect(press(' ')).toEqual({ activated: 1, prevented: true });
  });

  it('ignores other keys, and keys pressed on a control inside the row', () => {
    expect(press('a')).toEqual({ activated: 0, prevented: false });
    expect(press('Tab')).toEqual({ activated: 0, prevented: false });
    expect(press('Enter', false)).toEqual({ activated: 0, prevented: false });
  });
});
