# Draft: JSON import drops `is_fd`

**Status:** draft, not posted, and probably not to be posted as a bug: the
development branch already has the change. Pull request ebroecker/canmatrix#939
("fix: preserve define defaults, signal groups, fd flag and multiplexing in
json/yaml round trip", commit 2a63b57, merged 2026-10-28) makes `from_dict`
apply `is_fd`. It is not in a release yet: 1.3.3 (2026-10-21) is the latest on
PyPI, and it is the version CanViewer ships. The options are the maintainer's:

- wait for the next release, then update the wheel in
  `app/src/lib/canmatrix/wheels.lock.json` (the check of this draft then fails on
  purpose, and the draft retires);
- or post a short request for a release that includes ebroecker/canmatrix#939,
  quoting the reproduction as the reason.

The reproduction and the *Actual* block are checked by
`app/src/lib/canmatrix/upstream-reports.test.ts`, which runs the script under the
canmatrix wheel CanViewer ships and compares its output with the block below.

---

**Issue title:** JSON import ignores `is_fd`, so CAN FD frames come back as
classic CAN

## Summary

The JSON exporter writes `"is_fd": true` for a CAN FD frame, in both the default
and the `jsonExportAll` layout, but the JSON importer never reads the key. Every
frame loaded from JSON has `is_fd == False`, so a JSON round trip, or a
conversion from JSON to DBC, ARXML or any other format, turns CAN FD frames into
classic CAN frames. Exported to DBC directly, the frame below gets
`BA_ "VFrameFormat" BO_ 291 14;` (`StandardCAN_FD`); exported to DBC after a
JSON round trip, it gets no `VFrameFormat` at all, so the DBC file describes a
classic CAN frame.

## Environment

- canmatrix 1.3.3, the latest release on PyPI (2026-10-21);
- CPython 3.13 on Linux, and Pyodide 314.0.7 (CPython 3.14) with the same wheel:
  identical output.

## Reproduction

```python
import io

import canmatrix
import canmatrix.formats

print("canmatrix", canmatrix.__version__)

db = canmatrix.CanMatrix()
frame = canmatrix.Frame("FdFrame", arbitration_id=canmatrix.ArbitrationId(0x123), size=8, is_fd=True)
frame.add_signal(canmatrix.Signal("S", start_bit=0, size=8))
db.add_frame(frame)

for export_all in (False, True):
    out = io.BytesIO()
    canmatrix.formats.dump(db, out, "json", jsonExportAll=export_all)
    text = out.getvalue()
    print("jsonExportAll=%s: written is_fd:" % export_all, b'"is_fd": true' in text)
    again = canmatrix.formats.loads_flat(text, "json")
    print("jsonExportAll=%s: read back is_fd:" % export_all, again.frames[0].is_fd)
```

## Expected

```text
canmatrix 1.3.3
jsonExportAll=False: written is_fd: True
jsonExportAll=False: read back is_fd: True
jsonExportAll=True: written is_fd: True
jsonExportAll=True: read back is_fd: True
```

## Actual

```text
canmatrix 1.3.3
jsonExportAll=False: written is_fd: True
jsonExportAll=False: read back is_fd: False
jsonExportAll=True: written is_fd: True
jsonExportAll=True: read back is_fd: False
```

## Cause

`to_dict()` in `src/canmatrix/formats/_dict_codec.py` writes
`"is_fd": frame.is_fd` (lines 97 and 177), but `from_dict()` copies only
`is_complex_multiplexed`, `mux_names`, `cycle_time`, `is_j1939`, `header_id` and
`pdu_name` (line 223), and nothing else sets `is_fd`.

## Suggested fix

What the development branch does since #939, in `from_dict()`:

```python
if "is_fd" in frame:
    new_frame.is_fd = frame["is_fd"]
```

On the development branch at 8b54a41 the reproduction prints the *Expected*
block (its `__version__` there still reads 1.3.2).

---

## Notes for CanViewer (not for posting)

- CanViewer imports `.json` through canmatrix, so the app is affected: a CAN FD
  frame of up to 8 bytes in a JSON file shows as classic CAN. Frames longer than
  8 bytes still show as CAN FD, because CanViewer's own rule
  (`app/src/lib/dbc/canfd.ts`) treats a DLC above 8 as FD.
  `upstream-reports.test.ts` pins the 8-byte case: no `VFrameFormat`, and
  `isCanFd()` is false.
- `canviewer_adapter.py` does not work around it, and should not guess: the
  flag is gone before the adapter sees the frame. Reading `is_fd` from the JSON
  text ourselves would be a workaround of our own; the release is the better
  fix.
- `app/src/lib/canmatrix/mapper.test.ts` notes the same ("it drops is_fd").
