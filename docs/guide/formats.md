# Formats and their limits

CanViewer reads DBC with its own parser, and every other format through
[canmatrix](https://github.com/ebroecker/canmatrix), an open-source Python library
that runs inside your browser. Both produce the same model, so every view works for
every format. What differs is how much of a file comes across: that is measured for
each format on real test files, and the numbers are in the
[format reference](../reference/formats.md).

## DBC: complete, instant, with problems per line

DBC files open with CanViewer's own TypeScript parser. It models everything the views
show (messages, signals, multiplexing including `SG_MUL_VAL_`, value tables,
comments, attributes, float and double signals), reports every line it cannot read as
a problem with its line number, and opens a large file in a few tens of milliseconds.
It is tested against 58 real-world databases from carmakers; the
[DBC reference](../reference/dbc.md) lists the statements it supports and the corpus
it is tested against.

## Other formats, through canmatrix

| Format | Extension | Notes |
|---|---|---|
| ARXML (AUTOSAR) | `.arxml` | In AUTOSAR 3 files canmatrix finds frames only when the cluster information is ignored, so CanViewer reads such a file a second time that way, and says so in the problems. Some AUTOSAR 4.2 files fail to read |
| KCD (Kayak) | `.kcd` | A file can hold several buses; see [below](#files-with-several-buses) |
| SYM (PEAK PCAN Symbol Editor) | `.sym` | canmatrix drops multiplexed signals |
| DBF (Busmaster) | `.dbf` | |
| Excel | `.xlsx` | The layout canmatrix itself writes. `.xls` (the old Excel format) is not supported, see [why](#why-no-xls) |
| JSON, YAML | `.json`, `.yaml`, `.yml` | canmatrix's own schema, not an arbitrary JSON or YAML file. The YAML reader read none of canmatrix's own example files |
| FIBEX | `.xml` | The FIBEX reader read none of canmatrix's own example files |
| ODX | `.odx` | Untested: no test file is available |

canmatrix's readers are less complete than CanViewer's DBC parser, and some of their
weaknesses are listed above. Anything canmatrix reports while reading (warnings,
errors, and lines it drops) becomes a [parse problem](./opening-files.md#when-a-line-cannot-be-read),
so a loss is visible rather than silent. CanViewer never fills in a value the file does
not contain.

### The first import downloads the runtime

canmatrix needs a Python runtime (Pyodide, compiled to WebAssembly). It is part of the
app, but the browser fetches it only when the first non-DBC file is opened: about
16 MB for an ARXML file (15,957,759 bytes measured), less where the web host compresses
it. Some formats load a small extra package the first time they are used (YAML 113 kB,
Excel 269 kB). A session that opens only DBC files downloads none of it.

The first import takes a few seconds while the runtime starts; the stages show at the
bottom of the window. The next file opens much faster, and after the first import the
runtime is cached, so imports work offline too.

### Files with several buses

Some formats can describe several buses (clusters) in one file. CanViewer currently
shows the first cluster that has messages.

<!-- TODO(phase-2, W3): a file with several clusters lets you pick one, and an imported
database shows its source format with a note that conversion may be lossy. -->

### Why no `.xls`

canmatrix reads the old Excel format with the library xlrd, whose license has a clause
that is incompatible with CanViewer's license, the GNU GPL. `.xlsx` is read with a
different library and is supported.

## Not supported

- **LIN (`.ldf`)**: canmatrix's LDF reader needs a library that has no WebAssembly
  build.
- **CANopen (`.eds`)**: not part of the formats CanViewer loads.
- **Writing files**: CanViewer is a viewer. See [Exporting](./export.md) and
  [Editing](./editing.md) for what is planned.
