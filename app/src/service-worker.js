/* CanViewer service worker. Built into dist/sw.js by scripts/vite-plugins.ts,
 * which fills in the placeholders. Production builds only.
 *
 * - The app shell (index.html and the built JS/CSS, worker included) is
 *   precached on install, so the app opens offline after the first visit.
 * - Files under pyodide/ (runtime and wheels, ~16 MB) are cached the first time
 *   they are fetched, i.e. on the first non-DBC import, so an import works
 *   offline once one has been done online.
 * - Only same-origin GET requests are handled; the app makes no others.
 */
const SHELL_CACHE = 'canviewer-shell-__SHELL_VERSION__';
const PYODIDE_CACHE = 'canviewer-pyodide-__PYODIDE_VERSION__';
const PRECACHE = __PRECACHE__;

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
// Static hosts send Vary (vite preview: "Vary: Origin"); a module script's
// request carries an Origin header the precache request did not, so without
// ignoreVary the cached copy would never match. Safe here: every cached
// response is one of the app's own static files.
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map(scopeUrl)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('canviewer-') && key !== SHELL_CACHE && key !== PYODIDE_CACHE) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first, so a new deployment shows up; the cached shell when offline.
    event.respondWith(fetch(request).catch(() => caches.match(scopeUrl('./'), MATCH)));
    return;
  }

  const isPyodide = url.href.startsWith(scopeUrl('pyodide/'));
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, MATCH);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && isPyodide) {
        const cache = await caches.open(PYODIDE_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
