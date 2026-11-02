// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { NavRail, type Destination } from './NavRail';

const ALL: Record<Destination, boolean> = {
  overview: true,
  messages: true,
  network: true,
  nodes: true,
  tables: true,
  compare: true,
  traces: true,
};

function show({
  active = 'overview' as Destination | null,
  enabled = ALL,
  badges = {} as Partial<Record<Destination, number>>,
  fileOpen = false,
} = {}) {
  const onNavigate = vi.fn();
  const onOpenFile = vi.fn();
  const onCloseFile = vi.fn();
  const onAbout = vi.fn();
  renderWithProviders(
    <NavRail
      active={active}
      enabled={enabled}
      badges={badges}
      onNavigate={onNavigate}
      onOpenFile={onOpenFile}
      onCloseFile={fileOpen ? onCloseFile : undefined}
      onAbout={onAbout}
    />,
  );
  return { onNavigate, onOpenFile, onCloseFile, onAbout };
}

const railLabels = () => [...document.querySelectorAll('.rail-item .label')].map((e) => e.textContent);
const railItem = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement;

describe('NavRail: destinations', () => {
  it('shows the seven destinations, marks the active one and navigates', () => {
    const { onNavigate } = show({ active: 'messages' });
    expect(screen.getByRole('navigation', { name: 'CanViewer' })).toBeTruthy();
    expect(railLabels()).toEqual(['Overview', 'Messages', 'Network', 'Nodes', 'Tables', 'Compare', 'Traces']);
    expect(railItem('Messages').getAttribute('aria-current')).toBe('page');
    expect(railItem('Overview').getAttribute('aria-current')).toBeNull();
    fireEvent.click(railItem('Nodes'));
    expect(onNavigate).toHaveBeenCalledWith('nodes');
  });

  it('disables destinations without content, and everything before a file is open', () => {
    show({
      active: null,
      enabled: {
        overview: false,
        messages: false,
        network: false,
        nodes: false,
        tables: false,
        compare: false,
        traces: false,
      },
    });
    expect(railLabels().every((label) => railItem(label!).disabled)).toBe(true);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('shows a badge, capped at 999+', () => {
    show({ badges: { overview: 3 } });
    expect(railItem('Overview').querySelector('.rail-badge')?.textContent).toBe('3');
    expect(railItem('Messages').querySelector('.rail-badge')).toBeNull();
  });

  it('caps a large badge', () => {
    show({ badges: { overview: 1234 } });
    expect(railItem('Overview').querySelector('.rail-badge')?.textContent).toBe('999+');
  });

  it('opens a file from its action button', () => {
    const { onOpenFile } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    expect(onOpenFile).toHaveBeenCalledOnce();
  });
});

describe('NavRail: settings menu, About and Close file', () => {
  it('offers About always, and Close file only while a file is open', () => {
    const { onAbout } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['About CanViewer']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'About CanViewer' }));
    expect(onAbout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
  });

  it('closes the file from the menu', () => {
    const { onCloseFile, onAbout } = show({ fileOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Close file', 'About CanViewer']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close file' }));
    expect(onCloseFile).toHaveBeenCalledOnce();
    expect(onAbout).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('names both in German', () => {
    localStorage.setItem('canviewer.lang', 'de');
    show({ fileOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Datei schließen', 'Über CanViewer']);
  });
});

describe('NavRail: settings menu and language', () => {
  it('switches the language from the settings menu, and remembers it', () => {
    show();
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(settings);
    expect(settings.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-checked')])).toEqual([
      ['English', 'true'],
      ['Deutsch', 'false'],
    ]);

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(railLabels()).toEqual(['Übersicht', 'Botschaften', 'Netzwerk', 'Knoten', 'Tabellen', 'Vergleich', 'Traces']);
    expect(screen.getByRole('button', { name: 'Datei öffnen' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem('canviewer.lang')).toBe('de');

    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(screen.getByRole('menuitemradio', { name: 'Deutsch' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(railLabels()[0]).toBe('Overview');
    expect(document.documentElement.lang).toBe('en');
  });

  it('closes the menu with Escape or a click outside, but not with a click inside', () => {
    show();
    const settings = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settings);
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(settings);
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    // The menu button toggles it, too.
    fireEvent.click(settings);
    fireEvent.click(settings);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('NavRail: theme', () => {
  it('toggles between light and dark, and remembers the choice', () => {
    show();
    // jsdom has no matchMedia: the theme starts light.
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('canviewer.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('canviewer.theme')).toBe('light');
  });
});
