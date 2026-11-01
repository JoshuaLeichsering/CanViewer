// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import './test/render';

/** Run the entry point once, as the browser does on page load. */
async function boot() {
  vi.resetModules();
  await act(async () => {
    await import('./main');
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  document.body.innerHTML = '';
});

function stubServiceWorker(register = vi.fn().mockResolvedValue({})) {
  vi.stubGlobal('navigator', { ...navigator, language: navigator.language, serviceWorker: { register } });
  return register;
}

describe('main', () => {
  it('applies the stored theme before rendering the app into #root', async () => {
    localStorage.setItem('canviewer.theme', 'dark');
    await boot();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByText('A viewer for DBC CAN database files.')).toBeTruthy();
  });

  it('registers no service worker in development', async () => {
    const register = stubServiceWorker();
    await boot();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the service worker of a production build below the base URL', async () => {
    vi.stubEnv('PROD', true);
    const register = stubServiceWorker();
    await boot();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('works on when the service worker cannot be registered', async () => {
    vi.stubEnv('PROD', true);
    const register = stubServiceWorker(vi.fn().mockRejectedValue(new Error('insecure context')));
    await boot();
    expect(register).toHaveBeenCalledOnce();
    expect(screen.getByText('A viewer for DBC CAN database files.')).toBeTruthy();
  });

  it('registers none in the desktop app, which serves the build from its binary', async () => {
    vi.stubEnv('PROD', true);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const register = stubServiceWorker();
    await boot();
    expect(register).not.toHaveBeenCalled();
  });
});
