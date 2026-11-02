# Upstream reports

Drafts of reports for projects CanViewer depends on. **None of them is posted.**
Posting on other people's repositories is the maintainer's decision.

| draft | project | found in | status upstream | effect on CanViewer |
|---|---|---|---|---|
| [DBC import reports wrong line numbers after a `VAL_` line](canmatrix-dbc-val-line-numbers.md) | canmatrix | 1.3.3 | open: `dbc.py` is unchanged on the development branch (8b54a41, 2026-10-28) | none in the app: `canviewer_adapter.py` corrects the numbers |
| [Signals of an unreadable `BO_` line join the previous frame](canmatrix-dbc-unreadable-bo-signals.md) | canmatrix | 1.3.3 | open: unchanged on the development branch | none in the app, which reads `.dbc` with its own parser; 275 misplaced signals in the mapper suite's baseline |
| [JSON import drops `is_fd`](canmatrix-json-is-fd.md) | canmatrix | 1.3.3 | changed on the development branch (ebroecker/canmatrix#939), not released | CAN FD frames of up to 8 bytes in `.json` files show as classic CAN |

Each draft has the issue text to post (title, summary, environment, a
self-contained reproduction, expected and actual output, cause and a suggested
fix) and, below it, notes for CanViewer that are not for posting.

## How the drafts are checked

`app/src/lib/canmatrix/upstream-reports.test.ts` runs each draft's reproduction
under Pyodide with the canmatrix wheel CanViewer ships, and requires its output to
be the draft's *Actual* block. It also pins what CanViewer makes of the same
input. When canmatrix is updated and one of these tests fails, the behaviour
changed upstream: update or retire the draft, then the test.

The same output was seen with CPython 3.13 and canmatrix 1.3.3 from PyPI. The
suggested patches for the two DBC reports were applied to 1.3.3 and checked:
the reproductions then print the *Expected* blocks, and canmatrix's own
`tests/test_dbc.py` (from the 1.3.3 source distribution) passes with lxml
installed: 68 passed, as for unpatched 1.3.3 installed with
`pip install canmatrix[kcd]==1.3.3 pytest`. Without lxml
(`pip install canmatrix==1.3.3 pytest`), unpatched 1.3.3 gives 1 failed, 67
passed: `test_cycle_time_handling` needs the KCD format, which canmatrix loads
only when lxml is installed (`KeyError: 'canmatrix.formats.kcd'`).

## Before posting one

1. Run the reproduction against the latest release and the development branch.
2. Search the project's open and closed issues for duplicates (not done yet).
3. Post the part between the two rules of the draft, nothing above or below it.
4. Record the issue link in the draft and in the table above.
