# 0007. Real-world corpora, pinned baselines, and suites that may not skip

- **Status:** accepted
- **Date:** 2026-11-01

## Context

CanViewer's promise is to show what a file says, no less and no more. Unit tests check
rules one by one, but real databases from carmakers and other tools contain everything
the rules forget. And a reader's output can change without any test noticing: a parser
refactoring, a canmatrix upgrade or a mapper fix may change what a user sees in files no
unit test opens.

## Decision

- **Test against real files**, vendored as shallow git submodules under `third_party/`
  at pinned commits: 58 OEM DBC files (opendbc, model3dbc) and 114 files in other
  formats (the test files of canmatrix and cantools).
- **Pin what the readers produce, per file**, in JSON baselines next to the suites:
  counts, problems, the differences from a DBC twin, and for the DBC corpus a SHA-256 of
  the whole parsed model. Any change fails the suite, better or worse.
- **Regenerate a baseline only for an intended change**, with an environment variable
  (`UPDATE_CORPUS_BASELINE`, `UPDATE_IMPORT_BASELINE`, `UPDATE_MAPPER_BASELINE`), and
  explain its diff in the change that causes it.
- **The suites may not skip in CI.** They skip themselves locally without the
  submodules, so CI checks Vitest's JSON report with `scripts/check-test-report.mjs`:
  every test file loaded and passed, nothing skipped, and each corpus suite ran over
  exactly the expected number of files.
- **The documentation is generated from the baselines** where it states numbers
  ([0006](./0006-documentation-site.md)), so it changes with them.

## Consequences

- Known weaknesses stay visible: upstream inconsistencies in the DBC files are a pinned
  allow-list, and the canmatrix readers' losses are pinned difference by difference.
- A pull request that changes behaviour shows it in a baseline diff that a reviewer can
  read.
- Bumping a submodule means regenerating its baseline and explaining the diff; growing or
  shrinking a corpus means updating the expected counts in the report check.
- CI needs the submodules and the Python wheels, which it caches.

## Alternatives considered

- **Unit tests only**: fast, but blind to what real files contain.
- **Snapshot files of the whole model per corpus file**: complete, but megabytes of
  output that nobody reads in a review. Counts, problems and named differences, plus one
  hash of the model, show what changed and still catch everything.
- **Letting the suites skip silently** when the submodules are missing: a green run would
  then prove nothing.
