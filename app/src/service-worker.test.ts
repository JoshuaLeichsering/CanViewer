// SPDX-License-Identifier: GPL-2.0-or-later
// The service worker's caching rules, with the worker scope, the Cache API and
// fetch replaced by stand-ins. A real browser runs it in the end-to-end tests
// (offline reload) and in the network check.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = 'http://localhost:4173/app/';
// The source as it is, with its build-time placeholders: __PRECACHE__ is a
// global here, and the cache names keep their placeholder versions.
const SHELL = 'canviewer-shell-__SHELL_VERSION__';
const PYODIDE = 'canviewer-pyodide-__PYODIDE_VERSION__';
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'service-worker.js');
const MATCH = { ignoreSearch: true, ignoreVary: true };

type Handler = (event: Record<string, unknown>) => void;

class FakeCache {
  entries = new Map<string, Response>();
  added: string[] = [];
  async addAll(urls: string[]) {
    this.added.push(...urls);
  }
  async put(request: { url: string }, response: Response) {
    this.entries.set(request.url, response);
  }
}

let handlers: Record<string, Handler>;
let stores: Map<string, FakeCache>;
let cached: Map<string, Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let sw: { skipWaiting: ReturnType<typeof vi.fn>; claim: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  handlers = {};
  stores = new Map();
  cached = new Map();
  fetchMock = vi.fn();
  sw = { skipWaiting: vi.fn(), claim: vi.fn() };
  vi.stubGlobal('self', {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    clients: { claim: sw.claim },
    skipWaiting: sw.skipWaiting,
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
  });
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: vi.fn(async (request: string | { url: string }) => cached.get(typeof request === 'string' ? request : request.url)),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('__PRECACHE__', ['./', 'assets/index-abc.js', 'assets/index-def.css', 'sw.js']);
  vi.resetModules();
  await import(/* @vite-ignore */ SOURCE);
});

/** Dispatch an event and wait for what it handed to waitUntil or respondWith. */
async function dispatch(type: string, extra: Record<string, unknown> = {}) {
  let pending: Promise<unknown> | undefined;
  let responded = false;
  handlers[type]({
    ...extra,
    waitUntil: (p: Promise<unknown>) => (pending = p),
    respondWith: (p: Promise<unknown>) => {
      responded = true;
      pending = p;
    },
  });
  return { responded, result: await pending };
}
const get = (path: string, mode = 'cors') => ({ request: { method: 'GET', url: new URL(path, SCOPE).href, mode } });

describe('service worker', () => {
  it('precaches the app shell below its scope on install, and takes over at once', async () => {
    await dispatch('install');
    expect(stores.get(SHELL)?.added).toEqual([
      SCOPE,
      `${SCOPE}assets/index-abc.js`,
      `${SCOPE}assets/index-def.css`,
      `${SCOPE}sw.js`,
    ]);
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });

  it('drops caches of older versions on activate, and keeps everything else', async () => {
    for (const name of ['canviewer-shell-0ld', 'canviewer-pyodide-0ld', SHELL, PYODIDE, 'another-app']) {
      stores.set(name, new FakeCache());
    }
    await dispatch('activate');
    expect([...stores.keys()]).toEqual([SHELL, PYODIDE, 'another-app']);
    expect(sw.claim).toHaveBeenCalledOnce();
  });

  it('leaves requests other than same-origin GETs alone', async () => {
    expect((await dispatch('fetch', { request: { method: 'POST', url: `${SCOPE}x`, mode: 'cors' } })).responded).toBe(false);
    expect((await dispatch('fetch', get('https://example.com/font.woff2'))).responded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads pages from the network first, so a new deployment shows up', async () => {
    const page = new Response('new');
    fetchMock.mockResolvedValue(page);
    const { responded, result } = await dispatch('fetch', get('./#msg=256', 'navigate'));
    expect(responded).toBe(true);
    expect(result).toBe(page);
  });

  it('serves the cached shell for a page when offline', async () => {
    const shell = new Response('shell');
    cached.set(SCOPE, shell);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await dispatch('fetch', get('./?x=1', 'navigate'));
    expect(result).toBe(shell);
    expect(vi.mocked(caches.match)).toHaveBeenCalledWith(SCOPE, MATCH);
  });

  it('answers files from the cache first, ignoring query and Vary', async () => {
    const script = new Response('js');
    cached.set(`${SCOPE}assets/index-abc.js`, script);
    const { result } = await dispatch('fetch', get('assets/index-abc.js'));
    expect(result).toBe(script);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(caches.match).mock.calls[0][1]).toEqual(MATCH);
  });

  it('caches Pyodide files the first time they are fetched', async () => {
    const wasm = new Response('wasm', { status: 200 });
    fetchMock.mockResolvedValue(wasm);
    const { result } = await dispatch('fetch', get('pyodide/pyodide.asm.wasm'));
    expect(result).toBe(wasm);
    expect([...stores.get(PYODIDE)!.entries.keys()]).toEqual([`${SCOPE}pyodide/pyodide.asm.wasm`]);
  });

  it('caches neither failed Pyodide responses nor other uncached files', async () => {
    fetchMock.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await dispatch('fetch', get('pyodide/missing.whl'));
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await dispatch('fetch', get('assets/late-chunk.js'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stores.size).toBe(0);
  });
});
