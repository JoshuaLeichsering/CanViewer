// SPDX-License-Identifier: GPL-2.0-or-later
// The documentation site's license and third-party notices: a Vite plugin for
// the site's build (docs/.vitepress/config.mts), the counterpart of the web
// app's scripts/vite-legal.ts.
//
// - Every npm package with a module or an asset in the site's client bundle
//   must have a row with its version in the contents of THIRD_PARTY_NOTICES.md
//   that says it ships in the documentation site, and every package that
//   DOCS_SITE in scripts/license-policy.mjs lists must be in the bundle: the
//   list is exact in both directions.
// - Every virtual module (code a plugin or a build tool generates rather than
//   reads from a file) must be one of DOCS_SITE's helpers, with its row.
// - CanViewer's license files (COPYRIGHT.txt, LICENSE.txt, LICENSE-GPL-3.0.txt,
//   from LICENSE_FILES in scripts/license-policy.mjs) and THIRD_PARTY_NOTICES.txt
//   are published next to the pages, as plain text that every browser shows,
//   and served by the dev server too.
//
// Regenerate the notices with `node scripts/third-party-notices.mjs`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_SITE, LICENSE_FILES } from '../license-policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'documentation site';

/** The files published next to the pages, and where they come from. */
export const SITE_FILES = {
  ...Object.fromEntries(LICENSE_FILES.map((name) => [`${name}.txt`, name])),
  'THIRD_PARTY_NOTICES.txt': 'THIRD_PARTY_NOTICES.md',
};

/**
 * The npm package a module or asset path belongs to, with the directory of the
 * copy it comes from: absolute for a module, and for an asset, whose path is
 * relative to the site's sources, the same path under the repository root.
 */
function packageOf(path) {
  const m = path.replace(/\\/g, '/').replace(/^\0/, '').match(/^(.*?)(node_modules\/(?:.*node_modules\/)?((?:@[^/]+\/)?[^/]+))/);
  if (!m) return undefined;
  const absolute = /^(\/|[A-Za-z]:\/)/.test(m[1]);
  return { name: m[3], dir: absolute ? m[1] + m[2] : join(root, m[2]) };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the notices' contents table has a row for this component (and version) that ships in the site. */
function hasSiteRow(notices, name, version) {
  const v = version === undefined ? '[^|]+' : escape(version);
  return new RegExp(`^\\| \\[${escape(name)}\\]\\(#[^)]*\\) \\| ${v} \\| [^|]+ \\| [^|]*${SITE}[^|]* \\|$`, 'm').test(notices);
}

/** Whether a module id is a virtual module rather than a file. */
const isVirtual = (id) => id.startsWith('\0') || !/^(\/|[A-Za-z]:[\\/])/.test(id);

/**
 * The problems of one client bundle, given the module ids of its chunks and
 * the source paths of its assets. Exported for the tests.
 */
export function siteBundleProblems({ moduleIds, assetPaths, notices, versionAt }) {
  const problems = [];
  const packages = new Map();
  const helpers = new Set();
  for (const id of moduleIds) {
    const pkg = packageOf(id);
    if (pkg) packages.set(pkg.name, pkg.dir);
    else if (isVirtual(id)) {
      const helper = DOCS_SITE.helpers.find((h) => h.ids.some((re) => re.test(id)));
      if (helper) helpers.add(helper.name);
      else problems.push(`the site holds the virtual module ${JSON.stringify(id)}, which DOCS_SITE.helpers in scripts/license-policy.mjs does not know`);
    }
  }
  for (const path of assetPaths) {
    const pkg = packageOf(path);
    if (pkg) packages.set(pkg.name, pkg.dir);
  }
  for (const [name, dir] of [...packages].sort()) {
    const version = versionAt(dir);
    if (!hasSiteRow(notices, name, version)) problems.push(`${name} ${version} is in the site, but THIRD_PARTY_NOTICES.md has no row for it in the ${SITE}`);
  }
  for (const { name } of DOCS_SITE.packages) {
    if (!packages.has(name)) problems.push(`DOCS_SITE lists ${name}, which the site does not bundle; remove the entry`);
  }
  for (const name of [...helpers].sort()) {
    if (!hasSiteRow(notices, name)) problems.push(`${name} is in the site, but THIRD_PARTY_NOTICES.md has no row for it in the ${SITE}`);
  }
  return problems;
}

const versionAt = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;

/** The Vite plugin; `base` is the site's base path, for the dev server. */
export function siteLegalFiles({ base }) {
  let ssr = false;
  return {
    name: 'canviewer-docs-legal',
    configResolved(config) {
      ssr = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = SITE_FILES[(req.url ?? '').split('?')[0].slice(base.length)];
        if (!file || !req.url?.startsWith(base)) return next();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(join(root, file)));
      });
    },
    generateBundle(_options, bundle) {
      // VitePress renders the pages with a second, server-side bundle, which is not published.
      if (ssr) return;
      const moduleIds = [];
      const assetPaths = [];
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') moduleIds.push(...Object.keys(item.modules));
        else assetPaths.push(...(item.originalFileNames ?? []));
      }
      const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
      const problems = siteBundleProblems({ moduleIds, assetPaths, notices, versionAt });
      if (problems.length) this.error(`${problems.join('\n')}\nRegenerate the notices: node scripts/third-party-notices.mjs`);
      for (const [fileName, from] of Object.entries(SITE_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(join(root, from)) });
      }
    },
  };
}
