# Spike: canmatrix in a Pyodide Web Worker, self-hosted

**Date** 2026-11-01. Task 3 of [the handover](../../handover/2026-11-01-multi-format-import.md):

> Run Pyodide in a Web Worker under Vite, with the runtime and the wheels in the build
> (`public/` or a Vite plugin) and micropip installing only from those local URLs.
> Done means: a production build opens an ARXML file with the network panel showing no
> request outside the app's own origin, and the app still works offline after first load.

**Result: done.** A production build served by `vite preview` opened two ARXML files
and made no request outside `http://localhost:4173`, according to three independent
records (Playwright's request events, a HAR file and Chromium's net-log). After the
first visit it reloaded and opened a DBC and an ARXML file with the network switched off.

## How it works

| Piece | Where |
|---|---|
| Worker: starts Pyodide on the first non-DBC import, loads format packages on demand, runs `canviewer_adapter.read()` | `src/lib/canmatrix/worker.ts` |
| Client: creates the worker on first use, transfers the file bytes, reports the loading stage | `src/lib/canmatrix/client.ts` |
| Assets: runtime from `node_modules/pyodide`, wheels from `vendor/pyodide` (see `scripts/fetch-wheels.mjs`), served under `<base>pyodide/` in dev and copied to `dist/pyodide/` in the build | `scripts/vite-plugins.ts` |
| Service worker: precaches the app shell, caches `pyodide/*` when first fetched | `src/service-worker.js`, built to `dist/sw.js` |

There is **no micropip**, a deliberate change from the handover's wording. The worker
passes the custom lock file (`src/lib/canmatrix/wheels.lock.json`, minus its download URLs)
to `loadPyodide` as `lockFileContents`, sets `packageBaseUrl` to `<base>pyodide/`, and
calls `loadPackage`. Pyodide resolves dependencies from that lock alone and checks each
wheel against its SHA-256. In the browser there is no CDN fallback (in
`pyodide.asm.mjs`'s `downloadPackage`, only Node retries from `cdnURL`, and `cdnUrl` is set
to `packageBaseUrl` whenever that is given). micropip would add a package index lookup
and one more wheel, for nothing the lock does not already do.

The one external URL left in the bundle is Pyodide's own default,
`` e.cdnUrl=S(e.packageBaseUrl??`https://cdn.jsdelivr.net/pyodide/v${C}/full/`) ``
in the worker chunk, which is not used because `packageBaseUrl` is always set.

## Evidence

`network-check.mjs` drives the build in Chromium 1243 (Playwright 1.63.0). Chromium was
started with `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost`, so any other
host would have failed to resolve. The run below is the build of commit `4af2d5c`.

```sh
npm run build
npx vite preview --port 4173 --strictPort &
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node docs/spikes/2026-11-01-pyodide-worker/network-check.mjs \
  http://localhost:4173/ /tmp/out \
  third_party/canmatrix/tests/files/arxml/test.arxml \
  third_party/canmatrix/tests/files/arxml/ARXMLContainerTest.arxml \
  examples/demo.dbc dist
```

[network-check.log](network-check.log), verbatim:

