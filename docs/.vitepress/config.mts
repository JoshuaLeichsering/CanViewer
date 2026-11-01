// SPDX-License-Identifier: GPL-2.0-or-later
// The documentation site: VitePress over docs/, published with GitHub Pages
// together with the web app under app/ (see docs/decisions/0006-documentation-site.md).
//
// It makes no request outside its own origin: the theme uses the app's bundled
// fonts instead of a web font, search is VitePress's local index (built into
// the site, no search service), and there are no analytics.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';
import { siteLinks } from './markdown';

const REPO_URL = 'https://github.com/JoshuaLeichsering/CanViewer';
/** Where GitHub Pages publishes the site; links to it stay within the site. */
const SITE_URL = 'https://joshualeichsering.github.io/CanViewer/';
/** The site's base path: `/CanViewer/` on GitHub Pages (set by the Pages workflow). */
const base = process.env.DOCS_BASE ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error(`DOCS_BASE must start and end with "/": ${base}`);

const srcDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
/**
 * Kept in the repository, not on the site: the working notes and evidence of
 * the sessions that built CanViewer (the site's archive page links to them on
 * GitHub), and the design renders.
 */
const EXCLUDED = ['handover', 'spikes', 'design'];

/** Sidebar entries for every page in a directory, titled by their first heading. */
function pagesIn(dir: string): DefaultTheme.SidebarItem[] {
  const path = new URL(`../${dir}/`, import.meta.url);
  return readdirSync(path)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .sort()
    .map((f) => {
      const title = readFileSync(new URL(f, path), 'utf8').match(/^# (.+)$/m)?.[1] ?? f;
      return { text: title.replace(/`/g, ''), link: `/${dir}/${f.replace(/\.md$/, '')}` };
    });
}

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'What CanViewer is', link: '/guide/' },
      { text: 'Opening files', link: '/guide/opening-files' },
      { text: 'Formats and their limits', link: '/guide/formats' },
      { text: 'Privacy and offline use', link: '/guide/privacy' },
    ],
  },
  {
    text: 'Views',
    items: [
      { text: 'Overview', link: '/guide/overview' },
      { text: 'Messages and signals', link: '/guide/messages' },
      { text: 'Decoding frames', link: '/guide/decoding' },
      { text: 'Network graph', link: '/guide/network' },
      { text: 'Nodes', link: '/guide/nodes' },
      { text: 'Value tables', link: '/guide/value-tables' },
      { text: 'Language and theme', link: '/guide/settings' },
    ],
  },
  {
    text: 'Working with databases',
    items: [
      { text: 'Importing other formats', link: '/guide/import' },
      { text: 'Exporting', link: '/guide/export' },
      { text: 'Comparing two databases', link: '/guide/diff' },
      { text: 'Replaying traces', link: '/guide/traces' },
      { text: 'Encoding frames', link: '/guide/encoder' },
      { text: 'Editing', link: '/guide/editing' },
    ],
  },
  {
    text: 'Desktop app',
    items: [
      { text: 'The desktop app', link: '/guide/desktop' },
      { text: 'Install', link: '/guide/install' },
    ],
  },
];

const reference: DefaultTheme.SidebarItem[] = [
  {
    text: 'Reference',
    items: [
      { text: 'Overview', link: '/reference/' },
      { text: 'Formats and fidelity', link: '/reference/formats' },
      { text: 'Supported DBC statements', link: '/reference/dbc' },
      { text: 'Deep links', link: '/reference/deep-links' },
    ],
  },
];

const develop: DefaultTheme.SidebarItem[] = [
  {
    text: 'Developer guide',
    items: [
      { text: 'Getting set up', link: '/develop/' },
      { text: 'Architecture', link: '/develop/architecture' },
      { text: 'The Pyodide worker', link: '/develop/pyodide-worker' },
      { text: 'Tests and baselines', link: '/develop/testing' },
      { text: 'Documentation', link: '/develop/documentation' },
      { text: 'Release process', link: '/develop/release' },
      { text: 'The two ARXML readers', link: '/develop/arxml-readers' },
    ],
  },
  // Reports written for upstream projects, listed by themselves when there are any.
  ...(existsSync(new URL('../develop/upstream/', import.meta.url))
    ? [
        {
          text: 'Upstream reports',
          items: [
            ...(existsSync(new URL('../develop/upstream/index.md', import.meta.url))
              ? [{ text: 'About the reports', link: '/develop/upstream/' }]
              : []),
            ...pagesIn('develop/upstream'),
          ],
        },
      ]
    : []),
];

const decisions: DefaultTheme.SidebarItem[] = [
  { text: 'Decision records', items: [{ text: 'About the records', link: '/decisions/' }, ...pagesIn('decisions')] },
  { text: 'Archive', items: [{ text: 'Working notes', link: '/archive/' }] },
];

export default defineConfig({
  title: 'CanViewer',
  description: 'A viewer for CAN databases that runs in the browser: DBC, ARXML and more, with nothing leaving your machine.',
  lang: 'en',
  base,
  srcExclude: EXCLUDED.map((dir) => `${dir}/**`),
  cleanUrls: false,
  lastUpdated: false,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }]],
  markdown: {
    config(md) {
      siteLinks(md, {
        repoRoot,
        srcDir,
        excluded: EXCLUDED,
        repoUrl: REPO_URL,
        branch: 'main',
        siteUrl: SITE_URL,
        base,
      });
    },
  },
  themeConfig: {
    logo: '/icon.svg',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
      { text: 'Reference', link: '/reference/', activeMatch: '^/reference/' },
      { text: 'Develop', link: '/develop/', activeMatch: '^/develop/' },
      { text: 'Decisions', link: '/decisions/', activeMatch: '^/(decisions|archive)/' },
      // The web app is published next to the site, outside the page router.
      { text: 'Open the app', link: '/app/', target: '_self' },
    ],
    sidebar: {
      '/guide/': guide,
      '/reference/': reference,
      '/develop/': develop,
      '/decisions/': decisions,
      '/archive/': decisions,
    },
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: REPO_URL }],
    editLink: { pattern: `${REPO_URL}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: {
      message: 'Released under the GNU General Public License, version 2 or later.',
    },
  },
  vite: {
    plugins: [
      {
        // The site's icon is the app's icon, taken from desktop/ rather than copied.
        name: 'canviewer-docs-icon',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url?.split('?')[0] !== `${base}icon.svg`) return next();
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(readFileSync(new URL('../../desktop/app-icon.svg', import.meta.url)));
          });
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'icon.svg',
            source: readFileSync(new URL('../../desktop/app-icon.svg', import.meta.url)),
          });
        },
      },
    ],
  },
});
