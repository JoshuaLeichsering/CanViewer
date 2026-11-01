# Backlog

Ideas and planned work for CanViewer. Roughly ordered within each section;
move items up/down freely and check them off when done.

## Viewer

- [x] CAN FD polish: verify bit matrix, decoder and warnings for messages with
      DLC > 8 (up to 64 bytes); show FD indicator on messages
- [x] J1939 view: decompose 29-bit IDs into priority / PGN / source address,
      show PGN in the message list for extended frames
- [x] Dark mode (prefers-color-scheme + manual toggle)
- [x] Sortable/filterable columns in the signal table
- [ ] Keyboard navigation (↑/↓ through messages, / to focus search)
- [x] Show which signals use a given value table (VAL_TABLE_ back-references;
      DBC does not record the link, so signals with identical VAL_ maps are shown)
- [x] Virtualize the message tree for very large databases (1000+ messages)

## Compare & export

- [ ] Diff mode: load two DBC versions and highlight added/removed/changed
      messages and signals
- [ ] Export message/signal list as CSV or JSON
- [ ] Copy a message as C struct / decode pseudo-code

## Decode & traces

- [ ] Import a candump / ASC log and replay it through the decoder
      (table of decoded frames over time)
- [ ] Frame encoder: enter physical values per signal, get the hex frame
      (inverse of the decode panel)

## Editing (long term)

- [ ] Edit message/signal properties and write the DBC back out
      (turns the viewer into an editor)

## Infrastructure

- [ ] Error boundary with a "reset stored file" escape hatch
- [ ] Deploy as static site (Gitea Pages / any static host)
- [ ] Optional: package as desktop app (Tauri) for offline/workshop use
- [ ] CI on Gitea Actions: typecheck + tests (incl. submodule corpus) on push
