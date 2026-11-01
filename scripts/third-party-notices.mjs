#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Generates THIRD_PARTY_NOTICES.md: every third-party component the web app
// and the desktop app ship, with its version, license, source and license
// texts. The Vite build copies the file into dist/, and the desktop packages
// carry it too.
//
//   node scripts/third-party-notices.mjs          write THIRD_PARTY_NOTICES.md
//   node scripts/third-party-notices.mjs --check  fail if the file is not up to date
//
// Sources, so that nothing is written by hand that metadata can say:
//   - npm: package-lock.json (production dependencies) and each package's own
//     license files in node_modules/;
//   - the Python wheels: app/src/lib/canmatrix/wheels.lock.json and the
//     METADATA and license files inside each wheel in vendor/pyodide/
//     (run `npm run fetch-wheels` first);
//   - the Rust crates: `cargo metadata` for desktop/Cargo.lock and each crate's
//     license files (needs cargo, and downloads the crates once);
//   - what no metadata describes (the libraries inside the Pyodide runtime and
//     inside two wheels, and the icon paths copied into the sources):
//     scripts/license-policy.mjs, with license texts from upstream in
//     scripts/third-party/licenses/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOT_BUNDLED,
  NPM_TEXTS,
  PYODIDE_COMPONENTS,
  STANDARD_TEXTS,
  VENDORED,
  WHEEL_BUNDLED,
  WHEELS,
} from './license-policy.mjs';
import { readZip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'THIRD_PARTY_NOTICES.md');
const TEXTS_DIR = join(root, 'scripts/third-party/licenses');
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._].*)?$/i;
const WEB = 'web app, desktop app';

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const tidy = (s) => s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();

/** The terms of the Apache License 2.0, which many crates ship, each in its own copy. */
const APACHE_TERMS = /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION[\s\S]*?END OF TERMS AND CONDITIONS/;
const APACHE_TITLE = /^\s*Apache License\s+Version 2\.0, January 2004\s+(?:<\s*)?https?:\/\/www\.apache\.org\/licenses\/?(?:\s*>)?\s*/i;
const APACHE_APPENDIX = /APPENDIX: How to apply the Apache License to your work\.[\s\S]*$/;
const APACHE_TEXT = tidy(readFileSync(join(TEXTS_DIR, STANDARD_TEXTS['Apache-2.0']), 'utf8'));
const APACHE_KEY = collapse(APACHE_TEXT.match(APACHE_TERMS)[0]);

/**
 * License texts, deduplicated (ignoring whitespace), numbered in order of
 * first use. A copy of the Apache License 2.0 whose terms are the standard
 * ones is reproduced once: what differs from the standard text (a copyright
 * line filled into the appendix, another license in the same file) is kept as
 * a text of its own.
 */
class Texts {
  constructor() {
    this.byKey = new Map();
    this.list = [];
  }
  addOne(clean, user) {
    const key = createHash('sha256').update(collapse(clean)).digest('hex');
    let entry = this.byKey.get(key);
    if (!entry) {
      entry = { n: this.list.length + 1, text: clean, users: [] };
      this.byKey.set(key, entry);
      this.list.push(entry);
    }
    if (!entry.users.includes(user)) entry.users.push(user);
    return entry.n;
  }
  /** Returns the numbers of the texts that make up this one. */
  add(text, user) {
    const clean = tidy(text);
    const terms = clean.match(APACHE_TERMS);
    if (!terms || collapse(terms[0]) !== APACHE_KEY) return [this.addOne(clean, user)];
    const before = clean.slice(0, terms.index).replace(APACHE_TITLE, '');
    // A longer document that quotes the license (CPython's list of incorporated
    // software, say) stays whole.
    if (before.length > 1000) return [this.addOne(clean, user)];
    const ns = [this.addOne(APACHE_TEXT, user)];
    let after = clean.slice(terms.index + terms[0].length);
    const appendix = after.match(APACHE_APPENDIX);
    // The appendix is the license's own how-to; it counts only once filled in.
    if (appendix && /\[yyyy\]|\{yyyy\}|\[name of copyright owner\]/.test(appendix[0])) after = after.slice(0, appendix.index);
    const rest = tidy(`${before}\n\n${after}`);
    if (rest) ns.push(this.addOne(rest, user));
    return ns;
  }
  addFile(file, user) {
    return this.add(readFileSync(join(TEXTS_DIR, file), 'utf8'), user);
  }
}

