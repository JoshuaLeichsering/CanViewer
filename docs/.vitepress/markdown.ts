// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Markdown rules that let one source serve two readers: GitHub, which renders
 * the pages in docs/ as files of the repository, and the documentation site.
 *
 * - Relative links are written as they work on GitHub. A link that leaves the
 *   site (to a source file, or to the notes in docs/handover/) becomes a link to
 *   that file on GitHub; a link to a page stays a page link. A relative link to
 *   a file that does not exist fails the build.
 * - Links to the published site itself (the web app under app/, or a page)
 *   become links within the site, so that a local or pull request build never
 *   leaves its own origin. The app is not part of the page router, so its links
 *   load it in full (target="_self").
 * - Images may carry GitHub's `#gh-light-mode-only` or `#gh-dark-mode-only`
 *   fragment. On the site the fragment becomes a class that follows the site's
 *   own theme switch, see theme/custom.css.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { MarkdownRenderer } from 'vitepress';

export interface SiteLinkOptions {
  /** Absolute path of the repository root. */
  repoRoot: string;
  /** Absolute path of the site's source directory (docs/). */
  srcDir: string;
  /** Directories under srcDir that are not part of the site, relative to it. */
  excluded: string[];
  /** The repository's web URL, e.g. https://github.com/owner/repo. */
  repoUrl: string;
  /** The branch links into the repository point at. */
  branch: string;
  /** The published site's URL, ending in a slash. */
  siteUrl: string;
  /** The site's base path, ending in a slash. */
  base: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const THEME_FRAGMENT = /#gh-(light|dark)-mode-only$/;

interface Token {
  type: string;
  children: Token[] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
  attrJoin(name: string, value: string): void;
}

export function siteLinks(md: MarkdownRenderer, options: SiteLinkOptions): void {
  const { repoRoot, srcDir, excluded, repoUrl, branch, siteUrl, base } = options;
  const isExcluded = (abs: string) =>
    excluded.some((dir) => (abs + sep).startsWith(resolve(srcDir, dir) + sep));
  const isPage = (abs: string) => {
    if (!(abs + sep).startsWith(srcDir + sep) || isExcluded(abs)) return false;
    if (abs.endsWith('.md')) return true;
    return statSync(abs).isDirectory() && existsSync(resolve(abs, 'index.md'));
  };

  md.core.ruler.push('canviewer-site-links', (state) => {
    const env = state.env as { path?: string; relativePath?: string };
    const from = env.path;
    for (const block of state.tokens) {
      for (const token of (block.children ?? []) as Token[]) {
        if (token.type === 'image') {
          const src = token.attrGet('src') ?? '';
          const theme = src.match(THEME_FRAGMENT);
          if (theme) {
            token.attrSet('src', src.replace(THEME_FRAGMENT, ''));
            token.attrJoin('class', `doc-${theme[1]}-only`);
          }
          continue;
        }
        if (token.type !== 'link_open') continue;
        const href = token.attrGet('href') ?? '';

        if (href.startsWith(siteUrl)) {
          const rest = href.slice(siteUrl.length);
          if (rest === 'app' || rest.startsWith('app/')) {
            token.attrSet('href', base + rest);
            token.attrSet('target', '_self');
          } else {
            token.attrSet('href', '/' + rest);
          }
          continue;
        }
        if (!from || href === '' || href.startsWith('#') || href.startsWith('/') || SCHEME.test(href)) continue;

        const [path, hash] = href.split('#', 2);
        const abs = resolve(dirname(from), decodeURI(path));
        if (!existsSync(abs)) {
          throw new Error(`${env.relativePath}: the link ${href} points at ${relative(repoRoot, abs)}, which does not exist`);
        }
        if (isPage(abs)) continue;
        const kind = statSync(abs).isDirectory() ? 'tree' : 'blob';
        const repoPath = relative(repoRoot, abs).split(sep).map(encodeURIComponent).join('/');
        token.attrSet('href', `${repoUrl}/${kind}/${branch}/${repoPath}${hash !== undefined ? `#${hash}` : ''}`);
      }
    }
  });
}
