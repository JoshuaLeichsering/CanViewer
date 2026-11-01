# 0001. Repository layout

- **Status:** accepted
- **Date:** 2026-11-01

## Context

Until this change the web app sat at the repository root, the way Vite's own templates
set a project up: `index.html` and `src/` next to `package.json`. The Tauri shell was in
`src-tauri/`, the name the Tauri CLI suggests, and the browser checks that CI runs lived
inside the spike reports that introduced them (`docs/spikes/…/network-check.mjs`,
`smoke.mjs`, `cdp.conf.json`).

That suited a single web app. CanViewer now also has a desktop shell, checks that run in
a browser or against the packaged app, and maintenance scripts, and more are planned
(end-to-end flows, screenshots, a documentation site). Before the repository goes public,
the owner asked for a professional structure: the web app in its own directory instead
of the root, and likewise the desktop shell, the end-to-end checks, the scripts and the
documentation, with only config and top-level documents at the root (see
[the goal](../handover/2026-11-01-goal.md), F3).

## Decision

| Path | What it holds |
|---|---|
| `app/` | The web app, and Vite's root: `index.html` and `src/` (the views, the DBC parser in `src/lib/dbc/`, the canmatrix import in `src/lib/canmatrix/`, each with its tests next to it) |
| `desktop/` | The Tauri desktop shell (was `src-tauri/`), which packages the build in `dist/` |
| `e2e/` | Checks that drive a browser or the packaged app: `network-check.mjs`, and the desktop smoke test over CDP with its build config (`desktop-cdp-smoke.mjs`, `desktop-cdp.conf.json`) |
| `scripts/` | Build and maintenance scripts: `fetch-wheels.mjs`, the Vite plugins, the CI check of the test report |
| `examples/` | Sample files, such as `demo.dbc` |
| `docs/` | Handover notes, spike reports, design notes and these decision records |
| `third_party/` | The corpus submodules (opendbc, model3dbc, canmatrix, cantools) |
| `.github/workflows/` | CI (`ci.yml`) and the desktop builds (`desktop.yml`) |
| the root | Config only: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `.gitattributes`, `.gitmodules`; and `README.md`, `BACKLOG.md` |

Not tracked, and all at the root as before: `node_modules/`, `vendor/pyodide/` (the
wheels), `dist/` (the build); and `desktop/target/` (the Rust build).

How the tools are pointed at it:

- **Vite** (`vite.config.ts`): `root` is `app/`. The build still goes to `dist/` at the
  repository root (`build.outDir`, with `emptyOutDir: true`, because Vite does not empty
  a directory outside its root unless told to). The dependency cache (`cacheDir`,
  `node_modules/.vite`) and the `.env` files (`envDir`) stay at the root too. The paths
  are absolute, so they do not depend on the directory Vite is started from.
- **Vitest** keeps the repository root as its root and looks for tests in `app/` only
  (`test.root`, `test.dir`). Paths on its command line, such as `--outputFile`, are
  therefore still relative to the repository root.
- **Tauri**: the CLI finds `desktop/tauri.conf.json` by itself. The paths in it are
  relative to `desktop/` (`frontendDist: ../dist`, `version: ../package.json`), and
  `beforeDevCommand` and `beforeBuildCommand` (`npm run dev`, `npm run build`) run at the
  repository root, where `package.json` is.
- **e2e/**: the files that belong to the desktop app start with `desktop-`, so the
  desktop workflow's path filter (`e2e/desktop-*`) takes them and nothing else.
- **docs/** keeps its content where it is for now. It becomes a documentation site later
  (guide, reference, develop, decisions, archive).

## Consequences

- Every command still runs from the repository root: `npm run dev`, `npm test`,
  `npm run build`, `npx tauri …`, `node scripts/…`, `node e2e/…`. Nothing needs a
  `cd app`.
- URLs in the dev server are relative to `app/`: `index.html` loads `/src/main.tsx`,
  which is `app/src/main.tsx`. Files outside `app/` that it serves, such as the fonts from
  `node_modules/` and the pre-bundled dependencies, appear under `/@fs/…` URLs. Vite
  allows them because they are inside the repository (its default `server.fs.allow`).
- Relative paths from the sources to the rest of the repository gain one level: the
  tests in `app/src/lib/*/` reach `third_party/`, `examples/` and `vendor/pyodide/`
  through `../../../..`, and `app/src/fonts.css` reaches `node_modules/` through
  `../../`.
- Static files that must be served as they are would go in `app/public/`, because Vite's
  `publicDir` is relative to its root. There are none today.
- Paths in documentation and comments are written from the repository root
  (`app/src/lib/dbc/parser.ts`). Vitest's file filter accepts that form and the one
  relative to `app/`: `npx vitest run app/src/lib/dbc/corpus.test.ts` and
  `npx vitest run src/lib/dbc/corpus.test.ts` run the same suite.
- The files were moved with `git mv`, so `git log --follow` shows their history.
- The move changed no behaviour. Built from the moves and the config changes alone,
  `dist/` was byte-identical to the build before them: the same 27 files with the same
  SHA-256 each.
- The desktop workflow runs only for pull requests that change `desktop/`,
  `e2e/desktop-*` or the workflow itself, for `v*` tags, and on demand, because Windows
  and macOS minutes are expensive. A change to `app/` alone does not build the desktop
  packages; the release tags and a manual run do.

## Alternatives considered

- **Keep the web app at the root**, as `npm create vite` sets it up and most Vite guides
  assume. It needs no `root` setting. But the root would go on mixing the app's sources
  with the config, the desktop shell and the checks, which is what the owner asked to
  end. With a desktop shell, checks and a documentation site, the web app is one part
  among several, and gets a directory like the others.
- **Keep the name `src-tauri/`**, the Tauri CLI's default. Next to `app/`, `desktop/`
  says what it holds. The CLI looks for `tauri.conf.json` in any directory, so nothing
  depends on the name.
- **npm workspaces**, with a `package.json` in `app/` and in `desktop/`. Each part would
  be self-contained, but one dependency list and one lock file would become several, and
  every script would change, for a project with one web app. Config stays at the root.
- **Let Vitest inherit Vite's root `app/`.** Relative `--outputFile` and coverage paths
  would then land in `app/`, and CI's commands would have to change with them. Keeping
  Vitest's root at the repository root leaves them as they were.
- **Leave the checks in the spike reports.** CI runs them, so they are code that is
  maintained, not evidence. The reports keep their evidence and point
  to `e2e/`.
