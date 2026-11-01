# Release process

<!-- TODO(phase-2, W4): replace this page with the maintainers' part of the install
runbook: bump the version, tag vX.Y.Z, watch the release workflow, check the artifacts
(the packages, SHA256SUMS, the sizes in the notes), and how the runbook's commands run
in CI against the packages. -->

> [!NOTE]
> The release workflow is being built. This page describes the plan; it will hold the
> maintainers' checklist once the first release is out.

- Releases are built only by CI, never on a developer's machine.
- A tag `vX.Y.Z` that matches the version in `package.json` builds the desktop packages
  on all three systems and publishes a GitHub Release with a `.dmg` for macOS, an
  `.msi` and a setup `.exe` for Windows, a `.deb` for Linux, and a `SHA256SUMS` file.
- The builds are unsigned. The [install guide](../guide/install.md) explains the first
  launch on each system.
- Every release carries what the GPL asks for with binaries: the corresponding source
  at the release tag, with the lock files that pin every third-party part.
- The documentation site and the web app are deployed by the Pages workflow from `main`
  ([Documentation](./documentation.md#publishing)).
