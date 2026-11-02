# 0009. The desktop shell: Tauri on Windows, macOS and Linux

- **Status:** accepted
- **Date:** 2026-11-01

## Context

CanViewer is to be installable from a GitHub Release on macOS, Windows and Linux, by
following one runbook, and the packaged app is to do everything the web build does,
offline, ARXML import included. It must make no network requests at all. The owner
decided that the builds stay unsigned, that Linux ships a `.deb` and no AppImage, that the bundle
identifier stays `io.github.joshualeichsering.canviewer`, and that the placeholder icon
stays.

The spike ([its report](../spikes/2026-11-01-tauri-desktop/README.md)) built a Tauri 2
shell and tested it in CI on all three systems. Its deciding question was whether the
system webviews run the Pyodide import worker. In the spike's CI run the installed app
opened `examples/demo.dbc` and canmatrix's `test.arxml` on each system:

| | Windows | macOS | Linux |
|---|---|---|---|
| Webview | WebView2 156 (Chromium) | WKWebView, macOS 26.6.2 (arm64) | WebKitGTK 2.52.6 |
| `test.arxml` through Pyodide, cold | 4,251 ms | 2,160 ms | 6,835 ms |
| CSP violations, errors | none, none | none, none | none, none |
| Requests outside the app (Windows over CDP, in a later run) | 0 of 14 | (no request record in WebKit) | (no request record in WebKit) |

It also found that the Pyodide worker ran without the Content Security Policy, which this
record resolves.

## Decision

### Tauri 2 on all three systems

One shell, `desktop/`, for Windows, macOS and Linux. It shows the production web build
(`dist/`, embedded in the binary) in the system webview, with no plugins, no permissions,
no updater and no network access of its own. The spike answered the question that could
have forced Electron on macOS or Linux: WebKit runs the module worker, WebAssembly under
`'wasm-unsafe-eval'`, and the self-hosted wheels.

### The packages

