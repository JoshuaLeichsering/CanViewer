# 0002. canmatrix as the import adapter, not the base

- **Status:** accepted
- **Date:** 2026-11-01

## Context

CanViewer read DBC only, with its own TypeScript parser. The owner wanted more formats,
named [canmatrix](https://github.com/ebroecker/canmatrix) (Python, BSD-2-Clause) as the
basis, and asked for a newer project that reads "multiple input formats, like
Vector/YAML/JSON" if one existed.

A sweep of 444 searches over four angles (GitHub, package registries, community posts,
YAML and JSON CAN schemas) found 52 candidates, read the top four in code, and ended with
a critic pass. Nothing fit better than canmatrix. The closest alternatives each failed on
a basic point: a regex DBC reader without attributes or multiplexing
(omni-viewer-core), a configuration-as-code model that cannot run under Pyodide
(FLYNC), no WebAssembly target (autors), a native-only library (aletheia), or no YAML
or JSON database format (cantools, which stays a reference and a source of test files).

Two agents then assessed canmatrix 1.3.3: one read its code, the other converted
CanViewer's own files and five opendbc files through it, on CPython and under Pyodide
314.0.7.

## Decision

- **CanViewer's own parser stays in charge of `.dbc`.** On every DBC point measured it
  was more faithful than canmatrix, it reports problems per line, and it parsed the
  largest test file about 3 times faster than canmatrix on CPython and 4 times faster
  than canmatrix under Pyodide.
- **Every other format is read by canmatrix running in the browser under Pyodide**,
  loaded only when a non-DBC file is opened, in a Web Worker
  ([0003](./0003-self-hosted-pyodide-worker.md)).
- **canmatrix's in-memory model is mapped straight into CanViewer's `DbcDatabase`**
  by a Python adapter, never through canmatrix's JSON or YAML codec or its DBC writer,
  both of which lose data.
- **Nothing is lost silently.** What canmatrix prints while reading becomes a parse
  problem. CAN FD and J1939 follow CanViewer's own rules, not canmatrix's flags. Values
  canmatrix synthesizes, such as a signal's `initial_value`, are left out.
- **ARXML first**, with the lazily loaded download of about 16 MB accepted by the
  owner; it is paid only when a non-DBC file is opened.

## Consequences

- Every view works for every format, because there is one model.
- Each reader's fidelity is measured on the corpus of canmatrix's and cantools' test
  files and pinned, and the [format reference](../reference/formats.md) is generated
  from it. Known weaknesses of canmatrix's readers (AUTOSAR 3 frames, SYM multiplexing,
  YAML and FIBEX reading none of the reference files) are visible there, not hidden.
- The DBC corpus is also read through canmatrix in a test, to keep the case for the own
  parser measured rather than remembered.
- canmatrix's writers are not on any data path. They matter for the backlog's export,
  diff and editing items, where they would need the same fidelity checks first.
- Replacing a reader (for example cantools' ARXML reader, which reads files canmatrix
  fails on) is a decision for the owner.

## Evidence

Through DBC to canmatrix to DBC, on the six test files:

- **Problems become invisible.** A malformed line is caught by a bare `except:` that only
  prints. Dangling `CM_ SG_` comments are dropped without a message: CanViewer's problem
  counts went from 17 to 0 (`vw_mqb`) and 7 to 0 (`vw_pq`).
- **CAN FD and J1939 come only from an explicit attribute** on the frame; a
  `BA_DEF_DEF_` default, a payload over 8 bytes and `ProtocolType` are ignored. Ford's
  FD count went from 331 to 330.
- **Float and double merge**, the `VERSION` string and the network comment are not
  modelled, attribute values are strings, and UTF-8 files come out as mojibake unless
  the encoding is passed in.
- **The JSON and YAML codec** drops `SG_MUL_VAL_` ranges on import; its default export
  omits length, range, unit, values, comments and multiplexing.
- **The writers**: the DBC writer emits extended-multiplexing lines with no range, the
  ARXML writer rounds factors to one decimal (541 of 2,752 signals in Model 3 changed),
  and canmatrix could not read back its own XLSX for five of six inputs.

What canmatrix does well survived: IDs and the extended flag, DLCs up to 64, signal
layout, factor and offset, value descriptions, multi-line comments and real
`SG_MUL_VAL_` ranges.

## Alternatives considered

- **canmatrix as the base for everything, DBC included**: loses the problems per line
  and the measured fidelity above, and makes every DBC user wait for a 16 MB runtime.
- **Porting individual readers to TypeScript**: possible (BSD-2 and MIT allow it with the
  notices kept), and the fallback if the download were too large. It means maintaining a
  reader per format; the owner accepted the download instead.
- **Converting through canmatrix's JSON**: one codec for every format, but it loses data
  in both directions.