/** GitHub's heading anchors, with -1, -2 … for repeated headings. */
class Slugger {
  constructor() {
    this.seen = new Map();
  }
  slug(heading) {
    const base = heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  }
}

const textLinks = (ns) => ns.map((n) => `[Text ${n}](#text-${n})`).join(', ');

function repoUrl(pkg) {
  const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const url = r ?? pkg.homepage;
  if (!url) return undefined;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/^(https:\/\/github\.com\/[^/]+\/[^/#]+).*$/, '$1');
}

/** Sort orders that do not depend on the machine's locale, so that every machine writes the same file. */
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byText = (a, b) => byCodePoint(a.toLowerCase(), b.toLowerCase()) || byCodePoint(a, b);
function byVersion(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : byText(x, y);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- collect

function collectNpm() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.dev) continue;
    const name = key.replace(/^.*node_modules\//, '');
    if (name in NOT_BUNDLED) continue;
    const dir = join(root, key);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
    out.push({
      name,
      version: entry.version,
      license: entry.license,
      source: repoUrl(pkg),
      files: files.map((f) => readFileSync(join(dir, f), 'utf8')),
      policyTexts: NPM_TEXTS[name] ?? [],
    });
  }
  return out.sort((a, b) => byText(a.name, b.name));
}

function metadataField(metadata, field) {
  const head = metadata.split('\n\n')[0];
  return head
    .split('\n')
    .filter((l) => l.startsWith(`${field}: `))
    .map((l) => l.slice(field.length + 2).trim());
}

function wheelSource(metadata) {
  const urls = metadataField(metadata, 'Project-URL').map((v) => v.split(/,\s*/));
  for (const label of ['source', 'source code', 'repository', 'github', 'homepage']) {
    const hit = urls.find(([l]) => l.toLowerCase() === label);
    if (hit) return hit[1];
  }
  return metadataField(metadata, 'Home-page')[0];
}

function collectWheels() {
  const lock = JSON.parse(readFileSync(join(root, 'app/src/lib/canmatrix/wheels.lock.json'), 'utf8'));
  const out = [];
  for (const [name, entry] of Object.entries(lock.packages)) {
    const path = join(root, 'vendor/pyodide', entry.file_name);
    if (!existsSync(path)) throw new Error(`${entry.file_name} is missing: run npm run fetch-wheels`);
    const zip = readZip(path);
    const names = [...zip.keys()];
    const metadataName = names.find((n) => /^[^/]+\.dist-info\/METADATA$/.test(n));
    const metadata = zip.get(metadataName)().toString('utf8');
    const licenseFiles = names
      .filter((n) => /^[^/]+\.dist-info\/(licenses\/)?[^/]+$/.test(n))
      .filter((n) => /(licen[cs]e|copying|notice|authors)/i.test(n.split('/').pop()))
      .sort();
    const policy = WHEELS[name];
    if (!policy) throw new Error(`wheel ${name} is not reviewed in scripts/license-policy.mjs (WHEELS)`);
    out.push({
      name: metadataField(metadata, 'Name')[0] ?? name,
      key: name,
      version: entry.version,
      file: entry.file_name,
      license: policy.license,
      source: policy.source ?? wheelSource(metadata),
      files: licenseFiles.map((n) => zip.get(n)().toString('utf8')),
      policyTexts: policy.texts ?? [],
      bundled: WHEEL_BUNDLED[name] ?? [],
    });
  }
  return out.sort((a, b) => byText(a.name, b.name));
}

/** The first alternative of an OR expression that has a standard text, for crates that ship no license file. */
function standardTextsFor(expression) {
  const alternatives = expression.replace(/\s*\/\s*/g, ' OR ').split(/\s+OR\s+/).map((a) => a.replace(/[()]/g, '').trim());
  for (const alt of alternatives) {
    const ids = alt.split(/\s+AND\s+/);
    if (ids.every((id) => STANDARD_TEXTS[id])) return ids.map((id) => STANDARD_TEXTS[id]);
  }
  throw new Error(`no standard text for ${expression}: add one to STANDARD_TEXTS`);
}

function collectCrates() {
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(root, 'desktop/Cargo.toml')], {
      cwd: root,
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'inherit'],
    }).toString('utf8'),
  );
  const out = [];
  for (const p of meta.packages) {
    if (!p.source) continue; // the workspace's own crate
    const dir = dirname(p.manifest_path);
    const names = readdirSync(dir).filter((f) => LICENSE_FILE.test(f));
    if (p.license_file) names.push(p.license_file);
    const files = [...new Set(names)].sort().map((f) => readFileSync(join(dir, f), 'utf8'));
    out.push({
      name: p.name,
      version: p.version,
      license: p.license ?? 'see its license file',
      source: p.repository ?? `https://crates.io/crates/${p.name}`,
      files,
      standard: files.length ? [] : standardTextsFor(p.license),
    });
  }
  return out.sort((a, b) => byText(a.name, b.name) || byVersion(a.version, b.version));
}

