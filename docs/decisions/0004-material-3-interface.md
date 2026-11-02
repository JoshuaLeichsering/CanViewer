# 0004. A Material 3 interface, with fonts and icons bundled

- **Status:** accepted
- **Date:** 2026-11-01
- **Condensed from:** the [design notes](../design/2026-11-01-material-redesign/README.md)

## Context

A frontend redesign brief proposed three directions for CanViewer (Material 3, a panel
workspace, a quiet viewer) and a rebuild of the old interface for comparison. Its cover
image and its full-app prototype were the Material 3 direction. The prototype loaded its
fonts and icons from Google Fonts and its runtime from unpkg, which CanViewer cannot do:
the app makes no request outside its own origin.

## Decision

- **Implement the Material 3 direction**: a navigation rail (Overview, Messages, Network,
  Nodes, Tables), a list-detail layout, a tonal teal colour scheme, light and dark.
- **Colours are tokens** on the root element (`app/src/styles.css`); dark mode swaps the
  tokens through `data-theme="dark"`, set before the first paint from the stored choice
  or the system setting.
- **Fonts are bundled**: the Latin and Latin Extended subsets of Roboto Flex and Roboto
  Mono (woff2, 144 KB, SIL Open Font License 1.1), declared in `app/src/fonts.css`.
- **Icons are inline SVG paths** of the 28 Material Symbols the app uses
  (`app/src/components/icon-paths.ts`, Apache-2.0), not an icon font.
- **Nothing the old interface showed is dropped**: value types, attributes, warnings and
  frame-size notes, the network page's note on unconnected messages, parse problems and
  skipped statements all have a place.
- **The decoder starts empty.** The prototype prefilled sample payloads, which a DBC file
  does not contain; an empty field decodes as zero bytes.

## Consequences

- New UI follows the design notes and uses the tokens in `app/src/styles.css`.
- Every UI string exists in English and German; the type of the string table makes a
  missing translation a type error.
- The documentation site uses the same fonts and colours, from the same files, so it
  needs no web font either ([0006](./0006-documentation-site.md)).
- The design renders in `docs/design/` were generated for this project and may be
  published (the owner's decision after the license audit).

## Alternatives considered

- **The panel workspace and the quiet viewer**: the brief's other two directions. The
  brief itself pointed at Material 3 with its cover and full prototype.
- **Fonts and icons from Google Fonts**, as in the prototype: a request to a third party
  on every visit.
- **An icon font, self-hosted**: the whole Material Symbols font for 28 icons, where
  their paths are a small TypeScript file.
