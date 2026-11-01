# Draft: DBC import reports wrong line numbers after a `VAL_` line

**Status:** draft, not posted. Whether it goes to
[ebroecker/canmatrix](https://github.com/ebroecker/canmatrix/issues) is the
maintainer's decision. Everything from the issue title down to *Notes for CanViewer* is the
text to post; the notes are not.

The reproduction and the *Actual* block are checked by
`app/src/lib/canmatrix/upstream-reports.test.ts`, which runs the script under the
canmatrix wheel CanViewer ships and compares its output with the block below.

---

**Issue title:** DBC import: error line numbers are wrong after a `VAL_` or
`VAL_TABLE_` line

## Summary

When the DBC reader cannot read a line, it prints `error with line no: N`
followed by the line. After the first `VAL_` (or `VAL_TABLE_`) line in a file,
`N` is wrong: the loops that read the value pairs reuse `i`, the reader's line
counter, as their index, so the counter restarts from the number of pairs. Every
line number printed or logged after that point is off, and by a different amount
after each value table.

## Environment

- canmatrix 1.3.3, the latest release on PyPI (2026-10-21);
- CPython 3.13 on Linux, and Pyodide 314.0.7 (CPython 3.14) with the same wheel:
  identical output;
- the development branch at 8b54a41 (2026-10-28) prints the same:
  `src/canmatrix/formats/dbc.py` has not changed since 1.3.3.

## Reproduction

```python
import canmatrix.formats

DBC = b'''VERSION ""

BU_: ECU

BO_ 100 First: 8 ECU
 SG_ Mode : 0|8@1+ (1,0) [0|255] "" Vector__XXX
 SG_ Bad1 : x|8@1+ (1,0) [0|255] "" Vector__XXX

VAL_ 100 Mode 0 "Off" 1 "On" 2 "Auto" ;

BO_ 200 Second: 8 ECU
 SG_ Bad2 : y|8@1+ (1,0) [0|255] "" Vector__XXX
'''

print("canmatrix", canmatrix.__version__)
canmatrix.formats.loads_flat(DBC, "dbc")
```

`Bad1` (line 7) and `Bad2` (line 12) are deliberately unreadable: their start
bits are not numbers.

## Expected

```text
canmatrix 1.3.3
error with line no: 7
b' SG_ Bad1 : x|8@1+ (1,0) [0|255] "" Vector__XXX\n'
error with line no: 12
b' SG_ Bad2 : y|8@1+ (1,0) [0|255] "" Vector__XXX\n'
```

## Actual

```text
canmatrix 1.3.3
error with line no: 7
b' SG_ Bad1 : x|8@1+ (1,0) [0|255] "" Vector__XXX\n'
error with line no: 5
b' SG_ Bad2 : y|8@1+ (1,0) [0|255] "" Vector__XXX\n'
```

Line 12 is reported as line 5: the `VAL_` line on line 9 has three pairs, so
its loop leaves `i` at 2, and the counter goes on from there (3, 4, 5).

## Cause

`load()` in `src/canmatrix/formats/dbc.py` counts lines in `i` (line 490,
`i = 0`, and line 513, `i = i + 1`). Three loops inside the same `for line in f`
loop use `i` as their own index:

- line 789, `VAL_` for a signal: `for i in range(math.floor(len(temp_list) / 2)):`
- line 799, `VAL_` for an environment variable: the same loop;
- line 814, `VAL_TABLE_`: `for i in range(math.floor(len(temp_list) / 2)):`

After any of them, `i` holds the last pair index, and both the
`print("error with line no: %d" % i)` at line 965 and the
`logger.error("Error decoding line: %d (%s)" % (i, line))` calls use it.

## Suggested fix

Give the three loops their own index:

```diff
--- a/src/canmatrix/formats/dbc.py
+++ b/src/canmatrix/formats/dbc.py
@@ -788,7 +788,7 @@
                             sg = frame.signal_by_name(signal_name)
-                            for i in range(math.floor(len(temp_list) / 2)):
-                                val = temp_list[i * 2 + 1]
+                            for pair in range(math.floor(len(temp_list) / 2)):
+                                val = temp_list[pair * 2 + 1]
                                 val = val.replace('\\"', '"')
                                 if sg:
-                                    sg.add_values(temp_list[i * 2], val)
+                                    sg.add_values(temp_list[pair * 2], val)
                         except:
@@ -798,6 +798,6 @@
                             values = db.env_vars[signal_name]['values']
-                            for i in range(math.floor(len(temp_list) / 2)):
-                                val = temp_list[i * 2 + 1]
+                            for pair in range(math.floor(len(temp_list) / 2)):
+                                val = temp_list[pair * 2 + 1]
                                 val = val.replace('\\"', '"')
-                                values[temp_list[i * 2].strip()]=val
+                                values[temp_list[pair * 2].strip()]=val
                         except:
@@ -813,5 +813,5 @@
                     try:
-                        for i in range(math.floor(len(temp_list) / 2)):
-                            val = temp_list[i * 2 + 1]
-                            value_hash[temp_list[i * 2].strip()] = val.strip()
+                        for pair in range(math.floor(len(temp_list) / 2)):
+                            val = temp_list[pair * 2 + 1]
+                            value_hash[temp_list[pair * 2].strip()] = val.strip()
                     except:
```

With this patch applied to 1.3.3, the reproduction prints the *Expected* block,
and `tests/test_dbc.py` still passes with lxml installed (68 passed, as for
unpatched 1.3.3 installed with `pip install canmatrix[kcd]==1.3.3 pytest`).
Counting with
`for i, line in enumerate(f, start=1):` instead of `i = i + 1` would also keep
the counter right, but would leave the shadowing in place.

---

## Notes for CanViewer (not for posting)

- CanViewer reads `.dbc` with its own parser, so the app is not affected. The
  canmatrix DBC reader runs only in the mapper suite
  (`app/src/lib/canmatrix/mapper.test.ts`) over the 58 OEM DBC files.
- `canviewer_adapter.py` already works around the bug: `_locate()` looks up
  the line canmatrix quotes and replaces its number with the real one.
  `upstream-reports.test.ts` pins that (lines 7 and 12 for this input). If
  upstream fixes the bug,
  the workaround stays harmless; it can then be reduced to the SYM case its
  docstring also names.
- Before posting: search the open and closed issues for "line no" and
  "VAL_" for duplicates (not done yet). Check that the development branch still
  has the three loops.
