# Spike: CanViewer as a Tauri desktop app, built and tested by CI on all three systems

**Date** 2026-11-01. The question, from G4 of the goal at the time: can GitHub Actions
build CanViewer as a desktop app on Windows, macOS and Linux, install each package, and
use it, ARXML import through Pyodide included? Tauri was the backlog's candidate, and
the fear was that macOS would be the hard one.

**Result: yes, on all three.** In run
[41313248134](https://github.com/JoshuaLeichsering/CanViewer/actions/runs/41313248134),
each job:
- built the packages;
- installed them the way a user would;
- had the installed app open `examples/demo.dbc` and canmatrix's `test.arxml` (28
  messages, 152 signals, through the Pyodide worker), with no CSP violation and no
  error;
- uninstalled them again.

macOS was the fastest of the three. On Windows, a CI-only variant of the build, driven over CDP, recorded every request:
all went to the app's own origin ([below](#windows-request-recording)).

## What was built

| Piece | Where |
|---|---|
| Tauri 2 shell: one window showing the production build (`dist/`, embedded in the binary); no plugins, no permissions; HTML5 drag and drop kept working in WebView2 (`dragDropEnabled: false`) | `desktop/` |
| Strict Content Security Policy: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` | `desktop/tauri.conf.json` |
| Self-test, active only when `CANVIEWER_SMOKE_FILES` is set (see below) | `desktop/src/smoke.rs`, `smoke.js` |
| No service worker in the desktop app (the build is served from inside the binary) | `app/src/main.tsx` |
| CI: build, install, self-test and uninstall on `windows-latest`, `macos-latest` and `ubuntu-latest` | `.github/workflows/desktop.yml` |
| Request recording on Windows over CDP | `e2e/desktop-cdp-smoke.mjs`, `e2e/desktop-cdp.conf.json` |
| Placeholder icon from the bit-layout motif | `desktop/app-icon.svg`, `desktop/icons/` |

### The self-test

macOS's WKWebView cannot be driven from outside, and neither WebKitGTK nor WebView2 is
easy to drive on a CI runner. So the app tests itself:

- When `CANVIEWER_SMOKE_FILES` lists files, the shell injects an initialization script
  holding their bytes, and registers one command, `smoke_report`.
- The script clears the app's stored state, puts each file into the app's own file
  input (through a `DataTransfer`), and waits until the app shows it: the document
  title names the file, or an error snackbar appears.
- It reports the title and the overview's facts, any CSP violations and errors, and the
  page's resource URLs. The report goes to `CANVIEWER_SMOKE_OUT`.
- The app exits with code 0 only if every file opened, 1 if one did not, and 2 if no
  report arrived within five minutes.
- Without the variable, no script is injected and no command is registered.

## Results

All from run 41313248134 (commit `6f74f1d`). The self-test reports are quoted from the
job logs.

| | Windows | macOS | Linux |
|---|---|---|---|
| Runner | Windows Server, NT 10.0.26100, WebView2 runtime 156.0.4314.50 | macOS 26.6.2 (arm64) | Ubuntu 26.04, WebKitGTK 2.52.6 |
| Build (with a warm Rust cache) | 2 min 0 s | 44 s | 2 min 32 s |
| Packages | `CanViewer_0.1.0_x64_en-US.msi` 11,935,744 bytes; `CanViewer_0.1.0_x64-setup.exe` 11,050,584 bytes | `CanViewer_0.1.0_aarch64.dmg` 11,657,266 bytes (`CanViewer.app` 14.99 MiB) | `.deb` and `.AppImage` (see the job summary) |
| Install | `msiexec /i … /qn`: exit code 0, `C:\Program Files\CanViewer\canviewer.exe` (17,608,704 bytes) | DMG attached, `CanViewer.app` copied to `/Applications`; `Signature=adhoc`, `Format=app bundle with Mach-O thin (arm64)` | `apt-get install ./….deb`: package `can-viewer`, binary `/usr/bin/canviewer` (16.1 MB installed); AppImage run directly with `APPIMAGE_EXTRACT_AND_RUN=1` |
| App origin | `http://tauri.localhost` | `tauri://localhost` | `tauri://localhost` |
| `demo.dbc` | opened in 160 ms: 9 messages, 33 signals, 5 nodes | 102 ms, same counts | deb 103 ms, AppImage 104 ms, same counts |
| `test.arxml` (Pyodide, cold) | opened in 4,251 ms: 28 messages, 152 signals | 2,160 ms | deb 6,835 ms, AppImage 6,734 ms |
| CSP violations, errors | none, none | none, none | none, none |
| Uninstall | `msiexec /x … /qn`: exit code 0, executable gone | `rm -rf /Applications/CanViewer.app` | `apt-get remove can-viewer`, `/usr/bin/canviewer` gone |

From the macOS job, after the install:

```
Identifier=io.github.joshualeichsering.canviewer
Format=app bundle with Mach-O thin (arm64)
Signature=adhoc
TeamIdentifier=not set
/Applications/CanViewer.app: rejected
(Gatekeeper rejects it: expected for an ad-hoc signature)
```

The macOS self-test report:

```
self-test exit code: 0
{
  "origin": "tauri://localhost",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  "files": [
    { "file": "demo.dbc", "ms": 102, "opened": true,
      "info": "demo.dbc · Messages 9\n · Signals 33\n · Nodes 5\n · Value tables 2\n · Attribute defs 6\n" },
    { "file": "test.arxml", "ms": 2160, "opened": true,
      "info": "test.arxml · Messages 28\n · Signals 152\n · Nodes 0\n · Value tables 0\n · Attribute defs 0\n" }
  ],
  "cspViolations": [],
  "errors": [],
  "resources": [],
  "passed": true
}
```

