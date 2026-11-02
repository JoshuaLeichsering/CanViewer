# Working notes

CanViewer was built in a series of working sessions, each of which left notes: what was
asked, what was tried, what was measured. The [decision records](../decisions/index.md)
condense what those notes decided. The notes themselves stay in the repository, as they
were written, but are not part of this site; the links below open them on GitHub.

## Handover notes

- [The goal](../handover/2026-11-01-goal.md): the brief for making the repository
  public, with the owner's decisions, the workstreams and their done criteria.
- [Reading more than DBC](../handover/2026-11-01-multi-format-import.md): the research
  behind canmatrix as the import adapter, with the alternatives searched
  ([0002](../decisions/0002-canmatrix-import-adapter.md)).
- [License audit](../handover/2026-11-01-license-audit.md): every third-party part of
  the web build, the desktop packages and the repository, checked against
  GPL-2.0-or-later ([0005](../decisions/0005-license-gpl-2-or-later.md)).

## Spike reports

- [canmatrix in a Pyodide Web Worker, self-hosted](../spikes/2026-11-01-pyodide-worker/README.md):
  the worker, the network check and its three records of every request, the download
  sizes and the offline behaviour ([0003](../decisions/0003-self-hosted-pyodide-worker.md)).
- [CanViewer as a Tauri desktop app](../spikes/2026-11-01-tauri-desktop/README.md):
  building, installing, self-testing and uninstalling the desktop app in CI on Windows,
  macOS and Linux.

## Design notes

- [Material 3 redesign](../design/2026-11-01-material-redesign/README.md): the design
  next to the implementation, screen by screen, and where they differ
  ([0004](../decisions/0004-material-3-interface.md)).
