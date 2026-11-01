# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Report it privately instead,
through GitHub's private vulnerability reporting: on the repository's page, open
**Security**, then **Report a vulnerability**. Only the maintainer sees the report.

A useful report says:

- what you found, and what an attacker could do with it;
- how to reproduce it: the steps, and the smallest file that triggers it, if a file
  does. Strip anything confidential from the file first; a database made up for the
  report is best;
- where you saw it: the web app (which browser, and the address you opened it from) or
  the desktop app (which version, on which system), or the commit you built.

The maintainer answers in the report, works on a fix there, and publishes the advisory
with the release that fixes it, crediting you if you want to be credited.

## Supported versions

Fixes go into `main` and the next release. Older releases do not get fixes; update to
the latest one.

## What counts as a vulnerability

CanViewer promises that the files it opens never leave the machine, and that the app
makes no request outside its own origin: the Pyodide runtime, the Python packages, the
fonts and the icons are all served with the app, and the desktop app makes no network
request at all. Anything that breaks that promise is a vulnerability. For example:

- a request to another host, from the web app or the desktop app, made on its own or
  caused by a file;
- a crafted database file (DBC, ARXML or any other format CanViewer reads) that runs
  script in the page, reaches the desktop shell, or reads files it was not given;
- data from an opened file that reaches anywhere other than the browser's own storage
  on the user's machine;
- a vulnerability in a bundled third-party component (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) that CanViewer exposes.

A file that makes CanViewer show something wrong, or fail to open, is a bug rather
than a vulnerability: please open an issue for it.
