// SPDX-License-Identifier: GPL-2.0-or-later
// The release version: where it is written down, the check that every place
// agrees (and matches the tag being released), and the bump that changes them
// all at once.
//
// package.json is the source; desktop/tauri.conf.json reads it from there.
// The same version must also be in package-lock.json (twice), in
// desktop/Cargo.toml and desktop/Cargo.lock (the binary's own version), and in
// the package file names that docs/guide/install.md shows, because the
// release workflow runs that guide's commands against the packages it built.
//
//   node scripts/release-version.mjs check [vX.Y.Z]   prints version= and prerelease= lines
//   node scripts/release-version.mjs bump X.Y.Z[-rc.N]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const RUNBOOK = 'docs/guide/install.md';

/** X.Y.Z, optionally with a pre-release such as -rc.1 (no build metadata). */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export function parseVersion(version) {
  const m = VERSION.exec(version);
  if (!m) throw new Error(`not a release version (X.Y.Z or X.Y.Z-pre.N): ${JSON.stringify(version)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

export const isPrerelease = (version) => parseVersion(version).pre.length > 0;

/**
 * The MSI ProductVersion for `version`, or undefined when Tauri's own (X.Y.Z)
 * fits. Windows Installer takes only numbers, major.minor.build[.revision], the
 * first two up to 255 and the others up to 65535, so a pre-release such as
 * 0.2.0-rc.1 becomes 0.2.0.1. Windows Installer compares only the first three
 * fields, so 0.2.0.1 counts as the same version as 0.2.0.
 */
export function msiVersion(version) {
  const { major, minor, patch, pre } = parseVersion(version);
  if (major > 255 || minor > 255 || patch > 65535) throw new Error(`${version}: too large for an MSI version`);
  if (!pre.length) return undefined;
  const last = pre[pre.length - 1];
  if (!/^\d+$/.test(last) || Number(last) > 65535) {
    throw new Error(`${version}: an MSI needs a pre-release that ends in a number up to 65535, such as -rc.1`);
  }
  return `${major}.${minor}.${patch}.${Number(last)}`;
}

const read = (root, path) => readFileSync(join(root, path), 'utf8');

/** `[package]`'s version line in a Cargo.toml. */
const CARGO_TOML_VERSION = /(\[package\](?:\n(?!\[)[^\n]*)*?\nversion\s*=\s*")([^"]*)(")/;
/** The canviewer entry of a Cargo.lock. */
const CARGO_LOCK_VERSION = /(\[\[package\]\]\nname = "canviewer"\nversion = ")([^"]*)(")/;
/** Package file names in the runbook: CanViewer_<version>_… */
const RUNBOOK_NAME = /CanViewer_([0-9][0-9A-Za-z.-]*?)_(?=x64|universal|amd64)/g;

/** Every place the version is written down, and what it says there. */
export function readVersions(root = ROOT) {
  const pkg = JSON.parse(read(root, 'package.json'));
  const lock = JSON.parse(read(root, 'package-lock.json'));
  const cargoToml = CARGO_TOML_VERSION.exec(read(root, 'desktop/Cargo.toml'))?.[2];
  const cargoLock = CARGO_LOCK_VERSION.exec(read(root, 'desktop/Cargo.lock'))?.[2];
  const runbook = [...read(root, RUNBOOK).matchAll(RUNBOOK_NAME)].map((m) => m[1]);
  return {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'desktop/Cargo.toml': cargoToml,
    'desktop/Cargo.lock': cargoLock,
    [`${RUNBOOK} file names`]: runbook,
  };
}

/**
 * Check that every place agrees with package.json, and, given a tag, that the
 * tag is v<version>. Returns the version and the problems found.
 */
export function checkVersions(root = ROOT, tag) {
  const found = readVersions(root);
  const version = found['package.json'];
  const problems = [];
  try {
    parseVersion(version);
    msiVersion(version);
  } catch (e) {
    problems.push(`package.json: ${e.message}`);
  }
  for (const [where, value] of Object.entries(found)) {
    if (Array.isArray(value)) {
      if (!value.length) problems.push(`${where}: none found`);
      const other = [...new Set(value.filter((v) => v !== version))];
      if (other.length) problems.push(`${where}: ${other.join(', ')} instead of ${version}`);
    } else if (value !== version) {
      problems.push(`${where}: ${value ?? 'not found'} instead of ${version}`);
    }
  }
  if (tag !== undefined && tag !== `v${version}`) problems.push(`tag ${tag} does not match package.json's version (expected v${version})`);
  return { version, prerelease: !problems.length && isPrerelease(version), problems };
}

/** Write `next` into every place the version is written down. */
export function bumpVersion(root, next) {
  parseVersion(next);
  msiVersion(next);
  const current = readVersions(root)['package.json'];

  const pkg = JSON.parse(read(root, 'package.json'));
  pkg.version = next;
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  const lock = JSON.parse(read(root, 'package-lock.json'));
  lock.version = next;
  lock.packages[''].version = next;
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');

  for (const [path, pattern] of [
    ['desktop/Cargo.toml', CARGO_TOML_VERSION],
    ['desktop/Cargo.lock', CARGO_LOCK_VERSION],
  ]) {
    const text = read(root, path);
    if (!pattern.test(text)) throw new Error(`${path}: the version line was not found`);
    writeFileSync(join(root, path), text.replace(pattern, `$1${next}$3`));
  }

  const runbook = read(root, RUNBOOK);
  writeFileSync(join(root, RUNBOOK), runbook.replace(RUNBOOK_NAME, `CanViewer_${next}_`));
  return { from: current, to: next };
}

function main(argv) {
  const [command, arg] = argv;
  if (command === 'check') {
    const { version, prerelease, problems } = checkVersions(ROOT, arg || undefined);
    for (const p of problems) console.error(`version check: ${p}`);
    if (problems.length) return 1;
    console.log(`version=${version}`);
    console.log(`prerelease=${prerelease}`);
    return 0;
  }
  if (command === 'bump' && arg) {
    const { from, to } = bumpVersion(ROOT, arg.replace(/^v/, ''));
    console.log(`version ${from} -> ${to} in package.json, package-lock.json, desktop/Cargo.toml, desktop/Cargo.lock and ${RUNBOOK}`);
    const { problems } = checkVersions(ROOT);
    for (const p of problems) console.error(`version check: ${p}`);
    return problems.length ? 1 : 0;
  }
  console.error('usage: node scripts/release-version.mjs check [vX.Y.Z] | bump X.Y.Z[-rc.N]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
