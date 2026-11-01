# CanViewer

A viewer for CAN databases that runs in your browser. Open a DBC file, or ARXML, KCD,
SYM, DBF, FIBEX, ODX, Excel, JSON or YAML, and browse its messages, signals, bit
layouts, network and value tables. Decode and encode frames, replay a CAN log through
the database, compare two versions, export the lists and code, and edit messages and
signals and save the result as DBC. Files are read on your machine and never uploaded;
the app makes no request outside its own origin and works offline.

![CanViewer showing a message of examples/demo.dbc: its signals, bit layout and details](docs/guide/images/message-en-light.webp#gh-light-mode-only)
![CanViewer showing a message of examples/demo.dbc: its signals, bit layout and details](docs/guide/images/message-en-dark.webp#gh-dark-mode-only)

**Documentation:** [joshualeichsering.github.io/CanViewer](https://joshualeichsering.github.io/CanViewer/)
(the sources are in [`docs/`](docs/), starting with the [user guide](docs/guide/index.md)).

## Try it

Open the web app at
[joshualeichsering.github.io/CanViewer/app](https://joshualeichsering.github.io/CanViewer/app/),
then drop [`examples/demo.dbc`](examples/demo.dbc) onto the window. The
[guide](docs/guide/index.md) walks through every view; the
[format reference](docs/reference/formats.md) shows how faithfully each format is read,
measured on real test files.

## Install

CanViewer also runs as a desktop app for Windows, macOS and Linux, offline from the
start. The [install guide](docs/guide/install.md) takes you from the release page to a
running app, and back out.

## Develop

```sh
git clone --recurse-submodules https://github.com/JoshuaLeichsering/CanViewer.git
cd CanViewer
npm ci
npm run dev    # the app on http://localhost:5173
npm test       # unit tests and the corpus suites
```

[CONTRIBUTING.md](CONTRIBUTING.md) lists the checks CI runs, to run them before you
push. The [developer guide](docs/develop/index.md) covers the setup and the repository
layout, the [architecture](docs/develop/architecture.md),
[tests and baselines](docs/develop/testing.md), the
[release process](docs/develop/release.md) and the
[documentation](docs/develop/documentation.md); the
[decision records](docs/decisions/index.md) explain why things are the way they are.
Planned work is in [`BACKLOG.md`](BACKLOG.md).

## License

CanViewer is free software under the GNU General Public License, version 2 or (at your
option) any later version: see [LICENSE](LICENSE). The third-party components it ships,
and their licenses, are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
[CONTRIBUTING.md](CONTRIBUTING.md) says how to set up and check a change, and
[SECURITY.md](SECURITY.md) how to report a vulnerability.
