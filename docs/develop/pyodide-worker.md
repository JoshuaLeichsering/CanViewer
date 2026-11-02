# The Pyodide worker

Non-DBC formats are read by canmatrix, a Python library, running under
[Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly) in a Web Worker. The
runtime and every Python package are part of the build and are served from the app's
own origin. [Decision record 0003](../decisions/0003-self-hosted-pyodide-worker.md)
explains the choices; this page explains the parts.

## The parts

| Piece | Where |
|---|---|
| Format table: which extension goes to which canmatrix reader, and which packages it needs | [`formats.ts`](../../app/src/lib/canmatrix/formats.ts) |
| Client: starts the worker on first use, transfers the file's bytes, reports the loading stage | [`client.ts`](../../app/src/lib/canmatrix/client.ts) |
| Worker: starts Pyodide on the first import, loads packages on demand, calls the adapter | [`worker.ts`](../../app/src/lib/canmatrix/worker.ts), [`worker-protocol.ts`](../../app/src/lib/canmatrix/worker-protocol.ts) |
| Adapter: reads the file with canmatrix and maps its model into a `DbcDatabase`-shaped dict, with problems | [`canviewer_adapter.py`](../../app/src/lib/canmatrix/canviewer_adapter.py) |
| Wheel lock: every package with its file name and SHA-256 | [`wheels.lock.json`](../../app/src/lib/canmatrix/wheels.lock.json) |
| Assets: the runtime from `node_modules/pyodide`, the wheels from `vendor/pyodide`, served under `<base>pyodide/` in dev and copied to `dist/pyodide/` in the build | [`vite-plugins.ts`](../../scripts/vite-plugins.ts), [`fetch-wheels.mjs`](../../scripts/fetch-wheels.mjs) |
| Node runtime for the tests: the same adapter under Pyodide in Node, with `fetch` blocked | [`node-runtime.ts`](../../app/src/lib/canmatrix/node-runtime.ts) |

## How a file is read

1. The client creates the worker on the first non-DBC file and posts the file's bytes,
   the canmatrix import type, the packages the format needs, and the absolute URL of
   the `pyodide/` directory. The page resolves that URL against its own address, so the
   app works below any path, such as `/app/` on GitHub Pages.
2. The worker starts Pyodide once, with the lock file's contents (`lockFileContents`)
   and `packageBaseUrl` set to that directory, and loads the format's packages with
   `loadPackage`. Pyodide resolves dependencies from the lock alone and checks every
   wheel against its SHA-256.
3. The adapter reads the bytes with canmatrix, captures what canmatrix prints, and
   returns every cluster as a dict plus the log. The client keeps the first cluster with
   messages.

The worker reports three stages (runtime, packages, reading), which the app shows while
it waits.

## No micropip, no CDN

There is no micropip: it would add a package index lookup and one more wheel, for
nothing the lock does not already do. In the browser Pyodide has no CDN fallback once
`packageBaseUrl` is set, so a missing file fails instead of being fetched elsewhere. The
one external URL left in the bundle is Pyodide's own default CDN address, which is never
used because `packageBaseUrl` is always set.

## Sizes

Measured on the first ARXML import, as `vite preview` serves the files (uncompressed):

| Part | Bytes |
|---|---:|
| Runtime (`pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide.asm.mjs`) | 13,394,199 |
| canmatrix with attrs, six and click | 417,710 |
| lxml (for ARXML, KCD, FIBEX and ODX) | 2,145,850 |
| **First ARXML import** | **15,957,759** |
| pyyaml (YAML), when first needed | 112,901 |
| openpyxl with et-xmlfile (Excel), when first needed | 268,969 |

`pyodide.asm.wasm` compresses to about 3.6 MB with gzip, so a host that compresses
sends less. A DBC-only session downloads none of it: the worker chunk (Pyodide's loader
and the adapter, about 40 kB) loads only on the first import.

## Offline

The service worker caches every file under `pyodide/` the first time it is fetched. After
one online import, imports work offline. A browser that never imported anything cannot
import offline; the import then fails with a message and the app stays usable.
Precaching the runtime on the first visit would close that gap, at the price of 16 MB
for every visitor, including those who only open DBC files.

## The network check

[`e2e/network-check.mjs`](../../e2e/network-check.mjs) proves the privacy promise for
every change: it drives the production build in Chromium, opens ARXML and DBC files
online, offline after a visit, and in a fresh profile that never imported anything, and
records every request through Playwright, a HAR file and Chromium's net-log. Chromium
starts with every hostname except `localhost` unresolvable. The check fails on any
request outside the app's origin. CI runs it on the default build, and the Pages
workflow on the app as published under `/app/`. See [Tests and baselines](./testing.md#the-network-check).

## In the desktop app

The desktop app serves the same files from inside the binary. Tauri sends its content
security policy only with HTML responses, so a worker loaded from its own URL would run
without one. In the desktop app the worker therefore starts from a one-line `blob:`
module that imports the real worker script
([`start-worker.ts`](../../app/src/lib/canmatrix/start-worker.ts)): a worker created from
a `blob:` URL inherits the policy of the page, and the policy allows `blob:` in
`worker-src` for it. Under `connect-src 'self'` the worker cannot reach another host.
The web build keeps the plain worker URL: GitHub Pages sends no policy for it to inherit,
and its service worker must serve the worker's requests offline.

[`e2e/desktop-csp-check.mjs`](../../e2e/desktop-csp-check.mjs) checks the import worker under
the policy in Chromium in CI. The installed app's self-test checks, in each system's own
webview, that a worker started from a `blob:` URL is held to the policy
([decision record 0009](../decisions/0009-desktop-shell.md)). The
[Tauri spike report](../spikes/2026-11-01-tauri-desktop/README.md) has the measurements.
