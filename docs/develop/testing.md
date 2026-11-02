# Tests and baselines

Every claim CanViewer makes rests on a test or a recorded run. This page lists the
tests, the baselines that pin behaviour, and the checks that CI runs.

## Running the tests

```sh
git submodule update --init --depth 1   # the corpora
npm run fetch-wheels                    # the Python wheels, for the canmatrix suites
npm test                                # or: npx vitest run
```

Tests live next to the code they test (`app/src/**/*.test.ts`) and run with
[Vitest](https://vitest.dev/) in Node. To run one file, name it:
`npx vitest run app/src/lib/dbc/parser.test.ts`.

Component tests render every view with [React Testing Library](https://testing-library.com/):
the message list and its filters, the signal table, the bit matrix, the decoder and the
encoder, nodes, the network graph, value tables, settings, the welcome and error states,
the import progress, the Compare and Traces views, and the editors. A
component test file opts into a DOM with `// @vitest-environment jsdom` on its first lines;
everything else, the corpus suites included, runs in Node.

## Coverage

```sh
npm run test:coverage
```

runs every test with V8 coverage, writes the HTML report to `coverage/`, and fails below
the thresholds in [`vite.config.ts`](../../vite.config.ts): 90 % of lines, statements and
functions and 85 % of branches overall, and 95 % of lines and statements, 90 % of
functions and branches in `app/src/lib`. The thresholds may only rise. CI uploads the
report as the `coverage-report` artifact of the run and puts the table of
[`coverage-summary.mjs`](../../scripts/coverage-summary.mjs) in the job summary.

## The corpus suites

Unit tests check the rules one by one. The corpus suites check them against real files,
and none of them may skip in CI:

| Suite | What it reads | Pinned in |
|---|---|---|
| [`corpus.test.ts`](../../app/src/lib/dbc/corpus.test.ts) | 58 OEM DBC files (opendbc, model3dbc) with CanViewer's parser: every file parses without problems except a pinned list of upstream inconsistencies | [`corpus-baseline.json`](../../app/src/lib/dbc/corpus-baseline.json) |
| [`import-corpus.test.ts`](../../app/src/lib/canmatrix/import-corpus.test.ts) | 114 files in other formats (canmatrix and cantools test files) through canmatrix under Pyodide, and 70 comparisons with their DBC twins | [`import-corpus-baseline.json`](../../app/src/lib/canmatrix/import-corpus-baseline.json) |
| [`mapper.test.ts`](../../app/src/lib/canmatrix/mapper.test.ts) | `examples/demo.dbc` (must come out identical) and the 58 OEM DBC files through canmatrix and the mapper, compared with CanViewer's parser | [`mapper-dbc-baseline.json`](../../app/src/lib/canmatrix/mapper-dbc-baseline.json) |
| [`roundtrip.test.ts`](../../app/src/lib/dbc/roundtrip.test.ts) | the 58 OEM DBC files through the DBC writer and back: the written file must read as the same model ([decision record 0008](../decisions/0008-dbc-writer.md)) | `corpus-baseline.json` |
| [`table.test.ts`](../../app/src/lib/export/table.test.ts), [`pseudo-code.test.ts`](../../app/src/lib/export/pseudo-code.test.ts), [`c-struct.test.ts`](../../app/src/lib/export/c-struct.test.ts) | 149 DBC files of the submodules: the CSV and JSON export read back as the model, the generated pseudo-code decodes every signal as CanViewer does, and every C struct compiles with `cc` | the files in [`export/pinned/`](../../app/src/lib/export/pinned/) |
| [`diff-corpus.test.ts`](../../app/src/lib/diff/diff-corpus.test.ts) | the 58 OEM DBC files diffed with themselves (no differences), and two pairs of opendbc versions | [`diff-corpus-baseline.json`](../../app/src/lib/diff/diff-corpus-baseline.json) |
| [`encode.corpus.test.ts`](../../app/src/lib/dbc/encode.corpus.test.ts) | the 58 OEM DBC files: every signal, and sampled whole frames, round-trip through the frame encoder | – |

The canmatrix suites run Pyodide in Node with `fetch` replaced by a function that
records calls, and each ends by asserting that nothing tried the network. Without the
submodules the corpus suites skip themselves; with the submodules but without the
wheels, the canmatrix suites fail instead of skipping.

## Baselines

A baseline pins what a suite saw, file by file: counts, problems, differences, and for
the DBC corpus a SHA-256 of the whole parsed model. Any change to the output, better or
worse, fails the suite. That is the point: a behaviour change must be visible in the
diff of the change that causes it.

When a change is intended, regenerate the baseline, read its diff, and explain it in the
pull request:

```sh
UPDATE_CORPUS_BASELINE=1 npx vitest run app/src/lib/dbc/corpus.test.ts
UPDATE_IMPORT_BASELINE=1 npx vitest run app/src/lib/canmatrix/import-corpus.test.ts
UPDATE_MAPPER_BASELINE=1 npx vitest run app/src/lib/canmatrix/mapper.test.ts
UPDATE_DIFF_BASELINE=1 npx vitest run app/src/lib/diff/diff-corpus.test.ts
UPDATE_EXPORT_PINNED=1 npx vitest run app/src/lib/export   # the pinned export files
node scripts/docs/fidelity-tables.mjs   # the reference tables generated from them
```

The last command regenerates the tables of the [format reference](../reference/formats.md)
and the [DBC reference](../reference/dbc.md).
[`reference-docs.test.ts`](../../app/src/lib/reference-docs.test.ts) fails while they
disagree with the baselines, and checks that the DBC reference lists every statement the
parser skips.

Never regenerate a baseline to make a failing test pass without understanding the diff.

## Checking that nothing skipped

A green test run proves little if a suite skipped itself. CI therefore writes Vitest's
JSON report and runs [`check-test-report.mjs`](../../scripts/check-test-report.mjs) on
it. It fails unless every test file loaded and passed, nothing was skipped, and each
corpus suite ran over exactly the expected number of files:

```sh
npx vitest run --reporter=verbose --reporter=json --outputFile.json=test-report.json
node scripts/check-test-report.mjs test-report.json
```

It ends with `every corpus suite ran in full` when all is well. When a corpus
legitimately grows or shrinks, update its expected counts in the same change, and say
why.

## The network check

[`e2e/network-check.mjs`](../../e2e/network-check.mjs) drives a production build in
Chromium and fails on any request outside the app's origin (see
[The Pyodide worker](./pyodide-worker.md#the-network-check) for what it does). It needs
Playwright:

```sh
npm run build
npx vite preview --port 4173 --strictPort &
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node e2e/network-check.mjs \
  http://localhost:4173/ network-check \
  third_party/canmatrix/tests/files/arxml/test.arxml \
  third_party/canmatrix/tests/files/arxml/ARXMLContainerTest.arxml \
  examples/demo.dbc dist
```

Its summary must include the line `requests outside http://localhost:4173: 0`, and the
two lines after it, the origins in the HAR file and in Chromium's net-log, must name
only `http://localhost:4173`.

## The browser checks

Besides the network check, these drive the production build in Chromium, and each fails
on any request outside the app's origin. [CONTRIBUTING.md](../../CONTRIBUTING.md#the-local-check)
has the commands to run them:

| Check | What it covers |
|---|---|
| `npm run e2e` ([`e2e/flows/`](../../e2e/flows/)) | Playwright flows: open a file, navigate, decode, switch theme and language, deep links, offline reload. The server is `vite preview` on `E2E_PORT` (default 4180). A flow that needs other browser options, a locale say, sets them with `test.use({ ... })`, since the request guard watches only the fixture's context. |
| [`ui-checks.mjs`](../../e2e/ui-checks.mjs) | axe-core in both themes and both languages, at desktop and phone width; the keyboard, the error recovery screen, the narrow layout |
| [`import-ui.test.mjs`](../../e2e/import-ui.test.mjs) | a file of every canmatrix format by the file dialog and by drag and drop, the loading stages on a cold start, the cluster choice, the source note, restoring on reload, the translated failures |
| [`signal-table.mjs`](../../e2e/signal-table.mjs), [`large-database.mjs`](../../e2e/large-database.mjs) | sorting and filtering the signal table; a generated database of 5000 messages within time budgets |
| [`export-check.mjs`](../../e2e/export-check.mjs) | every export and copy equals the pinned file in `app/src/lib/export/pinned/` |
| [`diff-check.mjs`](../../e2e/diff-check.mjs) | the Compare page, with a DBC file and an ARXML file read through canmatrix |
| [`trc-traces-encoder.mjs`](../../e2e/trc-traces-encoder.mjs) | the Traces view with the sample logs, and the frame encoder |
| [`editing.mjs`](../../e2e/editing.mjs) | editing a message and a signal, Save as DBC, and opening the saved file |
| [`desktop-csp-check.mjs`](../../e2e/desktop-csp-check.mjs) | the import worker, and the desktop self-test script, under the desktop app's Content Security Policy |
| [`docs-crawl.mjs`](../../e2e/docs-crawl.mjs) | every page of this site, served as GitHub Pages serves it ([Documentation](./documentation.md)) |

## In CI

| Workflow | When | What |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | pushes to `main`, pull requests | type check, every test with coverage and the report check, the build, the network check and every browser check above but the crawl; a second job for licenses, notices, the tests of the scripts, identifying information and the relative links in every Markdown file |
| [`pages.yml`](../../.github/workflows/pages.yml) | pushes to `main`, pull requests | the documentation site and the app under `/app/`, link checks, the network check on the published app, a crawl of the site; deploys from `main` once the repository is public ([Documentation](./documentation.md)) |
| [`desktop.yml`](../../.github/workflows/desktop.yml) | pull requests that change the desktop shell, its checks, its runbook, the license files and notices every package bundles, or the release workflow; called by the release workflow; on demand | build the packages on Windows, macOS and Linux, follow the [install guide](../guide/install.md) with them (checksums, install, self-test, uninstall, nothing left behind), check the export download, and run `cargo test` on Linux |
| [`release.yml`](../../.github/workflows/release.yml) | `v*` tags; on demand as a dry run | the version check, the desktop workflow with release builds, and the GitHub Release ([Release process](./release.md)) |

The desktop workflow runs only when it has to, because Windows and macOS runner minutes
are expensive.
