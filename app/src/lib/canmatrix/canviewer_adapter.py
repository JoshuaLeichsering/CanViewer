# SPDX-License-Identifier: GPL-2.0-or-later
"""Reads a CAN database with canmatrix and returns it shaped like CanViewer's
DbcDatabase (app/src/lib/dbc/types.ts), as plain dicts and lists that convert to
JavaScript objects without any PyProxy left over.

What is mapped:
- messages and signals: layout with the DBC-as-written start bit, scaling,
  range, unit, receivers, value descriptions, comments, multiplexing (simple
  and extended);
- nodes, value tables, attribute definitions (all five object types) and
  attribute values, typed by their definition the way CanViewer's DBC parser
  types them: numbers for INT/HEX/FLOAT, the label for ENUM (an index is
  resolved), text for STRING;
- what other formats keep in model fields rather than DBC attributes:
  frame.cycle_time, frame.is_fd, frame.is_j1939 and signal.cycle_time become
  GenMsgCycleTime, VFrameFormat and GenSigCycleTime, the attributes canmatrix's
  own DBC export writes for them (VFrameFormat J1939PG is what makes CanViewer
  treat a frame, and the database, as J1939). signal.initial_value is left
  out: canmatrix fills it in when a file has none. CanViewer's FD and J1939 rules then apply unchanged
  (app/src/lib/dbc/canfd.ts, j1939.ts). Attributes a file already has are kept.
- everything canmatrix prints, or logs at WARNING and above, becomes a
  ParseProblem (with the line number where canmatrix gives one), so nothing
  it reports is dropped silently. The raw lines are also returned in "log".

Not modelled by canmatrix, so not mapped: the DBC VERSION string and the
network comment. Environment variables and signal groups are counted in
"skipped", as CanViewer's parser does for DBC.
"""

import contextlib
import decimal
import importlib
import io
import logging
import re

NO_NODE = "Vector__XXX"
_EXTENDED_FLAG = 0x80000000
_OBJECT_TYPES = (
    ("", "global_defines"),
    ("BU_", "ecu_defines"),
    ("BO_", "frame_defines"),
    ("SG_", "signal_defines"),
    ("EV_", "env_defines"),
)
# The VFrameFormat enum canmatrix's DBC export declares when it adds the
# attribute (indexes 0, 1, 3, 14 and 15 are the ones CanViewer interprets).
_VFRAMEFORMAT_VALUES = (
    ["StandardCAN", "ExtendedCAN", "reserved", "J1939PG"]
    + ["reserved"] * 10
    + ["StandardCAN_FD", "ExtendedCAN_FD"]
)
# Formats whose loader takes an encoding option; the XML formats declare theirs.
_ENCODING_OPTION = {"dbc": "dbcImportEncoding", "dbf": "dbfImportEncoding", "sym": "symImportEncoding"}


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


# ---------------------------------------------------------------- values


def _num(value):
    # canmatrix computes min/max when a format leaves them out; 0 is only a
    # fallback for a value it could not compute.
    return 0.0 if value is None else float(value)


def _plain_number(value):
    """int when integral, else float; None when `value` is not a number."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, decimal.Decimal)):
        number = value
    else:
        text = str(value).strip()
        try:
            number = int(text, 0) if re.fullmatch(r"[+-]?0[xX][0-9a-fA-F]+", text) else decimal.Decimal(text)
        except (ValueError, decimal.InvalidOperation):
            return None
    if isinstance(number, decimal.Decimal):
        if not number.is_finite():
            return None
        return int(number) if number == number.to_integral_value() else float(number)
    if isinstance(number, float) and number.is_integer():
        return int(number)
    return number


def _unquote(value):
    text = str(value)
    return text[1:-1] if len(text) >= 2 and text[0] == '"' and text[-1] == '"' else text


def _typed(define, value):
    """An attribute value as CanViewer's DBC parser would store it."""
    if value is None:
        return None
    kind = getattr(define, "type", None)
    if kind in ("INT", "HEX", "FLOAT"):
        number = _plain_number(_unquote(value))
        if number is not None:
            return float(number) if kind == "FLOAT" and not isinstance(number, int) else number
        return _unquote(value)
    if kind == "ENUM":
        labels = [str(v) for v in getattr(define, "values", None) or []]
        index = _plain_number(_unquote(value))
        if isinstance(index, int) and 0 <= index < len(labels) and _unquote(value) not in labels:
            return labels[index]
        return _unquote(value)
    if kind == "STRING":
        return _unquote(value)
    # No definition: a number if it reads as one, else text (like the DBC parser).
    if isinstance(value, str) and len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    number = _plain_number(value)
    return number if number is not None else str(value)


