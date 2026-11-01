// SPDX-License-Identifier: GPL-2.0-or-later
// Link check for the documentation, in two modes.
//
//   node scripts/docs/check-links.mjs --sources
//       Every Markdown file in the repository (git ls-files, so build output and
//       submodules are left out): each relative link must point at a file or
//       directory that exists, and a #fragment on a link to a Markdown file must
//       name one of its headings (GitHub's anchors). Root-absolute links are
//       errors: GitHub and the site would resolve them differently.
//
//   node scripts/docs/check-links.mjs --site <dir> [--base /CanViewer/]
//       The built site as GitHub Pages would serve it from <dir> under <base>
//       (the documentation, with the web app under app/): every href and src
//       that stays on the site must resolve to a file in <dir>, every #fragment
//       to an id in the target page, no link may leave <base>, and every page
//       must be linked from another page.
//
// Exits 1 on any broken link, and prints each one with the file it is in.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// ---- Markdown sources ----

const blank = (s) => s.replace(/[^\n]/g, ' ');

/** Markdown with code (fenced and inline) and HTML comments blanked out, line breaks kept. */
export function stripCode(markdown) {
  return stripFences(markdown)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank);
}

/** Markdown with fenced code blocks blanked out. */
function stripFences(markdown) {
  let fence = null;
  const lines = markdown.split('\n').map((line) => {
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
      return blank(line);
    }
    if (open) {
      fence = open[1];
      return blank(line);
    }
    return line;
  });
  return lines.join('\n');
}

/** The link targets in a Markdown text, with their line numbers. */
export function markdownLinks(markdown) {
  const text = stripCode(markdown);
  const links = [];
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  for (const m of text.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    links.push({ url: m[1].replace(/^<|>$/g, ''), line: lineOf(m.index) });
  }
  for (const m of text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(\S+)/gm)) links.push({ url: m[1], line: lineOf(m.index) });
  for (const m of text.matchAll(/<(?:a|img|source)\b[^>]*?\s(?:href|src)="([^"]+)"/g)) {
    links.push({ url: m[1], line: lineOf(m.index) });
  }
  return links;
}

/**
 * GitHub's anchor for a heading: lower case, punctuation removed, spaces as
 * hyphens. Emphasis markers go, but an underscore inside a word is text, and
 * GitHub keeps it (`et_xmlfile` in THIRD_PARTY_NOTICES.md).
 */
export function githubSlug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a Markdown file offers on GitHub. */
export function markdownAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  const text = stripFences(markdown).replace(/<!--[\s\S]*?-->/g, blank);
  for (const m of text.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) {
    const slug = githubSlug(m[1]);
    const n = seen.get(slug) ?? 0;
    anchors.add(n === 0 ? slug : `${slug}-${n}`);
    seen.set(slug, n + 1);
  }
  for (const m of markdown.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]);
  return anchors;
}

export function checkSources(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f && existsSync(join(root, f)));
  const errors = [];
  let checked = 0;
  for (const file of files) {
    const abs = join(root, file);
    const source = readFileSync(abs, 'utf8');
    for (const { url, line } of markdownLinks(source)) {
      if (SCHEME.test(url)) continue;
      checked += 1;
      if (url.startsWith('#')) {
        if (url.length > 1 && !markdownAnchors(source).has(decodeURIComponent(url.slice(1)))) {
          errors.push(`${file}:${line}: ${url}: this file has no heading for it`);
        }
        continue;
      }
      if (url.startsWith('/')) {
        errors.push(`${file}:${line}: ${url}: a root-absolute link resolves differently on GitHub and on the site; use a relative one`);
        continue;
      }
      const [path, fragment] = url.split('#', 2);
      let target;
      try {
        target = resolve(dirname(abs), decodeURI(path.split('?')[0]));
      } catch {
        errors.push(`${file}:${line}: ${url}: not a valid URL`);
        continue;
      }
      if (!existsSync(target)) {
        errors.push(`${file}:${line}: ${url}: ${relative(root, target)} does not exist`);
        continue;
      }
      if (fragment && target.endsWith('.md') && !markdownAnchors(readFileSync(target, 'utf8')).has(fragment)) {
        errors.push(`${file}:${line}: ${url}: ${relative(root, target)} has no heading for #${fragment}`);
      }
    }
  }
  return { files: files.length, checked, errors };
}

