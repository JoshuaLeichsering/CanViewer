// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { DBC_STORAGE_KEY, clearImportedFile } from '../lib/import/storage';
import { ErrorBoundary } from './ErrorBoundary';

// jsdom has no IndexedDB: stand in for the imported file's store, to see when it is cleared.
vi.mock('../lib/import/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/import/storage')>()),
  clearImportedFile: vi.fn(async () => true),
}));
const clearImport = vi.mocked(clearImportedFile);

function Boom({ what }: { what: unknown }): never {
  throw what;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  history.replaceState(null, '', '/');
  // React reports the caught error, and the boundary logs it once more; jsdom
  // reports that it cannot reload. None of that is a test failure.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearImport.mockClear();
});

const crashed = (what: unknown) =>
  renderWithProviders(
    <ErrorBoundary>
      <Boom what={what} />
    </ErrorBoundary>,
  );

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    renderWithProviders(
      <ErrorBoundary>
        <p>all well</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all well')).toBeTruthy();
    expect(screen.queryByTestId('rgh-crash')).toBeNull();
  });

  it('shows the recovery screen when a view throws, with the focus on its heading', () => {
    crashed(new Error('the view broke'));
    const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('button', { name: 'Reset stored file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByText('Error details')).toBeTruthy();
    expect(document.querySelector('.rgh-crash-details pre')?.textContent).toContain('the view broke');
    expect(consoleError).toHaveBeenCalledWith('CanViewer crashed:', expect.any(Error), expect.any(String));
  });

  it('turns a thrown value that is not an Error into one', () => {
    crashed('just a string');
    expect(document.querySelector('.rgh-crash-details pre')?.textContent).toContain('just a string');
  });

  it('speaks German when the app does', () => {
    localStorage.setItem('canviewer.lang', 'de');
    crashed(new Error('kaputt'));
    expect(screen.getByRole('heading', { level: 1, name: 'Etwas ist schiefgelaufen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gespeicherte Datei zurücksetzen' })).toBeTruthy();
  });

  it('"Reset stored file" forgets the stored DBC, the imported file and the deep link, and keeps the settings', async () => {
    localStorage.setItem(DBC_STORAGE_KEY, JSON.stringify({ name: 'bad.dbc', text: 'BO_ 1 X: 8 A' }));
    localStorage.setItem('canviewer.theme', 'dark');
    history.replaceState(null, '', '/?x=1#msg=256');
    crashed(new Error('the view broke'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset stored file' }));
    expect(localStorage.getItem(DBC_STORAGE_KEY)).toBeNull();
    expect(clearImport).toHaveBeenCalledOnce();
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.search).toBe('?x=1');
    expect(localStorage.getItem('canviewer.theme')).toBe('dark');
  });

  it('reloads only once the imported file is gone, so that it is not restored again', async () => {
    let cleared!: (done: boolean) => void;
    clearImport.mockImplementationOnce(() => new Promise((resolve) => (cleared = resolve)));
    history.replaceState(null, '', '/#msg=256');
    crashed(new Error('the view broke'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset stored file' }));
    await Promise.resolve();
    expect(window.location.hash).toBe('#msg=256');
    cleared(true);
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('"Reload" keeps the stored file', () => {
    localStorage.setItem(DBC_STORAGE_KEY, JSON.stringify({ name: 'demo.dbc', text: 'VERSION ""' }));
    crashed(new Error('the view broke'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(localStorage.getItem(DBC_STORAGE_KEY)).not.toBeNull();
    expect(clearImport).not.toHaveBeenCalled();
  });
});