| System | Package | Release name |
|---|---|---|
| Windows | NSIS installer, for the current user (Tauri's default `currentUser` mode, `%LOCALAPPDATA%\CanViewer`), no administrator rights | `CanViewer_<version>_x64-setup.exe` |
| Windows | MSI, per machine (`C:\Program Files\CanViewer`), for administrators and IT | `CanViewer_<version>_x64_en-US.msi` |
| macOS | one **universal** `.dmg`, built with `--target universal-apple-darwin` | `CanViewer_<version>_universal.dmg` |
| Linux | `.deb` (decided; no AppImage) | `CanViewer_<version>_amd64.deb` |

The release names are Tauri's own, fixed in `scripts/desktop-release.mjs`, which copies
the packages out of Tauri's bundle directory under them. The runbook can name the files,
and a test fails if it names others.

**One universal `.dmg`, not one per architecture.** A reader need not know whether a Mac
has Apple silicon or Intel, and there is one file to download and check. It costs a
second compile on the same arm64 runner (the x86-64 half is cross-compiled; Rust and
Tauri support this), and the binary inside holds both architectures. CI checks that it
does (`lipo -archs`), runs the self-test natively on Apple silicon, and runs it once more
under Rosetta 2 when the runner has it or can install it. Otherwise it warns that the
Intel half did not run, because no Intel runner is used.

### The import worker runs under the page's Content Security Policy

The spike found that Tauri sends the CSP header only with HTML responses (tauri 2.12.5,
`src/manager/mod.rs`, `is_html`), and that `app.security.headers` cannot carry a CSP. A
dedicated worker loaded from its own URL takes its policy from its own response, so the
import worker ran with none: only the app's own code kept its requests local.

A worker created from a `blob:` URL inherits the policy of the document that created it.
So in the desktop app, `app/src/lib/canmatrix/start-worker.ts` starts the worker from a
one-line `blob:` module that imports the real worker script (`import "<url>";`), and
`desktop/tauri.conf.json` adds `blob:` to `worker-src`. A test pins the whole policy
(`app/src/lib/desktop.test.ts`). The worker then runs under `connect-src 'self' ipc:
http://ipc.localhost`, `script-src 'self' 'wasm-unsafe-eval'` and the rest. In
Chromium, Pyodide needed nothing more under it: no `'unsafe-eval'`.

The evidence, from `e2e/desktop-csp-check.mjs`. It serves `dist/` as the Tauri shell
does, with the policy on HTML responses only, marks the page as the desktop app, opens
both files, and then fetches a `data:` URL inside the app's worker. `connect-src 'self'`
forbids that fetch, and it needs no network, so only the policy can stop it. Before the
change:

```
workers: http://localhost:43395/assets/worker-DYcVZ8E6.js
import worker http://localhost:43395/assets/worker-DYcVZ8E6.js: fetch of a data: URL not blocked (read "csp-probe")
FAILED: the import worker does not run from a blob: URL (http://localhost:43395/assets/worker-DYcVZ8E6.js); the import worker is not held to the policy (not blocked (read "csp-probe"))
```

After it:

```
open test.arxml: 5389 ms -> test.arxml · Messages 28 · Signals 152 · Nodes 0 · Value tables 0 · Attribute defs 13
workers: blob:http://localhost:44875/5779aac6-fa78-4800-890b-892c5d9b3ab3
import worker blob:http://localhost:44875/5779aac6-fa78-4800-890b-892c5d9b3ab3: fetch of a data: URL blocked by connect-src (Failed to fetch)
control, assets/worker-DYcVZ8E6.js started from its own URL: fetch of a data: URL not blocked (read "csp-probe")
requests: 32, outside http://localhost:44875: 0
CSP violations while opening the files: 0
desktop CSP check passed: the import worker runs under the page policy
```

That check runs in Chromium in CI on every pull request (`ci.yml`). In the real webviews,
the app's self-test (`desktop/src/smoke.js`) starts its own `blob:` worker and makes the
same fetch, and passes only if the policy blocks it. On Windows, the CDP check makes that
fetch inside the app's own worker as well. WebKit's part of this (macOS and Linux) is
verified by the desktop workflow's runs on macOS and Linux.

**The web build keeps the plain URL.** It sends no policy for a worker to inherit, so a
`blob:` start would gain nothing there. And its service worker must serve the worker's
requests when the app is offline (the network check's phase C), which not every browser
extends to `blob:` workers. Of the 25 files in `dist/`, 22 are byte-identical to the build
before the change, the worker chunk among them. The other three are the index chunk,
which holds the new start, and `index.html` and `sw.js`, which name it.

**The cost** is `blob:` in `worker-src`. Only script that already runs in the page can
create a `blob:` URL, and `script-src 'self'` limits that script to the app's own files,
so this allows nothing that could not run already, and the worker gains the whole policy
in return.

### Release builds: LTO and one codegen unit

`desktop/Cargo.toml`'s release profile has `lto = true` and `codegen-units = 1` again,
and releases are built with it. Every other CI build turns both off through
`CARGO_PROFILE_RELEASE_LTO` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS`, which
`desktop.yml` sets from its `release` input. The evidence, all from the spike:

- With them, the installed Windows executable was 16,811,008 bytes; without them,
  17,608,704 bytes. That is 797,696 bytes, or 4.5 %, smaller.
- With them and a cold cache, the Windows build step took 8 min 9 s (the spike's first
  run). Without them and with a warm cache, it took 2 min 0 s. The two are not directly
  comparable, which is why the slower build is kept to releases.

Releases are rare, and a tag's run cannot use the Rust caches of pull request runs, so a
release builds from a cold cache either way. The release workflow tests the packages it
publishes (the runbook, the self-test, the CDP check), so the LTO build is tested before
anyone downloads it. `opt-level = "s"` or `"z"` and thin LTO were not measured, and stay
out until they are.

### Unsigned, with room for signing

The packages are unsigned (decided). macOS keeps Tauri's ad-hoc signature
(`bundle.macOS.signingIdentity: "-"`), so Gatekeeper asks once and the runbook shows how
to allow it. See [signing](#signing) for what turning it on takes.

### The WebView2 runtime

The Windows installers keep Tauri's default `webviewInstallMode`, `downloadBootstrapper`.
On a computer without the WebView2 runtime (it ships with Windows 11 and current
Windows 10), the installer downloads it from Microsoft. That is the installer, at install
time, not the app. The embedded and offline modes would put Microsoft's installers into
the package, binary-only code with terms of their own, so they are not used.

### The release workflow

- `.github/workflows/release.yml` runs for tags `v*`. Its first job checks that the tag
  is `v` followed by `package.json`'s version, and that `package-lock.json`,
  `desktop/Cargo.toml`, `desktop/Cargo.lock` and the runbook's file names agree
  (`scripts/release-version.mjs`, which also bumps them all). Nothing is built
  otherwise.
- It calls `desktop.yml` as a reusable workflow, so pull requests and releases run the
  same build and test jobs. Tags no longer start `desktop.yml` directly, which would
  build everything twice.
- Each build job runs the install runbook's command blocks, as `docs/guide/install.md`
  shows them, against the packages it has just built (see below). It uploads the
  packages with their `SHA256SUMS`.
- The publish job joins the parts, checks every file against the `SHA256SUMS` its build
  job wrote, and adds `THIRD_PARTY_NOTICES.md` and `demo.dbc`. It writes the combined
  `SHA256SUMS` and the notes with each package's size and a link to the run. Then it
  creates the release: a pre-release for `X.Y.Z-rc.N`, a draft for `X.Y.Z`, which the
  maintainer checks and publishes. It downloads the published assets again and checks
  them against `SHA256SUMS`.
- It never changes an existing release. A failed draft or pre-release is deleted by hand
  (`gh release delete <tag> --yes` keeps the tag), and the run is repeated.
- A release must bundle `THIRD_PARTY_NOTICES.md` and CanViewer's license files
  (`COPYRIGHT`, `LICENSE`, `LICENSE-GPL-3.0`) as Tauri resources
  (`scripts/desktop-release.mjs config --release`, which fails without them). Other
  builds bundle whichever of them exist.
- **Pre-release versions and the MSI.** Windows Installer accepts only numeric versions,
  so the overlay gives WiX `X.Y.Z.N` for `X.Y.Z-rc.N`. Windows Installer compares only
  the first three fields, so a release candidate installed from the `.msi` must be
  uninstalled before the final release of the same version is installed. The runbook
  says so.
- No workflow runs for branch pushes. `desktop.yml` runs for pull requests that touch the
  desktop shell, its checks, its runbook or its scripts, when the release workflow calls
  it, and on demand. A dry run of the whole release (**Run workflow** on `release.yml`)
  builds and tests everything, and uploads the release it would have published as an
  artifact.

### The runbook runs in CI

`docs/guide/install.md` marks each command block with an invisible comment
(`<!-- runbook: linux-install -->`). `scripts/runbook.mjs run <id>` runs a block exactly
as the guide shows it, in the reader's shell: Windows PowerShell 5.1 (what Windows ships,
not PowerShell 7), zsh on macOS, bash on Linux. The desktop workflow runs every block
against the freshly built packages:
- check the checksums;
- install: both Windows installers, the `.dmg`, the `.deb`;
- macOS's first-launch command;
- the self-test;
- uninstall, and delete the app's data;
- then check that nothing is left: no executable, no data folder, no entry in Windows'
  installed apps, no package.

`scripts/runbook.test.mjs` fails if the guide has a block that no workflow runs, or a
workflow runs a block the guide lacks. So the commands have one source, and every
command shown is run.

## Signing

When the owner obtains certificates (a paid service, his decision):

- **macOS:** put the Developer ID certificate and the Apple account into the repository's
  secrets. Pass them to `desktop.yml` with `secrets: inherit` on the `packages` job of
  `release.yml`. Set Tauri's variables on the macOS build step (`APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` for notarization), and drop `signingIdentity: "-"`.
  The marked comment in `desktop.yml` shows where.
- **Windows:** give the build overlay a `bundle.windows.signCommand` (for example for a
  cloud signing service) or a `certificateThumbprint`, again with the secrets passed
  through. SmartScreen's warning fades as a signed publisher gains reputation.
- The runbook's first-launch steps then shrink, and its CI checks (Gatekeeper's
  `spctl --assess`) can turn from informative to required.

## Consequences

- One codebase, one webview API, and one CI workflow cover all three systems. Each
  system's webview is the one its users already update: WebView2, WKWebView and
  WebKitGTK. The packages stay small: the spike's were 11 to 12 MB.
- The app depends on the system webview: WebView2 on Windows, WebKitGTK 4.1 on Linux,
  and WKWebView on macOS. Only the runners' systems are tested: `macos-latest`, and
  `ubuntu-latest` for the `.deb`, which is built there and so needs a C library (glibc)
  at least as new as the one it was linked against. The Linux job prints that version.
  Older releases of either may lack what the app uses.
- The import worker obeys the CSP in the desktop app. A future change that makes the
  worker fetch from elsewhere fails there, and the CSP check in CI catches it on every
  pull request.
- Every release is built, installed, self-tested and uninstalled by CI before it is
  published, with the commands the users get.
- Release builds take longer than pull request builds, and macOS builds two
  architectures. Windows and macOS minutes are spent only on desktop pull requests,
  release tags and manual runs.

## Alternatives considered

- **Electron** on all systems, or only where Tauri failed. Every package would carry its
  own Chromium, which makes it many times larger and is a browser engine to keep patched
  with every release. The spike showed Tauri works on all three, so nothing called for it.
- **Wails, Neutralinojs** and similar shells. They were not tried. Tauri was already
  proven in CI with every package format needed (MSI, NSIS, `.dmg`, `.deb`).
- **No desktop app, only the web app** (installable as a PWA). That would leave nothing
  to download from a GitHub Release, which the context above asks for. The web app
  stays for every system without a package.
- **One `.dmg` per architecture.** It takes the same two compiles, and readers would
  have to pick the right one.
- **An AppImage.** It was dropped for its license duties
  ([0005](./0005-license-gpl-2-or-later.md)): it would carry about 120 libraries of the
  build machine, with a duty to provide their sources for every release.
- **For the worker's policy:**
  - Start it from a `blob:` URL in the web build too. Rejected: there is no policy to
    inherit there, and offline imports depend on the service worker serving the
    worker.
  - A `<meta>` CSP in `index.html`. Rejected: a worker loaded from its own URL does not
    inherit it either.
  - A custom protocol handler in Rust that adds the header to every response. Rejected:
    it would replace Tauri's asset protocol with code of our own, for what the `blob:`
    start gives with two lines.
  - Start the worker from a `data:` URL. Rejected: its origin would be opaque, and
    `'self'` would no longer match the self-hosted runtime.
  - Document it and change nothing. Rejected: the change cost nothing measurable, and
    turns a promise into an enforced rule.
- **A `<meta>` CSP for the web app's page itself**, which GitHub Pages would honour
  although it cannot send the header. Not adopted, for now:
  - One `dist/` serves the web app and every desktop package (`frontendDist`), and the
    desktop app would enforce a `<meta>` policy in its `index.html` together with the
    header. The tag would have to allow what only the desktop app needs (`ipc:` and
    `http://ipc.localhost` for Tauri's IPC, `blob:` workers), or the desktop packages
    would need an HTML of their own: a second build variant that only the Windows,
    macOS and Linux runs of the desktop workflow could test.
  - In the browser it would hold the page's main thread only. The import worker, which
    reads every file that is not DBC, starts from its own URL there (above) and would
    not inherit it, so the part that handles the most data would stay outside it.
  - What the policy would enforce, no request outside the origin, is what the network
    check records three ways on every change, for the build and for the app as Pages
    serves it; the docs crawl does the same for the site.

  Worth revisiting if the web build moves its worker to the `blob:` start (which needs
  a check that every browser's service worker serves `blob:` workers offline), or if
  the desktop packages get their own HTML for another reason.
- **No LTO at all**, as in the spike's later runs. Rejected for releases, which give up
  the 4.5 % for build time saved only on a rare, cold build. Kept for pull request
  builds.
