# Overview

The overview is the first page after a file opens. It sums up the database and lists
everything that applies to it as a whole.

![The overview of examples/demo.dbc](./images/overview-en-light.webp#gh-light-mode-only)
![The overview of examples/demo.dbc](./images/overview-en-dark.webp#gh-dark-mode-only)

## At the top

- The file name, the database's `VERSION` string and its network comment, if it has
  them.
- Five counts: **messages**, **signals**, **nodes**, **value tables** and **attribute
  definitions**.
- A status line. Either the file *parsed without problems*, with what was detected,
  such as *3 J1939 parameter groups and 1 CAN FD frame detected*, or a red banner with
  the number of parse problems, followed by the table of problems (line, reason,
  content). The table shows the first 200; a note gives the count of the rest.

## Messages

Every message, sorted by ID, with its ID in hex, name, DLC, number of signals, sender,
cycle time (from the `GenMsgCycleTime` attribute) and the first line of its comment.
A tag marks CAN FD frames (**FD**), J1939 parameter groups (**J1939**) and other
extended frames (**EXT**). In a J1939 database a **PGN** column is added. Click a row to
open the message.

How CanViewer decides what is CAN FD or J1939:

- **CAN FD**: Vector's `VFrameFormat` attribute decides when it is set, on the message
  or as the attribute's default (`StandardCAN_FD`, `ExtendedCAN_FD`). Without it, a
  payload of more than 8 bytes means CAN FD.
- **J1939**: a message whose `VFrameFormat` is `J1939PG` is a J1939 parameter group. A
  database counts as J1939 when its `ProtocolType` attribute says so, or when it has
  such a parameter group; in a J1939 database every extended frame is shown as J1939.

## Below the messages

- **Attribute definitions** (`BA_DEF_`, with their defaults from `BA_DEF_DEF_`): name,
  what they apply to (network, node, message, signal), type, range, default and enum
  values.
- **Network attributes**: attribute values set on the database itself.
- **Not displayed (parsed & skipped)**: statements CanViewer recognizes but does not
  model, with how often each occurs, for example `NS_ (1×) · BS_ (1×)`.
