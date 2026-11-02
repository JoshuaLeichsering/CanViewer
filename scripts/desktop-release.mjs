// SPDX-License-Identifier: GPL-2.0-or-later
// The release side of the desktop packages, for .github/workflows/desktop.yml
// and release.yml:
//
//   config   the Tauri config overlay for a CI build: no beforeBuildCommand
//            (the workflow builds the web app first), the license files and
//            the third-party notices bundled as resources when they exist
//            (always, for a release), and an MSI version for a pre-release
//   collect  copies one system's packages out of Tauri's bundle directory under
//            their release names, adds demo.dbc, and writes SHA256SUMS
//   finish   joins the systems' parts into the release: checks every part
//            against its SHA256SUMS, adds THIRD_PARTY_NOTICES.md, writes the
//            combined SHA256SUMS and the release notes with each package's size
//   resources prints RESOURCES, one per line, for the workflows' checks of an
//            installed package
//
//   node scripts/desktop-release.mjs resources
//   node scripts/desktop-release.mjs config --out FILE [--release]
//   node scripts/desktop-release.mjs collect --system windows|macos|linux --out DIR [--bundle-dir DIR]
//   node scripts/desktop-release.mjs finish --parts DIR --out DIR --notes FILE [--release] [--tag vX.Y.Z]
//     [--repo-url URL] [--run-url URL]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_FILES } from './license-policy.mjs';
import { ROOT, isPrerelease, msiVersion } from './release-version.mjs';

export const SUMS = 'SHA256SUMS';
export const NOTICES = 'THIRD_PARTY_NOTICES.md';
export const SAMPLE = 'examples/demo.dbc';
/**
 * Files bundled with the app when they exist, at the root of its resources:
 * the third-party notices and CanViewer's license files. Required for a
 * release. The workflows' checks of an installed package read this list
 * (`node scripts/desktop-release.mjs resources`).
 */
export const RESOURCES = [NOTICES, ...LICENSE_FILES];

/**
 * The packages of each system: where Tauri puts them (under the bundle
 * directory), and the name they are released under. The release names are
 * Tauri's own, made independent of how a future Tauri spells them, so that
 * the runbook can name the files.
 */
export const PACKAGES = {
  windows: [
    { dir: 'nsis', match: /-setup\.exe$/, name: (v) => `CanViewer_${v}_x64-setup.exe`, label: 'Windows 10 and 11, x64: installer for your user account (no administrator rights needed)' },
    { dir: 'msi', match: /\.msi$/, name: (v) => `CanViewer_${v}_x64_en-US.msi`, label: 'Windows 10 and 11, x64: Windows Installer package for all users (needs administrator rights)' },
  ],
  macos: [{ dir: 'dmg', match: /\.dmg$/, name: (v) => `CanViewer_${v}_universal.dmg`, label: 'macOS, Apple silicon and Intel (universal)' }],
  linux: [{ dir: 'deb', match: /\.deb$/, name: (v) => `CanViewer_${v}_amd64.deb`, label: 'Linux, x86-64: a .deb, built and tested on Ubuntu' }],
};

/** Tauri's bundle directory for each system's build (macOS builds the universal target). */
export const BUNDLE_DIRS = {
  windows: 'desktop/target/release/bundle',
  macos: 'desktop/target/universal-apple-darwin/release/bundle',
  linux: 'desktop/target/release/bundle',
};

