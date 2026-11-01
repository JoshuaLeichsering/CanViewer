# Importing other formats

<!-- TODO(phase-2, W3): complete this page with the import UI: every format in the file
dialog, picking one of several clusters, the source format with its "conversion may be
lossy" note linking to the problems, and imported files restored on reload. Replace the
screenshot with one from scripts/screenshots.mjs that shows these. -->

Files in formats other than DBC are read by [canmatrix](./formats.md#other-formats-through-canmatrix),
which runs in your browser. Drop such a file onto the window and CanViewer imports it
into the same model as a DBC file, so every view works with it.

![test.arxml from canmatrix's test files, imported](./images/import-en-light.webp#gh-light-mode-only)
![test.arxml from canmatrix's test files, imported](./images/import-en-dark.webp#gh-dark-mode-only)

## What happens on import

1. **Loading the Python runtime**: the first import of a session starts Pyodide in a
   Web Worker. The first time ever, the browser downloads it (about 16 MB); after that
   it comes from the cache.
2. **Loading format support**: the packages the format needs, such as the XML library
   for ARXML, KCD and FIBEX.
3. **Reading the file with canmatrix**, and mapping what it read into CanViewer's model.

Each stage shows at the bottom of the window. If the import fails, a message there
says why, and the file that was open before stays open.

## What you get

- The database as canmatrix read it. Where a format can describe several buses, the
  first one with messages is shown.
- Every warning or error canmatrix reported, and every line it dropped, as a parse
  problem on the [overview](./overview.md). The screenshot above shows one: the file
  was read a second time with the cluster information ignored.
- No invented values: what the file does not say stays empty.

How well each format comes across is in the [format reference](../reference/formats.md).

## Current limits

- The file dialog offers only `.dbc`, `.txt` and `.arxml`; drag and drop takes every
  format.
- An imported file does not come back after a reload.
