# Install CanViewer

CanViewer runs in a web browser, and as a desktop app on Windows, macOS and Linux. The
desktop app does everything the web app does, ARXML import included, and works offline.
It makes no network requests at all: no telemetry, no update check. The files you open
never leave your computer.

This guide takes you from the release page to a running app, and back out again. You need
no developer tools. Each step can be done by clicking; the commands shown next to the
steps do the same from a terminal. CI runs every one of those commands against each
release's packages, on each system, before the release is published (see
[how this guide is checked](#how-this-guide-is-checked)).

- [What to download](#what-to-download)
- [Windows](#windows)
- [macOS](#macos)
- [Linux](#linux)
- [Other systems](#other-systems)
- [For maintainers: making a release](#for-maintainers-making-a-release)

## What to download

Open the [releases page](https://github.com/JoshuaLeichsering/CanViewer/releases) and
pick the newest release. Under **Assets**, download the package for your system,
`SHA256SUMS`, and `demo.dbc` if you want to check the installed app with it. The commands
below expect them in your Downloads folder.

| System | Package |
|---|---|
| Windows 10 and 11, 64-bit | `CanViewer_0.2.0-rc.1_x64-setup.exe` installs for your user account and needs no administrator rights. `CanViewer_0.2.0-rc.1_x64_en-US.msi` installs for all users of the computer, needs administrator rights, and suits IT departments. Take one of them. |
| macOS, Apple silicon and Intel | `CanViewer_0.2.0-rc.1_universal.dmg` |
| Linux: a `.deb`, built and tested on Ubuntu, 64-bit (x86-64) | `CanViewer_0.2.0-rc.1_amd64.deb` |

Each release also carries:
- `SHA256SUMS`: the SHA-256 checksum of every file in the release, so that you can check
  that your download is complete and unchanged;
- `demo.dbc`: a small CAN database, for checking the installed app;
- `THIRD_PARTY_NOTICES.md`: the licenses of the third-party software in CanViewer. It is
  also installed with the app.

The version in the file names here is the version this guide was last released with. A
newer release has the same files under its own version.

**The packages are not code-signed.** Signing needs a paid certificate for each of Windows
and macOS. So Windows and macOS warn you once, before the first start, that they do not
know the publisher. The steps below show how to allow it. The checksum shows that your
download is the file on the release page, complete and unchanged.

## Windows

### 1. Check the download

Open PowerShell in your Downloads folder: in File Explorer, open the folder, then
right-click an empty spot and choose **Open in Terminal** (on Windows 10, hold Shift while
you right-click, and choose **Open PowerShell window here**). Then paste this and press
Enter:

<!-- runbook: windows-verify -->
```powershell
$verified = 0
foreach ($line in Get-Content .\SHA256SUMS) {
  $hash, $name = $line -split '  ', 2
  if (-not (Test-Path -LiteralPath $name)) { continue }
  if ((Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash -ne $hash) { throw "${name}: the checksum does NOT match" }
  "${name}: OK"
  $verified++
}
if ($verified -eq 0) { throw 'None of the files listed in SHA256SUMS is in this folder.' }
```

It prints `OK` for each file of the release that is in the folder. If it says a checksum
does not match, delete the file and download it again.

### 2. Install

Double-click `CanViewer_0.2.0-rc.1_x64-setup.exe` (or the `.msi`).

Windows SmartScreen may show **Windows protected your PC**. Click **More info**, check
that the app is `CanViewer_0.2.0-rc.1_x64-setup.exe`, then click **Run anyway**. The installer
asks no questions beyond the usual ones; the `.msi` asks for administrator rights.

Or install from PowerShell, without any dialog. For your user account:

<!-- runbook: windows-nsis-install -->
```powershell
$p = Start-Process .\CanViewer_0.2.0-rc.1_x64-setup.exe -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "the installer exited with code $($p.ExitCode)" }
```

For all users, in a PowerShell started with **Run as administrator**:

<!-- runbook: windows-msi-install -->
```powershell
$msi = (Resolve-Path .\CanViewer_0.2.0-rc.1_x64_en-US.msi).Path
$p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec exited with code $($p.ExitCode)" }
```

The `.msi` installs into `C:\Program Files\CanViewer\`, unless `setup.exe` installed
CanViewer before: then it reuses that folder in `%LOCALAPPDATA%`, which the uninstaller
of the `setup.exe` installation leaves recorded. Removing the leftovers (step 6 below)
clears that.

CanViewer needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11 and of
current Windows 10. On a computer without it, the installer downloads it from Microsoft.

### 3. Start CanViewer

Open the Start menu and choose **CanViewer**.

### 4. Check that it works

Click **Open** and choose `demo.dbc` from your Downloads folder. The overview shows
**9** messages, **33** signals and **5** nodes.

CanViewer also has a self-test, which does the same without you: it opens `demo.dbc`,
reports what it shows, and closes again. In PowerShell, in the Downloads folder:

<!-- runbook: windows-self-test -->
```powershell
$exe = Get-Item "$env:LOCALAPPDATA\CanViewer\canviewer.exe", "$env:ProgramFiles\CanViewer\canviewer.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'CanViewer is not installed' }
Remove-Item .\self-test.json -ErrorAction SilentlyContinue
$env:CANVIEWER_SMOKE_FILES = "$PWD\demo.dbc"
$env:CANVIEWER_SMOKE_OUT = "$PWD\self-test.json"
$app = Start-Process $exe.FullName -Wait -PassThru
Remove-Item Env:\CANVIEWER_SMOKE_FILES, Env:\CANVIEWER_SMOKE_OUT
Get-Content .\self-test.json -ErrorAction SilentlyContinue
if ($app.ExitCode -ne 0) { throw "the self-test failed (exit code $($app.ExitCode))" }
```

A window opens for a moment, and the report ends with `"passed": true`.

### 5. Update

Download the new release, check it as in step 1, and install it as in step 2. It replaces
the version you have, and keeps your settings. Use the same kind of package as before
(`setup.exe` or `.msi`).

If you installed a release candidate (a version such as `0.2.0-rc.1`) with the `.msi`,
uninstall it before you install the final release of the same version: Windows Installer
counts both as the same version.

### 6. Uninstall

Open **Settings** → **Apps** → **Installed apps**, find **CanViewer**, click **⋯** and
choose **Uninstall** (on Windows 10: **Settings** → **Apps** → **Apps & features** →
**CanViewer** → **Uninstall**). The uninstaller of the `setup.exe` installation also offers to
delete the app's data.

Or from PowerShell. If you installed with `setup.exe`:

<!-- runbook: windows-nsis-uninstall -->
```powershell
Start-Process "$env:LOCALAPPDATA\CanViewer\uninstall.exe" -ArgumentList '/S' -Wait
```

If you installed with the `.msi` (as administrator, in the folder with the `.msi`):

<!-- runbook: windows-msi-uninstall -->
```powershell
$msi = (Resolve-Path .\CanViewer_0.2.0-rc.1_x64_en-US.msi).Path
$p = Start-Process msiexec.exe -ArgumentList "/x `"$msi`" /qn" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "msiexec exited with code $($p.ExitCode)" }
```

Uninstalling keeps the app's data: the file you last opened, the theme and the language.
The uninstaller of the `setup.exe` installation also leaves the folder it installed into
recorded in the registry. To delete both:

<!-- runbook: windows-remove-data -->
```powershell
Remove-Item -Recurse -Force "$env:APPDATA\io.github.joshualeichsering.canviewer", "$env:LOCALAPPDATA\io.github.joshualeichsering.canviewer" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'HKCU:\Software\The CanViewer authors\CanViewer' -ErrorAction SilentlyContinue
```

## macOS

### 1. Check the download

Open **Terminal** (in Applications → Utilities) and paste these two lines (if your
browser saved the files somewhere other than Downloads, change the `cd` line):

<!-- runbook: macos-verify -->
```zsh
cd ~/Downloads
shasum -a 256 --check --ignore-missing SHA256SUMS
```

It prints `OK` for each file of the release that is in the folder. If it prints `FAILED`,
delete the file and download it again.

### 2. Install

Double-click `CanViewer_0.2.0-rc.1_universal.dmg`, and drag **CanViewer** onto the
**Applications** folder in the window that opens. Then eject the disk image (in Finder's
sidebar, click ⏏ next to **CanViewer**).

Or in Terminal:

<!-- runbook: macos-install -->
```zsh
cd ~/Downloads
hdiutil attach CanViewer_0.2.0-rc.1_universal.dmg -nobrowse -mountpoint /Volumes/CanViewer
cp -R /Volumes/CanViewer/CanViewer.app /Applications/
hdiutil detach /Volumes/CanViewer
```

### 3. Start CanViewer for the first time

Because the app is not signed by an identified developer, macOS blocks its first start.

On macOS 15 (Sequoia) and later:
1. Open **CanViewer** from Applications. macOS says it cannot verify the app. Click
   **Done**.
2. Open **System Settings** → **Privacy & Security**, and scroll down to **Security**.
   Next to "CanViewer was blocked to protect your Mac", click **Open Anyway**, and
   confirm with your password.
3. Click **Open Anyway** in the dialog that follows.

On macOS 14 and earlier, Control-click **CanViewer** in Applications, choose **Open**,
and click **Open** in the dialog.

Or allow it in Terminal, which removes the quarantine mark macOS puts on downloaded
files:

<!-- runbook: macos-first-launch -->
```zsh
xattr -d com.apple.quarantine /Applications/CanViewer.app
```

From then on, CanViewer starts like any other app.

### 4. Check that it works

Click **Open** and choose `demo.dbc` from your Downloads folder. The overview shows
**9** messages, **33** signals and **5** nodes.

Or run the self-test, which does the same without you and prints a report ending with
`"passed": true`:

<!-- runbook: macos-self-test -->
```zsh
cd ~/Downloads
CANVIEWER_SMOKE_FILES="$PWD/demo.dbc" /Applications/CanViewer.app/Contents/MacOS/canviewer
```

### 5. Update

Download the new release, check it, and install it as in step 2, choosing **Replace**
when Finder asks (in Terminal, run the uninstall command of step 6 before the install
commands). The first start of the new version needs step 3 again. Your settings are
kept.

### 6. Uninstall

Quit CanViewer, and drag **CanViewer** from Applications to the Bin. Or in Terminal:

<!-- runbook: macos-uninstall -->
```zsh
rm -rf /Applications/CanViewer.app
```

This keeps the app's data: the file you last opened, the theme and the language. To
delete it as well:

<!-- runbook: macos-remove-data -->
```zsh
cd ~/Library
rm -rf "Application Support/io.github.joshualeichsering.canviewer" \
  Caches/io.github.joshualeichsering.canviewer \
  HTTPStorages/io.github.joshualeichsering.canviewer \
  HTTPStorages/io.github.joshualeichsering.canviewer.binarycookies \
  WebKit/io.github.joshualeichsering.canviewer \
  Preferences/io.github.joshualeichsering.canviewer.plist \
  "Saved Application State/io.github.joshualeichsering.canviewer.savedState"
```

## Linux

The `.deb` is for Debian, Ubuntu and the distributions built on them, on 64-bit x86. It
needs WebKitGTK 4.1, which `apt` installs with it. It is built and tested on the newest
Ubuntu release that GitHub's build machines run; an older release may lack a library
version it needs.

The commands expect the files in `~/Downloads`. If your browser saved them elsewhere (on a
system in another language the folder may have another name), change the `cd` line.

### 1. Check the download

In a terminal:

<!-- runbook: linux-verify -->
```sh
cd ~/Downloads
sha256sum --check --ignore-missing SHA256SUMS
```

It prints `OK` for each file of the release that is in the folder. If it prints `FAILED`,
delete the file and download it again.

### 2. Install

<!-- runbook: linux-install -->
```sh
cd ~/Downloads
sudo apt install ./CanViewer_0.2.0-rc.1_amd64.deb
```

The `./` matters: it tells `apt` to install the file, not to look for a package of that
name.

### 3. Start CanViewer

Choose **CanViewer** in your desktop's app menu, or run `canviewer` in a terminal. Linux
does not ask before the first start.

### 4. Check that it works

Click **Open** and choose `demo.dbc` from your Downloads folder. The overview shows
**9** messages, **33** signals and **5** nodes.

Or run the self-test, which does the same without you and prints a report ending with
`"passed": true`:

<!-- runbook: linux-self-test -->
```sh
cd ~/Downloads
CANVIEWER_SMOKE_FILES="$PWD/demo.dbc" canviewer
```

### 5. Update

Download the new release, check it, and install it as in step 2. `apt` replaces the
version you have, and your settings are kept.

If you installed a release candidate (a version such as `0.2.0-rc.1`), `apt` reports the
final release of the same version (`0.2.0`) as a downgrade and asks whether to go on:
the package keeps the version as written, and Debian's version rules sort a part after
a hyphen as a revision, so `0.2.0-rc.1` counts as later than `0.2.0`. Answering yes is
right, or `sudo apt remove can-viewer` first.

### 6. Uninstall

<!-- runbook: linux-uninstall -->
```sh
sudo apt remove can-viewer
```

This keeps the app's data: the file you last opened, the theme and the language. To
delete it as well:

<!-- runbook: linux-remove-data -->
```sh
rm -rf ~/.local/share/io.github.joshualeichsering.canviewer ~/.cache/io.github.joshualeichsering.canviewer
```

## Other systems

There is no package for other Linux distributions (an AppImage would have to carry about
120 libraries of the build machine, with their sources), for 32-bit or Arm Windows, or for
Arm Linux. The web app does the same in any current browser, and also works offline once
it has been opened.

## Where the app keeps its files

| | Windows | macOS | Linux |
|---|---|---|---|
| The app | `%LOCALAPPDATA%\CanViewer\` (`setup.exe`) or `C:\Program Files\CanViewer\` (`.msi`) | `/Applications/CanViewer.app` | `/usr/bin/canviewer`, and `/usr/lib/CanViewer/` |
| The license files (`COPYRIGHT`, `LICENSE`, `LICENSE-GPL-3.0`) and `THIRD_PARTY_NOTICES.md` | in the app's folder | in `CanViewer.app/Contents/Resources/` | in `/usr/lib/CanViewer/`, and the notice as `/usr/share/doc/can-viewer/copyright` |
| Its data (the last file, the theme and the language) | `%LOCALAPPDATA%\io.github.joshualeichsering.canviewer\` | `~/Library/WebKit/io.github.joshualeichsering.canviewer/` and other folders of that name in `~/Library/` | `~/.local/share/io.github.joshualeichsering.canviewer/` |

## For maintainers: making a release

Releases are built only by CI, by the
[Release workflow](../../.github/workflows/release.yml). It runs for every tag `v*`, and
fails before building anything unless the tag is `v` followed by `package.json`'s version.

### 1. Bump the version

```sh
node scripts/release-version.mjs bump 0.2.0-rc.1
```

This writes the version into `package.json`, `package-lock.json`, `desktop/Cargo.toml`,
`desktop/Cargo.lock` and the file names in this guide, then checks that they agree. A
release candidate is `X.Y.Z-rc.N`, a final release `X.Y.Z`. Commit the change on a branch,
open a pull request, and merge it once CI is green.

### 2. Tag

On `main`, at the merged commit:

```sh
git tag -a v0.2.0-rc.1 -m "CanViewer 0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

### 3. Watch the workflow

Open **Actions** → **Release** on GitHub, or run `gh run watch`. The workflow:

1. checks the tag against the version (`node scripts/release-version.mjs check <tag>`);
2. builds the web app and the packages on `windows-latest`, `macos-latest` and
   `ubuntu-latest`, through the [desktop workflow](../../.github/workflows/desktop.yml):
   the `setup.exe` and the `.msi`, a universal `.dmg`, and the `.deb`;
3. runs this guide's commands on each system against the packages it has just built:
   checks the checksums, installs each package, runs the self-test, uninstalls, deletes
   the app's data, and checks that nothing is left behind. CI's own self-test also opens
   an ARXML file through the import runtime, checks that the import worker is held to the
   app's Content Security Policy, and saves `demo.dbc`'s message list through the export
   menu (`CANVIEWER_SMOKE_EXPORT=1`), which must land in the Downloads folder and equal
   the web app's export. The self-test in this guide leaves the export out, so it saves
   nothing in your Downloads folder;
4. joins the packages into one release, checks each against the checksum its build job
   recorded, adds `SHA256SUMS`, `THIRD_PARTY_NOTICES.md` and `demo.dbc`, and writes the
   notes with each package's size;
5. creates the GitHub release: a **pre-release** for a version with `-rc.N`, a **draft**
   for a final version. Then it downloads the assets from the release and checks them
   against `SHA256SUMS` once more.

The workflow never changes a release that exists. If a run fails after it created the
release, delete that release (`gh release delete v0.2.0-rc.1 --yes`, which keeps the
tag), then **Re-run jobs**.

### 4. Check the artifacts

On the release page, check that:
- the assets are the four packages, `SHA256SUMS`, `THIRD_PARTY_NOTICES.md` and
  `demo.dbc`;
- the notes list each package with its size, and link the workflow run;
- the run's jobs passed, and their logs show the self-test reports (`"passed": true`).

Then put the run's link into the last paragraph of
[How this guide is checked](#how-this-guide-is-checked), with the tag it checked, in a
pull request, so that the guide names the run that last checked it.

Then download a package and follow this guide on a real computer. For a final release,
publish the draft: **Edit** → **Publish release**, or
`gh release edit v0.2.0 --draft=false`.

### A dry run

**Actions** → **Release** → **Run workflow** runs everything on the chosen branch except
the publishing: it uploads the release it would have made as the `release` artifact of
the run.

### Signing later

The packages are unsigned by decision, and macOS gets Tauri's ad-hoc signature. The
release workflow marks where signing goes when certificates exist: Apple's signing and
notarization through Tauri's `APPLE_*` variables, and Windows through
`bundle.windows.signCommand`. See
[the decision record](../decisions/0009-desktop-shell.md#signing).

## How this guide is checked

Each command block above that the release workflow runs carries an invisible marker
(`<!-- runbook: linux-install -->` and so on). The desktop workflow runs those blocks
exactly as they stand here, with `node scripts/runbook.mjs run <id>`, in Windows
PowerShell 5.1, zsh and bash, against the packages it has just built. A test
(`scripts/runbook.test.mjs`) fails if a block is not run by the workflow, or the workflow
runs a block this guide lacks; another (`scripts/desktop-release.test.mjs`) fails if the
file names here differ from the release's.

The two things CI does around the blocks: it marks the installed macOS app as downloaded
(the quarantine attribute a browser sets), so that the first-launch command has something
to remove; and it runs the Linux self-test under a virtual display (`xvfb-run`).

Each release's notes link the run that built it, which is the run that checked this guide
against its packages. The run that last checked this guide against a release: not
recorded yet; the first will be the run of `v0.2.0-rc.1`.
