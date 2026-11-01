# Opening files

![The welcome screen, with Open file… and the drop zone](./images/welcome-en-light.webp#gh-light-mode-only)
![The welcome screen, with Open file… and the drop zone](./images/welcome-en-dark.webp#gh-dark-mode-only)

## Three ways to open a file

- **Open file…** on the welcome screen, or the round upload button at the top of the
  navigation rail, opens your system's file dialog.
- **Drag and drop**: drop a file anywhere on the window. While you drag, an overlay
  says *Drop the file to open it*.
- **Reload**: the last DBC file you opened comes back when you reload the page or open
  the app again (see [below](#the-last-file-comes-back)).

Only one file is open at a time; opening another replaces it.

<!-- TODO(phase-2, W3): the file dialog accepts every format and a file with several
clusters lets you pick one. Update the two lists below when the import UI lands. -->

Which files go where:

- A file whose extension is one that canmatrix reads (`.arxml`, `.kcd`, `.sym`, `.dbf`,
  `.xlsx`, `.json`, `.yaml`, `.yml`, `.xml` for FIBEX, `.odx`) is imported through
  canmatrix. See [Importing other formats](./import.md).
- Every other file is read as DBC text, whatever its extension (`.dbc`, `.txt`, or
  none).
- The file dialog currently offers `.dbc`, `.txt` and `.arxml` files. Drag and drop
  takes every format.

## Encodings

DBC files come in two encodings in practice: UTF-8, and the Windows code page that
Vector's tools write (Windows-1252, a superset of Latin-1). CanViewer reads a file as
UTF-8 when its bytes are valid UTF-8, and as Windows-1252 otherwise, so umlauts in
comments and value descriptions come out right either way.

## When a line cannot be read

CanViewer does not give up on a file because of one bad line. A line it cannot
understand is skipped and recorded as a **parse problem**, with its line number, the
reason and the line itself; everything else loads normally. The number of problems
shows as a badge on **Overview** in the navigation rail, and the overview lists them:

![The overview of vw_mqb.dbc from opendbc, listing 17 parse problems](./images/problems-en-light.webp#gh-light-mode-only)
![The overview of vw_mqb.dbc from opendbc, listing 17 parse problems](./images/problems-en-dark.webp#gh-dark-mode-only)

Statements that CanViewer recognizes but does not display, such as `NS_` or
`SIG_GROUP_`, are not problems: the overview counts them under *Not displayed*. The
[DBC reference](../reference/dbc.md) lists what is modelled and what is not.

For imported formats, whatever canmatrix reports about the file (warnings, errors, and
lines its own readers drop) becomes a parse problem in the same list.

## The last file comes back

The last DBC file you opened is kept in your browser's local storage, on your machine
only, and opened again on the next visit. Two limits:

- A file too large for the browser's storage quota is not kept. It opens normally, it
  just does not come back after a reload.
- Files imported through canmatrix are not kept yet; opening one forgets the stored DBC
  file, so that a reload does not show a different file.

<!-- TODO(phase-2, W3): imported files are restored from IndexedDB on reload. -->

## Links to a message

Every view has its own address: the part after `#` in the address bar names the
message, node or value table on screen, for example `#msg=256/EngineSpeed`. Bookmark it,
or use **Copy link** on a message page. Opening such a link restores the stored file and
goes straight to that view. The [deep link reference](../reference/deep-links.md) lists
the forms.

A link only works in a browser that has the file stored: the file itself is never part
of the link.
