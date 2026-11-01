"""Reads a CAN database with canmatrix and returns it shaped like CanViewer's
DbcDatabase (src/lib/dbc/types.ts), as plain dicts and lists that convert to
JavaScript objects without any PyProxy left over.

Scope today (handover task 2): messages and signals with their layout, scaling,
units, receivers, value descriptions, comments and multiplexing, which is what
the twin comparison in import-corpus.test.ts checks. Nodes, attributes,
attribute definitions, value tables and the FD/J1939 rules are task 4.

Everything canmatrix prints, or logs at WARNING and above, while loading is
returned in "log", so nothing it reports is dropped silently.
"""

import contextlib
import decimal
import importlib
import io
import logging

NO_NODE = "Vector__XXX"
_EXTENDED_FLAG = 0x80000000


def _register(import_type):
    """Make sure canmatrix.formats knows the format, even if its packages
    (lxml, openpyxl, ...) were loaded after canmatrix.formats was imported:
    the module registry is only filled once, at import time."""
    import canmatrix.formats as F

    module = importlib.import_module("canmatrix.formats." + import_type)
    if import_type not in F.loadedFormats:
        F.loadedFormats.append(import_type)
        F.supportedFormats[import_type] = [
            name
            for name in ("load", "dump", "clusterImporter", "clusterExporter", "extension")
            if hasattr(module, name)
        ]
    return F


class _Collect(logging.Handler):
    def __init__(self, sink):
        super().__init__(logging.WARNING)
        self.sink = sink

    def emit(self, record):
        self.sink.append("%s %s: %s" % (record.levelname, record.name, record.getMessage()))


def _num(value):
    # canmatrix computes min/max when a format leaves them out; 0 is only a
    # fallback for a value it could not compute.
    return 0.0 if value is None else float(value)


def _value_type(signal):
    if signal.is_float:
        return "double" if int(signal.size) > 32 else "float"
    return "signed" if signal.is_signed else "unsigned"


def _multiplex(signal):
    if signal.is_multiplexer and signal.mux_val is not None:
        info = {"role": "both", "switchValue": int(signal.mux_val)}
    elif signal.is_multiplexer:
        info = {"role": "multiplexor"}
    elif signal.mux_val is not None:
        info = {"role": "multiplexed", "switchValue": int(signal.mux_val)}
    else:
        info = {"role": "none"}
    if signal.muxer_for_signal and signal.mux_val_grp:
        info["extended"] = {
            "switchName": str(signal.muxer_for_signal),
            "ranges": [[int(lo), int(hi)] for lo, hi in signal.mux_val_grp],
        }
    return info


def _signal(signal):
    out = {
        "name": str(signal.name),
        # DBC-as-written start bit: Intel LSB, Motorola MSB in sawtooth numbering.
        "startBit": int(signal.get_startbit(bit_numbering=1)),
        "length": int(signal.size),
        "byteOrder": "intel" if signal.is_little_endian else "motorola",
        "valueType": _value_type(signal),
        "factor": _num(signal.factor),
        "offset": _num(signal.offset),
        "min": _num(signal.min),
        "max": _num(signal.max),
        "unit": str(signal.unit or ""),
        "receivers": [str(r) for r in signal.receivers],
        "multiplex": _multiplex(signal),
        "attributes": {},
    }
    if signal.values:
        out["values"] = {int(k): str(v) for k, v in signal.values.items()}
    if signal.comment:
        out["comment"] = str(signal.comment)
    return out


def _message(frame):
    arb = frame.arbitration_id
    transmitters = [str(t) for t in frame.transmitters]
    out = {
        "id": int(arb.id),
        "rawId": int(arb.id) | (_EXTENDED_FLAG if arb.extended else 0),
        "isExtended": bool(arb.extended),
        "name": str(frame.name),
        "dlc": int(frame.size),
        "sender": transmitters[0] if transmitters else NO_NODE,
        "transmitters": transmitters[1:],
        "signals": [_signal(s) for s in frame.signals],
        "attributes": {},
    }
    if frame.comment:
        out["comment"] = str(frame.comment)
    return out


def _database(db):
    return {
        "version": "",
        "nodes": [],
        "messages": [_message(f) for f in db.frames],
        "valueTables": [],
        "attributeDefinitions": [],
        "attributes": {},
        "problems": [],
        "skipped": {},
    }


def read(data, import_type, options=None):
    """Load `data` (bytes) as `import_type` and map every cluster it holds.

    Returns {"clusters": [{"name": str, "db": DbcDatabase dict}], "log": [str],
    "error": str or None}. A loader exception is reported in "error" instead of
    raised, so a broken file never takes the interpreter down with it.
    """
    log = []
    handler = _Collect(log)
    root = logging.getLogger()
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.WARNING)
    printed = io.StringIO()
    clusters = []
    error = None
    if hasattr(data, "to_bytes"):  # a JavaScript Uint8Array passed in by Pyodide
        data = data.to_bytes()
    options = dict(options or {})
    notes = []
    try:
        F = _register(import_type)
        dbs = _load(F, data, import_type, options, printed)
        if (
            import_type == "arxml"
            and not options.get("arxmlIgnoreClusterInfo")
            and not any(db is not None and db.frames for db in (dbs or {}).values())
        ):
            # canmatrix 1.3.3 looks for frames only under CAN-PHYSICAL-CHANNEL,
            # which AUTOSAR 4 uses; AUTOSAR 3 files name it PHYSICAL-CHANNEL and
            # come back empty, without an error. Searching the whole file
            # finds them, at the price of losing which cluster they belong to.
            notes.append(
                "NOTE canviewer_adapter: no CAN frames found per cluster; "
                "read again with arxmlIgnoreClusterInfo=True"
            )
            options["arxmlIgnoreClusterInfo"] = True
            dbs = _load(F, data, import_type, options, printed)
        for name, db in (dbs or {}).items():
            if db is not None:
                clusters.append({"name": str(name), "db": _database(db)})
    except Exception as e:  # noqa: BLE001 - reported to the caller, not swallowed
        error = "%s: %s" % (type(e).__name__, e)
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)
    log = [line for line in printed.getvalue().splitlines() if line.strip()] + log + notes
    return {"clusters": clusters, "log": log, "error": error}


def _load(F, data, import_type, options, printed):
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        # Decimal is canmatrix's default and what its readers are written for:
        # with float_factory=float the ARXML reader raises on some files
        # ("'float' object has no attribute 'to_integral'"). The mapping
        # converts to float. Passed explicitly because canmatrix keeps the
        # factory in global state between loads.
        return F.load(io.BytesIO(bytes(data)), import_type, float_factory=decimal.Decimal, **options)
