// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Shared setup for the component tests (they run under jsdom, see the
 * `// @vitest-environment jsdom` line at the top of each). Importing this
 * module registers the cleanup: Vitest runs without globals, so Testing
 * Library cannot register it by itself.
 */
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '../lib/i18n';
import { ThemeProvider } from '../lib/theme';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.removeAttribute('lang');
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </I18nProvider>
  );
}

/** Render inside the app's language and theme providers, as main.tsx does. */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: Providers, ...options });
}
