# Importing other formats

Files in formats other than DBC are read by [canmatrix](./formats.md#other-formats-through-canmatrix),
which runs in your browser. Open such a file with **Open file…**, whose dialog offers
every format, or drop it onto the window, and CanViewer imports it into the same model
as a DBC file, so every view works with it.

![test.arxml from canmatrix's test files, imported](./images/import-en-light.webp#gh-light-mode-only)
![test.arxml from canmatrix's test files, imported](./images/import-en-dark.webp#gh-dark-mode-only)

## What happens on import

1. **Loading the Python runtime**: the first import of a session starts Pyodide in a
   Web Worker. The first time ever, the browser downloads it (about 16 MB); after that
   it comes from the cache.
2. **Loading format support**: the packages the format needs, such as the XML library
   for ARXML, KCD and FIBEX.
3. **Reading the file with canmatrix**, and mapping what it read into CanViewer's model.

Each stage shows at the bottom of the window, from the first moment to the last, with
the format's extra package named (such as *lxml* or *openpyxl*). If the import fails, a
message there says why, and the file that was open before stays open.

When CanViewer knows the reason, it says it in your language: *canmatrix found no CAN
database in this file*, or that the Python runtime or a format's support could not be
loaded because the browser is offline and has never downloaded it (both are downloaded
with their first use and work offline from then on; try again once online). Errors of
canmatrix's own readers are shown as canmatrix wrote them. On the overview's list of
parse problems, the reason column is in your language (for example *Warnung von
canmatrix* for a warning canmatrix logged), and the line or message next to it stays as
canmatrix wrote it. CanViewer's own notes about an import (*Hinweis zum Import*), such
as a frame whose contained PDUs it does not show, are in your language too.

## What you get

- The database as canmatrix read it.
- **Its source**, on the [overview](./overview.md): *Imported from ARXML* (or the format
  it came in), with a note that the conversion to CanViewer's model may be lossy, and a
  link to the problems canmatrix reported.
- **A choice of cluster.** Where a file describes several buses (clusters), as ARXML,
  KCD and FIBEX files can, the overview lists them, and you pick the one to show. The
  first one with messages is shown to start with. cantools' `the_homer.kcd` holds three:

  ![The source card of the_homer.kcd: imported from KCD, with its clusters Motor, Instrumentation and Comfort](./images/clusters-en-light.webp#gh-light-mode-only)
  ![The source card of the_homer.kcd: imported from KCD, with its clusters Motor, Instrumentation and Comfort](./images/clusters-en-dark.webp#gh-dark-mode-only)

- Every warning or error canmatrix reported, and every line it dropped, as a parse
  problem on the overview. The screenshot at the top of this page (`test.arxml`) shows
  one: the file was read a second time with the cluster information ignored.
- No invented values: what the file does not say stays empty.

## The file comes back

An imported file is restored when you reload the page or open the app again, like a
DBC file: CanViewer keeps its bytes in your browser's IndexedDB, on your machine only,
with the cluster you picked and the view you were on. A restore reads the file through
canmatrix again, so it needs the runtime too; offline, that works once the runtime and
the format's support have been downloaded before.

How well each format comes across is in the [format reference](../reference/formats.md).

## Limits

- One cluster is shown at a time. [Comparing](./diff.md) two clusters of one file is not
  possible; compare two files instead.
- What canmatrix does not read, CanViewer cannot show: the
  [format reference](../reference/formats.md) measures it for each format.
