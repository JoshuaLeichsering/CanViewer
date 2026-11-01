# CanViewer

A viewer for DBC CAN database files, running entirely in the browser.
No data leaves your machine — files are parsed locally.

## Features

- **Material 3 interface**: navigation rail (Overview, Messages, Network, Nodes, Tables),
  list-detail layout, light and dark theme (follows the system until switched in the rail),
  fonts and icons bundled with the app
- **Message list** sorted by CAN ID with hex IDs, FD / J1939 / EXT tags, filter chips
  (all, extended, CAN FD) and search across message names, IDs and signal names
- **Signal table** per message: start bit, length, byte order (Intel/Motorola), type,
  factor/offset, min/max, unit, receivers, multiplexing (incl. extended multiplexing
  via `SG_MUL_VAL_`)
- **Bit layout**: one row per byte, each signal one tonal block numbered on its start bit,
  Motorola sawtooth layout, conflict detection (mux alternatives sharing bits are *not*
  flagged); selecting a signal highlights it everywhere
- **Frame decoder**: paste hex bytes, get physical values, value-table labels (the decoded
  value is marked in the signal card) and multiplexer-aware activity
- **CAN FD aware**: FD badge (via payload size or Vector's `VFrameFormat` attribute,
  J1939 PGs exempt), frame-size validity hints (12/16/20/24/32/48/64 bytes, padding
  note for odd sizes), bit matrix collapses the unused tail of large frames
- **J1939 aware**: in J1939 databases (ProtocolType attribute or `J1939PG` messages),
  extended IDs are decomposed into priority / PGN / PDU type / destination / source
  address with well-known SAE PGN and address names; the overview gains a PGN column
- **Node view**: transmitted messages and received signals per ECU
- **ECU network graph**: interactive sender→receiver topology — arrows per direction,
  line width scales with message count, click nodes/connections to drill into the
  messages behind them
- **Value tables**, with the signals that use the same values; comments (multi-line),
  attributes (`BA_DEF_` / `BA_` incl. ENUM resolution), `SIG_VALTYPE_` float/double signals
- **Robust parsing**: malformed lines are collected as warnings instead of failing the
  whole file; Latin-1 fallback for files from Vector tools
- Last opened file is restored on reload; views are deep-linkable (`#msg=…`, `#node=…`),
  and **Copy link** on a message copies the link to it
- **UI language switch** (English/German) in the rail's menu, persisted; defaults to
  the browser language

## Repository layout

