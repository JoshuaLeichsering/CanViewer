# Getting set up

CanViewer is a React and TypeScript app built with Vite, with a Python import adapter
that runs under Pyodide, a Tauri desktop shell, and this documentation site built with
VitePress. Everything runs from the repository root.

## Requirements

- Node.js 22 and npm.
- git, with the submodules for the corpus suites.
- For the browser checks and the screenshots: Playwright with its Chromium
  (`npm install --no-save playwright` and `npx playwright install chromium`, or a global
  install found through `NODE_PATH`). It is not a dependency of the app.
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
| `npx tsc --noEmit` | Type-check the app |
| `npm run build` | Type-check and build the app into `dist/` |
| `npm run preview` | Serve `dist/` as built, service worker included |
| `npm run docs:dev` | This site with hot reload ([Documentation](./documentation.md)) |
| `npm run docs:build` | Build this site into `docs/.vitepress/dist/` |
| `npx tauri dev`, `npx tauri build` | Run or package the desktop app |

## Repository layout

| Path | What it holds |
|---|---|
| `app/` | The web app, and Vite's root: `index.html` and `src/` (the views in `src/components/`, the DBC parser in `src/lib/dbc/`, the canmatrix import in `src/lib/canmatrix/`, each with its tests next to it) |
| `desktop/` | The Tauri desktop shell, which packages the build in `dist/` |
| `e2e/` | Checks that drive a browser or the packaged app: the network check, the documentation crawl, the desktop smoke test |
| `scripts/` | Build and maintenance scripts: `fetch-wheels.mjs`, the Vite plugins, the test report check, the screenshots, and the documentation scripts in `scripts/docs/` |
| `examples/` | Sample files, such as `demo.dbc` |
| `docs/` | This site's sources; the working notes in `docs/handover/`, `docs/spikes/` and `docs/design/` are kept but not published ([archive](../archive/index.md)) |
| `third_party/` | The corpus submodules (opendbc, model3dbc, canmatrix, cantools) |
| `.github/workflows/` | CI, the desktop builds and the Pages site |

Why the web app is not at the root, as in Vite's templates: [decision record
0001](../decisions/0001-repository-layout.md).

## Conventions

- Everything in the repository is in English. The UI is in English and German: every
  string lives in [`i18n.tsx`](../../app/src/lib/i18n.tsx) in both languages.
- Paths in documentation and comments are written from the repository root.
- The app makes no request outside its own origin. Do not add one: fonts, icons and the
  Python runtime are all self-hosted ([decision record 0003](../decisions/0003-self-hosted-pyodide-worker.md)).
- A behaviour change shows up in a pinned baseline. Regenerate a baseline only for an
  intended change, and explain the diff.
