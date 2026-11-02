# Deep links

The part of the app's address after `#` names the view on screen. CanViewer keeps it
current as you navigate, and reads it when the app starts with a stored file (see
[Links to a message](../guide/opening-files.md#links-to-a-message)).

| Fragment | View |
|---|---|
| *(none)* | The overview |
| `#msg=<id>` | A message |
| `#msg=<id>/<signal>` | A message, with one of its signals selected |
| `#msg=<id>.<n>` | The message with that ID that comes `n`-th in the file, counting from 0, for files that define the same ID more than once (`#msg=<id>` is the first) |
| `#node=<name>` | A node |
| `#vt=<name>` | A value table |
| `#graph` | The network graph |
| `#diff` | The Compare page ([comparing two databases](../guide/diff.md)); the other version is not part of the link, so it opens empty |
| `#trace` | The Traces view ([replaying traces](../guide/traces.md)); the log is not part of the link either |

- `<id>` is the message ID as written in the DBC file, in decimal. For an extended
  (29-bit) message that includes the extended-frame flag, bit 31: the message with ID
  `0x0CF00400` in [`examples/demo.dbc`](../../examples/demo.dbc) is written
  `BO_ 2364539904` and linked as `#msg=2364539904`.
- Names are URL-encoded (`encodeURIComponent`).
- A fragment that names nothing in the open file shows the overview.

Examples, for `examples/demo.dbc`: `#msg=256/EngineSpeed` (the signal EngineSpeed in
EngineData), `#node=ECM`, `#vt=GearPositions`.
