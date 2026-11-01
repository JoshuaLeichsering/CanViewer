# Messages and signals

**Messages** in the navigation rail opens a list of every message next to the page of
the selected one.

![The message EngineData from examples/demo.dbc, with EngineSpeed selected](./images/message-en-light.webp#gh-light-mode-only)
![The message EngineData from examples/demo.dbc, with EngineSpeed selected](./images/message-en-dark.webp#gh-dark-mode-only)

## The message list

Messages are sorted by ID and show the ID in hex, the name, the sender, the number of
signals and the cycle time, with the same **FD**, **J1939** and **EXT** tags as the
[overview](./overview.md).

- **Search** filters by message name, by signal name, and by ID in hex or decimal:
  `0x64`, `64` and `100` all find the message with ID 100 (0x64).
- **Filter chips** narrow the list to **Extended** (29-bit) messages or **CAN FD**
  frames.

<!-- TODO(phase-2, W6): keyboard navigation (up and down through the messages, `/` to
focus the search). TODO(phase-2, W7): sortable and filterable signal columns, and the
virtualized list for databases with more than 1000 messages. -->

## The message page

- **The header**: the name, the ID in hex and decimal, and chips for extended, CAN FD
  and J1939 frames. **Copy link** copies a [link to this message](./opening-files.md#links-to-a-message).
- **Facts**: DLC in bytes, sender (and further transmitters from `BO_TX_BU_`), cycle
  time, send type (`GenMsgSendType`) and the number of signals.
- **J1939**: for a J1939 frame, the identifier broken down into priority, PGN (with the
  SAE name of well-known parameter groups), PDU format with destination, source
  address (with well-known address names) and data page.

  ![The J1939 message J1939_EEC1, with its identifier broken down](./images/j1939-en-light.webp#gh-light-mode-only)
  ![The J1939 message J1939_EEC1, with its identifier broken down](./images/j1939-en-dark.webp#gh-dark-mode-only)

- **Warnings**, in red, for a signal that runs past the end of the data, and for two
  signals that use the same bits. Multiplexed signals that are alternatives of each
  other may share bits; they are not flagged.
- **Notes**, in amber, on the frame size: a size above 8 bytes that CAN FD cannot carry
  as such (it would be padded to the next valid size, 12, 16, 20, 24, 32, 48 or 64
  bytes), more than 64 bytes, or more than 8 bytes on a frame that `VFrameFormat`
  declares classic CAN. J1939 parameter groups are exempt: they may be longer.
- **The message's comment**, if it has one.

## The bit layout

The bit layout draws the frame one byte per row, bit 7 on the left. Every signal is a
tonal block, numbered on its start bit. Motorola (big-endian) signals run across bytes
in the sawtooth order the DBC format uses. Bits two signals share are marked as a
conflict, unless the signals are multiplexed alternatives. In a large CAN FD frame, the
unused bytes at the end collapse into one row.

Selecting a signal, in the table or in the bit layout, highlights it in both and opens
its details.

## The signal table

![The signal table of DiagData, a multiplexed message](./images/signals-en-light.webp#gh-light-mode-only)
![The signal table of DiagData, a multiplexed message](./images/signals-en-dark.webp#gh-dark-mode-only)

One row per signal: name, multiplexing, start bit and length as written in the DBC,
byte order (Intel or Motorola), value type (`unsigned`, `signed`, or `float` and
`double` from `SIG_VALTYPE_`), factor, offset, minimum, maximum, unit and receivers.

The multiplexing column shows `M` for the multiplexor and `m0`, `m1`, … for the signals
that are present only when the multiplexor has that value. Extended multiplexing
(`SG_MUL_VAL_`, a signal switched by a value range of another multiplexed signal) is
shown as well.

## The signal card

For the selected signal: how the raw value becomes a physical one (`raw × factor +
offset`), the range and unit, the bits (start, length, byte order), receivers, value
type, multiplexing, its comment, its value descriptions (`VAL_`) and its attributes.
When a frame is being [decoded](./decoding.md), the value description that matches
the decoded value is marked.
