// SPDX-License-Identifier: GPL-2.0-or-later
import { resolveObjectURL } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startImportWorker, workerBootstrap } from './start-worker';

/** Records what the code under test hands to `new Worker(...)`. */
class FakeWorker {
  static created: { url: string; options: WorkerOptions | undefined }[] = [];
  constructor(url: string | URL, options?: WorkerOptions) {
    FakeWorker.created.push({ url: String(url), options });
  }
}

describe('startImportWorker', () => {
  beforeEach(() => {
    FakeWorker.created = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts the worker from its own URL in a browser', () => {
    vi.stubGlobal('document', { baseURI: 'https://example.org/app/' });
    startImportWorker('./assets/worker-abc.js', false);
    expect(FakeWorker.created).toEqual([
      { url: 'https://example.org/app/assets/worker-abc.js', options: { type: 'module' } },
    ]);
  });

  it('starts the worker from a blob: module that imports the script in the desktop app', async () => {
    vi.stubGlobal('document', { baseURI: 'tauri://localhost/' });
    startImportWorker('/assets/worker-abc.js', true);
    expect(FakeWorker.created).toHaveLength(1);
    const [{ url, options }] = FakeWorker.created;
    expect(options).toEqual({ type: 'module' });
    expect(url.startsWith('blob:')).toBe(true);
    const blob = resolveObjectURL(url);
    expect(blob?.type).toBe('text/javascript');
    expect(await blob?.text()).toBe('import "tauri://localhost/assets/worker-abc.js";\n');
  });

  it('keeps an absolute script URL as it is (WebView2 serves the app from http://tauri.localhost)', () => {
    vi.stubGlobal('document', { baseURI: 'http://tauri.localhost/' });
    startImportWorker('http://tauri.localhost/assets/worker-abc.js', false);
    expect(FakeWorker.created[0].url).toBe('http://tauri.localhost/assets/worker-abc.js');
  });
});

describe('workerBootstrap', () => {
  it('is a single static import, quoted as a JavaScript string', () => {
    expect(workerBootstrap('http://tauri.localhost/assets/w.js')).toBe('import "http://tauri.localhost/assets/w.js";\n');
    // A quote in the URL cannot end the string early.
    expect(workerBootstrap('tauri://localhost/a"b.js')).toBe('import "tauri://localhost/a\\"b.js";\n');
  });
});
