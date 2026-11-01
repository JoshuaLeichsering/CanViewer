# Tests and baselines

Every claim CanViewer makes rests on a test or a recorded run. This page lists the
tests, the baselines that pin behaviour, and the checks that CI runs.

<!-- TODO(phase-2, W2): add coverage (the report and the thresholds), the component
tests with React Testing Library and the Playwright end-to-end flows, with their
commands. -->

## Running the tests

```sh
git submodule update --init --depth 1   # the corpora
npm run fetch-wheels                    # the Python wheels, for the canmatrix suites
npm test                                # or: npx vitest run
```

Tests live next to the code they test (`app/src/**/*.test.ts`) and run with
[Vitest](https://vitest.dev/) in Node. To run one file, name it:
`npx vitest run app/src/lib/dbc/parser.test.ts`.

## The corpus suites

Unit tests check the rules one by one. The corpus suites check them against real files,
and none of them may skip in CI:

| Suite | What it reads | Pinned in |
|---|---|---|
| [`corpus.test.ts`](../../app/src/lib/dbc/corpus.test.ts) | 58 OEM DBC files (opendbc, model3dbc) with CanViewer's parser: every file parses without problems except a pinned list of upstream inconsistencies | [`corpus-baseline.json`](../../app/src/lib/dbc/corpus-baseline.json) |
| [`import-corpus.test.ts`](../../app/src/lib/canmatrix/import-corpus.test.ts) | 114 files in other formats (canmatrix and cantools test files) through canmatrix under Pyodide, and 70 comparisons with their DBC twins | [`import-corpus-baseline.json`](../../app/src/lib/canmatrix/import-corpus-baseline.json) |
| [`mapper.test.ts`](../../app/src/lib/canmatrix/mapper.test.ts) | `examples/demo.dbc` (must come out identical) and the 58 OEM DBC files through canmatrix and the mapper, compared with CanViewer's parser | [`mapper-dbc-baseline.json`](../../app/src/lib/canmatrix/mapper-dbc-baseline.json) |

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

The last line of its summary must read `requests outside http://localhost:4173: 0`.

## In CI

| Workflow | When | What |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | pushes to `main`, pull requests | type check, every test with the report check, the build, the network check |
| [`pages.yml`](../../.github/workflows/pages.yml) | pushes to `main` and pull requests that touch the app, the docs or their scripts | the documentation site and the app under `/app/`, link checks, the network check on the published app, a crawl of the site; deploys from `main` once the repository is public ([Documentation](./documentation.md)) |
| [`desktop.yml`](../../.github/workflows/desktop.yml) | changes to the desktop shell, `v*` tags, on demand | build, install, self-test and uninstall the desktop app on Windows, macOS and Linux |

The desktop workflow runs only when it has to, because Windows and macOS runner minutes
are expensive.