// ---------------------------------------------------------------- render

export function render({ npm, wheels, crates }) {
  const texts = new Texts();
  const slugger = new Slugger();
  const contents = [];
  const body = [];

  const component = (heading, { version, license, source, note, files = [], textFiles = [], shipsIn = WEB }) => {
    const anchor = slugger.slug(heading);
    const ns = [...files.flatMap((t) => texts.add(t, heading)), ...textFiles.flatMap((f) => texts.addFile(f, heading))];
    contents.push(`| [${heading}](#${anchor}) | ${version ?? '–'} | ${license} | ${shipsIn} |`);
    body.push(`#### ${heading}`, '');
    if (note) body.push(note, '');
    if (version) body.push(`- Version: ${version}`);
    body.push(`- License: ${license}`);
    if (source) body.push(`- Source: <${source}>`);
    body.push(`- License text: ${textLinks([...new Set(ns)])}`, '');
  };
  const section = (heading, intro) => {
    slugger.slug(heading);
    body.push(`### ${heading}`, '');
    if (intro) body.push(intro, '');
  };

  slugger.slug('Third-party notices');
  slugger.slug('Contents');
  slugger.slug('Web app');
  body.push('## Web app', '', 'What the web app ships. The desktop app embeds the web app, so all of it ships there too.', '');

  const fonts = npm.filter((p) => p.name.startsWith('@fontsource'));
  const pyodide = npm.find((p) => p.name === 'pyodide');
  const libraries = npm.filter((p) => !fonts.includes(p) && p !== pyodide);

  section('JavaScript libraries', 'Bundled into the app’s JavaScript.');
  for (const p of libraries) component(p.name, { ...p, textFiles: p.policyTexts });

  section('Fonts', 'The Latin subsets, as font files next to the app’s JavaScript.');
  for (const p of fonts) component(p.name, { ...p, textFiles: p.policyTexts });

  section('Icons');
  for (const v of VENDORED) component(v.name, { ...v, textFiles: v.texts });

  section(
    'Pyodide runtime',
    'In `pyodide/` next to the app (`pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`), with the loader in the import worker’s JavaScript. ' +
      'It loads only when a file in a format other than DBC is opened. The parts after the `pyodide` package itself are compiled into it.',
  );
  component('pyodide', {
    version: pyodide.version,
    license: pyodide.license,
    source: `https://github.com/pyodide/pyodide/tree/${pyodide.version}`,
    files: pyodide.files,
    textFiles: pyodide.policyTexts,
  });
  for (const c of PYODIDE_COMPONENTS) component(c.name, { ...c, textFiles: c.texts });

  section(
    'Python packages',
    'Wheels in `pyodide/`, loaded into the Pyodide runtime when a file in a format other than DBC is opened: canmatrix and what it needs for the format at hand.',
  );
  for (const w of wheels) {
    component(w.name, { ...w, note: `\`${w.file}\``, textFiles: w.policyTexts });
    for (const b of w.bundled) component(`${b.name} (compiled into ${w.name})`, { ...b, textFiles: b.texts });
  }

  slugger.slug('Desktop app');
  body.push('## Desktop app', '');
  const cratesHeading = 'Rust crates';
  const cratesAnchor = slugger.slug(cratesHeading);
  body.push(
    `### ${cratesHeading}`,
    '',
    `The ${crates.length} crates in \`desktop/Cargo.lock\`, for all three systems: those compiled into the binary on each of them, and those that build it.`,
    'Each crate’s license files are reproduced below as it ships them; for the few that ship none, the standard text of their license is.',
    '',
    '| Crate | Version | License | License text |',
    '|---|---|---|---|',
  );
  for (const c of crates) {
    const user = `${c.name} ${c.version}`;
    const ns = [...c.files.flatMap((t) => texts.add(t, user)), ...c.standard.flatMap((f) => texts.addFile(f, user))];
    const name = c.source ? `[${c.name}](${c.source})` : c.name;
    body.push(`| ${name} | ${c.version} | ${c.license.replace(/\|/g, '\\|')} | ${textLinks([...new Set(ns)])} |`);
  }
  body.push('');
  contents.push(`| [${cratesHeading}](#${cratesAnchor}) | ${crates.length} crates | see the list | desktop app |`);

  body.push('## License texts', '');
  for (const t of texts.list) {
    const fence = '`'.repeat(Math.max(3, ...[...t.text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    const users = t.users.length > 12 ? `${t.users.slice(0, 12).join(', ')} and ${t.users.length - 12} more` : t.users.join(', ');
    body.push(`### Text ${t.n}`, '', `Used by: ${users}.`, '', `${fence}text`, t.text, fence, '');
  }

  const head = [
    '# Third-party notices',
    '',
    'CanViewer is free software: you can redistribute it and/or modify it under the terms of',
    'the GNU General Public License as published by the Free Software Foundation, either',
    'version 2 of the License, or (at your option) any later version. See [LICENSE](LICENSE).',
    '',
    'CanViewer ships the third-party components below, each under its own license. Some are',
    'under the Apache License 2.0, which is compatible with version 3 of the GNU GPL but not',
    'with version 2. Where such a part is included (the Material Symbols icon paths in the web',
    'app, and crates such as `tao` in the desktop app), the combined program is distributed',
    'under the terms of the GNU GPL version 3.',
    '',
    'Each component’s source is at the address given with it. The exact versions are pinned in',
    '`package-lock.json`, `app/src/lib/canmatrix/wheels.lock.json` and `desktop/Cargo.lock`,',
    'which are part of CanViewer’s source at every release tag.',
    '',
    'This file is generated by `node scripts/third-party-notices.mjs`. To change it, change that',
    'script or `scripts/license-policy.mjs`, not this file.',
    '',
    '## Contents',
    '',
    '| Component | Version | License | Ships in |',
    '|---|---|---|---|',
    ...contents,
    '',
  ];
  return [...head, ...body].join('\n').replace(/\n+$/, '\n');
}

function main() {
  const check = process.argv.includes('--check');
  const md = render({ npm: collectNpm(), wheels: collectWheels(), crates: collectCrates() });
  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current === md) {
      console.log(`THIRD_PARTY_NOTICES.md is up to date (${Buffer.byteLength(md)} bytes)`);
      return;
    }
    const a = current.split('\n');
    const b = md.split('\n');
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(`THIRD_PARTY_NOTICES.md is out of date; first difference at line ${i + 1}:`);
    console.log(`  committed: ${a[i] ?? '(end of file)'}`);
    console.log(`  generated: ${b[i] ?? '(end of file)'}`);
    console.log('Run: node scripts/third-party-notices.mjs');
    process.exit(1);
  }
  writeFileSync(OUT, md);
  console.log(`wrote THIRD_PARTY_NOTICES.md (${Buffer.byteLength(md)} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