export const packageVersion = (root = ROOT) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** SHA256SUMS in the format of sha256sum and shasum -a 256: "<hash>  <name>", sorted by name. */
export function formatSums(entries) {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.name}\n`)
    .join('');
}

export function parseSums(text) {
  const sums = new Map();
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new Error(`${SUMS} line ${i + 1} is not "<sha256>  <file>": ${JSON.stringify(line)}`);
    if (sums.has(m[2])) throw new Error(`${SUMS} lists ${m[2]} twice`);
    sums.set(m[2], m[1]);
  }
  return sums;
}

/** The Tauri config overlay for a CI build (see the top of this file). */
export function tauriOverlay({ root = ROOT, release = false, version = packageVersion(root) } = {}) {
  const missing = RESOURCES.filter((f) => !existsSync(join(root, f)));
  if (release && missing.length) throw new Error(`a release must bundle ${missing.join(' and ')}, which the repository lacks`);
  // Resource paths are relative to desktop/, where tauri.conf.json is.
  const resources = Object.fromEntries(RESOURCES.filter((f) => !missing.includes(f)).map((f) => [`../${f}`, f]));
  const bundle = {};
  if (Object.keys(resources).length) bundle.resources = resources;
  const msi = msiVersion(version);
  if (msi) bundle.windows = { wix: { version: msi } };
  return { build: { beforeBuildCommand: '' }, ...(Object.keys(bundle).length ? { bundle } : {}) };
}

/**
 * Copy one system's packages from `bundleDir` to `out` under their release
 * names, add the sample file, and write SHA256SUMS for all of them. Returns
 * [{ name, size, sha256 }].
 */
export function collect({ root = ROOT, system, bundleDir = join(root, BUNDLE_DIRS[system] ?? ''), out, version = packageVersion(root) }) {
  const packages = PACKAGES[system];
  if (!packages) throw new Error(`unknown system ${system}; one of ${Object.keys(PACKAGES).join(', ')}`);
  mkdirSync(out, { recursive: true });
  const copied = [];
  for (const p of packages) {
    const dir = join(bundleDir, p.dir);
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => p.match.test(f)).sort() : [];
    if (found.length !== 1) throw new Error(`${dir}: expected one file matching ${p.match}, found ${found.length ? found.join(', ') : 'none'}`);
    copyFileSync(join(dir, found[0]), join(out, p.name(version)));
    copied.push(p.name(version));
  }
  copyFileSync(join(root, SAMPLE), join(out, basename(SAMPLE)));
  copied.push(basename(SAMPLE));
  const entries = copied.map((name) => ({ name, size: statSync(join(out, name)).size, sha256: sha256(join(out, name)) }));
  writeFileSync(join(out, SUMS), formatSums(entries));
  return entries;
}

/** Every release asset's name, in the order the notes list them. */
export const releaseAssets = (version) => [
  ...Object.values(PACKAGES).flatMap((ps) => ps.map((p) => p.name(version))),
  basename(SAMPLE),
  NOTICES,
  SUMS,
];

/**
 * Join the parts the build jobs uploaded (one directory each, with its own
 * SHA256SUMS) into the release in `out`. Every file must match its part's
 * SHA256SUMS, and a file in two parts (demo.dbc) must be identical. Adds
 * THIRD_PARTY_NOTICES.md (required for a release) and the combined SHA256SUMS.
 */
export function finish({ root = ROOT, parts, out, version = packageVersion(root), release = false }) {
  mkdirSync(out, { recursive: true });
  const assets = new Map();
  const partDirs = readdirSync(parts).filter((d) => statSync(join(parts, d)).isDirectory()).sort();
  if (!partDirs.length) throw new Error(`${parts}: no parts`);
  for (const part of partDirs) {
    const dir = join(parts, part);
    if (!existsSync(join(dir, SUMS))) throw new Error(`${part}: no ${SUMS}`);
    const sums = parseSums(readFileSync(join(dir, SUMS), 'utf8'));
    const files = readdirSync(dir).filter((f) => f !== SUMS);
    for (const f of files) if (!sums.has(f)) throw new Error(`${part}/${f} is not in its ${SUMS}`);
    for (const [name, hash] of sums) {
      const path = join(dir, name);
      if (!existsSync(path)) throw new Error(`${part}/${name} is in its ${SUMS} but missing`);
      const actual = sha256(path);
      if (actual !== hash) throw new Error(`${part}/${name}: SHA-256 ${actual}, but its ${SUMS} says ${hash}`);
      const seen = assets.get(name);
      if (seen && seen.sha256 !== hash) throw new Error(`${name} differs between ${seen.part} and ${part}`);
      if (!seen) {
        copyFileSync(path, join(out, name));
        assets.set(name, { name, part, size: statSync(path).size, sha256: hash });
      }
    }
  }
  const notices = join(root, NOTICES);
  if (existsSync(notices)) {
    copyFileSync(notices, join(out, NOTICES));
    assets.set(NOTICES, { name: NOTICES, part: 'repository', size: statSync(notices).size, sha256: sha256(notices) });
  } else if (release) {
    throw new Error(`a release must carry ${NOTICES}, which the repository lacks`);
  }
  if (release) {
    const expected = releaseAssets(version).filter((n) => n !== SUMS);
    const missing = expected.filter((n) => !assets.has(n));
    const extra = [...assets.keys()].filter((n) => !expected.includes(n));
    if (missing.length || extra.length) {
      throw new Error(`the release must be exactly ${expected.join(', ')}; missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}`);
    }
  }
  const entries = [...assets.values()];
  writeFileSync(join(out, SUMS), formatSums(entries));
  return entries;
}

const MIB = 1024 * 1024;
export const formatSize = (bytes) => `${bytes.toLocaleString('en-US')} bytes (${(bytes / MIB).toFixed(1)} MiB)`;

/** The release notes: what to download for which system, each package's size, and where it came from. */
export function releaseNotes({ version, assets, tag = `v${version}`, repoUrl, runUrl }) {
  const size = new Map(assets.map((a) => [a.name, a.size]));
  const guide = repoUrl ? `[the install guide](${repoUrl}/blob/${tag}/docs/guide/install.md)` : 'the install guide (docs/guide/install.md)';
  const lines = [
    `CanViewer ${version}${isPrerelease(version) ? ', a release candidate for testing' : ''}.`,
    '',
    `To install it, follow ${guide}: it covers the download, checking it, the first start of an unsigned app, updating and uninstalling, on each system.`,
    '',
    '| For | Download | Size |',
    '|---|---|---|',
  ];
  for (const p of Object.values(PACKAGES).flat()) {
    const name = p.name(version);
    if (size.has(name)) lines.push(`| ${p.label} | \`${name}\` | ${formatSize(size.get(name))} |`);
  }
  lines.push(
    '',
    `Also here: \`${SUMS}\`, the SHA-256 checksum of every file of this release; \`${NOTICES}\`, the licenses of the third-party software the app contains; and \`demo.dbc\`, a small CAN database to open once CanViewer is installed.`,
    '',
    'The packages are not code-signed. Windows and macOS therefore ask once before the first start; the install guide shows how to allow it.',
    '',
  );
  const source = repoUrl ? `[${tag}](${repoUrl}/tree/${tag})` : tag;
  lines.push(
    runUrl
      ? `Built from ${source} by [this workflow run](${runUrl}), which also installed each package, ran the app's self-test and uninstalled it again, on each system, with the install guide's own commands.`
      : `Built from ${source}.`,
  );
  return lines.join('\n') + '\n';
}

