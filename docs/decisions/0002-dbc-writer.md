# 0002. The DBC writer and what it preserves

- **Status:** accepted
- **Date:** 2026-11-01

## Context

CanViewer is getting editing: message and signal properties can be changed in the app,
and the result is saved with *Save as DBC*. Saving is only trustworthy if writing does not
change the database behind the user's back. The project's first intention is that
CanViewer shows what the file says, no less and no more, and that a loss is visible,
never silent (see [the goal](../handover/2026-11-01-goal.md), W11).

The TypeScript parser (`app/src/lib/dbc/parser.ts`) is in charge of `.dbc` files. It
reads a file into a `DbcDatabase`, the model every view works on. It keeps no concrete
syntax: no comments outside `CM_` strings, no whitespace, no record of the order the
statements came in, and no content of the statements it recognizes but does not model
(`EV_`, `SIG_GROUP_`, `BA_DEF_REL_` and the others it counts in `skipped`).

## Decision

`writeDbc` (`app/src/lib/dbc/writer.ts`) writes a `DbcDatabase` as DBC text, with a
round-trip guarantee about the model, not about the source text:

> For a file the parser reads, `parseDbc(writeDbc(parseDbc(text)).text)` gives the same
> model as `parseDbc(text)`.

"The model" is the `DbcDatabase` except its two parse diagnostics: `problems` (lines the
parser could not use, with their line numbers) and `skipped` (how many statements of each
unmodeled kind it saw). Both describe the source text, not the database, and the writer
cannot reproduce them: a dangling reference is not in the model, and a skipped statement's
content was never read.

### How it is checked

`app/src/lib/dbc/roundtrip.test.ts` runs over the 58 OEM corpus files (the opendbc
submodule and `Model3CAN.dbc`, the same files as `corpus.test.ts`). For each file:

- the first parse must hash to the file's `modelSha256` in `corpus-baseline.json` (the
  pinned baseline: SHA-256 of `JSON.stringify` of the parsed database);
- `writeDbc` must report no issues;
- the second parse must report no problems, and skip nothing but the `NS_` and `BS_`
  header the writer emits;
- the second parse, with the first parse's `problems` and `skipped` carried over, must
  hash to the same `modelSha256` from the baseline;
- writing the second parse again must give the same text.

`scripts/check-test-report.mjs` fails CI unless all 58 of these tests ran and passed. A
writer that drops signal comments fails for 28 of the 58 files, every one that has a
signal comment; this was tried while building it.

The hash compares `JSON.stringify` output, which follows the order in which properties
were set on each object. The parser sets a signal's `comment` and `values` in the order
it meets `CM_` and `VAL_`. The writer writes all `CM_` before all `VAL_`, the
conventional order, and in all 58 corpus files every signal that has both has its `CM_`
first (otherwise their hashes could not match). A file that puts a signal's `VAL_` before
its `CM_` would round-trip to an equal model whose properties are in a different order,
and its hash would differ. If a corpus update ever brings one, compare
that file with sorted keys; do not make the writer mimic source order.

### What the writer preserves

Everything in the model:

| Part | Preserved |
|---|---|
| Database | version string, network comment, network attribute values |
| Nodes | order, names, comments, attribute values |
| Value tables | order, names, every value and description, negative and empty tables included |
| Messages | order, the raw id exactly (the extended flag and any other high bits), name, DLC, sender, extra transmitters (`BO_TX_BU_`), comment, attribute values |
| Signals | order, name, start bit, length, byte order, signedness, float and double (`SIG_VALTYPE_`), factor, offset, minimum, maximum (every number exactly, exponents included), unit, receivers, multiplexor role and switch value, extended multiplexing (`SG_MUL_VAL_`), value descriptions, comment, attribute values |
| Attribute definitions | order, object type, value type, range, enum labels, defaults |
| Attribute values | numbers stay numbers and strings stay strings; an enum label is written as its index (`BA_`) or quoted (`BA_DEF_DEF_`), and reads back as the label |
| Duplicates | duplicate message ids and signal names are written as they are, so the parser reads (and reports) them as before |