(WebKit's `innerText` ends each fact with a newline. The self-test now trims it.) In
Windows' report, every resource the page loaded is under `http://tauri.localhost`:

```
"resources": [
  "http://tauri.localhost/assets/index-BZcOwuK7.js",
  "http://tauri.localhost/assets/index-BVTXvxnQ.css",
  "http://tauri.localhost/assets/roboto-flex-latin-wght-normal-n-dP9qr2.woff2",
  "http://tauri.localhost/favicon.ico",
  "http://tauri.localhost/assets/roboto-mono-latin-400-normal-GekRknry.woff2",
  "http://tauri.localhost/assets/worker-CvWaBT0i.js"
],
```

WebKit lists no resource timing entries for the `tauri://` scheme, so the macOS and
Linux reports have none.

### Windows request recording

The plan was to drive the installed app with Playwright over WebView2's DevTools port,
started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, as
Playwright documents for WebView2 apps. The port never opened, in two runs:

```
browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222
```

wry always passes its own browser arguments when it creates the WebView2 environment
(wry 0.57.1, `src/webview2/mod.rs`, `options.set_additional_browser_arguments(…)`, by
default `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`), and the
variable did not take effect alongside them. CI therefore builds a second binary, used
only for this check, whose window config adds the flag (`e2e/desktop-cdp.conf.json`, built with
`--no-bundle`), and drives that one.

In run [41314152587](https://github.com/JoshuaLeichsering/CanViewer/actions/runs/41314152587)
(commit `af67d86`), all three jobs passed again, and the variant was driven over CDP:

```
app page: http://tauri.localhost/
user agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0
tauri: true, service worker controls page: false
open demo.dbc: 62 ms -> demo.dbc · Messages 9 · Signals 33 · Nodes 5 · Value tables 2 · Attribute defs 6
open test.arxml: 2881 ms -> test.arxml · Messages 28 · Signals 152 · Nodes 0 · Value tables 0 · Attribute defs 0
ARXML import fetched 8 runtime files from http://tauri.localhost/pyodide/
requests: 14, origins: http://tauri.localhost
CSP violations: 0
console errors and warnings: 0
smoke test passed
```

Every request went to the app's own origin, the worker's Pyodide requests included, and
the service worker stayed off. The full request list is in the run's `smoke-windows`
artifact (`cdp-windows/report.json`).

## Findings for G4

- **macOS is not the hard part.**
  - It built, installed from the DMG, and ran the ARXML import fastest of the three.
  - The real macOS costs are signing and notarization: Gatekeeper rejects the ad-hoc
    signature, so users go through System Settings → Privacy & Security → *Open
    Anyway*.
  - Runner minutes count ten times for private repositories, though this job took 1 min
    14 s in total.
  - The build is arm64 only. A universal build needs both Rust targets and
    `--target universal-apple-darwin`.
- **WebKit runs Pyodide** in the `tauri://` custom protocol: module worker, WebAssembly
  under `wasm-unsafe-eval`, the self-hosted wheels. That was the deciding question, so
  Electron is not needed for macOS or Linux.
- **The worker runs without a CSP.**
  - Tauri adds the `Content-Security-Policy` header only to HTML responses (tauri
    2.12.5, `src/manager/mod.rs`, `is_html` around line 423).
  - A dedicated worker loaded from its own URL takes its policy from its own response,
    so the Pyodide worker is not restricted by the CSP.
  - `app.security.headers` cannot carry a CSP: tauri-utils says "The
    Content-Security-Policy header is defined separately".
  - What keeps the worker local is the app's own code, which the network checks verify.
    Creating the worker from a `blob:` URL would make it inherit the page's policy, at
    the price of `worker-src blob:`.
  - Since resolved: the desktop app now starts the worker that way
    ([decision 0009](../../decisions/0009-desktop-shell.md)).
- **The missing favicon shows up here too**: the page requests
  `http://tauri.localhost/favicon.ico`. That is W6 in the goal.
- **Size.** LTO and single-unit codegen were turned off to speed up CI. With them
  (first Windows run), the installed executable was 16,811,008 bytes, against
  17,608,704 without.
- **Not decided here:**
  - the bundle identifier;
  - the final icon;
  - the WebView2 install mode: the default `downloadBootstrapper` downloads WebView2 at
    install time on machines that lack it, and the runner had it;
  - signing;
  - a universal macOS build.

## Run it again

The workflow ([desktop.yml](../../../.github/workflows/desktop.yml)) runs on pull requests
that change the desktop shell, its checks, its runbook or the workflow itself, on `v*` tags
through the release workflow ([release.yml](../../../.github/workflows/release.yml)), and
on demand (`workflow_dispatch`). It now follows the install runbook,
[docs/guide/install.md](../../guide/install.md). To try the self-test locally with any installed build:

```sh
CANVIEWER_SMOKE_FILES="$PWD/examples/demo.dbc:$PWD/third_party/canmatrix/tests/files/arxml/test.arxml" \
CANVIEWER_SMOKE_OUT=/tmp/self-test.json \
  /Applications/CanViewer.app/Contents/MacOS/canviewer; echo "exit $?"
```

On Windows, separate the paths with `;`.