```
# phase A: online, cold (http://localhost:4173/)
service worker controls page: true
open test.arxml: 4208 ms -> test.arxml · 28 messages · 152 signals · 0 nodes
# phase B: online, warm
open ARXMLContainerTest.arxml: 99 ms -> ARXMLContainerTest.arxml · 5 messages · 10 signals · 0 nodes
# phase C: offline
offline probe of http://localhost:4173/offline-probe: unreachable (TypeError: Failed to fetch)
reloaded offline, page title: CanViewer — DBC Database Viewer
open demo.dbc: 23 ms -> demo.dbc · version “CanViewer Demo 1.0” · 9 messages · 33 signals · 5 nodes
open test.arxml: 3837 ms -> test.arxml · 28 messages · 152 signals · 0 nodes
# phase D: fresh profile, offline before any import
open test.arxml: Could not read test.arxml: Failed to fetch dynamically imported module: http://localhost:4173/pyodide/pyodide.asm.mjs
then open demo.dbc: demo.dbc · version “CanViewer Demo 1.0” · 9 messages · 33 signals · 5 nodes
# requests
phase A: 31 requests {"page/worker":15,"service-worker":16}; 19 answered by the server, 0 failed; /pyodide/ files from the server: 8, 15957759 bytes
  /pyodide/python_stdlib.zip 2545637
  /pyodide/pyodide.asm.wasm 9598218
  /pyodide/pyodide.asm.mjs 1250344
  /pyodide/canmatrix-1.3.3-py3-none-any.whl 230838
  /pyodide/attrs-26.1.0-py3-none-any.whl 67548
  /pyodide/six-1.17.0-py2.py3-none-any.whl 11050
  /pyodide/click-8.3.1-py3-none-any.whl 108274
  /pyodide/lxml-6.1.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl 2145850
phase B: 0 requests {}; 0 answered by the server, 0 failed; /pyodide/ files from the server: 0, 0 bytes
phase C: 15 requests {"page/worker":13,"service-worker":2}; 0 answered by the server, 3 failed; /pyodide/ files from the server: 0, 0 bytes
phase D: 21 requests {"page/worker":10,"service-worker":11}; 10 answered by the server, 7 failed; /pyodide/ files from the server: 0, 0 bytes
requests outside http://localhost:4173: 0
HAR: 46 entries, origins ["http://localhost:4173"]
net-log: 152 url entries, origins ["http://localhost:4173"]
```

- [requests.json](requests.json): every request of all four phases, with its source
  (page or worker, or service worker), status, whether the service worker answered it,
  and any failure. Playwright reports the dedicated worker's requests as the page's.
- [requests.har](requests.har): HAR of phases A to C (phase D runs in a second browser
  context without one).
- [netlog-urls.txt](netlog-urls.txt): every `url` and `host` value in Chromium's net-log
  for the whole run, which covers every context including the service worker. The only
  host values are `localhost` and `http://localhost:4173`.
- [A-online-arxml.png](A-online-arxml.png): `test.arxml` open in the existing views.
  The screenshot after the offline open in phase C is byte-identical (same MD5).
- [D-offline-import-error.png](D-offline-import-error.png): the message when a profile
  that never imported anything tries an import offline.

## What the numbers say

- **Download on the first non-DBC import: 15,957,759 bytes** for an ARXML file
  (runtime 13,394,199, canmatrix with attrs, six and click 417,710, lxml 2,145,850),
  uncompressed as `vite preview` serves them. `pyodide.asm.wasm` gzips to 3,600.75 kB
  (`vite build` output), so a host that compresses sends less. Other formats load
  their own packages when first needed (pyyaml 112,901, openpyxl with et-xmlfile
  268,969, xlrd with xlwt 203,232). A DBC-only session downloads none of it: the main
  bundle grew from 203.14 kB to 206.20 kB, and the worker chunk (29.59 kB, Pyodide's
  loader and the adapter) loads only on import.
- **Cold start 4.2 s** in headless Chromium against a local server, from choosing the
  file to the database on screen. That is the first import of a session; the next
  file took 99 ms.
- **Offline**: after one visit the app shell comes from the service worker. After one
  online import, so do the Pyodide files: offline, the import took 3.8 s, all of it
  from the cache (`0 answered by the server`). Without an earlier import the runtime is
  not cached. The import then fails with a message and the app stays usable (phase D).
  Precaching the runtime on the first visit would remove that gap, but it would make
  every visitor download 16 MB.

## Caveats and follow-ups

- The DBC path is untouched: `.dbc` and `.txt` still go to `parseDbc`, and the corpus
  baseline still matches (58 files).
- Spike scope in the UI: the file dialog accepts `.arxml` (drag and drop takes every
  canmatrix format), the first cluster with messages is shown, a stage line replaces the
  file info while loading, and canmatrix's log lines are listed as problems. An imported
  file is not restored on reload. Task 5 covers the UI properly.
- In the sidebar, 8-digit hex IDs run into long message names (visible in
  `A-online-arxml.png`). That is the existing layout, but ARXML files with extended IDs
  and long names will show it more often.
- `vite build` logs `Module "node:…" has been externalized for browser compatibility`
  for `pyodide.mjs`'s Node-only branches. Those branches never run in the browser.
- The service worker is registered only in production builds. It ignores `Vary` when
  matching (`vite preview` sends `Vary: Origin`, which otherwise made every cached script
  miss when offline), and it handles same-origin GET requests only.