### What it does not preserve

- **Comment layout and whitespace.** Indentation, blank lines, line breaks between
  statements and the spelling of numbers (`1.0` is written `1`, `0.10` is written `0.1`)
  are the writer's own. Line breaks inside `CM_` strings are kept, since they are part of
  the comment.
- **Statement order.** The writer uses the conventional order: `VERSION`, `NS_`, `BS_`,
  `BU_`, `VAL_TABLE_`, the `BO_` blocks with their `SG_` lines, `BO_TX_BU_`, `CM_`,
  `BA_DEF_`, `BA_DEF_DEF_`, `BA_`, `VAL_`, `SIG_VALTYPE_`, `SG_MUL_VAL_`.
- **The `NS_` list.** It is always the standard list Vector tools write.
- **Statements CanViewer does not model.** Environment variables, signal groups,
  relation attributes, signal types and the rest of what the parser counts in `skipped`
  are not written. The overview lists them under *Not displayed (parsed & skipped)*, so a
  user can see what a saved file will lack (apart from `NS_` and `BS_`, which the writer
  writes).
- **Dangling references.** A `CM_`, `BA_`, `VAL_` or similar statement that names an
  object the file does not define is a parse problem, not part of the model, and is not
  written.
- **Spellings that mean the same.** A sender or receiver list of `Vector__XXX` is how an
  empty one is written; a bare lowercase `m` multiplexor is written `M`; a float or double
  signal is written with `-` as its sign, since `SIG_VALTYPE_` decides its type.
- **The encoding.** The text is saved as UTF-8 without a byte order mark. The app reads
  UTF-8 first, so a saved file opens with the same text. A file that came in as
  Windows-1252 goes out as UTF-8, which tools that assume Windows-1252 show wrongly
  outside ASCII.

### What DBC cannot hold

A model from another format (through canmatrix) or a hand-built one can hold what the
DBC grammar cannot: a name with a space, a double quote in a unit, a string that ends in
a backslash, a property of a second signal with the same name that no statement can
address, a number that would read back as an enum label. The writer reports each of these
as an issue (`DbcWriteIssue`: kind, object, property) instead of losing it silently, and
still writes the rest. *Save as DBC* lists the issues and saves only when the user
chooses *Save anyway*.

### Editing stays inside the guarantee

The editors (`app/src/lib/dbc/edit.ts`) accept a changed field only if the writer can hold
it: names are C identifiers and unique, ids fit 11 or 29 bits and are unique, numbers are
finite, units have no double quote, strings do not end in a backslash, and a float is 32
bits and a double 64. A field left as it was keeps the file's value exactly, without
being parsed again. An edited database therefore round-trips as well, which the unit
tests check by writing and re-parsing each edit.

## Alternatives considered

- **Edit the source text in place**, keeping comments, layout and order. That needs a
  concrete syntax tree in the parser (or a second parser), and edits that touch several
  statements (renaming a signal touches `SG_`, `CM_`, `BA_`, `VAL_` and `SG_MUL_VAL_`)
  become text surgery. The goal accepts losing comment and whitespace layout, so the
  simpler model writer was chosen.
- **Carry unmodeled statements through as raw text.** It would keep environment
  variables and signal groups, but it changes the model, and with it every pinned
  baseline, for content no view shows. It can come later, as its own change.
- **Write with canmatrix's DBC exporter.** It would put the 16 MB Python runtime on the
  save path for DBC-only users, and canmatrix's model differs from CanViewer's in ways the
  mapper baseline pins. The TypeScript parser is in charge of `.dbc`, so its writer
  belongs next to it.

## Consequences

- *Save as DBC* never changes what CanViewer shows for a DBC file, and the corpus suite
  holds that to account on every CI run.
- A saved file loses the source's comment layout, statement order and the statements
  CanViewer does not model. Users who need those should keep the original file.
- When the model grows (a new statement is modeled), the writer must grow with it. The
  round-trip suite fails for every corpus file that uses the new statement until it does.
