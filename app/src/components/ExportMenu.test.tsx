// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The export and copy-as menus (W8), and the menu button they share.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { demoDb, messageNamed } from '../test/fixtures';
import * as download from '../lib/export/download';
import { cStruct } from '../lib/export/c-struct';
import { decodePseudoCode } from '../lib/export/pseudo-code';
import { CopyCodeMenu, ExportMenu } from './ExportMenu';
import { ExpMenuButton, ExpMenuError, type ExpMenuItem } from './ExpMenuButton';

const flush = () => act(async () => {});
const button = (testId: string) => screen.getByTestId(testId) as HTMLButtonElement;
const items = () => screen.queryAllByRole('menuitem').map((i) => i.textContent);
const focused = () => document.activeElement?.textContent;
const status = () => document.querySelector('.exp-menu [role=status]')?.textContent;

beforeEach(() => {
  vi.spyOn(download, 'downloadText').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExportMenu', () => {
  it('opens on a click, lists the three exports and closes on a second click', () => {
    renderWithProviders(<ExportMenu db={demoDb()} fileName="demo.dbc" />);
    const b = button('exp-export-button');
    expect(b.getAttribute('aria-haspopup')).toBe('menu');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Export the message and signal list' }).id).toBe(b.getAttribute('aria-controls'));
    expect(items()).toEqual(['Messages as CSV', 'Signals as CSV', 'Messages and signals as JSON']);
    expect(focused()).toBe('Messages as CSV');
    fireEvent.click(b);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([
    ['messagesCsv', 'demo.messages.csv', 'text/csv;charset=utf-8'],
    ['signalsCsv', 'demo.signals.csv', 'text/csv;charset=utf-8'],
    ['messagesJson', 'demo.messages.json', 'application/json'],
  ] as const)('%s downloads %s with the export’s content, and says so', async (kind, name, type) => {
    const db = demoDb();
    renderWithProviders(<ExportMenu db={db} fileName="demo.dbc" />);
    fireEvent.click(button('exp-export-button'));
    fireEvent.click(screen.getByTestId(`exp-export-${kind}`));
    await flush();
    const expected = download.exportFile(db, 'demo.dbc', kind);
    expect(download.downloadText).toHaveBeenCalledWith(name, type, expected.text);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button('exp-export-button'));
    expect(button('exp-export-button').textContent).toBe('Exported');
    expect(status()).toBe(`${name} exported`);
  });

  it('says so when the export fails, in the interface’s words, and the mark goes away', async () => {
    vi.useFakeTimers();
    vi.mocked(download.downloadText).mockImplementation(() => {
      throw new Error('NotAllowedError: the browser said no');
    });
    renderWithProviders(<ExportMenu db={demoDb()} fileName="demo.dbc" />);
    fireEvent.click(button('exp-export-button'));
    fireEvent.click(screen.getByTestId('exp-export-messagesCsv'));
    await flush();
    expect(button('exp-export-button').textContent).toBe('Export failed');
    expect(screen.getByRole('alert').textContent).toBe('Could not export the file');
    expect(button('exp-export-button').title).toBe('Could not export the file');
    await act(async () => void vi.advanceTimersByTime(6000));
    expect(button('exp-export-button').textContent).toBe('Export');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is in German', () => {
    localStorage.setItem('canviewer.lang', 'de');
    renderWithProviders(<ExportMenu db={demoDb()} fileName="demo.dbc" />);
    fireEvent.click(button('exp-export-button'));
    expect(items()).toEqual(['Botschaften als CSV', 'Signale als CSV', 'Botschaften und Signale als JSON']);
  });
});

describe('CopyCodeMenu', () => {
  const show = () => {
    const db = demoDb();
    const message = messageNamed(db, 'EngineData');
    renderWithProviders(<CopyCodeMenu db={db} message={message} fileName="demo.dbc" />);
    return { db, message };
  };

  it('copies the C struct and the decode pseudo-code of the message', async () => {
    const copy = vi.spyOn(download, 'copyText').mockResolvedValue(true);
    const { db, message } = show();
    fireEvent.click(button('exp-copy-button'));
    expect(items()).toEqual(['C struct', 'Decode pseudo-code']);
    fireEvent.click(screen.getByTestId('exp-copy-cStruct'));
    await flush();
    expect(copy).toHaveBeenLastCalledWith(cStruct(db, message, 'demo.dbc'));
    expect(button('exp-copy-button').textContent).toBe('Copied');
    expect(status()).toBe('C struct of EngineData copied');

    fireEvent.click(button('exp-copy-button'));
    fireEvent.click(screen.getByTestId('exp-copy-pseudoCode'));
    await flush();
    expect(copy).toHaveBeenLastCalledWith(decodePseudoCode(db, message, 'demo.dbc'));
    expect(status()).toBe('Decode pseudo-code of EngineData copied');
  });

  it('says that the clipboard is not available when nothing can copy', async () => {
    vi.spyOn(download, 'copyText').mockResolvedValue(false);
    show();
    fireEvent.click(button('exp-copy-button'));
    fireEvent.click(screen.getByTestId('exp-copy-cStruct'));
    await flush();
    expect(button('exp-copy-button').textContent).toBe('Copy failed');
    expect(screen.getByRole('alert').textContent).toBe('Could not copy: the clipboard is not available');
  });
});

describe('ExpMenuButton: keyboard', () => {
  const ITEMS: ExpMenuItem[] = ['One', 'Two', 'Three'].map((label) => ({ key: label.toLowerCase(), label, run: async () => `${label} done` }));
  const show = (items = ITEMS) =>
    renderWithProviders(
      <ExpMenuButton
        label="Act"
        title="Actions"
        icon="download"
        items={items}
        okLabel="Done"
        errorLabel="Failed"
        errorText="It failed"
        testId="tst-menu-button"
      />,
    );
  const menuKey = (key: string) => fireEvent.keyDown(screen.getByRole('menu'), { key });

  it('opens on the first item with ↓ and on the last with ↑', () => {
    show();
    fireEvent.keyDown(button('tst-menu-button'), { key: 'ArrowDown' });
    expect(focused()).toBe('One');
    menuKey('Escape');
    fireEvent.keyDown(button('tst-menu-button'), { key: 'ArrowUp' });
    expect(focused()).toBe('Three');
    // Other keys on the button do nothing.
    menuKey('Escape');
    fireEvent.keyDown(button('tst-menu-button'), { key: 'x' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves with the arrow keys, wrapping round, and with Home and End; only the focused item is a Tab stop', () => {
    show();
    fireEvent.click(button('tst-menu-button'));
    menuKey('ArrowDown');
    expect(focused()).toBe('Two');
    menuKey('End');
    expect(focused()).toBe('Three');
    menuKey('ArrowDown');
    expect(focused()).toBe('One');
    menuKey('ArrowUp');
    expect(focused()).toBe('Three');
    menuKey('Home');
    expect(focused()).toBe('One');
    expect(screen.getAllByRole('menuitem').map((i) => i.tabIndex)).toEqual([0, -1, -1]);
  });

  it('keeps its keys from the page’s own shortcuts', () => {
    const onPage = vi.fn();
    document.addEventListener('keydown', onPage);
    show();
    fireEvent.click(button('tst-menu-button'));
    menuKey('ArrowDown');
    menuKey('Escape');
    expect(onPage).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onPage);
  });

  it('closes with Escape, back on the button, with Tab, and with a click outside, but not inside', () => {
    show();
    fireEvent.click(button('tst-menu-button'));
    menuKey('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button('tst-menu-button'));

    fireEvent.click(button('tst-menu-button'));
    menuKey('Tab');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button('tst-menu-button'));
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the message of an ExpMenuError, and the menu’s own text for any other failure', async () => {
    const failing: ExpMenuItem[] = [
      { key: 'own', label: 'Own words', run: async () => Promise.reject(new ExpMenuError('Said in the UI language')) },
      { key: 'other', label: 'Browser words', run: async () => Promise.reject(new TypeError('Failed to fetch')) },
    ];
    show(failing);
    fireEvent.click(button('tst-menu-button'));
    fireEvent.click(screen.getByTestId('tst-menu-own'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Said in the UI language');
    fireEvent.click(button('tst-menu-button'));
    fireEvent.click(screen.getByTestId('tst-menu-other'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('It failed');
    expect(button('tst-menu-button').textContent).toBe('Failed');
  });

  it('places the menu inside the viewport, below the button, or above it when there is no room below', () => {
    show();
    const b = button('tst-menu-button');
    const rect = (r: Partial<DOMRect>) => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...r }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === b ? rect({ top: 700, bottom: 740, left: 900, right: 1000 }) : rect({ width: 200, height: 150 });
    });
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    fireEvent.click(b);
    const menu = screen.getByRole('menu');
    // Right-aligned with the button; above it, since 740 + 4 + 150 would leave the viewport.
    expect(menu.style.left).toBe('800px');
    expect(menu.style.top).toBe(`${700 - 4 - 150}px`);
    // It follows a scroll.
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this === b ? rect({ top: 100, bottom: 140, left: 900, right: 1000 }) : rect({ width: 200, height: 150 });
    });
    fireEvent.scroll(window);
    expect(menu.style.top).toBe('144px');
  });
});
