# Release process

Releases are built only by CI, never on a developer's machine. A tag `vX.Y.Z` that
matches the version in `package.json` builds the desktop packages on all three systems,
tests them by following the [install guide](../guide/install.md), and publishes a GitHub
Release. The step-by-step checklist for maintainers is the
[maintainers' section of the install guide](../guide/install.md#for-maintainers-making-a-release); this
page summarizes how it fits together. The choices behind it are in
[decision record 0009](../decisions/0009-desktop-shell.md).

## The workflows

- [`release.yml`](../../.github/workflows/release.yml) runs on tags `v*`, and on demand
  as a dry run that uploads the release it would make as an artifact instead of
  publishing it.
- Its first job checks the tag against every place that holds the version:
  `package.json`, `package-lock.json`, `desktop/Cargo.toml`, `desktop/Cargo.lock` and the
  file names in the install guide (`node scripts/release-version.mjs check <tag>`). A
  mismatch stops the release before anything is built.
- It then calls [`desktop.yml`](../../.github/workflows/desktop.yml) with
  `release: true`. That workflow builds the `setup.exe` and the `.msi` on
  `windows-latest`, one universal `.dmg` (Apple silicon and Intel) on `macos-latest`,
  and the `.deb` on `ubuntu-latest`. On each system it runs the install guide's own
  command blocks against the packages it has just built: check the checksums, install,
  run the self-test, uninstall, delete the app's data, and check that nothing is left
  behind.
- The publish job joins the three systems' packages, checks each against the checksum
  its build job recorded, adds `SHA256SUMS`, `THIRD_PARTY_NOTICES.md` and `demo.dbc`,
  and writes the notes with each package's size
  ([`desktop-release.mjs`](../../scripts/desktop-release.mjs)). It creates a
  **pre-release** for a version with `-rc.N` and a **draft** for a final version, which
  the maintainer publishes. It then downloads the assets again and checks them against
  `SHA256SUMS`. It never changes a release that already exists.

## Bumping the version

```sh
node scripts/release-version.mjs bump 0.2.0
```

changes every place the check looks at, in one go (a release candidate is
`X.Y.Z-rc.N`). Commit the bump on a branch, merge it once CI is green, then tag the
merged commit on `main` with an annotated tag and push the tag.

## Build settings

- Release builds use the release profile of `desktop/Cargo.toml` as it stands: LTO and
  one codegen unit, for packages about 4.5 % smaller. Pull request builds turn both off
  through `CARGO_PROFILE_RELEASE_*` variables, because they are much faster to build.
- A release must bundle `THIRD_PARTY_NOTICES.md` and CanViewer's license files
  (`COPYRIGHT`, `LICENSE`, `LICENSE-GPL-3.0`: `RESOURCES` in `scripts/desktop-release.mjs`)
  in every package; the build fails without them, and the desktop workflow checks each
  installed package against the same list. `desktop/tauri.conf.json` sets the license
  metadata (`license`, `licenseFile`, `copyright`, `publisher`); `licenseFile` is
  `COPYRIGHT`, which the installers show as their license page, and the `.deb` also
  installs it as `/usr/share/doc/can-viewer/copyright`.
- The packages are unsigned, by decision; macOS gets Tauri's ad-hoc signature. The
  workflows mark where signing goes once certificates exist, and the decision record has
  a section on it. The install guide explains the first launch of an unsigned build on
  each system.

## Checks that guard the desktop app

- [`e2e/desktop-csp-check.mjs`](../../e2e/desktop-csp-check.mjs) runs in CI on every pull
  request. It serves the build with the desktop app's Content Security Policy, the way
  Tauri sends it, and fails unless the import worker runs under that policy.
- The self-test of the installed app (`CANVIEWER_SMOKE_FILES`, in
  [`desktop/src/smoke.rs`](../../desktop/src/smoke.rs)) opens `demo.dbc` and an ARXML
  file and checks the policy in each system's own webview. CI's run of it also saves a
  message list through the export menu and compares the saved file with the pinned
  export.
- [`scripts/runbook.test.mjs`](../../scripts/runbook.test.mjs) fails if the install
  guide has a command block that no workflow runs, or a workflow runs a block the guide
  lacks.

## What every release carries

Every release carries what the GPL asks for with binaries: the corresponding source at
the release tag, with the lock files that pin every third-party part, and the
third-party notices. The documentation site and the web app are deployed separately, by
the Pages workflow from `main` ([Documentation](./documentation.md#publishing)).
