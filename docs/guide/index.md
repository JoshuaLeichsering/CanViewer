# What CanViewer is

CanViewer is a viewer for CAN databases: the files that describe which messages a CAN
bus carries, which signals each message packs into its bytes, and how to turn raw bits
into physical values. It runs in your browser, or as a desktop app, and reads the file
on your own machine. Beyond viewing, it decodes and encodes frames, replays logs,
compares two versions, exports lists and code, and edits and saves DBC files.

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

## What it does with a database

| Page | What you do |
|---|---|
| [Importing other formats](./import.md) | Read ARXML and the other formats through canmatrix, pick a cluster |
| [Exporting](./export.md) | Save the message and signal lists as CSV or JSON, copy a message as a C struct or decode pseudo-code |
| [Comparing two databases](./diff.md) | See what was added, removed or changed between two versions |
| [Replaying traces](./traces.md) | Decode every frame of a candump or Vector ASC log |
| [Encoding frames](./encoder.md) | Enter physical values and get a frame's bytes |
| [Editing](./editing.md) | Change messages and signals, and save the result as DBC |

The interface follows Material 3, in English and German, light and dark: see
[Language and theme](./settings.md).

## Your data stays yours

CanViewer never uploads a file. The web app is a set of static files; once it has
loaded, everything happens in your browser, and after the first visit it also works
offline. [Privacy and offline use](./privacy.md) explains what the host of the app can
and cannot see.

## Free software

CanViewer is free software under the GNU General Public License, version 2 or later,
and comes with no warranty. **About CanViewer**, in the app's settings menu, says so, with
the version, the source link, and the license files and third-party notices, which it
opens in the app itself (see [Language and theme](./settings.md#about-canviewer)). The
same files come with every copy: next to the web app as `COPYRIGHT.txt` (the notice, with
an additional permission for the Windows build), `LICENSE.txt` and `LICENSE-GPL-3.0.txt`
(the texts of the GPL versions 2 and 3) and `THIRD_PARTY_NOTICES.md`, inside every desktop
package ([where](./install.md#where-the-app-keeps-its-files)), and with this site, linked at
the foot of its home page. The source is on
[GitHub](https://github.com/JoshuaLeichsering/CanViewer).

## Where to go next

- [Opening files](./opening-files.md): the ways to open a file, encodings, links to a
  message, and what to do if CanViewer fails.
- [Keyboard](./keyboard.md): the keys for the search, the lists, the tables and the
  dialogs.
- [The desktop app](./desktop.md): the same app as a program for Windows, macOS and
  Linux.
- [Developer guide](../develop/index.md): build and test CanViewer yourself.
