# Material 3 redesign: the design reference

**Source:** `Frontend_redesign_brief.zip` (2026-11-01). It holds three directions (Material 3,
a panel workspace, a quiet viewer) and a rebuild of the old UI for comparison. The brief's
cover image and its full-app file, `CanViewer Material.dc.html`, are the Material direction,
so that is the one implemented. The brief itself is not in the repository, so the renders
below are the reference that new UI follows, together with the tokens in `app/src/styles.css`.

`design/` holds renders of `CanViewer Material.dc.html` at 1440 × 900 with its demo data,
which mirrors `examples/demo.dbc`. The brief's runtime loads React and Babel from unpkg;
for the renders those three files were served from local npm copies of the same versions.

| Screen | Design |
|---|---|
| Message, light (EngineData, EngineSpeed selected) | ![](design/message-light.png) |
| Overview, light | ![](design/overview-light.png) |
| Message, dark (BrakeData, payload `13 88 13 92 0C 80`) | ![](design/brake-dark.png) |
| Network, ECM selected | ![](design/network-selected-light.png) |
| Nodes | ![](design/nodes-light.png) |
| Value tables | ![](design/tables-light.png) |

When the redesign landed, `app/` also held the implementation in the same six states, for
a side-by-side review, and in four screens the design does not show. They duplicated the
renders above or the generated screenshots and went stale with every UI change, so they
were removed; current screenshots of the app come from
[`scripts/screenshots.mjs`](../../../scripts/screenshots.mjs), which writes them to
[`docs/guide/images/`](../../guide/images/): the welcome screen
(`welcome-en-*.webp`), parse problems (`problems-en-*.webp`, `vw_mqb.dbc` from opendbc)
and the German UI (`overview-de-*.webp`, `message-de-*.webp`).

`app/` keeps one screen that neither the design nor the generated set shows: a CAN FD
frame of 24 bytes, in the dark theme. It is a historical record of the first
implementation of the redesign, not of the app as it is: its navigation rail predates the
Compare and Traces destinations and the export menu.

| Screen | First implementation |
|---|---|
| CAN FD frame (`AdasObjects`), 24 bytes, dark | ![](app/adas-dark.png) |

## Where the app differs from the design, and why

- **Fonts and icons are bundled.** The design loads Roboto Flex, Roboto Mono and Material
  Symbols from Google Fonts. The app ships the Latin subsets of the two fonts (woff2,
  144 KB, `app/src/fonts.css`) and the 28 icons it uses as inline SVG paths
  (`app/src/components/icon-paths.ts`), so it still makes no request outside its own origin.
- **Nothing the old UI showed is dropped.** The signal card adds the value type and the
  signal's attributes. Messages keep their attributes card, warnings and frame-size notes
  (as banners). The network page keeps the note on messages without sender or receivers.
  The overview keeps parse problems (error banner and table) and skipped statements.
- **The decoder starts empty.** The design prefills sample payloads, which a DBC file does
  not contain. An empty field decodes as all zero bytes, and the parsed bytes are echoed
  when the input is shorter or longer than the DLC.
- **Additions the design leaves open:** the menu button opens the language setting, the
  theme follows the system until toggled, an imported file's loading stage and errors
  appear as a snackbar, and rail destinations with nothing to show are disabled.
