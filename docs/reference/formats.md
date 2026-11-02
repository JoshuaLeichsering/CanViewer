# Formats and fidelity

How much of a file CanViewer shows depends on the format. DBC is read by CanViewer's
own parser (see [Supported DBC statements](./dbc.md)). Every other format is read by
canmatrix, running under Pyodide, and mapped into the same model. This page measures
those readers on real test files. Every number in the tables below is generated from the
pinned test baselines, so it is what the tests last saw, not an estimate.

## How it is measured

The test corpus is the test files of two open-source projects, vendored as git
submodules under `third_party/`:
[canmatrix](https://github.com/ebroecker/canmatrix) (tag 1.3.3.1, BSD-2-Clause) and
[cantools](https://github.com/cantools/cantools) (tag 45.1.2, MIT). The suite
[`import-corpus.test.ts`](../../app/src/lib/canmatrix/import-corpus.test.ts) reads every
file in a format CanViewer imports through canmatrix, under Pyodide in Node (the runtime
the app uses) with the network blocked, and pins the result in
[`import-corpus-baseline.json`](../../app/src/lib/canmatrix/import-corpus-baseline.json).

Where a file has a **DBC twin**, a DBC file that describes the same database, the suite
also compares the two field by field through CanViewer's model
([`compare.ts`](../../app/src/lib/canmatrix/compare.ts)): the twin read by CanViewer's
parser against the file read by canmatrix. canmatrix's twins are the files in its
`tests/reference/` directories, which an older canmatrix converted from one source file
per format; cantools pairs its files by name. A difference can therefore come from the
reader or from the old conversion. Either way it is pinned, and any change, better or
worse, fails the suite until the baseline is updated on purpose.

## Reading the corpus

One row per format, over every corpus file of that format. *Read* means canmatrix
returned at least one message, *Read, no messages* that it returned a database without
any, and *Failed* that it raised an error. *With reader notes* counts files for which
canmatrix printed warnings or errors; CanViewer shows those as parse problems.

<!-- generated:import-formats -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| Format | Extensions | Corpus files | Read | Read, no messages | Failed | Messages | Signals | With reader notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ARXML (AUTOSAR) | `.arxml` | 28 | 17 | 6 | 5 | 106 | 503 | 18 |
| KCD (Kayak) | `.kcd` | 17 | 14 | 1 | 2 | 359 | 1,076 | 0 |
| SYM (PEAK PCAN Symbol Editor) | `.sym` | 29 | 28 | 1 | 0 | 173 | 817 | 9 |
| DBF (Busmaster) | `.dbf` | 8 | 3 | 0 | 5 | 6 | 6 | 0 |
| Excel | `.xlsx` | 8 | 7 | 0 | 1 | 112 | 619 | 0 |
| JSON (canmatrix) | `.json` | 8 | 6 | 0 | 2 | 88 | 479 | 0 |
| YAML (canmatrix) | `.yaml`, `.yml` | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| FIBEX | `.xml` | 8 | 0 | 0 | 8 | 0 | 0 | 0 |
| ODX | `.odx` | 0 | – | – | – | – | – | – |
| **All formats** |  | **114** | **75** | **8** | **31** | **844** | **3,500** | **27** |

<!-- /generated:import-formats -->

ODX is read by the same adapter, but neither project has an ODX test file, so it is
untested.

## Compared with the DBC twin

How many of the files with a twin come out identical to it, how many differ, and how many
could not be read at all.

<!-- generated:import-twins -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| Format | Files with a DBC twin | Identical to the twin | With differences | Nothing read | Difference lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| ARXML (AUTOSAR) | 8 | 0 | 6 | 2 | 1,360 |
| KCD (Kayak) | 10 | 1 | 7 | 2 | 338 |
| SYM (PEAK PCAN Symbol Editor) | 12 | 0 | 12 | 0 | 765 |
| DBF (Busmaster) | 8 | 1 | 2 | 5 | 10 |
| Excel | 8 | 0 | 7 | 1 | 1,439 |
| JSON (canmatrix) | 8 | 0 | 6 | 2 | 1,304 |
| YAML (canmatrix) | 8 | 0 | 0 | 8 | 8 |
| FIBEX | 8 | 0 | 0 | 8 | 8 |
| **All formats** | **70** | **2** | **40** | **28** | **5,232** |

<!-- /generated:import-twins -->

What differs, by format. Each cell counts the files (out of the number in the column
header) that show at least one difference of that kind.

<!-- generated:import-kinds -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| What differs from the DBC twin | ARXML (8) | KCD (10) | SYM (12) | DBF (8) | Excel (8) | JSON (8) | YAML (8) | FIBEX (8) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nothing read (the reader failed) | 2 | 2 | – | 5 | 1 | 2 | 8 | 8 |
| Message missing | 3 | 3 | 3 | – | 3 | 3 | – | – |
| Message the reader adds | 3 | 3 | 3 | – | 1 | 3 | – | – |
| Message: extended (29-bit) flag | – | – | – | – | 1 | – | – | – |
| Message: name | 6 | 3 | 3 | – | 3 | 3 | – | – |
| Message: DLC | – | – | 4 | – | 2 | – | – | – |
| Message: sender | – | 1 | 3 | – | – | 2 | – | – |
| Message: frame format (classic, CAN FD, J1939) | – | – | – | – | 2 | – | – | – |
| Message: comment | 1 | 1 | 1 | 1 | 5 | 6 | – | – |
| Message: attribute value | 5 | 2 | 3 | – | 3 | 5 | – | – |
| Signal missing | 3 | 3 | 9 | – | 5 | 3 | – | – |
| Signal the reader adds | 3 | 3 | 7 | – | 4 | 3 | – | – |
| Signal: start bit | – | 1 | 2 | – | 1 | – | – | – |
| Signal: byte order | – | 1 | 2 | – | – | – | – | – |
| Signal: value type (signed, unsigned, float) | 3 | 1 | 1 | – | 3 | – | – | – |
| Signal: factor | – | – | – | – | 1 | – | – | – |
| Signal: offset | – | – | – | – | 6 | – | – | – |
| Signal: minimum | 5 | 2 | 1 | – | 4 | 4 | – | – |
| Signal: maximum | 5 | 1 | 1 | – | 6 | 4 | – | – |
| Signal: unit | 5 | – | 3 | – | 4 | 4 | – | – |
| Signal: receivers | – | – | 2 | – | – | 2 | – | – |
| Signal: multiplexing | 2 | – | – | – | 1 | 2 | – | – |
| Signal: value descriptions | 3 | – | 3 | – | 1 | 5 | – | – |
| Signal: comment | 4 | 2 | 1 | 1 | 2 | 6 | – | – |
| Signal: attribute value | 1 | 2 | 1 | – | 1 | 1 | – | – |
| Node missing | – | – | 2 | – | – | 2 | – | – |
| Node the reader adds | – | 1 | – | 1 | – | – | – | – |
| Node: comment | – | 2 | – | – | 2 | – | – | – |
| Node: attribute value | 2 | 2 | – | – | 2 | – | – | – |
| Database: attribute value | – | – | 2 | – | 1 | – | – | – |
| Value table missing | 1 | 1 | – | – | 1 | 1 | – | – |
| Value table the reader adds | – | – | 6 | – | – | – | – | – |
| Attribute definition missing | 5 | 5 | 8 | – | 5 | 5 | – | – |
| Attribute definition the reader adds | 6 | – | 12 | – | 7 | – | – | – |
| Attribute definition: type, range, default or enum values | – | 1 | 1 | 1 | 2 | – | – | – |
| Attribute the reader adds to objects (once per name) | 6 | 1 | 12 | – | 2 | 1 | – | – |

<!-- /generated:import-kinds -->

The differences behind each count are listed, line by line, in the baseline file. Some
patterns stand out:

- **YAML and FIBEX** read none of their eight files: canmatrix's YAML reader cannot load
  the files canmatrix itself wrote in its tests (`could not determine a constructor`),
  and its FIBEX reader fails on all of them (`KeyError: 'CANCHANNEL01'`).
- **SYM** loses signals: canmatrix's SYM reader drops multiplexed signals.
- **ARXML**: canmatrix finds no frames in AUTOSAR 3 files unless the cluster information
  is ignored, so CanViewer reads such a file a second time that way and reports that it
  did. It fails on three of cantools' AUTOSAR 4.2 files.
- **Attribute definitions** differ for most formats because those formats have no such
  concept: the reader invents none, and adds its own (the ARXML reader, for one, adds
  `ISignalName` and others to every signal).

## Every file

<details>
<summary>All corpus files, with what canmatrix read from each</summary>

<!-- generated:import-files -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| File | Format | Clusters | Messages | Signals | Reader notes | Differences from the twin | Error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `canmatrix/tests/files/arxml/ARXMLCompuMethod1.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `canmatrix/tests/files/arxml/ARXMLContainerTest.arxml` | ARXML | 1 | 5 | 10 | 5 |  |  |
| `canmatrix/tests/files/arxml/ARXMLSecuredPDUTest.arxml` | ARXML | 1 | 2 | 2 | – |  |  |
| `canmatrix/tests/files/arxml/ARXML_min_max.arxml` | ARXML | 1 | 1 | 6 | 6 |  |  |
| `canmatrix/tests/files/arxml/MyECU.ecuc.arxml` | ARXML | 1 | 2 | 4 | – |  |  |
| `canmatrix/tests/files/arxml/test.arxml` | ARXML | 1 | 28 | 152 | 1 | 515 |  |
| `canmatrix/tests/files/dbf/test.dbf` | DBF | 1 | 2 | 2 | – | 0 |  |
| `canmatrix/tests/files/json/test.json` | JSON | 1 | 2 | 2 | – | 3 |  |
| `canmatrix/tests/files/kcd/test.kcd` | KCD | 1 | 26 | 157 | – | 23 |  |
| `canmatrix/tests/files/sym/test.sym` | SYM | 1 | 28 | 158 | 4 | 58 |  |
| `canmatrix/tests/files/xlsx/test.xlsx` | Excel | 1 | 27 | 154 | – | 482 |  |
| `canmatrix/tests/reference/from_arxml/test.kcd` | KCD | 1 | 28 | 158 | – | 86 |  |
| `canmatrix/tests/reference/from_arxml/test_CAN.dbf` | DBF | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_arxml/test_CAN.json` | JSON | 1 | 28 | 158 | – | 312 |  |
| `canmatrix/tests/reference/from_arxml/test_CAN.sym` | SYM | 1 | 28 | 157 | 2 | 150 |  |
| `canmatrix/tests/reference/from_arxml/test_CAN.xlsx` | Excel | 1 | 27 | 154 | – | 484 |  |
| `canmatrix/tests/reference/from_arxml/test_CAN.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_arxml/test_CAN.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_dbc/test.arxml` | ARXML | 1 | 2 | 2 | 1 | 35 |  |
| `canmatrix/tests/reference/from_dbc/test.dbf` | DBF | 1 | 2 | 2 | – | 4 |  |
| `canmatrix/tests/reference/from_dbc/test.json` | JSON | 1 | 2 | 2 | – | 17 |  |
| `canmatrix/tests/reference/from_dbc/test.kcd` | KCD | 1 | 2 | 2 | – | 7 |  |
| `canmatrix/tests/reference/from_dbc/test.sym` | SYM | 1 | 2 | 2 | – | 20 |  |
| `canmatrix/tests/reference/from_dbc/test.xlsx` | Excel | 1 | 2 | 2 | – | 13 |  |
| `canmatrix/tests/reference/from_dbc/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_dbc/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_dbf/test.arxml` | ARXML | 1 | 2 | 2 | 1 | 33 |  |
| `canmatrix/tests/reference/from_dbf/test.json` | JSON | 1 | 2 | 2 | – | 17 |  |
| `canmatrix/tests/reference/from_dbf/test.kcd` | KCD | 1 | 2 | 2 | – | 8 |  |
| `canmatrix/tests/reference/from_dbf/test.sym` | SYM | 1 | 2 | 2 | – | 21 |  |
| `canmatrix/tests/reference/from_dbf/test.xlsx` | Excel | 1 | 2 | 2 | – | 15 |  |
| `canmatrix/tests/reference/from_dbf/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_dbf/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_json/test.arxml` | ARXML | 1 | 2 | 2 | 1 | 24 |  |
| `canmatrix/tests/reference/from_json/test.dbf` | DBF | 1 | 2 | 2 | – | 1 |  |
| `canmatrix/tests/reference/from_json/test.kcd` | KCD | 1 | 2 | 2 | – | 0 |  |
| `canmatrix/tests/reference/from_json/test.sym` | SYM | 1 | 2 | 2 | – | 10 |  |
| `canmatrix/tests/reference/from_json/test.xlsx` | Excel | 1 | 2 | 0 | – | 7 |  |
| `canmatrix/tests/reference/from_json/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_json/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_kcd/test.arxml` | ARXML | 1 | 26 | 151 | 1 | 297 |  |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.dbf` | DBF | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.json` | JSON | 1 | 26 | 157 | – | 403 |  |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.sym` | SYM | 1 | 26 | 156 | 2 | 107 |  |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.xlsx` | Excel | 1 | 25 | 153 | – | 153 |  |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_kcd/test_test.kcd.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_sym/test.arxml` | ARXML | 1 | 28 | 152 | 1 | 454 |  |
| `canmatrix/tests/reference/from_sym/test.dbf` | DBF | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_sym/test.json` | JSON | 1 | 28 | 158 | – | 550 |  |
| `canmatrix/tests/reference/from_sym/test.kcd` | KCD | 1 | 28 | 158 | – | 201 |  |
| `canmatrix/tests/reference/from_sym/test.xlsx` | Excel | 1 | 27 | 154 | – | 284 |  |
| `canmatrix/tests/reference/from_sym/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_sym/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_xls/test.arxml` | ARXML | – | 0 | 0 | 1 | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xls/test.dbf` | DBF | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xls/test.json` | JSON | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xls/test.kcd` | KCD | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xls/test.sym` | SYM | 1 | 25 | 153 | – | 171 |  |
| `canmatrix/tests/reference/from_xls/test.xlsx` | Excel | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xls/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_xls/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `canmatrix/tests/reference/from_xlsx/test.arxml` | ARXML | – | 0 | 0 | 1 | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xlsx/test.dbf` | DBF | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xlsx/test.json` | JSON | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xlsx/test.kcd` | KCD | – | 0 | 0 | – | 1 | ArbitrationIdOutOfRange: ID out of range |
| `canmatrix/tests/reference/from_xlsx/test.sym` | SYM | 1 | 25 | 153 | – | 171 |  |
| `canmatrix/tests/reference/from_xlsx/test.xml` | FIBEX | – | 0 | 0 | – | 1 | KeyError: 'CANCHANNEL01' |
| `canmatrix/tests/reference/from_xlsx/test.yaml` | YAML | – | 0 | 0 | – | 1 | ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python… |
| `cantools/tests/files/arxml/compu_method_no_category.arxml` | ARXML | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/arxml/ecu-extract-4.2.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `cantools/tests/files/arxml/system-3.2.3.arxml` | ARXML | 1 | 2 | 13 | 1 |  |  |
| `cantools/tests/files/arxml/system-4.2.arxml` | ARXML | – | 0 | 0 | – |  | AttributeError: 'NoneType' object has no attribute 'text' |
| `cantools/tests/files/arxml/system-DAI-3.1.2.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `cantools/tests/files/arxml/system-bad-root-tag-4.2.arxml` | ARXML | – | 0 | 0 | – |  | AttributeError: 'NoneType' object has no attribute 'getparent' |
| `cantools/tests/files/arxml/system-dangling-reference-4.2.arxml` | ARXML | – | 0 | 0 | – |  | AttributeError: 'NoneType' object has no attribute 'text' |
| `cantools/tests/files/arxml/system-float-limits-missing-compu-scale-4.2.arxml` | ARXML | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/arxml/system-float-values.arxml` | ARXML | 1 | 1 | 2 | – |  |  |
| `cantools/tests/files/arxml/system-illegal-namespace-4.2.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `cantools/tests/files/arxml/system-illegal-root-4.2.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `cantools/tests/files/arxml/system-illegal-version-4.2.2.1.0.arxml` | ARXML | 1 | 0 | 0 | 1 |  |  |
| `cantools/tests/files/arxml/system-missing-denominator-4.2.arxml` | ARXML | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/arxml/system-missing-factor-4.2.arxml` | ARXML | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/arxml/system-missing-rational-4.2.arxml` | ARXML | 1 | 1 | 1 | 1 |  |  |
| `cantools/tests/files/kcd/auto_message_length.kcd` | KCD | 1 | 1 | 3 | – |  |  |
| `cantools/tests/files/kcd/bad_message_length.kcd` | KCD | 1 | 1 | 1 | – | 2 |  |
| `cantools/tests/files/kcd/dump.kcd` | KCD | 1 | 4 | 11 | – |  |  |
| `cantools/tests/files/kcd/empty.kcd` | KCD | 0 | 0 | 0 | – |  |  |
| `cantools/tests/files/kcd/message_layout.kcd` | KCD | 1 | 8 | 16 | – |  |  |
| `cantools/tests/files/kcd/signal_range.kcd` | KCD | 1 | 4 | 4 | – |  |  |
| `cantools/tests/files/kcd/tester.kcd` | KCD | 1 | 3 | 7 | – |  |  |
| `cantools/tests/files/kcd/the_homer.kcd` | KCD | 3 | 33 | 93 | – |  |  |
| `cantools/tests/files/kcd/vehicle.kcd` | KCD | 1 | 217 | 462 | – | 9 |  |
| `cantools/tests/files/sym/bad_message_length.sym` | SYM | 1 | 1 | 0 | – | 11 |  |
| `cantools/tests/files/sym/big-endian.sym` | SYM | 1 | 1 | 6 | – |  |  |
| `cantools/tests/files/sym/comments_hex_and_motorola.sym` | SYM | 1 | 2 | 10 | 2 | 17 |  |
| `cantools/tests/files/sym/empty-6.0.sym` | SYM | 1 | 0 | 0 | – |  |  |
| `cantools/tests/files/sym/empty-enum-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/issue_138.sym` | SYM | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/sym/jopp-5.0.sym` | SYM | 1 | 4 | 4 | 2 |  |  |
| `cantools/tests/files/sym/jopp-6.0.sym` | SYM | 1 | 6 | 1 | 2 |  |  |
| `cantools/tests/files/sym/letter-terminated-can-id-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/min-max-only-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/multiplexed_variables.sym` | SYM | 1 | 1 | 7 | – |  |  |
| `cantools/tests/files/sym/receive-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/send-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/sendreceive-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/signal-types-6.0.sym` | SYM | 1 | 1 | 0 | – |  |  |
| `cantools/tests/files/sym/special-chars-6.0.sym` | SYM | 1 | 1 | 1 | – |  |  |
| `cantools/tests/files/sym/test_extended_id_dump.sym` | SYM | 1 | 2 | 0 | – | 14 |  |
| `cantools/tests/files/sym/test_multiline_enum.sym` | SYM | 1 | 6 | 1 | 2 |  |  |
| `cantools/tests/files/sym/test_multiplex_dump.sym` | SYM | 1 | 1 | 1 | – | 15 |  |
| `cantools/tests/files/sym/type-extended-cycle-dash-p.sym` | SYM | 1 | 1 | 1 | 2 |  |  |
| `cantools/tests/files/sym/variables-color-enum-6.0.sym` | SYM | 1 | 1 | 1 | 4 |  |  |

<!-- /generated:import-files -->

</details>

## DBC through canmatrix

canmatrix can read DBC too, but CanViewer does not use it for DBC: its own parser is more
faithful. The suite [`mapper.test.ts`](../../app/src/lib/canmatrix/mapper.test.ts) shows
how much, by reading the 58 real-world DBC files of the
[DBC corpus](./dbc.md#tested-against-real-world-files) through canmatrix and the mapper,
and comparing the result with CanViewer's own parse of the same file. It pins what
differs in
[`mapper-dbc-baseline.json`](../../app/src/lib/canmatrix/mapper-dbc-baseline.json).

<!-- generated:mapper-summary -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

|  | Files |
| --- | ---: |
| DBC files read through canmatrix | 58 |
| Identical to CanViewer’s parser, no problems | 29 |
| With differences | 29 |
| With problems reported for canmatrix’s output | 11 |
| With lines canmatrix could not read | 8 |

<!-- /generated:mapper-summary -->

<!-- generated:mapper-kinds -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| What canmatrix reads differently | Files | Difference lines |
| --- | ---: | ---: |
| Message missing | 11 | 79 |
| Message the reader adds | 6 | 8 |
| Message: name | 1 | 1 |
| Message: comment | 1 | 6 |
| Message: attribute value | 1 | 1 |
| Signal missing | 1 | 1 |
| Signal the reader adds | 3 | 275 |
| Signal: value descriptions | 1 | 2 |
| Signal: comment | 4 | 16 |
| Node missing | 3 | 10 |
| Node the reader adds | 23 | 151 |
| Attribute definition: type, range, default or enum values | 3 | 23 |

<!-- /generated:mapper-kinds -->

What is behind the largest counts:

- canmatrix's DBC reader **drops lines it cannot read**, printing a message instead of
  failing. When the line is a `BO_`, it then attaches that message's signals to the
  previous message, which is where most *signals the reader adds* come from.
- It **creates a node for every sender** that the file does not declare in `BU_`.
- It drops comments on signals that do not exist (CanViewer reports those as parse
  problems instead) and applies long-name attributes to message names.

<details>
<summary>All 58 files</summary>

<!-- generated:mapper-files -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| File | Differences | Problems | Lines not read | Most frequent difference |
| --- | ---: | ---: | ---: | --- |
| `acura_ilx_2016_nidec.dbc` | – | – | – |  |
| `bmw_e9x_e8x.dbc` | 1 | – | – | Node the reader adds (1) |
| `cadillac_ct6_chassis.dbc` | – | – | – |  |
| `cadillac_ct6_object.dbc` | – | – | – |  |
| `cadillac_ct6_powertrain.dbc` | 1 | – | – | Node the reader adds (1) |
| `chrysler_cusw.dbc` | 4 | 5 | 5 | Message missing (2) |
| `chrysler_pacifica_2017_hybrid_private_fusion.dbc` | – | – | – |  |
| `comma_body.dbc` | 1 | – | – | Node the reader adds (1) |
| `ESR.dbc` | – | – | – |  |
| `fca_giorgio.dbc` | 8 | 1 | 1 | Node the reader adds (7) |
| `FORD_CADS_64.dbc` | 15 | – | – | Attribute definition: type, range, default or enum values (10) |
| `FORD_CADS.dbc` | 15 | – | – | Attribute definition: type, range, default or enum values (10) |
| `ford_cgea1_2_bodycan_2011.dbc` | – | – | – |  |
| `ford_cgea1_2_ptcan_2011.dbc` | – | – | – |  |
| `ford_fusion_2018_adas.dbc` | – | – | – |  |
| `ford_fusion_2018_pt.dbc` | – | – | – |  |
| `ford_lincoln_base_pt.dbc` | 5 | – | – | Attribute definition: type, range, default or enum values (3) |
| `gm_global_a_chassis.dbc` | – | – | – |  |
| `gm_global_a_high_voltage_management.dbc` | – | – | – |  |
| `gm_global_a_lowspeed_1818125.dbc` | – | – | – |  |
| `gm_global_a_lowspeed.dbc` | 13 | 50 | 40 | Message missing (13) |
| `gm_global_a_object.dbc` | 3 | – | – | Message missing (1) |
| `gm_global_a_powertrain_expansion.dbc` | – | – | – |  |
| `gwm_haval_h6_phev_2024.dbc` | 1 | – | – | Node the reader adds (1) |
| `hongqi_hs5.dbc` | – | – | – |  |
| `hyundai_2015_ccan.dbc` | – | – | – |  |
| `hyundai_2015_mcan.dbc` | 2 | – | – | Message missing (1) |
| `hyundai_i30_2014.dbc` | – | – | – |  |
| `hyundai_santafe_2007.dbc` | – | – | – |  |
| `luxgen_s5_2015.dbc` | – | – | – |  |
| `mazda_2017.dbc` | 2 | 1 | – | Signal: value descriptions (2) |
| `mazda_3_2019.dbc` | – | – | – |  |
| `mazda_radar.dbc` | – | – | – |  |
| `mazda_rx8.dbc` | – | – | – |  |
| `mercedes_benz_e350_2010.dbc` | – | – | – |  |
| `Model3CAN.dbc` | 2 | – | – | Message: name (1) |
| `nissan_xterra_2011.dbc` | – | – | – |  |
| `opel_omega_2001.dbc` | – | – | – |  |
| `psa_aee2010_r3.dbc` | 23 | – | – | Node the reader adds (14) |
| `rivian_park_assist_can.dbc` | 1 | – | – | Node the reader adds (1) |
| `rivian_primary_actuator.dbc` | 16 | 1 | – | Signal: comment (13) |
| `tesla_can.dbc` | 5 | 2 | – | Node the reader adds (4) |
| `tesla_model3_party.dbc` | 11 | – | – | Node the reader adds (11) |
| `tesla_model3_vehicle.dbc` | 15 | – | – | Node the reader adds (15) |
| `tesla_powertrain.dbc` | 8 | – | – | Node missing (6) |
| `toyota_2017_ref_pt.dbc` | 294 | 29 | 29 | Signal the reader adds (259) |
| `toyota_adas.dbc` | – | – | – |  |
| `toyota_iQ_2009_can.dbc` | – | – | – |  |
| `toyota_prius_2010_pt.dbc` | 1 | – | – | Node the reader adds (1) |
| `toyota_radar_dsu_tssp.dbc` | – | – | – |  |
| `toyota_tss2_adas.dbc` | – | – | – |  |
| `volvo_v40_2017_pt.dbc` | 2 | 4 | 4 | Node the reader adds (2) |
| `volvo_v60_2015_pt.dbc` | – | – | – |  |
| `vw_meb.dbc` | 62 | 18 | 18 | Node the reader adds (32) |
| `vw_mlb.dbc` | 13 | – | – | Node the reader adds (13) |
| `vw_mqb.dbc` | 9 | – | – | Node the reader adds (5) |
| `vw_mqbevo.dbc` | 26 | 10 | 10 | Node the reader adds (15) |
| `vw_pq.dbc` | 14 | 1 | 1 | Node the reader adds (13) |

<!-- /generated:mapper-files -->

</details>

## Keeping this page current

After a change that alters what a reader produces, the suites fail until their
baselines are regenerated (see [Tests and baselines](../develop/testing.md)). Then
regenerate this page from the new baselines and commit both:

```sh
node scripts/docs/fidelity-tables.mjs
```

[`reference-docs.test.ts`](../../app/src/lib/reference-docs.test.ts) fails while the page
and the baselines disagree.