def _attributes(raw, defines):
    out = {}
    for name, value in (raw or {}).items():
        typed = _typed(defines.get(name), value)
        if typed is not None:
            out[str(name)] = typed
    return out


def _definition(name, object_type, define):
    kind = define.type or "STRING"
    out = {"name": str(name), "objectType": object_type, "valueType": kind}
    if kind == "ENUM":
        out["enumValues"] = [str(v) for v in getattr(define, "values", None) or []]
    elif kind in ("INT", "HEX", "FLOAT"):
        if getattr(define, "min", None) is not None and getattr(define, "max", None) is not None:
            out["min"] = float(define.min)
            out["max"] = float(define.max)
    default = _typed(define, define.defaultValue)
    if default is not None:
        out["defaultValue"] = default
    return out


# ---------------------------------------------------------------- objects


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


def _signal(signal, defines, derived):
    attributes = _attributes(signal.attributes, defines)
    cycle = _plain_number(getattr(signal, "cycle_time", 0) or 0)
    if cycle and "GenSigCycleTime" not in attributes:
        attributes["GenSigCycleTime"] = cycle
        derived.add("GenSigCycleTime")
    # signal.initial_value is not turned into GenSigStartValue: canmatrix fills
    # it for every signal (0, the offset or min) when a file gives none, so a
    # derived start value could not be told apart from an invented one.
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
        "attributes": attributes,
    }
    if signal.values:
        out["values"] = {int(k): str(v) for k, v in signal.values.items()}
    if signal.comment:
        out["comment"] = str(signal.comment)
    return out


def _message(frame, db, derived):
    arb = frame.arbitration_id
    transmitters = [str(t) for t in frame.transmitters]
    attributes = _attributes(frame.attributes, db.frame_defines)
    cycle = _plain_number(getattr(frame, "cycle_time", 0) or 0)
    if cycle and "GenMsgCycleTime" not in attributes:
        attributes["GenMsgCycleTime"] = cycle
        derived.add("GenMsgCycleTime")
    if "VFrameFormat" not in attributes and (frame.is_fd or frame.is_j1939):
        if frame.is_fd:
            attributes["VFrameFormat"] = "ExtendedCAN_FD" if arb.extended else "StandardCAN_FD"
        else:
            attributes["VFrameFormat"] = "J1939PG"
        derived.add("VFrameFormat")
    out = {
        "id": int(arb.id),
        "rawId": int(arb.id) | (_EXTENDED_FLAG if arb.extended else 0),
        "isExtended": bool(arb.extended),
        "name": str(frame.name),
        "dlc": int(frame.size),
        "sender": transmitters[0] if transmitters else NO_NODE,
        "transmitters": transmitters[1:],
        "signals": [_signal(s, db.signal_defines, derived) for s in frame.signals],
        "attributes": attributes,
    }
    if frame.comment:
        out["comment"] = str(frame.comment)
    return out


# Definitions for attributes the mapping adds, as canmatrix's DBC export declares them.
_DERIVED_DEFINITIONS = {
    "GenMsgCycleTime": {"name": "GenMsgCycleTime", "objectType": "BO_", "valueType": "INT", "min": 0.0, "max": 65535.0},
    "VFrameFormat": {"name": "VFrameFormat", "objectType": "BO_", "valueType": "ENUM", "enumValues": _VFRAMEFORMAT_VALUES},
    "GenSigCycleTime": {"name": "GenSigCycleTime", "objectType": "SG_", "valueType": "INT", "min": 0.0, "max": 65535.0},
}