// ---- the built site ----

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** href, src and srcset values of the elements that load or link something. */
export function htmlLinks(html) {
  const links = [];
  for (const tag of html.matchAll(/<(a|link|script|img|source|iframe|use)\b([^>]*)>/gi)) {
    for (const attr of tag[2].matchAll(/\s(href|src|srcset|xlink:href)="([^"]*)"/gi)) {
      const values = attr[1].toLowerCase() === 'srcset' ? attr[2].split(',').map((s) => s.trim().split(/\s+/)[0]) : [attr[2]];
      for (const value of values) if (value) links.push({ tag: tag[1].toLowerCase(), url: value.replace(/&amp;/g, '&') });
    }
  }
  return links;
}

export function htmlIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')));
}

export function checkSite(dir, base = '/') {
  const root = resolve(dir);
  const files = walk(root);
  const pages = files.filter((f) => f.endsWith('.html'));
  const idsOf = new Map();
  const ids = (file) => {
    if (!idsOf.has(file)) idsOf.set(file, htmlIds(readFileSync(file, 'utf8')));
    return idsOf.get(file);
  };
  /** The file GitHub Pages would serve for a path below the site root, if any. */
  const fileFor = (path) => {
    const p = join(root, path);
    if (!(p + sep).startsWith(root + sep)) return undefined;
    if (existsSync(p) && statSync(p).isFile()) return p;
    if (existsSync(join(p, 'index.html'))) return join(p, 'index.html');
    if (existsSync(p + '.html')) return p + '.html';
    return undefined;
  };
  const errors = [];
  const linkedFrom = new Map();
  let checked = 0;
  for (const page of pages) {
    const where = relative(root, page);
    const pageUrl = new URL(base + where.split(sep).join('/'), 'http://site.invalid');
    for (const { tag, url } of htmlLinks(readFileSync(page, 'utf8'))) {
      if (/^(mailto|tel|data|blob|javascript):/i.test(url)) continue;
      const target = new URL(url, pageUrl);
      if (target.origin !== pageUrl.origin) continue;
      checked += 1;
      if (!target.pathname.startsWith(base)) {
        errors.push(`${where}: <${tag}> ${url}: leaves the site's base ${base}`);
        continue;
      }
      const file = fileFor(decodeURIComponent(target.pathname.slice(base.length)));
      if (!file) {
        errors.push(`${where}: <${tag}> ${url}: no such file on the site`);
        continue;
      }
      if (file !== page && tag === 'a') linkedFrom.set(file, (linkedFrom.get(file) ?? 0) + 1);
      const fragment = decodeURIComponent(target.hash.slice(1));
      if (fragment && file.endsWith('.html') && !ids(file).has(fragment)) {
        errors.push(`${where}: <${tag}> ${url}: ${relative(root, file)} has no id "${fragment}"`);
      }
    }
  }
  const index = join(root, 'index.html');
  for (const page of pages) {
    const where = relative(root, page);
    if (page === index || where === '404.html' || where.startsWith(`app${sep}`)) continue;
    if (!linkedFrom.has(page)) errors.push(`${where}: no other page links to it`);
  }
  return { files: pages.length, checked, errors };
}

// ---- command line ----

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let result;
  if (args.includes('--sources')) {
    result = checkSources(fileURLToPath(new URL('../..', import.meta.url)));
    console.log(`Markdown files: ${result.files}, relative links checked: ${result.checked}`);
  } else if (option('--site')) {
    const base = option('--base') ?? '/';
    result = checkSite(option('--site'), base);
    console.log(`pages: ${result.files}, links on the site checked: ${result.checked} (base ${base})`);
  } else {
    console.error('usage: node scripts/docs/check-links.mjs --sources | --site <dir> [--base /path/]');
    process.exit(2);
  }
  for (const e of result.errors) console.error(`BROKEN ${e}`);
  console.log(`broken links: ${result.errors.length}`);
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
