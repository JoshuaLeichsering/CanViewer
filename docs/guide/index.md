# What CanViewer is

CanViewer is a viewer for CAN databases: the files that describe which messages a CAN
bus carries, which signals each message packs into its bytes, and how to turn raw bits
into physical values. It runs in your browser, or as a desktop app, and reads the file
on your own machine.

![CanViewer with examples/demo.dbc open, showing the message EngineData](./images/message-en-light.webp#gh-light-mode-only)
![CanViewer with examples/demo.dbc open, showing the message EngineData](./images/message-en-dark.webp#gh-dark-mode-only)

## Try it

1. Open the app: [CanViewer on GitHub Pages](https://joshualeichsering.github.io/CanViewer/app/),
   or the **Open the app** button at the top of this site.
2. Download the example database, [`examples/demo.dbc`](../../examples/demo.dbc), and
   drop it onto the window, or choose **Open file…**.
3. Browse: the **Overview** sums up the database, **Messages** lists every message with
   its signals and bit layout, and **Network** draws which ECU sends what to whom.

The example is small on purpose and exercises most features: CAN FD, J1939, extended
multiplexing, value tables and attributes.

## What it reads

- **DBC** (Vector's CAN database format), with CanViewer's own parser. It opens
  instantly and reports every line it cannot read.
- **ARXML, KCD, SYM, DBF, Excel (`.xlsx`), JSON, YAML, FIBEX and ODX**, through
  [canmatrix](https://github.com/ebroecker/canmatrix) running in your browser. The
  first such file downloads about 16 MB of runtime, once.

How faithfully each format comes across is measured, not guessed: see
[Formats and their limits](./formats.md) and the generated
[fidelity tables](../reference/formats.md).

## What it shows

| View | What you see |
|---|---|
| [Overview](./overview.md) | The database at a glance: counts, CAN FD and J1939 detection, parse problems, every message, attribute definitions |
| [Messages and signals](./messages.md) | A searchable message list; per message its facts, signal table, bit layout and signal details |
| [Decoding frames](./decoding.md) | Paste a frame's bytes and read every signal's physical value |
| [Network graph](./network.md) | Which ECU sends messages to which, as an interactive graph |
| [Nodes](./nodes.md) | Per ECU, the messages it transmits and the signals it receives |
| [Value tables](./value-tables.md) | Named value tables and the signals that use the same values |

The interface follows Material 3, in English and German, light and dark: see
[Language and theme](./settings.md).

## Your data stays yours

CanViewer never uploads a file. The web app is a set of static files; once it has
loaded, everything happens in your browser, and after the first visit it also works
offline. [Privacy and offline use](./privacy.md) explains what the host of the app can
and cannot see.

## Where to go next

- [Opening files](./opening-files.md): the ways to open a file, encodings, and links
  to a message.
- [The desktop app](./desktop.md): the same app as a program for Windows, macOS and
  Linux.
- [Developer guide](../develop/index.md): build and test CanViewer yourself.
