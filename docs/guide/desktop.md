# The desktop app

<!-- TODO(phase-2, W4): complete this page from the release workflow: the packages per
system and their sizes, the link to the latest release, and what differs from the web
app. -->

CanViewer also runs as a desktop program for Windows, macOS and Linux. It is the same
app as the web version, in a window of its own:

- **Offline from the start.** The app and the Python runtime for non-DBC formats are
  inside the program. It makes no network requests at all: no telemetry, no update
  check.
- **Every format.** DBC with CanViewer's own parser, and ARXML and the other formats
  through canmatrix, exactly as in the browser.
- **Small.** The packages are about 11 to 12 MB; the program uses the operating
  system's own web view (WebView2 on Windows, WebKit on macOS and Linux) instead of
  bundling a browser.
- **Locked down.** A strict content security policy allows the window to load only the
  app's own files.

The desktop app is built with [Tauri](https://tauri.app/). CI builds it on all three
systems, installs each package the way a user would, has the installed app open a DBC
and an ARXML file, and uninstalls it again.

## Install

From the first release on, the packages are published on the repository's GitHub
Releases page:

| System | Package |
|---|---|
| Windows | `.msi` installer, or the setup `.exe` |
| macOS | `.dmg` |
| Linux | `.deb` (Debian, Ubuntu and their derivatives) |

The builds are not signed with a paid certificate, so Windows and macOS ask you to
confirm the first launch. The [install guide](./install.md) walks through checking the
download, the first launch, updating and uninstalling on each system.
