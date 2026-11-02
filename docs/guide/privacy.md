# Privacy and offline use

CAN databases are often confidential. CanViewer is built so that opening one does not
share it with anyone.

## Your files never leave your machine

- A file you open is read by the app in your browser (or in the desktop app). It is
  never uploaded: the app has no server to upload to.
- DBC files are parsed by JavaScript in the page. Other formats are read by canmatrix
  running in a Web Worker in the same browser, from a runtime the app ships itself.
- The last file you opened is kept in your browser's storage (a DBC file in local
  storage, an imported file in IndexedDB), so that it comes back after a reload. It
  stays on your machine. **Close file** in the settings menu forgets it, in the web app
  and in the desktop app; so does clearing the site's data in your browser, or deleting
  the desktop app's data folder ([where](./install.md#where-the-app-keeps-its-files)).
- A log you replay in the [Traces view](./traces.md), the other version on the
  [Compare page](./diff.md), and the files you [export](./export.md) or
  [save as DBC](./editing.md) are made in the page too. A log and the other version
  are not stored at all.
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

The app is served from `https://joshualeichsering.github.io/CanViewer/app/`. Browsers
keep storage per origin (scheme, host and port), not per path, so the copy of the last
file the app keeps (local storage and IndexedDB, above) is in the storage of
`https://joshualeichsering.github.io`, which every GitHub Pages site of that account
shares: a page of any other site the account publishes there could read it. To leave
nothing behind, use **Close file** when you are done, or use the desktop app, whose
storage is its own.

If you would rather not load the app from GitHub at all, use the
[desktop app](./desktop.md), or build the web app yourself and serve it from your own
machine (see the [developer guide](../develop/index.md)).

## Offline use

- **Web app**: after the first visit, a service worker keeps the app's files in your
  browser, so the app opens and reads DBC files without a network, and *About
  CanViewer* still shows the license texts and the third-party notices. The Python runtime is
  cached the first time you open a non-DBC file; after that, imports work offline too.
  A browser that has never imported a file cannot do so offline: the import then fails
  with a message, and the app keeps working for DBC files.
- **Desktop app**: everything is inside the program. It works offline from the start
  and makes no network requests at all. Its content security policy allows the window
  to load only the app's own files, and the worker that reads non-DBC formats runs under
  the same policy, so it cannot reach another host either. The web app has no such
  policy: GitHub Pages cannot send the header, and a policy in the page itself would not
  reach its import worker
  ([why](../decisions/0009-desktop-shell.md#alternatives-considered)). There, the checks
  above stand in for it.
