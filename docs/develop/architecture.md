# Architecture

CanViewer is a static single-page app. There is no backend: a file is read in the
browser, turned into one data model, and every view renders from that model.

```
file opened or dropped
  │
  ├─ .dbc, .txt, anything else ─→ parseDbc()            app/src/lib/dbc/parser.ts
  │                                  │
  └─ .arxml .kcd .sym .dbf .xlsx     │
     .json .yaml .yml .xml .odx      │
       │                             │
       └─→ Web Worker: Pyodide + canmatrix              app/src/lib/canmatrix/worker.ts
             canviewer_adapter.read()                   canviewer_adapter.py
             (canmatrix model → plain dict)             │
                                     │                  │
                                     ▼                  ▼
                               DbcDatabase              app/src/lib/dbc/types.ts
                                     │
                     App state: file, selection, search, filter   app/src/App.tsx
                                     │
     Overview · Messages (list, signal table, bit layout, decoder) · Network · Nodes · Tables
                                                        app/src/components/
```

## The model

[`DbcDatabase`](../../app/src/lib/dbc/types.ts) is CanViewer's one model of a CAN
database: messages with their signals, nodes, value tables, attribute definitions and
values, comments, the statements that were skipped, and the parse problems. It is
shaped after DBC, because DBC is the richest of the formats CanViewer reads, and it
holds only what a file says: the canmatrix mapper leaves out values that canmatrix
synthesizes, such as a signal's `initial_value`.

Rules that the views share live next to the model, each with unit tests:

| Module | What it decides |
|---|---|
| [`bits.ts`](../../app/src/lib/dbc/bits.ts) | Bit positions (Intel and Motorola), the bit layout, overlaps, decoding a frame, multiplexer activity |
| [`canfd.ts`](../../app/src/lib/dbc/canfd.ts) | CAN FD and J1939 frame formats (`VFrameFormat`, payload size), valid FD frame sizes |
| [`j1939.ts`](../../app/src/lib/dbc/j1939.ts) | J1939 databases, identifier decomposition, well-known PGN and address names |
| [`identity.ts`](../../app/src/lib/dbc/identity.ts) | Telling apart messages that share an ID (invalid, but found in real files) |

## Reading DBC

[`parseDbc()`](../../app/src/lib/dbc/parser.ts) is a line-oriented parser. It joins
statements that wrap across lines, parses each statement on its own, and records a
problem with the line number for anything it cannot read, so that one bad line never
loses the file. The [DBC reference](../reference/dbc.md) lists what it models. It runs
on the main thread: the largest corpus file takes a few tens of milliseconds.

## Reading everything else

Other formats go to a Web Worker that runs canmatrix under Pyodide, loaded on the first
such file only. [The Pyodide worker](./pyodide-worker.md) describes it, and
[decision record 0002](../decisions/0002-canmatrix-import-adapter.md) why canmatrix is an
import adapter and not the base. The Python side,
[`canviewer_adapter.py`](../../app/src/lib/canmatrix/canviewer_adapter.py), maps
canmatrix's model straight into a dictionary shaped like `DbcDatabase`, and turns
whatever canmatrix prints while reading into parse problems with line numbers where it
can find them.

## The app shell

[`App.tsx`](../../app/src/App.tsx) holds the state: the open database and file name,
the selection (overview, a message and signal, a node, a value table, or the graph),
the search and the filter. The selection is mirrored into the URL fragment
([deep links](../reference/deep-links.md)). The last DBC file is kept in `localStorage`
and restored on start.

- **Views** ([`app/src/components/`](../../app/src/components/)) are function components
  that render from the model; the bit layout and the network graph are SVG and CSS, with
  no chart library.
- **Language**: [`i18n.tsx`](../../app/src/lib/i18n.tsx) holds every UI string in
  English and German, typed so that a key missing in one language fails the type check.
- **Theme**: [`theme.tsx`](../../app/src/lib/theme.tsx) sets `data-theme` on the root
  element before the first paint; colours are Material 3 tokens in
  [`styles.css`](../../app/src/styles.css)
  ([decision record 0004](../decisions/0004-material-3-interface.md)).
- **Offline**: in production builds a service worker
  ([`service-worker.js`](../../app/src/service-worker.js)) precaches the app shell and
  caches the Pyodide files when they are first fetched. It is generated at build time
  by a plugin in [`vite-plugins.ts`](../../scripts/vite-plugins.ts), which fills in the
  list of files to precache.

## The desktop shell

[`desktop/`](../../desktop/) wraps the same production build in a Tauri 2 window. The
build is embedded in the binary and served from a custom protocol, with a strict
content security policy. The desktop app registers no service worker, since it is
offline already. A self-test, active only when the environment variable
`CANVIEWER_SMOKE_FILES` is set, lets CI open files in the installed app on every system.
The [Tauri spike report](../spikes/2026-11-01-tauri-desktop/README.md) has the evidence
behind the choice.

<!-- TODO(phase-2, W4): link the decision record on the desktop shell, and the release
workflow. -->
