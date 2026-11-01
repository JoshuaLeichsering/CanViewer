// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inDesktopApp } from './desktop';

describe('inDesktopApp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false where there is no window (tests, workers)', () => {
    expect(inDesktopApp()).toBe(false);
  });

  it('is false in a browser and true where the Tauri shell defined its global', () => {
    vi.stubGlobal('window', {});
    expect(inDesktopApp()).toBe(false);
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(inDesktopApp()).toBe(true);
  });
});

/**
 * The desktop app's Content Security Policy, pinned. The import worker runs
 * under it (app/src/lib/canmatrix/start-worker.ts), so a change here changes
 * what Pyodide may do. Change it on purpose only, and say why.
 */
describe('the desktop CSP (desktop/tauri.conf.json)', () => {
  const conf = JSON.parse(readFileSync(new URL('../../../desktop/tauri.conf.json', import.meta.url), 'utf8'));
  const csp: Record<string, string> = conf.app.security.csp;

  it('is exactly the reviewed policy', () => {
    expect(csp).toEqual({
      'default-src': "'self'",
      'script-src': "'self' 'wasm-unsafe-eval'",
      'style-src': "'self'",
      'img-src': "'self'",
      'font-src': "'self'",
      'connect-src': "'self' ipc: http://ipc.localhost",
      'worker-src': "'self' blob:",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
    });
  });

  it('allows no source outside the app and its IPC, and no eval', () => {
    const sources = Object.values(csp).flatMap((v) => v.split(/\s+/));
    const allowed = new Set(["'self'", "'none'", "'wasm-unsafe-eval'", 'blob:', 'ipc:', 'http://ipc.localhost']);
    expect(sources.filter((s) => !allowed.has(s))).toEqual([]);
    expect(sources).not.toContain("'unsafe-eval'");
    expect(sources).not.toContain("'unsafe-inline'");
  });
});
