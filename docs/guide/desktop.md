# The desktop app

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
  app's own files. The worker that reads non-DBC formats runs under the same policy, so
  it cannot reach another host either.

The desktop app is built with [Tauri](https://tauri.app/) ([decision record
0009](../decisions/0009-desktop-shell.md)). CI builds it on all three systems, installs
each package the way the [install guide](./install.md) says, has the installed app open a
DBC and an ARXML file, and uninstalls it again.

## The packages

Each release on the repository's GitHub Releases page has:

| System | Package | Installs |
|---|---|---|
| Windows | `CanViewer_<version>_x64-setup.exe` | for you alone, in `%LOCALAPPDATA%\CanViewer`, without administrator rights |
| Windows | `CanViewer_<version>_x64_en-US.msi` | for every user of the computer, in `C:\Program Files\CanViewer` |
| macOS | `CanViewer_<version>_universal.dmg` | `CanViewer.app`, for Apple silicon and Intel |
| Linux | `CanViewer_<version>_amd64.deb` | the package `can-viewer`, with the program `/usr/bin/canviewer` |

Next to them are `SHA256SUMS`, to check the download, `THIRD_PARTY_NOTICES.md`,
`demo.dbc`, a sample database to open once the app is installed, and
`libiconv-1.16.tar.gz` and `wix3-wix3141rtm.tar.gz`, the source code that the licenses of
GNU libiconv and the WiX Toolset ask to come with the packages. Every package installs
CanViewer's license files (`COPYRIGHT`, `LICENSE` and `LICENSE-GPL-3.0`) and the notices
with the app, and its installer shows `COPYRIGHT` as the license; **About CanViewer** in
the app opens them too. The release notes give
each package's size.

The builds are not signed with a paid certificate, so Windows and macOS ask you to
confirm the first launch. There is no AppImage: Linux gets the `.deb`, built and tested on
Ubuntu. The [install guide](./install.md) walks through checking the download, the first
launch, updating and uninstalling on each system.

## What is different from the web app

- **Exports** and files saved as DBC go to your Downloads folder: on Windows the
  user's Downloads folder, on macOS `~/Downloads`, on Linux the XDG Downloads folder
  named in `~/.config/user-dirs.dirs` (or the app's working directory, when that file
  names none). A name that is taken gets a number rather than overwriting the file.
- **The app keeps its data** (the last file you opened, the theme, the language) in a
  folder of its own instead of the browser's storage. **Close file** in the settings menu
  forgets the last file; the [install guide](./install.md#where-the-app-keeps-its-files)
  says where the folder is, and how to remove it.
- **No service worker.** The web app caches itself for offline use; the desktop app is
  offline already.
- **A self-test.** Started with the environment variable `CANVIEWER_SMOKE_FILES` set to
  the path of `demo.dbc`, the app opens the file, prints a report that ends with
  `"passed": true`, and quits. The install guide uses it to confirm an install. It starts
  from a clean profile, so the theme, the language and the last file are reset
  afterwards.
