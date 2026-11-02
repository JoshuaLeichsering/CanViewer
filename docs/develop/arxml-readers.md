# ARXML readers: canmatrix and cantools compared

**Written** 2026-11-01. CanViewer reads ARXML through canmatrix 1.3.3 under Pyodide
(`app/src/lib/canmatrix/`). cantools reads some of the files canmatrix fails on, so
this report holds the two readers against each other and against the DBC twins on
the corpus. Nothing is switched: replacing canmatrix's ARXML reader is the
maintainer's decision (`docs/handover/2026-11-01-goal.md`, *Authority*).

## The short answer

- **cantools is no replacement.** Of the 28 ARXML files in the corpus, cantools
  refuses 15 and canmatrix 5. canmatrix finds frames in 17 files (106 messages,
  503 signals), cantools in 11 (25 messages, 54 signals, plus one container frame
  with 5 contained PDUs and 20 signals).
- **cantools wins on two files**, both from its own tests:
  - `system-4.2.arxml`, where canmatrix crashes: cantools reads 8 frames with 22
    signals, and a container frame with 5 contained PDUs (20 signals);
  - `ecu-extract-4.2.arxml`, where canmatrix finds no frames: cantools reads 3
    frames with 5 signals.
- **cantools loses whole files that canmatrix reads.** It refuses canmatrix's own
  `test.arxml` (28 frames, 152 signals through canmatrix) and the other
  canmatrix-written AUTOSAR 3 files with repeated short names, crashes on two more,
  and reads `ARXMLSecuredPDUTest.arxml` as empty, without an error.
- **Where both read a file, neither is right throughout.** Against the DBC twins,
  cantools gets a scaling wrong (factor 5 and offset 1 read as 1 and 0) and drops
  three value descriptions that canmatrix keeps. Against each other, cantools has
  the right CAN ids and value types in `MyECU.ecuc.arxml` (canmatrix reads 0 for
  both frames and every signal as signed) and reads limits and a value
  description that canmatrix replaces or drops; canmatrix
  keeps the secured PDUs that cantools misses, and a unit cantools ignores on
  purpose.
- **cantools is stricter, which helps faithfulness.** On the 7 files cantools'
  tests expect to fail, cantools gives a reason each time. canmatrix crashes on 2,
  returns an empty database without an error on 3, and reads 2 with a scaling it
  made up, without a warning.

The options for the maintainer:

1. **Keep canmatrix alone** (today). Nothing changes; the gaps below stay visible
   in the baselines.
