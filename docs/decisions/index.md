# Decision records

Each record states one decision that shapes CanViewer: the context it was made in, what
was decided, what follows from it, and the alternatives that were weighed. Records are
not rewritten when things change; a later record supersedes an earlier one and says so.

| Record | Decision |
|---|---|
| [0001](./0001-repository-layout.md) | The repository layout: the web app in `app/`, the desktop shell in `desktop/`, checks in `e2e/`, scripts in `scripts/`, config at the root |
| [0002](./0002-canmatrix-import-adapter.md) | canmatrix reads every format but DBC, as an import adapter into CanViewer's model; CanViewer's own parser keeps DBC |
| [0003](./0003-self-hosted-pyodide-worker.md) | canmatrix runs under Pyodide in a Web Worker, with the runtime and every wheel self-hosted and pinned, and no micropip |
| [0004](./0004-material-3-interface.md) | A Material 3 interface, with fonts and icons bundled |
| [0005](./0005-license-gpl-2-or-later.md) | GPL-2.0-or-later, and what it rules out: `.xls` import, the AppImage |
| [0006](./0006-documentation-site.md) | This site: VitePress on GitHub Pages, with the web app under `/app/` and tables generated from the baselines |
| [0007](./0007-pinned-corpus-baselines.md) | Real-world corpora with pinned baselines, and corpus suites that may not skip |

<!-- TODO(phase-2): add the records the other workstreams write (the desktop shell per
system, from W4; what the DBC writer preserves, from W11), renumbered to follow 0007. The
sidebar lists every file in this directory by itself. -->

## Writing a record

Copy the shape of an existing record: a title with the next number, the status and
date, then *Context*, *Decision*, *Consequences* and *Alternatives considered*. Name the
evidence, or link it. Add the record to the table above; the sidebar picks it up by
itself.

The working notes the earlier records were condensed from are listed in the
[archive](../archive/index.md).
