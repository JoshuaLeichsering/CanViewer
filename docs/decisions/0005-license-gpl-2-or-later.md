# 0005. GPL-2.0-or-later, and what it rules out

- **Status:** accepted
- **Date:** 2026-11-01
- **Condensed from:** the owner's decisions recorded in the [goal](../handover/2026-11-01-goal.md#decisions-so-far)
  and the [license audit](../handover/2026-11-01-license-audit.md)

## Context

The repository is to be published under the GNU General Public License version 2. An
audit of every third-party part of the web build, the desktop packages and the
repository checked what that choice allows.

Its main finding: every Tauri 2 desktop binary links Apache-2.0 code (the window library
`tao`, and `dpi` and `muda`), and the web bundle carries the Material Symbols icon paths,
also Apache-2.0. The Free Software Foundation considers Apache-2.0 incompatible with
GPLv2 but compatible with GPLv3. A GPL-2.0-only license would have blocked every desktop
package and the icons.

## Decision

- **CanViewer is licensed under GPL-2.0-or-later**: the GNU General Public License,
  version 2 or any later version. CanViewer's own files stay usable in GPLv2 projects;
  a built artifact that contains Apache-2.0 code (every desktop binary, and the web
  bundle while it holds the icon paths) is conveyed under GPLv3 terms. Both license
  texts ship.
- **No `.xls` import.** canmatrix reads the old Excel format with xlrd 1.2.0, whose
  license (and that of xlwt, which canmatrix imports with it) includes an original-BSD
  advertising clause that no GPL version accepts. Both left the wheel lock. `.xlsx`
  stays, through openpyxl (MIT).
- **No AppImage.** Linux ships a `.deb` only. An AppImage would bundle about 120
  libraries from the build machine, with a duty to provide their sources for every
  release.
- **An additional permission for the Windows build.** `canviewer.exe` statically links
  Microsoft's WebView2 loader, for which no source exists, and the Microsoft Visual C++
  runtime. The license gets an additional permission that allows linking with both and
  conveying the result, worded so that it also works as a GPLv3 section 7 permission.
- **Builds stay unsigned**, and the design renders may be published, as they come from a
  design generated for this project.
- **lxml's two unlicensed stylesheets stay in its wheel.** lxml 6.1.3 includes
  `isoschematron/resources/xsl/RNG2Schtrn.xsl` and `XSD2Schtrn.xsl`, which its
  `LICENSES.txt` calls "unlicensed and copyright the respective authors". CanViewer never
  loads them: canmatrix imports `lxml.etree` only, never `lxml.isoschematron`. Every lxml
  wheel on PyPI and Pyodide's own build carry them, and stripping them would make the
  vendored wheel differ from the release that `wheels.lock.json` pins by its SHA-256. The
  risk is the one every lxml redistributor carries; the notices quote lxml's
  `LICENSES.txt`, which names both files.

## Consequences

The audit lists the duties that follow. In short:

- The repository must carry the GPL-2.0 and GPL-3.0 texts, license metadata in
  `package.json`, `desktop/Cargo.toml` and `desktop/tauri.conf.json`, and SPDX headers.
  `COPYRIGHT` holds the notice with the additional permission, `LICENSE` the text of
  version 2 and `LICENSE-GPL-3.0` that of version 3; the web build carries all three
  (as `.txt`), and every desktop package carries them as resources, with `COPYRIGHT`
  as the installers' license page and, in the `.deb`, as
  `/usr/share/doc/can-viewer/copyright`.
- Every package and the web build must carry third-party notices for the runtime, the
  wheels, the fonts, the icons and the crates, and an About entry must show the license,
  a source link and the notices.
- Every release that ships binaries must come with the corresponding source at its tag,
  including the lock files that pin every third-party part.
- A license check in CI, with an allowlist that follows the audit, is to keep new
  dependencies within it.
- The import corpus no longer includes `.xls`: the suite reads 114 files and compares 70
  twins, instead of 122 and 78.

## Alternatives considered

- **GPL-2.0-only**, with an exception from the owners for Apache-2.0 libraries: needs new
  icons and non-standard terms, cannot cover third-party GPLv2 code, and still leaves the
  AppImage blocked.
- **GPL-3.0-or-later**: the label would match what the binaries are, but CanViewer's own
  code could no longer be reused in GPLv2-only projects. The duties are otherwise the
  same.
- **Keeping `.xls`**, by converting it to `.xlsx` in JavaScript first, or with a
  permission for xlrd: a new dependency, or non-standard terms that would bind every
  redistributor to the advertising clause.
- **Keeping the AppImage**, trimmed and with sources per release: on the order of 100
  source packages to publish with every release.