| Path | What it holds |
|---|---|
| `app/` | The web app, and Vite's root: `index.html` and `src/` (the views, the DBC parser in `src/lib/dbc/`, the canmatrix import in `src/lib/canmatrix/`, each with its tests next to it) |
| `desktop/` | The Tauri desktop shell, which packages the build in `dist/` |
| `e2e/` | Checks that drive a browser or the packaged app: `network-check.mjs`, the Playwright flows in `flows/` (`npm run e2e`, configured in `playwright.config.ts`), the UI checks (`ui-checks.mjs`), the import UI's checks (`import-ui.test.mjs`), the signal table and large database checks (`signal-table.mjs`, `large-database.mjs`), the export check (`export-check.mjs`), the diff mode check (`diff-check.mjs`, with its pinned ARXML comparison `diff-check-arxml.txt`), the Traces and encoder check (`trc-traces-encoder.mjs`), the desktop smoke test over CDP with its build config (`desktop-cdp-smoke.mjs`, `desktop-cdp.conf.json`), and the check of the file the desktop self-test exports (`desktop-download-check.mjs`) |
| `scripts/` | Build and maintenance scripts: `fetch-wheels.mjs`, the Vite plugins, the CI check of the test report, the coverage summary, the license and identifying-information checks, the generator of `THIRD_PARTY_NOTICES.md` |
| `examples/` | Sample files: `demo.dbc`, its later version `demo-v2.dbc`, and the logs `demo.asc` and `demo-candump.log` |
| `docs/` | Handover notes, spike reports, design notes and [decision records](docs/decisions/) |
| `third_party/` | The corpus submodules (opendbc, model3dbc, canmatrix, cantools) |
| `.github/` | CI (`workflows/ci.yml`), the desktop builds (`workflows/desktop.yml`), issue and pull request templates, `CODEOWNERS` |
| the root | Config only: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore`, `.gitattributes`, `.gitmodules`; and `README.md`, `BACKLOG.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` |

Every command runs from the repository root. Vite's root is `app/`, so dev server URLs
start there (`/src/main.tsx` is `app/src/main.tsx`), while the build still goes to
`dist/` at the root. Why the web app is not at the root, as in Vite's templates:
[decision record 0001](docs/decisions/0001-repository-layout.md).

## Development

```sh
npm install
npm run fetch-wheels   # Python wheels for the import adapter, into vendor/pyodide/
npm run dev            # dev server on http://localhost:5173
npm test               # unit tests + corpus suites
npm run test:coverage  # the same, with the coverage thresholds of vite.config.ts
npm run build          # typecheck + production build (dist/)
npm run e2e            # Playwright flows against the build (npx playwright install chromium once)
node e2e/ui-checks.mjs # accessibility (axe), keyboard and narrow-layout checks against the build
```

`e2e/import-ui.test.mjs` checks the import of every canmatrix format against a running
build; [CONTRIBUTING.md](CONTRIBUTING.md#the-local-check) shows how to start it.

CI ([ci.yml](.github/workflows/ci.yml)) runs on every push to `main` and every pull
request: typecheck, all tests with the coverage thresholds, a check that every corpus
suite ran over the expected number of files with nothing skipped
([check-test-report.mjs](scripts/check-test-report.mjs)), the production build, the
network check, which fails on any request outside the app's origin, the end-to-end
flows, the UI checks, the import UI's checks, the signal table and large database
checks, the export check, the diff mode check and the Traces and encoder check. A second
job checks licenses, notices and identifying information
([CONTRIBUTING.md](CONTRIBUTING.md#the-local-check) lists every step).

`dev`, `test` and `build` run `fetch-wheels` first. It downloads the wheels listed in
[wheels.lock.json](app/src/lib/canmatrix/wheels.lock.json) from jsDelivr (the
Pyodide-built ones) and PyPI, and checks each against its pinned SHA-256. Files
already present are left alone, so it works offline once they are there. Where
those hosts are unreachable, `node scripts/fetch-wheels.mjs --from <dir>` takes
them from a local directory, such as an unpacked
[Pyodide release](https://github.com/pyodide/pyodide/releases/tag/314.0.7).

A production build carries the Pyodide runtime and those wheels in `dist/pyodide/`
(about 16 MB, fetched only when a non-DBC file is opened) and a service worker
(`dist/sw.js`, production only) that keeps the app usable offline after the first
visit. See the [worker spike notes](docs/spikes/2026-11-01-pyodide-worker/README.md).

An example database ships with the repository: open
[examples/demo.dbc](examples/demo.dbc) via **Open file…** or drag & drop it into
the window.

## Tested against real-world files

Two OEM database collections are vendored as git submodules under `third_party/`:
[commaai/opendbc](https://github.com/commaai/opendbc) and
[joshwardell/model3dbc](https://github.com/joshwardell/model3dbc) — 58 databases from
Toyota, Tesla, BMW, Mercedes, VW, Ford, GM, Hyundai, Mazda, Chrysler, Volvo, PSA,
Nissan, Rivian and more (~4,200 messages, ~33,700 signals). Fetch them with:

```sh
git submodule update --init
```

`npm test` then runs the corpus suite ([corpus.test.ts](app/src/lib/dbc/corpus.test.ts)):
every file must parse with zero problems except for a pinned allowlist of genuine
upstream inconsistencies (stale comments referencing renamed signals). Each file's
parse result is also pinned in [corpus-baseline.json](app/src/lib/dbc/corpus-baseline.json)
(counts plus a SHA-256 of the whole parsed model), so any change to how a corpus file
parses fails the suite; regenerate it after an intended change with
`UPDATE_CORPUS_BASELINE=1 npx vitest run app/src/lib/dbc/corpus.test.ts`. Without the
submodules the corpus suite is skipped automatically.

Two more submodules hold files in other formats, for the canmatrix import adapter
that is being built (see [the handover](docs/handover/2026-11-01-multi-format-import.md)):
the test files of [ebroecker/canmatrix](https://github.com/ebroecker/canmatrix)
(tag 1.3.3.1, BSD-2-Clause) and [cantools/cantools](https://github.com/cantools/cantools)
(tag 45.1.2, MIT), 114 ARXML, KCD, SYM, DBF, FIBEX, JSON, YAML and XLSX files.
[import-corpus.test.ts](app/src/lib/canmatrix/import-corpus.test.ts) reads each one
through canmatrix under Pyodide in Node, the same runtime the app will use, with
the network blocked. Where a file has a DBC twin (78 of them), it compares the two
through CanViewer's model. What the readers produce, including every difference
from the twin, is pinned in
[import-corpus-baseline.json](app/src/lib/canmatrix/import-corpus-baseline.json);
regenerate it with `UPDATE_IMPORT_BASELINE=1 npx vitest run app/src/lib/canmatrix/import-corpus.test.ts`.
The suite is skipped without the submodules and fails without the wheels.

[mapper.test.ts](app/src/lib/canmatrix/mapper.test.ts) checks the mapping from canmatrix's model
to CanViewer's (`canviewer_adapter.py`) the direct way: it reads DBC files through
canmatrix and compares the result with CanViewer's own parser. `examples/demo.dbc`
must come out identical. For the 58 opendbc and Model 3 files, what canmatrix's DBC
reader does differently (it drops dangling comments and lines it cannot read, applies
long names, creates nodes for undeclared senders) and the problems reported for it are
pinned in [mapper-dbc-baseline.json](app/src/lib/canmatrix/mapper-dbc-baseline.json).

## Supported DBC statements

`VERSION`, `BU_`, `BO_`, `SG_` (incl. `M`/`m<N>` multiplexing), `BO_TX_BU_`, `CM_`
(network/node/message/signal), `VAL_`, `VAL_TABLE_`, `BA_DEF_`, `BA_DEF_DEF_`, `BA_`,
`SIG_VALTYPE_`, `SG_MUL_VAL_`. Statements that are recognized but not modeled
(`EV_`, `SIG_GROUP_`, relation attributes, …) are counted and listed in the overview.

## License

CanViewer is free software under the GNU General Public License, version 2 or (at your
option) any later version: see [LICENSE](LICENSE). The third-party components it ships,
and their licenses, are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
[CONTRIBUTING.md](CONTRIBUTING.md) says how to set up and check a change, and
[SECURITY.md](SECURITY.md) how to report a vulnerability.
