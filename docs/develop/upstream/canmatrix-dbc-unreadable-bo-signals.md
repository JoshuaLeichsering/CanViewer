# Draft: signals of an unreadable `BO_` line join the previous frame

**Status:** draft, not posted. Whether it goes to
[ebroecker/canmatrix](https://github.com/ebroecker/canmatrix/issues) is Joshua's
decision. Everything from the issue title down to *Notes for CanViewer* is the
text to post; the notes are not.

The reproduction and the *Actual* block are checked by
`app/src/lib/canmatrix/upstream-reports.test.ts`, which runs the script under the
canmatrix wheel CanViewer ships and compares its output with the block below.

---

**Issue title:** DBC import: when a `BO_` line cannot be read, its signals are
added to the previous frame

## Summary

When the DBC reader cannot read a `BO_` line, it prints an error for that line
and goes on. The `SG_` lines that follow are then added to the frame of the
*previous* `BO_` line, without any error or warning. The result is a frame with
signals that belong to another frame, often overlapping its own.

The trigger seen most often in real files is a 29-bit identifier written without
the extended-frame flag (bit 31), such as `BO_ 2048 ...` or
`BO_ 103596083 ...`: `ArbitrationId` raises `ArbitrationIdOutOfRange` for a
standard id above 0x7FF. Any other exception in the `BO_` branch has the same
effect.

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
 SG_ A : 0|8@1+ (1,0) [0|255] "" Vector__XXX

BO_ 2048 Second: 8 ECU
 SG_ B : 8|8@1+ (1,0) [0|255] "" Vector__XXX
'''

print("canmatrix", canmatrix.__version__)
db = canmatrix.formats.loads_flat(DBC, "dbc")
for frame in db.frames:
    print(frame.name, frame.arbitration_id.id, [s.name for s in frame.signals])
```

## Expected

`First` keeps only its own signal `A`. Signal `B` belongs to `Second`: if
`Second` cannot be read, `B` cannot be placed either, and should be reported (or
dropped with an error), not attached to `First`. For example:

```text
canmatrix 1.3.3
error with line no: 8
b'BO_ 2048 Second: 8 ECU\n'
error with line no: 9
b' SG_ B : 8|8@1+ (1,0) [0|255] "" Vector__XXX\n'
First 100 ['A']
```

## Actual

```text
canmatrix 1.3.3
error with line no: 8
b'BO_ 2048 Second: 8 ECU\n'
First 100 ['A', 'B']
```

`B` (bits 8 to 15 of `Second`) is now a signal of `First`, and nothing says so.

## Cause

In `load()` in `src/canmatrix/formats/dbc.py`, `frame` holds the frame that
`SG_` lines are added to. The `BO_` branch (line 561) assigns it only after the
line was read:

```python
frame = Frame(temp.group(2), arbitration_id=int(temp.group(1)),
              size=int(temp.group(3)), transmitters=temp.group(4).split())
```

When that raises (here in `ArbitrationId.__attrs_post_init__`, "ID out of
range"), the bare `except:` at line 964 prints the error and the loop goes on
with `frame` still pointing at the previous frame. The `SG_` branch then calls
`frame.add_signal(temp_signal)` (line 603) on it.

If the unreadable `BO_` line is the first one in the file, `frame` is still
`None`, `add_signal` raises, and every `SG_` line of that message is reported.
So the same input is reported or silently misplaced depending on where the
message sits in the file.

## Suggested fix

Clear `frame` before the `BO_` line is read, so that the signals of a frame
that could not be read fail the way they already do when it is the first:

```diff
--- a/src/canmatrix/formats/dbc.py
+++ b/src/canmatrix/formats/dbc.py
@@ -559,6 +559,8 @@
                 follow_up = _FollowUps.NEW_SYMBOLS
                 continue
             if decoded.startswith("BO_ "):
+                # if this line cannot be read, its SG_ lines must fail, not join the previous frame
+                frame = None
                 regexp = re.compile(r"^BO_ ([^\ ]+) ([^\ ]+) *: *([^\ ]+) ([^\ ]+)")
                 temp = regexp.match(decoded)
     #            db.frames.addFrame(Frame(temp.group(1), temp.group(2), temp.group(3), temp.group(4)))
```

With this patch applied to 1.3.3, the reproduction prints the *Expected* block
above, and `tests/test_dbc.py` still passes (68 passed).

Whether such an id should be read at all is a separate question, and readers
disagree: cantools 45.1.2 refuses the whole file ("Standard frame id 0x800 is
more than 11 bits in message Second."), while some viewers take the id as
written. This report is only about the misplaced signals.

---

## Notes for CanViewer (not for posting)

- CanViewer reads `.dbc` with its own parser, which reads both messages of the
  reproduction (`First` with `A`, `Second` with id 2048 and `B`);
  `upstream-reports.test.ts` pins that. So the app is not affected.
- The bug shows in the mapper suite (`app/src/lib/canmatrix/mapper.test.ts`),
  which reads the 58 OEM DBC files through canmatrix as well. Its pinned
  baseline (`mapper-dbc-baseline.json`) has 71 `BO_` lines canmatrix could not
  read in 6 files, and 275 signals on the wrong message in 3 of them:
  `toyota_2017_ref_pt.dbc` 259, `vw_meb.dbc` 14, `chrysler_cusw.dbc` 2 (for
  example line 182, `BO_ 103596083 BSM_LEFT: 8 XXX`). In
  `gm_global_a_lowspeed.dbc` all 13 `BO_` lines are unreadable, so no frame is
  ever current, and its 27 `SG_` lines are reported instead, as described
  above.
- Before posting: search the open and closed issues for "BO_" and
  "ArbitrationIdOutOfRange". This sandbox could not: its GitHub access covers
  only this repository. The opendbc files above (MIT) can be named as examples.