2. **Add cantools as a second reader**, used only when canmatrix raises or finds no
   frames. On this corpus that gains `system-4.2.arxml` and `ecu-extract-4.2.arxml`,
   and a reason for 5 files that now come back empty or crash. It costs six more
   packages in the Pyodide download, one of them LGPL-3.0-only, one (bitstruct)
   without a pure-Python wheel, and an older wrapt than Pyodide ships; see
   [What a second reader would cost](#what-a-second-reader-would-cost).
3. **Switch to cantools.** On this corpus it would lose the frames of 8 files that
   canmatrix reads, `test.arxml` among them (2 of the 8 are broken files that
   cantools is right to refuse), and gain 2.

This report recommends option 1 for v0.2.0, and option 2 only if real ARXML files
from users show the `system-4.2.arxml` pattern. One caveat matters for any choice:
the corpus is the two projects' own test files, and each reader does best on its
own. There is no real-world OEM ARXML in it.

## How the comparison was made

- **canmatrix** runs the way the app runs it: canmatrix 1.3.3 under Pyodide,
  through `canviewer_adapter.py`, with its retry without cluster information for
  AUTOSAR 3. Its differences against the twins are the ones pinned in
  `app/src/lib/canmatrix/import-corpus-baseline.json`; the comparison script fails
  if they are not.
- **cantools** is cantools 45.1.2 (the tag of `third_party/cantools`) under CPython
  3.13, in a virtual environment of its own. `scripts/arxml-readers/cantools_dump.py`
  loads each file with `strict=True` (cantools' default) and, if that fails, again
  with `strict=False`; on this corpus the second attempt never helped. It maps
  cantools' model to CanViewer's `DbcDatabase` the way the adapter maps canmatrix's:
  the DBC-as-written start bit, `cycle_time` as `GenMsgCycleTime`, `is_fd` as
  `VFrameFormat`. A minimum or maximum cantools does not have stays empty: nothing
  is filled in.
- **Both** are compared with `compareDatabases()` (`app/src/lib/canmatrix/compare.ts`),
  the comparison that produced the pinned baseline. `scripts/arxml-readers/compare.ts`
  sorts every difference line into one kind:

  | kind | what it covers |
  |---|---|
  | presence | a message or signal only one side has |
  | frame | id (only between the readers, see below), id kind, name, DLC, frame format (classic, FD, J1939) |
  | layout | start bit, length, byte order, value type, multiplexing |
  | scaling | factor, offset, minimum, maximum, unit |
  | no range | a minimum or maximum the compared reading does not have at all |
  | values | value descriptions of a signal, and named value tables |
  | other | senders, receivers, comments, attributes, definitions, nodes |

- **The corpus** is every `.arxml` file under `third_party/canmatrix/tests` (13) and
  `third_party/cantools/tests/files` (15), the files the import corpus suite reads.
  DBC twins exist for 8 of canmatrix's files. All 8 are AUTOSAR 3.2.3 files that an
  older canmatrix wrote from the twin's source, so a difference against a twin can
  come from canmatrix's ARXML writer as well as from the reader. Where the file
  lost something (all units, the signal ranges), both readers miss it.

## What each reader reads

Messages / signals per file, or the error. "Reader crash" marks a file on which
cantools' reader raised an internal error (a `TypeError` or `AttributeError`),
which cantools itself reports as a bug to be filed.

| file | canmatrix | cantools |
|---|---|---|
| canmatrix/tests/files/arxml/ARXMLCompuMethod1.arxml | 0 / 0 | error: 'NoneType' object is not iterable (reader crash) |
| canmatrix/tests/files/arxml/ARXMLContainerTest.arxml | 5 / 10 | error: 'NoneType' object has no attribute 'text' (reader crash) |
| canmatrix/tests/files/arxml/ARXMLSecuredPDUTest.arxml | 2 / 2 | 0 / 0 |
| canmatrix/tests/files/arxml/ARXML_min_max.arxml | 1 / 6 | error: Expected 1 denominator value for linear scaling, but got 2. |
| canmatrix/tests/files/arxml/MyECU.ecuc.arxml | 2 / 4 | 2 / 4 |
| canmatrix/tests/files/arxml/test.arxml | 28 / 152 | error: File contains multiple elements with path '/Cluster/CAN/CAN/FreqVer... |
| canmatrix/tests/reference/from_dbc/test.arxml | 2 / 2 | 2 / 2 |
| canmatrix/tests/reference/from_dbf/test.arxml | 2 / 2 | 2 / 2 |
| canmatrix/tests/reference/from_json/test.arxml | 2 / 2 | 2 / 2 |
| canmatrix/tests/reference/from_kcd/test.arxml | 26 / 151 | error: File contains multiple elements with path '/Cluster/test.kcd/CAN/Fr... |
| canmatrix/tests/reference/from_sym/test.arxml | 28 / 152 | error: File contains multiple elements with path '/Cluster/CAN/CAN/FreqVer... |
| canmatrix/tests/reference/from_xls/test.arxml | error: ArbitrationIdOutOfRange: ID out of range | error: File contains multiple elements with path '/Cluster/CAN/CAN/Enable_... |
| canmatrix/tests/reference/from_xlsx/test.arxml | error: ArbitrationIdOutOfRange: ID out of range | error: File contains multiple elements with path '/Cluster/CAN/CAN/Enable_... |
| cantools/tests/files/arxml/compu_method_no_category.arxml | 1 / 1 | 1 / 1 |
| cantools/tests/files/arxml/ecu-extract-4.2.arxml | 0 / 0 | 3 / 5 |
| cantools/tests/files/arxml/system-3.2.3.arxml | 2 / 13 | 2 / 12 |
| cantools/tests/files/arxml/system-4.2.arxml | error: AttributeError: 'NoneType' object has no attribute 'text' | 8 / 22 (+5 contained PDUs) |
| cantools/tests/files/arxml/system-DAI-3.1.2.arxml | 0 / 0 | 0 / 0 |
| cantools/tests/files/arxml/system-bad-root-tag-4.2.arxml | error: AttributeError: 'NoneType' object has no attribute 'getparent' | error: No XML namespace specified or illegal root tag name '{http://autosa... |
| cantools/tests/files/arxml/system-dangling-reference-4.2.arxml | error: AttributeError: 'NoneType' object has no attribute 'text' | error: Encountered dangling reference FRAME-REF of type "CAN-FRAME": /Pack... |
| cantools/tests/files/arxml/system-float-limits-missing-compu-scale-4.2.arxml | 1 / 1 | 1 / 1 |
| cantools/tests/files/arxml/system-float-values.arxml | 1 / 2 | 1 / 2 |
| cantools/tests/files/arxml/system-illegal-namespace-4.2.arxml | 0 / 0 | error: Unrecognized XML namespace 'http://autosar.org/schema/argh4.0' |
| cantools/tests/files/arxml/system-illegal-root-4.2.arxml | 0 / 0 | error: No XML namespace specified or illegal root tag name '{http://autosa... |
| cantools/tests/files/arxml/system-illegal-version-4.2.2.1.0.arxml | 0 / 0 | error: Could not parse AUTOSAR version '4.2.2.1.0' |
| cantools/tests/files/arxml/system-missing-denominator-4.2.arxml | 1 / 1 | error: Expected 1 denominator value for linear scaling, but got 0. |
| cantools/tests/files/arxml/system-missing-factor-4.2.arxml | 1 / 1 | error: Expected 2 numerator values for linear scaling, but got 1. |
| cantools/tests/files/arxml/system-missing-rational-4.2.arxml | 1 / 1 | 1 / 1 |

In sum:

| | canmatrix | cantools |
|---|---|---|
| files read without an error | 23 | 13 |
| files with at least one frame | 17 | 11 |
| messages / signals | 106 / 503 | 25 / 54, plus 5 contained PDUs with 20 signals |
| files only this reader finds frames in | 8 | 2 |

### Why cantools refuses 15 files

- **7 are its own negative tests**, files cantools' test suite expects to fail
  (`tests/test_database.py`: `test_system_bad_root_tag`,
  `test_system_arxml_traversal`, `test_illegal_namespace`, `test_illegal_root`,
  `test_illegal_version`, `test_system_missing_denominator_arxml`,
  `test_system_missing_factor_arxml`).
- **5 repeat a short name** within one package ("File contains multiple elements
  with path ..."): `test.arxml` and the `from_kcd`, `from_sym`, `from_xls` and
  `from_xlsx` reference files. AUTOSAR requires short names to be unique there;
  canmatrix's ARXML writer names each `I-SIGNAL-TRIGGERING` after its signal, so a
  signal name used in two frames (`FreqVeryLo` in `test.arxml`) appears twice.
  cantools refuses the whole file; canmatrix tolerates it.
- **1 has two denominator values** (`ARXML_min_max.arxml`). canmatrix logs
  "invalid rational coefficients ... Replacing with factor=1 and offset=0", a
  visible problem in CanViewer.
- **2 crash cantools' reader**: `ARXMLCompuMethod1.arxml` (`TypeError` in
  `_load_buses`: `'NoneType' object is not iterable`) and
  `ARXMLContainerTest.arxml` (`AttributeError` in `_load_pdu`, reading the header
  id of a contained PDU that has none). Both are cantools bugs; reporting them
  would be a separate decision.

### Why canmatrix refuses 5 files, or reads them as empty

- `system-4.2.arxml`: canmatrix raises `AttributeError` in
  `get_frame_from_multiplexed_ipdu` (`arxml.py`, line 1590) because the
  multiplexed PDU has no `SELECTOR-FIELD-BYTE-ORDER`. cantools' own test of this
  file (`test_system_4_arxml`) checks its reading field by field.
- `from_xls/test.arxml` and `from_xlsx/test.arxml`: `ArbitrationIdOutOfRange`, a
  29-bit id marked as a standard one (`CAN-ADDRESSING-MODE` `STANDARD` with
  `IDENTIFIER` 16751425).
- `system-bad-root-tag-4.2.arxml` and `system-dangling-reference-4.2.arxml`:
  `AttributeError` crashes instead of a reason.
- No frames and no error in 6 files: `ARXMLCompuMethod1.arxml` (it holds a
  compu method only), `ecu-extract-4.2.arxml`, `system-DAI-3.1.2.arxml` (cantools
  finds none either), and the illegal namespace, root and version files, which
  cantools rejects with the reason. CanViewer shows an empty database with the
  adapter's note that it retried without cluster information.

## Against the DBC twins

Difference lines per kind. The twin column gives the twin's messages / signals.

| file | twin | reader | read | presence | frame | layout | scaling | no range | values | other |
|---|---|---|---|---|---|---|---|---|---|---|
| canmatrix/tests/files/arxml/test.arxml | 28 / 158 | canmatrix | 28 / 152 | 22 | 1 | 143 | 286 | 0 | 4 | 59 |
| canmatrix/tests/files/arxml/test.arxml | 28 / 158 | cantools | error: File contains multiple elements with path '/Cluster/CAN/CAN/FreqVer... |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_dbc/test.arxml | 2 / 2 | canmatrix | 2 / 2 | 0 | 2 | 0 | 5 | 0 | 0 | 28 |
| canmatrix/tests/reference/from_dbc/test.arxml | 2 / 2 | cantools | 2 / 2 | 0 | 2 | 0 | 4 | 4 | 1 | 6 |
| canmatrix/tests/reference/from_dbf/test.arxml | 2 / 2 | canmatrix | 2 / 2 | 0 | 2 | 0 | 5 | 0 | 0 | 26 |
| canmatrix/tests/reference/from_dbf/test.arxml | 2 / 2 | cantools | 2 / 2 | 0 | 2 | 0 | 4 | 4 | 1 | 4 |
| canmatrix/tests/reference/from_json/test.arxml | 2 / 2 | canmatrix | 2 / 2 | 0 | 2 | 0 | 2 | 0 | 0 | 20 |
| canmatrix/tests/reference/from_json/test.arxml | 2 / 2 | cantools | 2 / 2 | 0 | 2 | 0 | 4 | 4 | 0 | 0 |
| canmatrix/tests/reference/from_kcd/test.arxml | 26 / 157 | canmatrix | 26 / 151 | 22 | 25 | 58 | 148 | 0 | 2 | 42 |
| canmatrix/tests/reference/from_kcd/test.arxml | 26 / 157 | cantools | error: File contains multiple elements with path '/Cluster/test.kcd/CAN/Fr... |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_sym/test.arxml | 28 / 158 | canmatrix | 28 / 152 | 22 | 27 | 61 | 197 | 0 | 22 | 125 |
| canmatrix/tests/reference/from_sym/test.arxml | 28 / 158 | cantools | error: File contains multiple elements with path '/Cluster/CAN/CAN/FreqVer... |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_xls/test.arxml | 25 / 153 | canmatrix | error: ArbitrationIdOutOfRange: ID out of range |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_xls/test.arxml | 25 / 153 | cantools | error: File contains multiple elements with path '/Cluster/CAN/CAN/Enable_... |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_xlsx/test.arxml | 25 / 153 | canmatrix | error: ArbitrationIdOutOfRange: ID out of range |  |  |  |  |  |  |  |
| canmatrix/tests/reference/from_xlsx/test.arxml | 25 / 153 | cantools | error: File contains multiple elements with path '/Cluster/CAN/CAN/Enable_... |  |  |  |  |  |  |  |

cantools reads 3 of the 8 twins' files, canmatrix 6. On the 3 both read
(`from_dbc`, `from_dbf`, `from_json`, 2 messages and 2 signals each):

- **Counts and layout agree with the twin for both:** every message and signal is
  found (presence 0), and start bit, length, byte order and value type match
  (layout 0).
- **Frame names** differ for both alike: the file names its frames
  `FRAME_testFrame1` and `FRAME_extendedFrame`, the twin `testFrame1` and
  `extendedFrame` (frame 2).
- **Scaling: canmatrix is right, cantools is not.** `someTestSignal` has factor 5
  and offset 1 in the twin and in the file's `COMPU-METHOD`, which has no
  `CATEGORY`. canmatrix reads 5 and 1; cantools reads 1 and 0, in all three files:

  ```text
  0x123 testFrame1 / someTestSignal: factor 5 -> 1
  0x123 testFrame1 / someTestSignal: offset 1 -> 0
  ```

  The rest of the scaling lines are the file's own losses, the same for both
  readers: the writer left out the units (no `UNIT-REF`, so `"specialCharUnit°$"`
  and `"someUnit"` become `""`) and the signal ranges. Where the range is gone,
  canmatrix computes one from the raw range (`[0|500]` in the twin becomes
  `[1|10236]`, that is 0 to 2047 raw times 5 plus 1), and cantools has none (no
  range 4).
- **Values: canmatrix keeps all, cantools drops three.** In `from_dbc` and
  `from_dbf`, cantools loses the value descriptions of `Signal` (`1 "one"`,
  `2 "two"`, `3 "three"`), again a `COMPU-METHOD` without `CATEGORY`:

  ```text
  0x123 testFrame1 / Signal: values 3 entries -> 0 entries
  ```

- **Other:** most of canmatrix's 20 to 28 lines are attributes its ARXML reader
  adds (`ISignalName`, `SysSignalName`, `CompuMethodName`, `PduName`,
  `FrameTriggeringName`, `GenMsgSendType`, `GenMsgStartValue`) and their
  definitions. cantools adds none. Both miss `GenMsgCycleTime` and the node
  attribute `NetworkNode` where the twin (`from_dbc`) has them.

On the larger twins only canmatrix has a reading. Its differences are pinned in
the import baseline. The biggest groups in `test.arxml` are 143 signals that the
twin has as signed and canmatrix reads as unsigned, with the ranges that follow
(143 minimum and 143 maximum lines, such as `-2` to `1` against `0` to `3`). Its
22 presence lines are 13 twin signals that the reading lacks against 7 it has
instead, mostly the same signals under the ARXML name (`RealPower command` for
`RealPower_command`, one `FreqHi` where the twin has `FreqHi0` and `FreqHi1`), and
2 message lines at `0xCFFCAF7`. That id belongs to two frames, in the twin and in
the file alike: `FRAME_MasterMeasuredPowerAPU2` and `FRAME_StatusMeasuredPower`.
canmatrix reads both, but `compareDatabases()` pairs messages by id, and with two
frames on one id it pairs the twin's `FRAME_MasterMeasuredPowerAPU2` with the
reading's `FRAME_StatusMeasuredPower` (the 1 frame line, a name difference), then
counts the twin's `FRAME_StatusMeasuredPower` as missing and the reading's
`FRAME_MasterMeasuredPowerAPU2` as extra. Those 2 lines are an artefact of the
comparison, not a loss.

## cantools against canmatrix

On the 11 files where at least one reader finds frames and neither fails,
canmatrix's reading is the reference: "presence" counts what only one of them has.
`compareDatabases()` pairs messages by id, so before it runs, `compare.ts` pairs
the frames the two readers give different ids by name (where the name is unique
on both sides); the id difference then counts as one frame line per frame, and
the signals of such frames are compared like any others.

| file | canmatrix | cantools | presence | frame | layout | scaling | no range | values | other |
|---|---|---|---|---|---|---|---|---|---|
| canmatrix/tests/files/arxml/ARXMLSecuredPDUTest.arxml | 2 / 2 | 0 / 0 | 2 | 0 | 0 | 0 | 0 | 0 | 17 |
| canmatrix/tests/files/arxml/MyECU.ecuc.arxml | 2 / 4 | 2 / 4 | 0 | 2 | 4 | 0 | 8 | 0 | 0 |
| canmatrix/tests/reference/from_dbc/test.arxml | 2 / 2 | 2 / 2 | 0 | 0 | 0 | 2 | 4 | 1 | 31 |
| canmatrix/tests/reference/from_dbf/test.arxml | 2 / 2 | 2 / 2 | 0 | 0 | 0 | 2 | 4 | 1 | 31 |
| canmatrix/tests/reference/from_json/test.arxml | 2 / 2 | 2 / 2 | 0 | 0 | 0 | 2 | 4 | 0 | 27 |
| cantools/tests/files/arxml/compu_method_no_category.arxml | 1 / 1 | 1 / 1 | 0 | 0 | 0 | 0 | 2 | 0 | 22 |
| cantools/tests/files/arxml/ecu-extract-4.2.arxml | 0 / 0 | 3 / 5 | 3 | 0 | 0 | 0 | 0 | 0 | 13 |
| cantools/tests/files/arxml/system-3.2.3.arxml | 2 / 13 | 2 / 12 | 3 | 0 | 5 | 0 | 20 | 3 | 55 |
| cantools/tests/files/arxml/system-float-limits-missing-compu-scale-4.2.arxml | 1 / 1 | 1 / 1 | 0 | 0 | 0 | 1 | 0 | 1 | 20 |
| cantools/tests/files/arxml/system-float-values.arxml | 1 / 2 | 1 / 2 | 0 | 0 | 0 | 2 | 0 | 0 | 29 |
| cantools/tests/files/arxml/system-missing-rational-4.2.arxml | 1 / 1 | 1 / 1 | 0 | 0 | 0 | 1 | 0 | 0 | 20 |

What the file says, case by case:

- **`MyECU.ecuc.arxml`, an ECU configuration: cantools is right twice.**
  - CAN ids: canmatrix reads both frames with id 0. cantools reads 0x210 and
    0x200, the file's `CanIfRxPduCanId` (528) and `CanIfTxPduCanId` (512)
    (frame 2).
  - Value types: start bit, length and byte order of the 4 signals agree, but
    the file declares them `UINT8`, `UINT8`, `BOOLEAN` and `UINT8`
    (`ComSignalType`). cantools reads them as unsigned; canmatrix reads them as
    signed (layout 4) and computes a range of -1 to 0 for each 1-bit signal,
    where cantools gives none (no range 8). canmatrix's ECUC reader
    (`ecuc_extract_signal()` in `arxml.py`) reads `ComSignalType` but never
    passes it on, so every signal gets `Signal`'s default, signed, and
    `extract_cm_from_ecuc()` creates every frame without its CAN id, so with
    canmatrix's default of 0.
- **`system-3.2.3.arxml`, byte order: the file leaves it open.** Five signals
  have no `PACKING-BYTE-ORDER`. canmatrix takes them as big endian, logging that
  only at debug level, so CanViewer shows no problem; cantools takes them as
  little endian, as its own test of this file expects (layout 5).
- **`system-3.2.3.arxml`, multiplexing: both make up a selector.** The file
  describes the selector as a field of the multiplexed PDU, and also maps an
  I-signal `Selector` onto the same bits in each dynamic PDU. canmatrix adds a
  signal `Multiplexor` (signed, range -2 to 1) and keeps `Selector` as a signal
  of mux value 0 only; cantools adds `Multiplexed_selector1` and leaves `Selector`
  out (presence 3: 13 against 12 signals).
- **`system-3.2.3.arxml`, value descriptions: both are in the file.** Each
  `COMPU-SCALE` of `Position` has a `SHORT-LABEL` (`StandardPosition`) and a
  `VT` (`STANDARD_POSITION`). canmatrix shows the label, cantools the text value
  (values 3).
- **Ranges the file does not give** (no range 8, 4, 4, 4, 2 and 20): cantools leaves
  the minimum and maximum out, canmatrix computes them from the raw range. In
  CanViewer a computed range looks like one the file gave.
- **`system-missing-rational-4.2.arxml`, maximum: cantools is right.** The file
  gives limits 0 to 4 and no coefficients. cantools reads a maximum of 4 (its test
  expects 4.0), canmatrix 7, the raw range of 3 bits, and logs "Unknown
  Compu-Method".
- **`system-float-limits-missing-compu-scale-4.2.arxml`: cantools is right.** The
  linear scale's limits are 0.0 to 1.0, so cantools reads a maximum of 1 where
  canmatrix computes 255. A text-table entry without a lower limit (`2`,
  `INVALID`) is kept by cantools and dropped by canmatrix without a warning.
- **`system-float-values.arxml`, unit: canmatrix shows what the file says.** The
  unit is called `NoUnit`. canmatrix shows it; cantools drops it on purpose (an
  ignore list in its system loader).
- **`ARXMLSecuredPDUTest.arxml`: canmatrix is right.** canmatrix reads both frames
  of the secured PDUs; cantools reads none and reports nothing.
- **`ecu-extract-4.2.arxml`: cantools is right.** An ECU extract: cantools reads 3
  frames (its test checks them), canmatrix none, even after the adapter's retry.
- **Other** (13 to 55 lines): canmatrix's own attributes and their definitions,
  which cantools does not produce, and on `system-3.2.3.arxml` the nodes
  `Driver` and `Passenger`, which cantools reads and canmatrix does not.

### Broken files: who reports what

The 7 files cantools' tests expect to fail, and what CanViewer would show for them
today:

| file | cantools | canmatrix |
|---|---|---|
| system-bad-root-tag-4.2.arxml | error: illegal root tag name | crash (`AttributeError`) |
| system-dangling-reference-4.2.arxml | error: dangling reference FRAME-REF | crash (`AttributeError`) |
| system-illegal-namespace-4.2.arxml | error: unrecognized XML namespace | 0 frames, no error |
| system-illegal-root-4.2.arxml | error: illegal root tag name | 0 frames, no error |
| system-illegal-version-4.2.2.1.0.arxml | error: could not parse AUTOSAR version | 0 frames, no error |
| system-missing-denominator-4.2.arxml | error: expected 1 denominator value, got 0 | factor 10 (a denominator of 1 assumed), no warning |
| system-missing-factor-4.2.arxml | error: expected 2 numerator values, got 1 | factor 1, no warning |

The last two rows are the worst case for *faithful*: canmatrix fills in a value the
file does not have, and nothing says so.

## What a second reader would cost

If cantools were added for the files canmatrix cannot read (option 2), the
Pyodide download would grow by these packages (sizes of the PyPI wheels):

| package | version | license | wheel |
|---|---|---|---|
| cantools | 45.1.2 | MIT | 170,518 bytes |
| python-can | 4.6.1 | LGPL-3.0-only | 276,996 bytes |
| bitstruct | 8.24.0 | MIT | no pure-Python wheel on PyPI (sdist only, 35,769 bytes) |
| crccheck | 1.3.1 | MIT | 24,608 bytes |
| textparser | 0.26.2 | MIT | 9,638 bytes |
| argparse_addons | 0.12.0 | MIT | 3,310 bytes |

- python-can is needed even to read files: `import cantools` imports
  `cantools.tester`, which imports `can` (checked: without python-can,
  `import cantools` fails with `ModuleNotFoundError: No module named 'can'`). It
  needs packaging and typing_extensions, which Pyodide 314.0.7 provides, and
  `wrapt~=1.10`, while Pyodide ships wrapt 2.1.2: a wrapt 1.x wheel would be
  needed too (1.17.3 has a pure-Python one, 23,591 bytes).
- LGPL-3.0-only code can be combined with GPL code only under GPL version 3 or
  later, so, like the Apache-2.0 parts, it would rely on the "or later" of
  GPL-2.0-or-later. It would need an entry in the license audit
  (`docs/handover/2026-11-01-license-audit.md`).
- bitstruct would need a Pyodide build of its own, or a check that its
  pure-Python code path works there.
- The adapter would need a second mapping (the one in `cantools_dump.py` is a
  start) and its own problem reporting, and the corpus suite a second baseline.
- None of this changes the DBC path: CanViewer's own parser stays in charge of
  `.dbc`.

## Findings for CanViewer, whatever the decision

These came up during the comparison and are not about switching readers:

- **Contained PDUs were dropped without a problem.** canmatrix keeps a container
  frame's contained PDUs in `frame.pdus`, which `canviewer_adapter.py` does not
  map. In `ARXMLContainerTest.arxml`, CanViewer shows the header signals of 4
  container frames and loses 12 contained PDUs with 22 signals. That broke
  *faithful*; the adapter now adds an import note for each such frame (for
  example "frame TestFrame holds 3 contained PDUs with 9 signals, which CanViewer
  does not show"), pinned in the import baseline. Showing the contained PDUs
  would need a place for them in CanViewer's model.
- **A missing `PACKING-BYTE-ORDER` becomes big endian silently.** canmatrix logs
  it at debug level only, below the adapter's WARNING threshold.
- **A broken `COMPU-METHOD` gets an assumed scaling silently** (the
  missing-denominator and missing-factor files above).
- **ECU configuration files lose their ids and value types silently.** In
  `MyECU.ecuc.arxml`, canmatrix gives both frames id 0 and makes every signal
  signed (above), and CanViewer shows no problem for either.
- **Computed ranges look like given ones.** canmatrix fills in a range from the
  raw value range when a file gives none, the same way it fills in an initial
  value; the adapter already leaves the invented initial value out.

These four are still silent, and each is in [`BACKLOG.md`](../../BACKLOG.md) under
Formats: reporting them needs the adapter to see what canmatrix does not report
(a debug message, a scaling it assumed, a range it computed), or an upstream change.

## Reproduce

With the submodules checked out and the wheels in `vendor/pyodide`:

```sh
python3 -m venv <scratch>/venv
<scratch>/venv/bin/pip install cantools==45.1.2
<scratch>/venv/bin/python -I scripts/arxml-readers/cantools_dump.py third_party <scratch>/cantools.json
npx vite-node scripts/arxml-readers/compare.ts -- <scratch>/cantools.json <scratch>/details.json
```

`cantools_dump.py` prints `cantools 45.1.2: 28 ARXML files, 13 read`. The second
command prints the tables above, after
`28 ARXML files; canmatrix side equal to the pinned baseline for 8 twins`, and
writes every difference line to `details.json`.
