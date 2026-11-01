# Privacy and offline use

CAN databases are often confidential. CanViewer is built so that opening one does not
share it with anyone.

## Your files never leave your machine

- A file you open is read by the app in your browser (or in the desktop app). It is
  never uploaded: the app has no server to upload to.
- DBC files are parsed by JavaScript in the page. Other formats are read by canmatrix
  running in a Web Worker in the same browser, from a runtime the app ships itself.
- The last DBC file you opened is kept in your browser's local storage, so that it comes
  back after a reload. It stays on your machine; clearing the site's data in your
  browser removes it.
- Links to a view (`#msg=…`) name a message, not its content, and the part after `#`
  is never sent to the web server.

## No request outside the app's origin

The app loads everything from the place it was served from: its code, its fonts and
icons, and the Python runtime with its packages, each package checked against a
pinned SHA-256 checksum. It contacts no other host: no CDN, no font service, no
analytics, no error reporting, no update check.

This is tested, not promised. Every change to CanViewer runs a check that drives the
built app in Chromium, opens DBC and ARXML files online and offline, and records every
request three ways (the browser's request events, a HAR file and Chromium's own network
log). It fails on any request to another origin. The check runs against the app as it
is published here too, under `/app/`, and the same kind of check crawls every page of
this documentation site.

## What the web host sees

This site and the web app are published with GitHub Pages. Like any web host, GitHub
serves the app's files and so sees the requests for them: your IP address, your browser
and the time, for the app's pages, scripts and styles, and for the Python runtime when
you first open a non-DBC file. It does not see your files, their names, or anything
you do in the app; none of it is sent. GitHub's own privacy statement covers what it
logs.

If you would rather not load the app from GitHub at all, use the
[desktop app](./desktop.md), or build the web app yourself and serve it from your own
machine (see the [developer guide](../develop/index.md)).

## Offline use

- **Web app**: after the first visit, a service worker keeps the app's files in your
  browser, so the app opens and reads DBC files without a network. The Python runtime is
  cached the first time you open a non-DBC file; after that, imports work offline too.
  A browser that has never imported a file cannot do so offline: the import then fails
  with a message, and the app keeps working for DBC files.
- **Desktop app**: everything is inside the program. It works offline from the start
  and makes no network requests at all.
