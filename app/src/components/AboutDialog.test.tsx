// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as download from '../lib/export/download';
import { renderWithProviders } from '../test/render';
import { AboutDialog, LEGAL_DOCUMENTS, SOURCE_URL } from './AboutDialog';

// A path built from strings: under jsdom, URL is jsdom's (see test/fixtures.ts).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

function show() {
  const onClose = vi.fn();
  renderWithProviders(<AboutDialog onClose={onClose} />);
  return { onClose, dialog: screen.getByRole('dialog', { name: 'About CanViewer' }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

/** As in the desktop app, whose shell defines this global before the app runs. */
const asDesktopApp = () => Object.assign(window, { __TAURI_INTERNALS__: {} });

describe('AboutDialog', () => {
  it('shows the version, the license, the no-warranty statement and the source', () => {
    const { dialog } = show();
    expect(screen.getByTestId('abt-version').textContent).toBe(`CanViewer · Version ${pkg.version}`);
    expect(dialog.textContent).toMatch(/GNU General Public License, version 2 or \(at your option\) any later version/);
    expect(dialog.textContent).toMatch(/distributed under version 3 of the GPL/);
    expect(dialog.textContent).toMatch(/WITHOUT ANY WARRANTY/);
    expect(dialog.textContent).toMatch(/WebView2 loader and Visual C\+\+ runtime/);
    const source = screen.getByTestId('abt-source') as HTMLAnchorElement;
    expect(source.href).toBe(SOURCE_URL);
    expect(source.rel).toBe('noopener noreferrer');
  });

  it('links every license file the build writes, and the notices, by a relative path', () => {
    show();
    const links = screen.getAllByTestId('abt-doc') as HTMLAnchorElement[];
    // scripts/vite-legal.ts writes LICENSE_FILES of scripts/license-policy.mjs as <name>.txt.
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['COPYRIGHT.txt', 'LICENSE.txt', 'LICENSE-GPL-3.0.txt', 'THIRD_PARTY_NOTICES.md']);
    for (const file of ['COPYRIGHT', 'LICENSE', 'LICENSE-GPL-3.0', 'THIRD_PARTY_NOTICES.md']) expect(existsSync(join(ROOT, file))).toBe(true);
    expect(readFileSync(join(ROOT, 'scripts/license-policy.mjs'), 'utf8')).toContain(
      "export const LICENSE_FILES = ['COPYRIGHT', 'LICENSE', 'LICENSE-GPL-3.0'];",
    );
    expect(links.map((a) => a.textContent)).toEqual([
      'Copyright notice and additional permission',
      'GNU General Public License, version 2',
      'GNU General Public License, version 3',
      'Third-party notices',
    ]);
    expect(LEGAL_DOCUMENTS).toHaveLength(4);
  });

  it('shows a document in the dialog, read from the app’s own origin', async () => {
    const fetchMock = vi.fn(async () => new Response('GNU GENERAL PUBLIC LICENSE\nVersion 2'));
    vi.stubGlobal('fetch', fetchMock);
    show();
    const link = screen.getByRole('link', { name: 'GNU General Public License, version 2' });
    fireEvent.click(link);
    expect(screen.getByTestId('abt-shown').textContent).toBe('Loading LICENSE.txt…');
    const text = await screen.findByTestId('abt-text');
    expect(text.textContent).toBe('GNU GENERAL PUBLIC LICENSE\nVersion 2');
    expect(text.getAttribute('aria-label')).toBe('GNU General Public License, version 2');
    expect(text.tabIndex).toBe(0);
    expect(link.getAttribute('aria-current')).toBe('true');
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/LICENSE.txt');
  });

  it('says so when a document cannot be read, as offline before it was ever opened', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    show();
    fireEvent.click(screen.getByRole('link', { name: 'Third-party notices' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not load THIRD_PARTY_NOTICES.md: HTTP 404'));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    fireEvent.click(screen.getByRole('link', { name: 'Copyright notice and additional permission' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not load COPYRIGHT.txt: Failed to fetch'));
  });

  it('leaves a modified click to the browser (a new tab)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    show();
    fireEvent.click(screen.getByRole('link', { name: 'Third-party notices' }), { ctrlKey: true });
    expect(screen.queryByTestId('abt-shown')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes with its button and with Escape', () => {
    const { onClose, dialog } = show();
    expect(screen.queryByTestId('edt-submit')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('in the desktop app, shows the source address as text with a button that copies it', async () => {
    asDesktopApp();
    const copy = vi.spyOn(download, 'copyText').mockResolvedValue(true);
    const { dialog } = show();
    // No link: the desktop app opens no other window, so a new-tab link would do nothing.
    expect(dialog.querySelector(`a[href="${SOURCE_URL}"]`)).toBeNull();
    expect(screen.getByTestId('abt-source').tagName).toBe('SPAN');
    expect(screen.getByTestId('abt-source').textContent).toBe(SOURCE_URL);
    expect(screen.getByTestId('abt-copy-status').textContent).toBe(
      'The desktop app opens no browser and makes no network requests: copy the address and open it in your browser.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(screen.getByTestId('abt-copy-status').textContent).toBe('Address copied.'));
    expect(copy).toHaveBeenCalledWith(SOURCE_URL);
    // The license files still open in the dialog.
    expect(screen.getAllByTestId('abt-doc')).toHaveLength(4);
  });

  it('in the desktop app, says so when the address cannot be copied', async () => {
    asDesktopApp();
    vi.spyOn(download, 'copyText').mockResolvedValue(false);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not copy: the clipboard is not available'));
  });

  it('in the browser, has no copy button', () => {
    show();
    expect(screen.queryByTestId('abt-copy-source')).toBeNull();
    expect(screen.queryByTestId('abt-copy-status')).toBeNull();
  });

  it('is in German, in the desktop app too', () => {
    localStorage.setItem('canviewer.lang', 'de');
    asDesktopApp();
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Adresse kopieren' })).toBeTruthy();
    expect(screen.getByTestId('abt-copy-status').textContent).toMatch(/^Die Desktop-App öffnet keinen Browser/);
  });

  it('is in German', () => {
    localStorage.setItem('canviewer.lang', 'de');
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Über CanViewer' });
    expect(dialog.textContent).toMatch(/OHNE JEDE GEWÄHRLEISTUNG/);
    expect(screen.getByRole('link', { name: 'Hinweise zu Drittkomponenten' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
  });
});
