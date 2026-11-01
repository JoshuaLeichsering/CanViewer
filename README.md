# CanViewer

A viewer for CAN databases that runs in your browser or as a desktop app. Open a DBC
file and browse its messages, signals, bit layouts, network and value tables. Decode
and encode frames, replay a candump or Vector ASC log through the database, compare two
versions, export the lists as CSV or JSON and a message as C code, and edit messages and
signals and save the result as DBC. ARXML, KCD, SYM, Excel (`.xlsx`) and a few more
formats are imported through canmatrix, with known limits that the
[format reference](docs/reference/formats.md) measures for each. Files are read on your
machine and never uploaded; the app makes no request outside its own origin and works
offline.

![CanViewer showing a message of examples/demo.dbc: its signals, bit layout and details](docs/guide/images/message-en-light.webp#gh-light-mode-only)
![CanViewer showing a message of examples/demo.dbc: its signals, bit layout and details](docs/guide/images/message-en-dark.webp#gh-dark-mode-only)

## Try it

Once the repository is public, the web app is published with GitHub Pages at
[joshualeichsering.github.io/CanViewer/app](https://joshualeichsering.github.io/CanViewer/app/),
next to the documentation at
[joshualeichsering.github.io/CanViewer](https://joshualeichsering.github.io/CanViewer/).
Open it and drop [`examples/demo.dbc`](examples/demo.dbc) onto the window. Until then,
run it locally (see [Develop](#develop)) and read the documentation in
[`docs/`](docs/), starting with the [user guide](docs/guide/index.md).

## Install

The desktop app for Windows, macOS and Linux is offline from the start. The
[install guide](docs/guide/install.md) takes you from a release on the repository's
GitHub Releases page to a running app, and back out.

## Develop

```sh
git clone --recurse-submodules https://github.com/JoshuaLeichsering/CanViewer.git
cd CanViewer
npm ci
npm run dev    # the app on http://localhost:5173
npm test       # unit and component tests, and the corpus suites
```

The [developer guide](docs/develop/index.md) covers the setup, the repository layout,
the [architecture](docs/develop/architecture.md), the
[tests and baselines](docs/develop/testing.md) and the
[release process](docs/develop/release.md). [CONTRIBUTING.md](CONTRIBUTING.md) lists the
checks CI runs, to run them before you push; the [decision records](docs/decisions/index.md)
explain why things are the way they are. Planned work is in [`BACKLOG.md`](BACKLOG.md).

## License

CanViewer is free software under the GNU General Public License, version 2 or (at your
option) any later version: see [LICENSE](LICENSE). The third-party components it ships,
and their licenses, are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). To
report a vulnerability, see [SECURITY.md](SECURITY.md).
