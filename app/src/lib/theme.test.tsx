// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '../test/render';
import { applyInitialTheme, ThemeProvider, useTheme } from './theme';

/** A controllable prefers-color-scheme query. */
function fakeSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      act(() => listeners.forEach((l) => l()));
    },
    listeners,
  };
}

function Probe() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>{theme}</button>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('applyInitialTheme', () => {
  it('uses a stored choice first', () => {
    fakeSystemTheme(true);
    localStorage.setItem('canviewer.theme', 'light');
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the system setting without a stored choice, and ignores a broken one', () => {
    fakeSystemTheme(true);
    localStorage.setItem('canviewer.theme', 'purple');
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light without matchMedia or storage', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('follows system changes until the user picks a theme', () => {
    const system = fakeSystemTheme(false);
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('light');
    system.set(true);
    expect(screen.getByRole('button').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('light');
    expect(localStorage.getItem('canviewer.theme')).toBe('light');
    // An explicit choice: the system no longer applies, and nothing listens.
    system.set(true);
    expect(screen.getByRole('button').textContent).toBe('light');
    expect(system.listeners.size).toBe(0);
    unmount();
  });

  it('starts from a stored choice and does not follow the system then', () => {
    const system = fakeSystemTheme(false);
    localStorage.setItem('canviewer.theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('dark');
    expect(system.listeners.size).toBe(0);
  });

  it('still switches when the choice cannot be stored', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('gives a light default outside a provider', () => {
    render(<Probe />);
    expect(screen.getByRole('button').textContent).toBe('light');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('light');
  });
});