def _database(db, problems):
    derived = set()
    messages = [_message(f, db, derived) for f in db.frames]
    definitions = [
        _definition(name, object_type, define)
        for object_type, field in _OBJECT_TYPES
        for name, define in getattr(db, field, {}).items()
    ]
    known = {(d["objectType"], d["name"]) for d in definitions}
    for name in sorted(derived):
        d = _DERIVED_DEFINITIONS[name]
        if (d["objectType"], name) not in known:
            definitions.append(dict(d))
    attributes = _attributes(db.attributes, db.global_defines)
    skipped = {}
    if db.env_vars:
        skipped["EV_"] = len(db.env_vars)
    groups = sum(len(f.signalGroups) for f in db.frames)
    if groups:
        skipped["SIG_GROUP_"] = groups
    return {
        "version": "",
        "nodes": [
            {
                "name": str(ecu.name),
                **({"comment": str(ecu.comment)} if ecu.comment else {}),
                "attributes": _attributes(ecu.attributes, db.ecu_defines),
            }
            for ecu in db.ecus
        ],
        "messages": messages,
        "valueTables": [
            {"name": str(name), "values": {int(k): str(v) for k, v in values.items()}}
            for name, values in (db.value_tables or {}).items()
        ],
        "attributeDefinitions": definitions,
        "attributes": attributes,
        "problems": list(problems),
        "skipped": skipped,
    }


# ---------------------------------------------------------------- problems

_LINE_RE = re.compile(r"(?:line(?: no)?:?|sourceline)\s*(\d+)", re.IGNORECASE)
_BYTES_RE = re.compile(r"^b(['\"])(.*)\1$")


def _contained_pdus(dbs):
    """Notes for the contained PDUs of container frames, which the mapping does not show.

    canmatrix keeps an AUTOSAR container frame's contained PDUs in frame.pdus,
    with their own signals; CanViewer's model has no place for them, so each
    container frame that has some gets a note rather than losing them silently.
    """
    notes = []
    several = len([db for db in (dbs or {}).values() if db is not None]) > 1
    for cluster, db in (dbs or {}).items():
        if db is None:
            continue
        for frame in db.frames:
            pdus = list(getattr(frame, "pdus", None) or [])
            if not pdus:
                continue
            signals = sum(len(pdu.signals) for pdu in pdus)
            where = "frame %s%s" % (frame.name, " of cluster %s" % cluster if several else "")
            notes.append(
                "NOTE canviewer_adapter: %s holds %d contained PDU%s with %d signal%s, which CanViewer does not show"
                % (where, len(pdus), "" if len(pdus) == 1 else "s", signals, "" if signals == 1 else "s")
            )
    return notes


def _problems(printed, logged, notes):
    """ParseProblem entries from what canmatrix printed and logged.

    canmatrix's DBC reader prints "error with line no: N" and then the
    offending line as a bytes literal; the two are joined into one problem.
    """
    out = []
    awaiting_text = False
    for line in printed:
        content = _BYTES_RE.match(line.strip())
        if awaiting_text and content:
            out[-1]["text"] = content.group(2).replace("\\n", "").strip()
            awaiting_text = False
            continue
        number = _LINE_RE.search(line)
        awaiting_text = bool(number) and line.strip().lower().startswith("error with line no")
        if awaiting_text:
            out.append({"line": int(number.group(1)), "text": "", "reason": "canmatrix could not read this line"})
        else:
            out.append({"line": int(number.group(1)) if number else 0, "text": line, "reason": "canmatrix printed"})
    previous = (None, 0)
    for line in logged:
        number = _LINE_RE.search(line)
        level, _, rest = line.partition(" ")
        source = rest.split(":", 1)[0]
        # A detail line (the SYM reader logs "Error decoding line 181", then
        # the offending text) takes the number of the entry right before it.
        line_no = int(number.group(1)) if number else (previous[1] if previous[0] == source else 0)
        out.append({"line": line_no, "text": line, "reason": "canmatrix " + level.lower()})
        previous = (source, line_no if number else 0)
    for line in notes:
        out.append({"line": 0, "text": line, "reason": "import note"})
    return out


