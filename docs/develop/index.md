# Getting set up

CanViewer is a React and TypeScript app built with Vite, with a Python import adapter
that runs under Pyodide, a Tauri desktop shell, and this documentation site built with
VitePress. Everything runs from the repository root.

## Requirements

- Node.js 22 and npm.
- git, with the submodules for the corpus suites.
- A C compiler (`cc`, or the one `CC` names): the export tests compile the generated C
  structs, and fail rather than skip without one.
- For the browser checks and the screenshots: Playwright's Chromium. Playwright is a
  pinned dev dependency; fetch its browser once with `npx playwright install chromium`.
- For the desktop app: Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  of your system.

## First steps

```sh
git clone --recurse-submodules https://github.com/JoshuaLeichsering/CanViewer.git
cd CanViewer
npm ci
npm run fetch-wheels   # the Python wheels for the import adapter, into vendor/pyodide/
npm run dev            # the app on http://localhost:5173
```

`fetch-wheels` downloads the wheels listed in
[`wheels.lock.json`](../../app/src/lib/canmatrix/wheels.lock.json) from jsDelivr (the
Pyodide-built ones) and PyPI, and checks each against its pinned SHA-256. Files already
present are kept, so it works offline once they are there. `dev`, `test` and `build` run
it first. Where those hosts are unreachable,
`node scripts/fetch-wheels.mjs --from <dir>` takes the files from a local directory,
such as an unpacked [Pyodide release](https://github.com/pyodide/pyodide/releases/tag/314.0.7).

Without `--recurse-submodules`, fetch the corpora later with
`git submodule update --init` (add `--depth 1` for a smaller download).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The app with hot reload, on port 5173 |
| `npm test` | Every unit test and the corpus suites ([Tests and baselines](./testing.md)) |
| `npm run test:coverage` | The same, with the coverage thresholds of `vite.config.ts` |
| `npm run e2e` | The Playwright flows in `e2e/flows/` against the production build |
| `npm run test:scripts` | The tests of the scripts: licenses, notices, the release tooling, the link check |
| `npx tsc --noEmit` | Type-check the app |
| `npm run build` | Type-check and build the app into `dist/` |
| `npm run preview` | Serve `dist/` as built, service worker included |
| `npm run check:licenses`, `npm run check:identifying-info` | SPDX headers and dependency licenses; no personal data in the tree |
| `npm run notices` | Regenerate `THIRD_PARTY_NOTICES.md` after a dependency changes |
| `npm run docs:dev` | This site with hot reload ([Documentation](./documentation.md)) |
| `npm run docs:build` | Build this site into `docs/.vitepress/dist/` |
| `npm run docs:links`, `npm run docs:tables` | Check every Markdown link; regenerate the reference tables |
| `npx tauri dev`, `npx tauri build` | Run or package the desktop app |

[CONTRIBUTING.md](../../CONTRIBUTING.md#the-local-check) lists every check CI runs, with
the commands to run them before you push.

## Repository layout

| Path | What it holds |
|---|---|
| `app/` | The web app, and Vite's root: `index.html` and `src/` (the views in `src/components/`; the DBC parser and writer in `src/lib/dbc/`, the canmatrix import in `src/lib/canmatrix/` and `src/lib/import/`, export in `src/lib/export/`, diff mode in `src/lib/diff/`, traces in `src/lib/trace/`; each with its tests next to it) |
| `desktop/` | The Tauri desktop shell, which packages the build in `dist/`, with its self-test (`src/smoke.rs`, `src/smoke.js`) |
| `e2e/` | Checks that drive a browser or the packaged app: the network check, the Playwright flows in `flows/`, the UI checks (`ui-checks.mjs`), the import UI's checks (`import-ui.test.mjs`), the signal table and large database checks, the export, diff mode, Traces and editing checks, the desktop CSP check and smoke test, the documentation crawl and the Pages-like static server |
| `scripts/` | Build and maintenance scripts: `fetch-wheels.mjs`, the Vite plugins, the test report check, the coverage summary, the license and identifying-information checks, the generator of `THIRD_PARTY_NOTICES.md`, the release tooling (`release-version.mjs`, `desktop-release.mjs`, `runbook.mjs`), the screenshots, the ARXML reader comparison in `scripts/arxml-readers/`, and the documentation scripts in `scripts/docs/` |
| `examples/` | Sample files: `demo.dbc`, its later version `demo-v2.dbc`, and the logs `demo.asc` and `demo-candump.log` |
| `docs/` | This site's sources; the working notes in `docs/handover/`, `docs/spikes/` and `docs/design/` are kept but not published ([archive](../archive/index.md)) |
| `third_party/` | The corpus submodules (opendbc, model3dbc, canmatrix, cantools) |
| `.github/` | The workflows (CI, the desktop builds, the release and the Pages site), issue and pull request templates, `CODEOWNERS` |
| the root | Config only: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore`, `.gitattributes`, `.gitmodules`; and `README.md`, `BACKLOG.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` |

Why the web app is not at the root, as in Vite's templates: [decision record
0001](../decisions/0001-repository-layout.md).

## Conventions

- Everything in the repository is in English. The UI is in English and German: every
  string lives in [`i18n.tsx`](../../app/src/lib/i18n.tsx) in both languages (those of
  the Traces view and the frame encoder in [`i18n-trc.ts`](../../app/src/lib/i18n-trc.ts)).
- Paths in documentation and comments are written from the repository root.
- The app makes no request outside its own origin. Do not add one: fonts, icons and the
  Python runtime are all self-hosted ([decision record 0003](../decisions/0003-self-hosted-pyodide-worker.md)).
- A behaviour change shows up in a pinned baseline. Regenerate a baseline only for an
  intended change, and explain the diff.
- Source files start with their license: `// SPDX-License-Identifier: GPL-2.0-or-later`
  (`#` in Python, `/* */` in CSS). `node scripts/check-spdx-headers.mjs --fix` adds it.
- A new dependency is pinned, under a license `scripts/license-policy.mjs` allows, and
  `THIRD_PARTY_NOTICES.md` is regenerated. Removing one also removes its entry in the
  policy: the license check fails on entries that match nothing. The same holds for the
  documentation site: when an update of VitePress changes what its pages bundle, the
  site's build names the package, which then goes into `DOCS_SITE` in the policy.
