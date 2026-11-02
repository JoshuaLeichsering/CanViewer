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
     Overview · Messages (list, signal table, bit layout, decoder, encoder) · Network
     · Nodes · Tables · Compare · Traces                app/src/components/
                                     │
       export (CSV, JSON, C struct, pseudo-code)        app/src/lib/export/
       edit, then Save as DBC (writeDbc)                app/src/lib/dbc/edit.ts, writer.ts
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
| [`decode.ts`](../../app/src/lib/dbc/decode.ts), [`encode.ts`](../../app/src/lib/dbc/encode.ts) | Decoding a frame into physical values, and the inverse: physical values into a frame's bytes |
| [`edit.ts`](../../app/src/lib/dbc/edit.ts), [`writer.ts`](../../app/src/lib/dbc/writer.ts) | Checking and applying an edit to a message or signal, and writing the model back out as DBC ([decision record 0008](../decisions/0008-dbc-writer.md)) |

Around the model, in their own directories:

| Directory | What it does |
|---|---|
| [`app/src/lib/import/`](../../app/src/lib/import/) | Opening, importing and restoring files: the loader behind the progress panel, the cluster choice, and the stored file (a DBC in `localStorage`, an imported file's bytes in IndexedDB) |
| [`app/src/lib/export/`](../../app/src/lib/export/) | The message and signal lists as CSV and JSON, and a message as a C struct or as decode pseudo-code |
| [`app/src/lib/diff/`](../../app/src/lib/diff/) | Comparing two databases: added, removed and changed messages, signals, nodes, value tables and attribute definitions |
| [`app/src/lib/trace/`](../../app/src/lib/trace/) | Reading candump and Vector ASC logs, and replaying their frames through the database |

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
the selection (overview, a message and signal, a node, a value table, the graph, the Compare page or the Traces view),
the search and the filter. The selection is mirrored into the URL fragment
([deep links](../reference/deep-links.md)). The last file is restored on start: a DBC
from `localStorage`, an imported file from IndexedDB, with the cluster it showed.

- **Views** ([`app/src/components/`](../../app/src/components/)) are function components
  that render from the model; the bit layout and the network graph are SVG and CSS, with
  no chart library.
- **Language**: [`i18n.tsx`](../../app/src/lib/i18n.tsx) holds every UI string in
  English and German, typed so that a key missing in one language fails the type check;
  the strings of the Traces view and the frame encoder are in
  [`i18n-trc.ts`](../../app/src/lib/i18n-trc.ts), which it imports.
- **Theme**: [`theme.tsx`](../../app/src/lib/theme.tsx) sets `data-theme` on the root
  element before the first paint; colours are Material 3 tokens in
  [`styles.css`](../../app/src/styles.css)
  ([decision record 0004](../decisions/0004-material-3-interface.md)).
- **Offline**: in production builds a service worker
  ([`service-worker.js`](../../app/src/service-worker.js)) precaches the app shell,
  with the license files and the third-party notices that *About CanViewer* opens, and
  caches the Pyodide files when they are first fetched. It is generated at build time
  by a plugin in [`vite-plugins.ts`](../../scripts/vite-plugins.ts), which fills in the
  list of files to precache and a version made from their contents.

## The desktop shell

[`desktop/`](../../desktop/) wraps the same production build in a Tauri 2 window. The
build is embedded in the binary and served from a custom protocol, with a strict
content security policy. The desktop app registers no service worker, since it is
offline already. Its import worker starts from a one-line `blob:` module, so that it inherits the
page's policy ([`start-worker.ts`](../../app/src/lib/canmatrix/start-worker.ts)); the web
build starts it from its own URL. A self-test, active only when the environment variable
`CANVIEWER_SMOKE_FILES` is set, lets CI open files in the installed app on every system.
[Decision record 0009](../decisions/0009-desktop-shell.md) records the choice of Tauri
and its evidence, and the [release process](./release.md) how the packages are built,
tested and published.
