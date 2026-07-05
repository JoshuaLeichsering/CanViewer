# CanViewer

A viewer for DBC CAN database files, running entirely in the browser.
No data leaves your machine — files are parsed locally.

## Features

- **Message tree** sorted by CAN ID with hex IDs, extended-frame (29-bit) markers and search
  across message names, IDs and signal names
- **Signal table** per message: start bit, length, byte order (Intel/Motorola), type,
  factor/offset, min/max, unit, receivers, multiplexing (incl. extended multiplexing
  via `SG_MUL_VAL_`)
- **Bit layout matrix**: one row per byte, colored per signal, start-bit
  markers, Motorola sawtooth layout, conflict detection (mux alternatives sharing bits
  are *not* flagged)
- **Frame decoder**: paste hex bytes, get raw + physical values, value-table labels and
  multiplexer-aware activity
- **Node view**: transmitted messages and received signals per ECU
- **ECU network graph**: interactive sender→receiver topology — arrows per direction,
  line width scales with message count, click nodes/connections to drill into the
  messages behind them
- **Value tables**, comments (multi-line), attributes (`BA_DEF_` / `BA_` incl. ENUM
  resolution), `SIG_VALTYPE_` float/double signals
- **Robust parsing**: malformed lines are collected as warnings instead of failing the
  whole file; Latin-1 fallback for files from Vector tools
- Last opened file is restored on reload; views are deep-linkable (`#msg=…`, `#node=…`)

## Development

```sh
npm install
npm run dev        # dev server on http://localhost:5173
npm test           # parser + bit-layout unit tests
npm run build      # typecheck + production build (dist/)
```

Open the app and click **Load demo** to explore the bundled example database
([src/sample/demo.dbc](src/sample/demo.dbc)).

## Tested against real-world files

Two OEM database collections are vendored as git submodules under `third_party/`:
[commaai/opendbc](https://github.com/commaai/opendbc) and
[joshwardell/model3dbc](https://github.com/joshwardell/model3dbc) — 58 databases from
Toyota, Tesla, BMW, Mercedes, VW, Ford, GM, Hyundai, Mazda, Chrysler, Volvo, PSA,
Nissan, Rivian and more (~4,200 messages, ~33,700 signals). Fetch them with:

```sh
git submodule update --init
```

`npm test` then runs the corpus suite ([corpus.test.ts](src/lib/dbc/corpus.test.ts)):
every file must parse with zero problems except for a pinned allowlist of genuine
upstream inconsistencies (stale comments referencing renamed signals). Without the
submodules the corpus suite is skipped automatically.

## Supported DBC statements

`VERSION`, `BU_`, `BO_`, `SG_` (incl. `M`/`m<N>` multiplexing), `BO_TX_BU_`, `CM_`
(network/node/message/signal), `VAL_`, `VAL_TABLE_`, `BA_DEF_`, `BA_DEF_DEF_`, `BA_`,
`SIG_VALTYPE_`, `SG_MUL_VAL_`. Statements that are recognized but not modeled
(`EV_`, `SIG_GROUP_`, relation attributes, …) are counted and listed in the overview.
