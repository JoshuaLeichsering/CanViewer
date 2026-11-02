# Backlog

Ideas and planned work for CanViewer. Roughly ordered within each section;
move items up/down freely and check them off when done. The
[user guide](docs/guide/index.md) describes everything that is checked off.

## Viewer

- [x] CAN FD polish: verify bit matrix, decoder and warnings for messages with
      DLC > 8 (up to 64 bytes); show FD indicator on messages
- [x] J1939 view: decompose 29-bit IDs into priority / PGN / source address,
      show PGN in the message list for extended frames
- [x] Dark mode (prefers-color-scheme + manual toggle)
- [x] Sortable/filterable columns in the signal table
- [x] Keyboard navigation (↑/↓ through messages, / to focus search)
- [x] Show which signals use a given value table (VAL_TABLE_ back-references;
      DBC does not record the link, so signals with identical VAL_ maps are shown)
- [x] Virtualize the message tree for very large databases (1000+ messages)
- [x] An About entry with the license, the no-warranty statement, a link to the
      source and the third-party notices, as the GPL asks
      ([decision record 0005](docs/decisions/0005-license-gpl-2-or-later.md)):
      **About CanViewer** in the settings menu
- [x] Close the file and forget the stored copy (**Close file** in the settings menu)
- [ ] Parse large DBC files in a worker: opening a file of 5000 messages blocks
      the page for 0.1 to 0.25 s while it parses (0.6 s with the CPU throttled
      2x). Proposed for the owner: defer it past v0.2.0, since the pause happens
      once per file and every view stays responsive afterwards (the 5000-message
      check in `e2e/large-database.mjs`); the owner has not decided yet

## Formats

- [x] Import ARXML, KCD, SYM, DBF, Excel (`.xlsx`), JSON, YAML, FIBEX and ODX
      through canmatrix, with a choice of cluster and the source format shown
- [x] Restore an imported file on reload
- Not planned: `.xls` import (xlrd's license is incompatible with the GPL, see
  [decision record 0005](docs/decisions/0005-license-gpl-2-or-later.md))
- Not planned: LIN (`.ldf`), whose canmatrix reader needs a library without a
  WebAssembly build
- [x] Report the contained PDUs of AUTOSAR container frames, which CanViewer's
      model cannot show, as an import note instead of dropping them silently
- [ ] Report the losses of ECU configuration files (`.ecuc.arxml`), where canmatrix
      reads every frame ID as 0 and ignores the signal types, as a visible problem
      ([The two ARXML readers](docs/develop/arxml-readers.md)). The owner decides
      between this and an upstream report
- [ ] Report the other losses canmatrix does not report itself, measured in
      [The two ARXML readers](docs/develop/arxml-readers.md#findings-for-canviewer-whatever-the-decision):
      a missing `PACKING-BYTE-ORDER` read as big endian (logged at debug level
      only), a broken `COMPU-METHOD` given an assumed scaling, and a range canmatrix
      computes from the raw value range when the file gives none. Each needs the
      adapter to detect what canmatrix does silently, or an upstream change; the
      owner decides which, as for the ECU configuration files
- Owner's decision: whether to read ARXML with cantools instead of canmatrix, and
  whether to post the drafted canmatrix reports ([`docs/develop/upstream/`](docs/develop/upstream/))

## Compare & export

- [x] Diff mode: load two DBC versions and highlight added/removed/changed
      messages and signals
- [x] Export message/signal list as CSV or JSON
- [x] Copy a message as C struct / decode pseudo-code
- Owner's decision: whether the comparison should ignore whitespace around line
  breaks in comments (it reports `"Multi \n Line"` against `"Multi\nLine"` as a
  change). Until then it reports them, which shows what the files say

## Decode & traces

- [x] Import a candump / ASC log and replay it through the decoder
      (table of decoded frames over time)
- [x] Frame encoder: enter physical values per signal, get the hex frame
      (inverse of the decode panel)

## Editing (long term)

- [x] Edit message/signal properties and write the DBC back out
      (turns the viewer into an editor)

## Infrastructure

- [x] Error boundary with a "reset stored file" escape hatch
- [x] Deploy as a static site on GitHub Pages, next to the documentation. The
      Pages workflow builds and checks both on every change; it deploys from
      `main` once the repository is public and Pages is enabled, since Pages for
      a private repository needs a paid plan
- [x] Package as desktop app (Tauri) for offline/workshop use: Windows, macOS and
      Linux, released from a tag by CI, with an
      [install guide](docs/guide/install.md)
- [x] CI on GitHub Actions: typecheck, tests (incl. the submodule corpus), build and
      network check on every push to `main` and every pull request
- Not planned: an AppImage (it would bundle about 120 libraries of the build
  machine, each with a duty to provide its source); Linux gets a `.deb`
- Not planned for now: code signing. Builds stay unsigned, and the install guide
  covers the first launch on each system
