import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'canviewer.theme';

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Sets data-theme on <html> before React renders, so the first paint already
 * has the right colors. An explicit choice is remembered; without one the
 * system setting applies.
 */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = storedTheme() ?? systemTheme();
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  const [explicit, setExplicit] = useState(() => storedTheme() !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Follow the system setting until the user picks a theme themselves.
  useEffect(() => {
    if (explicit || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [explicit]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // not persisted; the choice still applies for this session
      }
      return next;
    });
    setExplicit(true);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
