# Documentation

This site is built with [VitePress](https://vitepress.dev/) from `docs/` and published
with GitHub Pages, together with the web app under `/app/`.
[Decision record 0006](../decisions/0006-documentation-site.md) explains the choices.

## Working on the site

```sh
npm run docs:dev       # the site with hot reload, on http://localhost:5173/
npm run docs:build     # build into docs/.vitepress/dist/
npm run docs:preview   # serve that build
```

| Path | What it holds |
|---|---|
| `docs/.vitepress/config.mts` | Navigation, sidebars, search, and what is published |
| `docs/.vitepress/markdown.ts` | The link and image rules that let one Markdown source work on GitHub and on the site |
| `docs/.vitepress/theme/` | VitePress's default theme without its web font, with the app's fonts and colours |
| `docs/guide/` | The user guide, and its screenshots in `docs/guide/images/` |
| `docs/reference/` | The format and DBC reference, partly generated |
| `docs/develop/` | This developer guide |
| `docs/decisions/` | The decision records |
| `docs/archive/` | The page that lists the working notes |
| `docs/handover/`, `docs/spikes/`, `docs/design/` | The working notes: kept in the repository, not published |

## Writing pages

- Write Markdown that reads well on GitHub too: the pages are also read there.
- Link with relative paths, including the `.md` extension: `[Decoding](./decoding.md)`.
  A link to a file outside the site, such as `../../app/src/lib/dbc/parser.ts`, becomes a
  link to that file on GitHub, and the build fails if the file does not exist.
- Link to the web app with its published address,
  `https://joshualeichsering.github.io/CanViewer/app/`; on the site it becomes a link
  within the site.
- Use GitHub's alerts (`> [!NOTE]`, `> [!WARNING]`) rather than VitePress's containers;
  both render them.
- Give every screenshot a light and a dark variant, marked with GitHub's fragments, and
  describe what it shows in the alt text:

  ```md
  ![The overview of examples/demo.dbc](./images/overview-en-light.webp#gh-light-mode-only)
  ![The overview of examples/demo.dbc](./images/overview-en-dark.webp#gh-dark-mode-only)
  ```

- A new guide page goes into the sidebar in `config.mts`. A new decision record is
  listed by itself; add it to the table in `decisions/index.md`.

## Screenshots

[`scripts/screenshots.mjs`](../../scripts/screenshots.mjs) takes every screenshot from a
running production build in Chromium, in English and German, light and dark, and writes
WebP files to `docs/guide/images/`. Some shots open corpus files, so check out the
submodules first.

```sh
npm run build
npx vite preview --port 4173 --strictPort &
node scripts/screenshots.mjs http://localhost:4173/
```

`--all` takes every shot in all four variants, `--only overview,message` a few, and
`--out <dir>` writes elsewhere. The script blocks every host but `localhost` and fails if
the app requested anything else. After a UI change, regenerate the images and review them
in the diff; commit only those the site uses.

## Generated tables

The tables in [Formats and fidelity](../reference/formats.md) and
[Supported DBC statements](../reference/dbc.md) sit between
`<!-- generated:<name> -->` markers and are written by
[`scripts/docs/fidelity-tables.mjs`](../../scripts/docs/fidelity-tables.mjs) from the
three baselines. Edit the text around them, never inside them. After a baseline changes:

```sh
node scripts/docs/fidelity-tables.mjs           # rewrite the tables
node scripts/docs/fidelity-tables.mjs --check   # or only check them
```

[`reference-docs.test.ts`](../../app/src/lib/reference-docs.test.ts), part of `npm test`,
regenerates the tables and fails when a page does not match the baselines. It also checks
that the format table names exactly the formats in `formats.ts`, that every kind of
difference in the baselines has a label, and that the DBC reference lists every
statement the parser skips.

Numbers that the prose repeats are checked too, on every page: the counts of the
corpora (*58 real-world DBC files*, *114 files in other formats*, *70 comparisons with
their DBC twins*, and the like) against the baselines, and the download sizes of the
first import against the files that make it up. Write such a number in one of the forms
the test knows, or add a pattern for a new one; the test lists them.

## Checks

| Check | What it proves |
|---|---|
| `npx tsc -p docs/.vitepress` | The site's configuration and Markdown rules type-check |
| `node scripts/docs/check-links.mjs --sources` | Every relative link in every Markdown file of the repository points at a file that exists, and every `#fragment` on a link to a Markdown file at one of its headings |
| `vitepress build docs` | VitePress's own check of links between pages, the link rule's check of links to repository files, and [`site-legal.mjs`](../../scripts/docs/site-legal.mjs)'s check that `THIRD_PARTY_NOTICES.md` covers every package the pages bundle |
| `node scripts/docs/check-links.mjs --site <dir> --base /CanViewer/` | In the built site, every link and asset resolves to a file, every `#fragment` to an id, nothing leaves the base path, and every page is linked from another |
| `node e2e/docs-crawl.mjs <site-url> <out-dir>` | Chromium visits every page and runs a search, with every host but `localhost` blocked: no request outside the origin, no failed request, no error in the page |
| `node e2e/network-check.mjs` against `/app/` | The web app as published makes no request outside its origin, online and offline |

## License and notices

The site's pages carry VitePress's default theme, Vue and a few small libraries, besides
the app's fonts. [`scripts/docs/site-legal.mjs`](../../scripts/docs/site-legal.mjs), a
plugin of the site's build, fails the build when `THIRD_PARTY_NOTICES.md` has no row for
a package the pages bundle, or when `DOCS_SITE` in `scripts/license-policy.mjs` lists one
they do not. It publishes `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` next to the pages,
and the footer of the home page links both.

## Publishing

[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) builds and checks the
site:

1. builds the app with a relative base (`npm run build -- --base ./`) and the site with
   `DOCS_BASE=/<repository>/`;
2. assembles them as GitHub Pages will serve them: the site at the root, the app under
   `app/`;
3. runs the link checks, then serves the assembled site with
   [`e2e/static-server.mjs`](../../e2e/static-server.mjs), which answers like GitHub
   Pages, and runs the network check against `/app/` and the crawl over the site;
4. on `main`, and only when the repository is public, uploads the site and deploys it to
   GitHub Pages.

It runs on pull requests that touch the app, the docs, the Markdown files at the root,
their scripts or the workflow (build and checks only), on pushes to `main`, and on
demand. The source link check also runs in `ci.yml`, on every push and pull request. Pages has to be enabled
once in the repository's settings (source: GitHub Actions); a private repository needs
a paid plan for it, so the site goes live when the repository is public.

To check the published layout locally:

```sh
npm run build -- --base ./
DOCS_BASE=/CanViewer/ npm run docs:build
mkdir -p _pages/CanViewer
cp -R docs/.vitepress/dist/. _pages/CanViewer/
cp -R dist _pages/CanViewer/app
node scripts/docs/check-links.mjs --site _pages/CanViewer --base /CanViewer/
node e2e/static-server.mjs _pages 4174 &
node e2e/docs-crawl.mjs http://localhost:4174/CanViewer/ docs-crawl
```
