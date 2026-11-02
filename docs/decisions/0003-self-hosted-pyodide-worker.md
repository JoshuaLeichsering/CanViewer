# 0003. A self-hosted Pyodide worker, without micropip

- **Status:** accepted
- **Date:** 2026-11-01
- **Condensed from:** the [Pyodide worker spike](../spikes/2026-11-01-pyodide-worker/README.md)

## Context

canmatrix runs under Pyodide ([0002](./0002-canmatrix-import-adapter.md)). Out of the
box, Pyodide and its package installer micropip fetch code from `cdn.jsdelivr.net`,
`pypi.org` and `files.pythonhosted.org`. That is code, not CAN data, but it breaks
offline use and tells third parties that the app is in use. CanViewer promises that no
data leaves the machine and that the app makes no request outside its own origin.

## Decision

- **Pyodide runs in a dedicated Web Worker**, started on the first non-DBC import, so the
  page stays responsive and DBC-only sessions never load it.
- **The runtime and every wheel are part of the build**, served from the app's own
  origin under `pyodide/`: the runtime from the `pyodide` npm package, the wheels
  downloaded once by `scripts/fetch-wheels.mjs` and checked against SHA-256 checksums
  pinned in `wheels.lock.json`.
- **No micropip.** The worker passes the lock to `loadPyodide` as `lockFileContents`,
  sets `packageBaseUrl` to the app's own `pyodide/` directory and calls `loadPackage`.
  Pyodide resolves dependencies from the lock alone and checks each wheel's SHA-256. In
  the browser there is no CDN fallback once `packageBaseUrl` is set, so a missing file
  fails instead of being fetched elsewhere.
- **The page resolves the `pyodide/` URL** and passes it to the worker, so that the app
  works below any path (a relative base), such as `/app/` on GitHub Pages.
- **A service worker** precaches the app shell and caches the Pyodide files the first
  time they are fetched, so the app works offline after the first visit and imports
  work offline after the first import.
- **A network check guards it all**: CI drives the built app in Chromium with every
  other hostname unresolvable, records every request three ways, and fails on any
  request outside the origin.

## Consequences

- The first non-DBC import downloads 15,957,759 bytes (runtime 13.4 MB, canmatrix and
  its dependencies 0.4 MB, lxml 2.1 MB), uncompressed. It took 4.2 s from choosing the
  file to the database on screen in headless Chromium against a local server; the next
  file took 99 ms.
- A browser that never imported a file cannot import offline. The import then fails
  with a message and the app stays usable. Precaching the runtime would close the gap at
  the price of 16 MB for every visitor.
- The one external URL left in the bundle is Pyodide's own default CDN address, which is
  never used.
- In the desktop app, Tauri sends its content security policy only with HTML, so the
  worker runs without one; the app's own code and the checks keep it local.
- Adding a Python package means adding it to the lock with its checksum, and to the
  build through `fetch-wheels`.

## Evidence

The spike's run, on a production build served by `vite preview`, opened two ARXML files
online, reloaded offline and opened a DBC and an ARXML file, and in a fresh profile
tried an import offline. Three independent records (Playwright's request events, a HAR
file and Chromium's net-log) saw no request outside `http://localhost:4173`. CI repeats
the check on every change ([Tests and baselines](../develop/testing.md#the-network-check)).

## Alternatives considered

- **micropip with a local index**: adds an index lookup and one more wheel, for nothing
  the lock does not already do.
- **Loading Pyodide from its CDN**: the default, and exactly the third-party request the
  privacy promise rules out.
- **Pyodide on the main thread**: blocks the page for seconds on the first import.
