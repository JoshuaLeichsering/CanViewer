# Supported DBC statements

CanViewer reads DBC files with its own parser,
[`parser.ts`](../../app/src/lib/dbc/parser.ts), into the model in
[`types.ts`](../../app/src/lib/dbc/types.ts) that every view uses.

## Modelled

| Statement | What CanViewer reads from it |
|---|---|
| `VERSION` | The version string, shown on the overview |
| `BU_` | The nodes (ECUs) |
| `BO_` | Messages: ID (with the extended-frame flag, bit 31), name, DLC, sender |
| `SG_` | Signals: start bit, length, byte order, signedness, factor, offset, range, unit, receivers, multiplexing (`M`, `m<N>`, and `m<N>M` for extended multiplexing) |
| `BO_TX_BU_` | Further transmitters of a message |
| `CM_` | Comments on the network, nodes, messages and signals, multi-line ones included |
| `VAL_` | A signal's value descriptions |
| `VAL_TABLE_` | Named value tables |
| `BA_DEF_` | Attribute definitions: object type, value type (`INT`, `HEX`, `FLOAT`, `STRING`, `ENUM`), range, enum values |
| `BA_DEF_DEF_` | Attribute defaults |
| `BA_` | Attribute values on the network, nodes, messages and signals; `ENUM` indexes are resolved to their labels |
| `SIG_VALTYPE_` | Float (32-bit) and double (64-bit) signals |
| `SG_MUL_VAL_` | Extended multiplexing: the switch signal and value ranges that activate a signal |

Statements that may wrap across lines (`CM_`, `BA_DEF_`, `BA_DEF_DEF_`, `BA_`, `VAL_`,
`VAL_TABLE_` and the other `;`-terminated ones) are joined before parsing. The parser
accepts UTF-8 and Windows-1252 files (see [Encodings](../guide/opening-files.md#encodings)).

## Recognized, not modelled

These statements are valid DBC, but no view shows them. CanViewer counts them and lists
them on the overview under *Not displayed*, instead of reporting them as problems:

`NS_`, `NS_DESC_`, `BS_`, `EV_`, `ENVVAR_DATA_`, `EV_DATA_`, `SGTYPE_`, `SGTYPE_VAL_`,
`BA_DEF_SGTYPE_`, `BA_SGTYPE_`, `SIG_TYPE_REF_`, `SIG_GROUP_`, `SIGTYPE_VALTYPE_`,
`BA_DEF_REL_`, `BA_DEF_DEF_REL_`, `BA_REL_`, `BU_SG_REL_`, `BU_EV_REL_`, `BU_BO_REL_`,
`CAT_DEF_`, `CAT_` and `FILTER`.

That covers environment variables, signal types and groups, relation attributes
(attributes on a node-signal or node-message pair) and categories.

## What becomes a problem

Anything else is reported as a parse problem with its line number, and the rest of the
file loads normally:

- a statement CanViewer does not know (*unrecognized statement*);
- a statement it knows but cannot read (*malformed …*), such as an `SG_` line that does
  not follow the grammar, or a signal with an invalid start bit or length;
- a reference to something that does not exist (*… references unknown …*), such as a
  `CM_`, `VAL_`, `BA_` or `SIG_VALTYPE_` statement for a signal, message or node the
  file does not define;
- a second message with an ID that is already taken (comments and attributes attach to
  the first).

## Tested against real-world files

The corpus suite, [`corpus.test.ts`](../../app/src/lib/dbc/corpus.test.ts), parses 58
DBC files from carmakers: the databases of
[commaai/opendbc](https://github.com/commaai/opendbc) and
[joshwardell/model3dbc](https://github.com/joshwardell/model3dbc), from Toyota, Tesla,
BMW, Mercedes, VW, Ford, GM, Hyundai, Mazda, Chrysler, Volvo, PSA, Nissan, Rivian and
more. Every file must parse without problems, except for a pinned list of genuine
inconsistencies in the upstream files (comments that name signals which were renamed or
removed). What the parser makes of each file is pinned in
[`corpus-baseline.json`](../../app/src/lib/dbc/corpus-baseline.json), including a
SHA-256 of the whole parsed model, so any change to how a file parses fails the suite.

Totals over the corpus:

<!-- generated:dbc-corpus -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

|  | Corpus total |
| --- | ---: |
| Files | 58 |
| Messages | 4,167 |
| Extended (29-bit) messages | 448 |
| CAN FD messages | 413 |
| J1939 parameter groups | 0 |
| Signals | 33,651 |
| Multiplexor signals | 61 |
| Multiplexed signals | 1,891 |
| Signals with extended multiplexing (`SG_MUL_VAL_`) | 18 |
| Float and double signals (`SIG_VALTYPE_`) | 0 |
| Signals with value descriptions | 6,427 |
| Signals with a comment | 1,272 |
| Nodes | 395 |
| Value tables | 958 |
| Attribute definitions | 284 |
| Files with parse problems | 7 |
| Parse problems | 36 |

<!-- /generated:dbc-corpus -->

The statements that occur in the corpus but are not modelled:

<!-- generated:dbc-skipped -->
<!-- Generated from the pinned baselines by scripts/docs/fidelity-tables.mjs. Do not edit by hand. -->

| Statement | Files | Statements |
| --- | ---: | ---: |
| `BS_` | 53 | 53 |
| `NS_` | 53 | 53 |

<!-- /generated:dbc-skipped -->

Features the corpus has few or none of (see the totals) are covered by
[`examples/demo.dbc`](../../examples/demo.dbc) and the parser's unit tests,
[`parser.test.ts`](../../app/src/lib/dbc/parser.test.ts).