def _locate(problems, data, encoding):
    """Put the real line number on problems whose text can be found in the file.

    canmatrix's line numbers are not reliable: the DBC reader's VAL_ and
    VAL_TABLE_ parsing reuses its line counter as a loop index (dbc.py,
    canmatrix 1.3.3), so every number after the first value table is wrong,
    and the SYM reader's numbers were six lines early on canmatrix's own
    tests/files/sym/test.sym. Where canmatrix quotes the offending line (DBC)
    or its content (a SYM detail line), that text is looked up in the file,
    searching on from the previous match, and the number found replaces
    canmatrix's, on the detail line and on the error entry it belongs to.
    """
    try:
        lines = [line.strip() for line in data.decode(encoding or "iso-8859-1", "replace").splitlines()]
    except LookupError:
        return
    position = 0

    def find(text, exact):
        nonlocal position
        for index in list(range(position, len(lines))) + list(range(0, position)):
            if (lines[index] == text) if exact else (text in lines[index]):
                position = index + 1
                return index + 1
        return None

    for i, problem in enumerate(problems):
        if problem["reason"] == "canmatrix could not read this line":
            found = find(problem["text"].strip(), True) if problem["text"] else None
            if found:
                problem["line"] = found
        elif problem["reason"].startswith("canmatrix ") and problem["reason"] != "canmatrix printed":
            message = problem["text"].split(": ", 1)[-1].strip()
            if len(message) < 8 or message.lower().startswith("error decoding line"):
                continue
            found = find(message, False)
            if found:
                head = problems[i - 1] if i > 0 else None
                if head and head["line"] == problem["line"] and head["reason"] == problem["reason"]:
                    head["line"] = found
                problem["line"] = found


# ---------------------------------------------------------------- entry point


def read(data, import_type, options=None):
    """Load `data` (bytes) as `import_type` and map every cluster it holds.

    Returns {"clusters": [{"name": str, "db": DbcDatabase dict}], "log": [str],
    "error": str or None}. A loader exception is reported in "error" instead of
    raised, so a broken file never takes the interpreter down with it. Problems
    are file-level and appear in every cluster's "problems".
    """
    logged = []
    handler = _Collect(logged)
    root = logging.getLogger()
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.WARNING)
    printed = io.StringIO()
    clusters = []
    error = None
    if hasattr(data, "to_bytes"):  # a JavaScript Uint8Array passed in by Pyodide
        data = data.to_bytes()
    data = bytes(data)
    options = dict(options or {})
    notes = []
    if import_type in _ENCODING_OPTION and _ENCODING_OPTION[import_type] not in options:
        # canmatrix assumes ISO-8859-1; decode as the app does for DBC: UTF-8
        # when the bytes are valid UTF-8, else Windows-1252.
        try:
            data.decode("utf-8")
            options[_ENCODING_OPTION[import_type]] = "utf-8"
        except UnicodeDecodeError:
            options[_ENCODING_OPTION[import_type]] = "cp1252"
    dbs = None
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
    except Exception as e:  # noqa: BLE001 - reported to the caller, not swallowed
        error = "%s: %s" % (type(e).__name__, e)
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)
    if error is None:
        notes.extend(_contained_pdus(dbs))
    printed_lines = [line for line in printed.getvalue().splitlines() if line.strip()]
    problems = _problems(printed_lines, logged, notes)
    _locate(problems, data, options.get(_ENCODING_OPTION.get(import_type, ""), None))
    if error is None:
        try:
            for name, db in (dbs or {}).items():
                if db is not None:
                    clusters.append({"name": str(name), "db": _database(db, problems)})
        except Exception as e:  # noqa: BLE001 - a mapping bug must surface, not crash
            clusters = []
            error = "mapping failed: %s: %s" % (type(e).__name__, e)
    log = printed_lines + logged + notes
    return {"clusters": clusters, "log": log, "error": error}


def _load(F, data, import_type, options, printed):
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        # Decimal is canmatrix's default and what its readers are written for:
        # with float_factory=float the ARXML reader raises on some files
        # ("'float' object has no attribute 'to_integral'"). The mapping
        # converts to float. Passed explicitly because canmatrix keeps the
        # factory in global state between loads.
        return F.load(io.BytesIO(data), import_type, float_factory=decimal.Decimal, **options)