function main(argv) {
  const [command] = argv;
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flag = (name) => argv.includes(`--${name}`);
  if (command === 'resources') {
    console.log(RESOURCES.join('\n'));
    return 0;
  }
  if (command === 'config' && opt('out')) {
    const overlay = tauriOverlay({ release: flag('release') });
    writeFileSync(opt('out'), JSON.stringify(overlay, null, 2) + '\n');
    console.log(`Tauri config overlay (${opt('out')}):\n${JSON.stringify(overlay, null, 2)}`);
    return 0;
  }
  if (command === 'collect' && opt('system') && opt('out')) {
    const system = opt('system');
    const entries = collect({ system, out: opt('out'), ...(opt('bundle-dir') ? { bundleDir: opt('bundle-dir') } : {}) });
    console.log(`### ${system}\n\n| File | Size | SHA-256 |\n|---|---|---|`);
    for (const e of entries) console.log(`| ${e.name} | ${formatSize(e.size)} | \`${e.sha256}\` |`);
    return 0;
  }
  if (command === 'finish' && opt('parts') && opt('out') && opt('notes')) {
    const version = packageVersion();
    const release = flag('release');
    const assets = finish({ parts: opt('parts'), out: opt('out'), version, release });
    const notes = releaseNotes({ version, assets, tag: opt('tag') ?? `v${version}`, repoUrl: opt('repo-url'), runUrl: opt('run-url') });
    writeFileSync(opt('notes'), notes);
    console.log(notes);
    console.log(readFileSync(join(opt('out'), SUMS), 'utf8'));
    return 0;
  }
  console.error('usage: see the top of scripts/desktop-release.mjs');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
