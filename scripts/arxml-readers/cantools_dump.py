"""Reads ARXML files with cantools and writes what it finds as JSON, shaped like
CanViewer's DbcDatabase (app/src/lib/dbc/types.ts), so that compare.ts can hold
it against canmatrix's reading and the DBC twins.

A report tool for docs/develop/arxml-readers.md, not part of the app: CanViewer
reads ARXML through canmatrix. Run it with cantools 45.1.2 (the tag of the
third_party/cantools submodule) in a virtual environment of its own:

    python3 -m venv <venv>
    <venv>/bin/pip install cantools==45.1.2
    <venv>/bin/python -I scripts/arxml-readers/cantools_dump.py third_party <out.json>

Each file is loaded with strict=True, cantools' default, and when that fails
once more with strict=False. The mapping follows canviewer_adapter.py where the
two models meet: the DBC-as-written start bit, cycle_time as GenMsgCycleTime and
is_fd as VFrameFormat (with the definitions canmatrix's DBC export declares).
Nothing is invented: a minimum or maximum cantools does not have stays null, and
attributes cantools does not model are left out. Container PDUs have no place in
CanViewer's model; the container frame is mapped without signals, and its
contained PDUs are listed beside the database.
"""

import json
import os
import sys
import warnings

import cantools

NO_NODE = "Vector__XXX"
_EXTENDED_FLAG = 0x80000000
_VFRAMEFORMAT_VALUES = (
    ["StandardCAN", "ExtendedCAN", "reserved", "J1939PG"] + ["reserved"] * 10 + ["StandardCAN_FD", "ExtendedCAN_FD"]
)
_DERIVED_DEFINITIONS = {
    "GenMsgCycleTime": {"name": "GenMsgCycleTime", "objectType": "BO_", "valueType": "INT", "min": 0.0, "max": 65535.0},
    "VFrameFormat": {"name": "VFrameFormat", "objectType": "BO_", "valueType": "ENUM", "enumValues": _VFRAMEFORMAT_VALUES},
}


def _number(value):
    if value is None:
        return None
    number = float(value)
    return int(number) if number.is_integer() else number


def _value_type(signal):
    if signal.is_float:
        return "double" if signal.length > 32 else "float"
    return "signed" if signal.is_signed else "unsigned"


def _multiplex(signal):
    ids = list(signal.multiplexer_ids or [])
    if signal.is_multiplexer and ids:
        info = {"role": "both", "switchValue": int(ids[0])}
    elif signal.is_multiplexer:
        info = {"role": "multiplexor"}
    elif ids:
        info = {"role": "multiplexed", "switchValue": int(ids[0])}
    else:
        info = {"role": "none"}
    if len(ids) > 1:
        info["extended"] = {"switchName": str(signal.multiplexer_signal), "ranges": [[int(i), int(i)] for i in ids]}
    return info


def _signal(signal):
    out = {
        "name": signal.name,
        # cantools keeps the start bit the way DBC writes it: Intel LSB,
        # Motorola MSB in sawtooth numbering.
        "startBit": int(signal.start),
        "length": int(signal.length),
        "byteOrder": "intel" if signal.byte_order == "little_endian" else "motorola",
        "valueType": _value_type(signal),
        "factor": _number(signal.scale),
        "offset": _number(signal.offset),
        "min": _number(signal.minimum),
        "max": _number(signal.maximum),
        "unit": signal.unit or "",
        "receivers": list(signal.receivers or []),
        "multiplex": _multiplex(signal),
        "attributes": {},
    }
    if signal.choices:
        out["values"] = {str(int(k)) if float(k).is_integer() else str(k): str(v) for k, v in signal.choices.items()}
    if signal.comment:
        out["comment"] = signal.comment
    return out


def _message(message, derived):
    attributes = {}
    if message.cycle_time:
        attributes["GenMsgCycleTime"] = int(message.cycle_time)
        derived.add("GenMsgCycleTime")
    if message.is_fd:
        attributes["VFrameFormat"] = "ExtendedCAN_FD" if message.is_extended_frame else "StandardCAN_FD"
        derived.add("VFrameFormat")
    senders = list(message.senders or [])
    out = {
        "id": int(message.frame_id),
        "rawId": int(message.frame_id) | (_EXTENDED_FLAG if message.is_extended_frame else 0),
        "isExtended": bool(message.is_extended_frame),
        "name": message.name,
        "dlc": int(message.length),
        "sender": senders[0] if senders else NO_NODE,
        "transmitters": senders[1:],
        "signals": [_signal(s) for s in message.signals],
        "attributes": attributes,
    }
    if message.comment:
        out["comment"] = message.comment
    return out


def _database(db):
    derived = set()
    messages = [_message(m, derived) for m in db.messages]
    return {
        "version": db.version or "",
        "nodes": [
            {"name": n.name, **({"comment": n.comment} if n.comment else {}), "attributes": {}} for n in db.nodes
        ],
        "messages": messages,
        "valueTables": [],
        "attributeDefinitions": [dict(_DERIVED_DEFINITIONS[name]) for name in sorted(derived)],
        "attributes": {},
        "problems": [],
        "skipped": {},
    }


def _containers(db):
    return [
        {
            "container": m.name,
            "contained": [
                {
                    "name": c.name,
                    "headerId": c.header_id,
                    "length": int(c.length),
                    "signals": len(c.signals),
                }
                for c in m.contained_messages or []
            ],
        }
        for m in db.messages
        if m.is_container
    ]


def _error(exception):
    return "%s: %s" % (type(exception).__name__, exception)


def _load(path, strict, out):
    # cantools warns when its reader raised something other than a format
    # error (a TypeError, say): a crash in the reader rather than a verdict on
    # the file. The warning's first line is kept, the traceback is not.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            return cantools.database.load_file(path, database_format="arxml", strict=strict)
        finally:
            for w in caught:
                line = str(w.message).splitlines()[0]
                if line not in out["warnings"]:
                    out["warnings"].append(line)


def read(path):
    out = {"strictError": None, "error": None, "warnings": [], "database": None, "containers": []}
    db = None
    try:
        db = _load(path, True, out)
    except Exception as e:  # noqa: BLE001 - recorded, then retried without strict checks
        out["strictError"] = _error(e)
        try:
            db = _load(path, False, out)
        except Exception as e2:  # noqa: BLE001 - recorded in the report
            out["error"] = _error(e2)
    if db is not None:
        out["database"] = _database(db)
        out["containers"] = _containers(db)
    return out


def corpus(third_party):
    roots = [os.path.join(third_party, "canmatrix", "tests"), os.path.join(third_party, "cantools", "tests", "files")]
    files = []
    for root in roots:
        for directory, _, names in os.walk(root):
            files.extend(os.path.join(directory, n) for n in names if n.lower().endswith(".arxml"))
    return sorted(os.path.relpath(f, third_party).replace(os.sep, "/") for f in files)


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: cantools_dump.py <third_party dir> <out.json>\n")
        return 2
    third_party, target = argv[1], argv[2]
    files = corpus(third_party)
    report = {
        "cantools": cantools.__version__,
        "files": {f: read(os.path.join(third_party, f)) for f in files},
    }
    with open(target, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, sort_keys=True)
        f.write("\n")
    read_ok = sum(1 for r in report["files"].values() if r["database"] is not None)
    print("cantools %s: %d ARXML files, %d read, written to %s" % (cantools.__version__, len(files), read_ok, target))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
