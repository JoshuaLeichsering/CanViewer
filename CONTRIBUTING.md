# Contributing to CanViewer

Thank you for helping. This page says how to set up, how to check a change the way CI
does, and the conventions the project keeps. By taking part you agree to follow the
[code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as
[SECURITY.md](SECURITY.md) describes, not in an issue.

## Setting up

You need Node.js 22, git and a C compiler (`cc`, or the one `CC` names): the export
tests compile the generated C structs, and the local check below requires them to run.
For the desktop app you also need Rust and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) of your system.

```sh
git clone --recurse-submodules https://github.com/JoshuaLeichsering/CanViewer.git
cd CanViewer
npm ci
npm run fetch-wheels   # the Python wheels for the import adapter, into vendor/pyodide/
npm run dev            # the web app on http://localhost:5173
```

`fetch-wheels` downloads the wheels pinned in `app/src/lib/canmatrix/wheels.lock.json`
and checks each against its SHA-256. Where jsDelivr or PyPI cannot be reached, take them
from an unpacked [Pyodide release](https://github.com/pyodide/pyodide/releases) or another
checkout: `node scripts/fetch-wheels.mjs --from <dir>`. If you cloned without
`--recurse-submodules`, fetch the test corpora with `git submodule update --init --depth 1`.

Where things are: the web app in `app/`, the desktop shell in `desktop/`, browser checks
in `e2e/`, build and maintenance scripts in `scripts/`, documentation in `docs/`, the test
corpora in `third_party/`. [Decision record 0001](docs/decisions/0001-repository-layout.md)
explains the layout. Every command runs from the repository root.

## The local check

CI runs the same steps on every pull request. Run them before you push:

```sh
npx tsc --noEmit
npx vitest run --coverage --reporter=verbose --reporter=json --outputFile.json=test-report.json
node scripts/check-test-report.mjs test-report.json   # every corpus suite ran in full
npm run test:scripts                                  # tests of the scripts themselves
npm run build
npm run check:identifying-info                        # no personal data in the tree
npm run check:licenses                                # SPDX headers, npm and wheel licenses
```

The vitest run enforces the coverage thresholds in `vite.config.ts` (`npm run
test:coverage` runs the same without the report) and writes the HTML report to
`coverage/`.

Then the network check, which proves the build makes no request outside its own origin,
and the end-to-end flows. Playwright is a dev dependency; fetch its Chromium once with
`npx playwright install chromium`:

```sh
npx vite preview --port 4173 --strictPort &
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 \
node e2e/network-check.mjs http://localhost:4173/ network-check \
  third_party/canmatrix/tests/files/arxml/test.arxml \
  third_party/canmatrix/tests/files/arxml/ARXMLContainerTest.arxml \
  examples/demo.dbc dist
E2E_PORT=4174 npm run e2e                             # the Playwright flows in e2e/flows/
node e2e/ui-checks.mjs                                # axe, keyboard, recovery, narrow layout
npx vite preview --port 4175 --strictPort &
CANVIEWER_URL=http://localhost:4175/ node --test e2e/import-ui.test.mjs   # the import UI
npx vite preview --port 4176 --strictPort &
node e2e/signal-table.mjs http://localhost:4176/ tbl-checks examples/demo.dbc   # sorting, filtering
node e2e/large-database.mjs http://localhost:4176/ tbl-checks   # 5000 messages stay responsive
npx vite preview --port 4177 --strictPort &
node e2e/export-check.mjs http://localhost:4177/ export-check examples/demo.dbc   # export and copy
npx vite preview --port 4178 --strictPort &
node e2e/diff-check.mjs http://localhost:4178/ diff-check   # the Compare page, DBC and ARXML
npx vite preview --port 4179 --strictPort &
node e2e/trc-traces-encoder.mjs http://localhost:4179/ trc-traces-encoder   # Traces view, encoder
npx vite preview --port 4180 --strictPort &
node e2e/editing.mjs http://localhost:4180/ editing-check examples/demo.dbc \
  third_party/cantools/tests/files/dbc/foobar.dbc                           # editing, Save as DBC
node e2e/desktop-csp-check.mjs dist desktop-csp examples/demo.dbc \
  third_party/canmatrix/tests/files/arxml/test.arxml   # the import worker under the desktop CSP
```

The network check's summary must include `requests outside http://localhost:4173: 0`. Stop the
preview server afterwards. `npm run e2e` starts its own server on `E2E_PORT` (default
4180), and every flow fails if the page requests anything outside the app's origin.
`e2e/ui-checks.mjs` serves `dist/` itself and fails on any serious or critical axe
finding, in both themes and both languages, at desktop and phone width.
`e2e/import-ui.test.mjs` opens a file of every canmatrix format from a fresh browser
profile, and checks the loading stages, the cluster choice, the source note, restoring
on reload and the translated failures. `e2e/signal-table.mjs` sorts and filters the
signal table by mouse and keyboard, and `e2e/large-database.mjs` generates a database of
5000 messages and fails if scrolling, search, the keyboard or the overview's pages exceed
their time budgets. `e2e/export-check.mjs` exports and copies through the menus and
requires every file and every copy to equal the pinned output in
`app/src/lib/export/pinned/`. `e2e/diff-check.mjs` compares two versions on the Compare
page, opened and dropped, a DBC file with an ARXML file read through canmatrix
(pinned in `e2e/diff-check-arxml.txt`), and fails on any request outside the origin.
`e2e/trc-traces-encoder.mjs` replays the sample logs in `examples/` through the Traces
view, filters a large generated log, and encodes frames with the encoder card, all without
a request outside the origin. `e2e/editing.mjs` edits a message and a signal, saves as
DBC, reloads and opens the saved file again, and checks the prompts that guard unsaved
edits and the list of what a saved file lacks. `e2e/desktop-csp-check.mjs` serves `dist/`
itself with the desktop app's Content Security Policy, the way Tauri sends it, and fails
unless the import worker runs under that policy and the desktop self-test script passes
there. Stop the preview servers afterwards.

The documentation site and the web app under `/app/` are checked the way the Pages
workflow (`.github/workflows/pages.yml`) checks them, which runs for changes to the app,
the docs or their scripts:

```sh
npx tsc -p docs/.vitepress                       # the site's configuration
npm run docs:links                               # every relative link in every Markdown file
node scripts/docs/fidelity-tables.mjs --check    # the generated tables match the baselines
npm run build -- --base ./                       # the app with a relative base, for /app/
DOCS_BASE=/CanViewer/ npm run docs:build
rm -rf _pages && mkdir -p _pages/CanViewer && cp -R docs/.vitepress/dist/. _pages/CanViewer/ && cp -R dist _pages/CanViewer/app
node scripts/docs/check-links.mjs --site _pages/CanViewer --base /CanViewer/
node e2e/static-server.mjs _pages 4181 &        # serves it the way GitHub Pages does
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 \
node e2e/network-check.mjs http://localhost:4181/CanViewer/app/ network-check \
  third_party/canmatrix/tests/files/arxml/test.arxml \
  third_party/canmatrix/tests/files/arxml/ARXMLContainerTest.arxml \
  examples/demo.dbc _pages
node e2e/docs-crawl.mjs http://localhost:4181/CanViewer/ docs-crawl   # every page, no foreign request
```

Run `npm run build` again afterwards for the other checks. After a change to the
interface, regenerate the screenshots with `node scripts/screenshots.mjs <app-url>`
against a running build ([the documentation guide](docs/develop/documentation.md#screenshots)).

If you change a dependency, also run `npm run notices` (it needs Rust's `cargo` and
`rustc`, for the desktop crates and the Rust standard library) and commit the regenerated
`THIRD_PARTY_NOTICES.md`. CI checks that it is up to date, and checks the crates' licenses
with `cargo deny --manifest-path desktop/Cargo.toml check licenses`. The outputs of the
check above (`test-report.json`, `network-check/`, `coverage/`, `test-results/`,
`import-ui/`, `tbl-checks/`, `export-check/`, `diff-check/`, `trc-traces-encoder/`, `editing-check/`,
`desktop-csp/`, `_pages/`, `docs-crawl/`) are ignored by git, so the sweep for identifying information does not read them.

## Conventions

- **Everything in the repository is in English.** Every string in the interface exists
  in English and German (`app/src/lib/i18n.tsx`).
- **No request outside the app's origin.** The web app, the documentation and the
  desktop app load nothing from another host: no CDN, no web fonts, no analytics, no
  update check. Bundle what you need.
- **Tests first where you can.** The libraries have unit tests next to them, and the
  corpus suites must run in full, never skip. A change in how a corpus file parses
  shows up as a difference from a pinned baseline. Regenerate a baseline only for an
  intended change, and explain the difference in the pull request. Never weaken a test
  or a threshold to get a green run.
- **Source files start with their license**: `// SPDX-License-Identifier: GPL-2.0-or-later`
  (or `#` and `/* */` in Python and CSS). `node scripts/check-spdx-headers.mjs --fix`
  adds it.
- **Dependencies:** prefer a few lines of code to a new dependency. If you add one,
  pin its exact version, choose a license compatible with GPL-2.0-or-later (MIT, BSD,
  ISC, Apache-2.0 and the others in `scripts/license-policy.mjs`), and update
  `package-lock.json` with npm 11 or later, which keeps the lock file's platform fields.
- **No personal data** in files: no email addresses, local paths or machine names, in
  code, documentation, logs or screenshots. `npm run check:identifying-info` finds most.
- **Commit messages** are plain English: a short subject in the imperative, and a body
  that says why. Reference issues as `Refs #12`; do not pair "close", "fix" or "resolve"
  with an issue number.
- **Pull requests** say what changed and why, and quote the evidence: the commands run
  and their output. The template lists what to include.

## License

CanViewer is licensed under the GNU General Public License, version 2 or (at your
option) any later version ([LICENSE](LICENSE)). By contributing, you agree that your
contribution is licensed under the same terms. Third-party components keep their own
licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
