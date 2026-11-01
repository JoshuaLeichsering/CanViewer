// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for scripts/desktop-release.mjs, with fake bundle directories.
// Run with: node --test "scripts/*.test.mjs"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RUNBOOK } from './release-version.mjs';
import {
  NOTICES,
  PACKAGES,
  SUMS,
  collect,
  finish,
  formatSize,
  formatSums,
  parseSums,
  releaseAssets,
  releaseNotes,
  sha256,
  tauriOverlay,
} from './desktop-release.mjs';
import { parseRunbook } from './runbook.mjs';

const tmp = (name) => mkdtempSync(join(tmpdir(), `${name}-`));

/** A repository root with package.json, the sample file, and optionally the license files. */
function repo(version, { notices = false, license = false } = {}) {
  const root = tmp('repo');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  mkdirSync(join(root, 'examples'));
  writeFileSync(join(root, 'examples/demo.dbc'), 'VERSION ""\n');
  if (notices) writeFileSync(join(root, NOTICES), '# Third-party notices\n');
  if (license) writeFileSync(join(root, 'LICENSE'), 'GNU GENERAL PUBLIC LICENSE\n');
  return root;
}

/** A Tauri bundle directory as each system's build leaves it. */
function bundle(system, version) {
  const dir = tmp(`bundle-${system}`);
  const files = {
    windows: { [`msi/CanViewer_${version}_x64_en-US.msi`]: 'msi', [`nsis/CanViewer_${version}_x64-setup.exe`]: 'nsis' },
    macos: { [`dmg/CanViewer_${version}_universal.dmg`]: 'dmg', 'macos/CanViewer.app/Contents/Info.plist': 'app' },
    linux: { [`deb/CanViewer_${version}_amd64.deb`]: 'deb' },
  }[system];
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), `${content} ${version}`);
  }
  return dir;
}

test('SHA256SUMS: sha256sum format, sorted, and parsed back', () => {
  const text = formatSums([
    { name: 'b.deb', sha256: 'b'.repeat(64) },
    { name: 'a.msi', sha256: 'a'.repeat(64) },
  ]);
  assert.equal(text, `${'a'.repeat(64)}  a.msi\n${'b'.repeat(64)}  b.deb\n`);
  assert.deepEqual([...parseSums(text)], [['a.msi', 'a'.repeat(64)], ['b.deb', 'b'.repeat(64)]]);
  assert.throws(() => parseSums('nonsense\n'), /line 1/);
  assert.throws(() => parseSums(text + text), /twice/);
});

test('the overlay bundles the license files that exist, and a release needs both', () => {
  assert.deepEqual(tauriOverlay({ root: repo('0.2.0') }), { build: { beforeBuildCommand: '' } });
  assert.deepEqual(tauriOverlay({ root: repo('0.2.0', { notices: true }) }), {
    build: { beforeBuildCommand: '' },
    bundle: { resources: { [`../${NOTICES}`]: NOTICES } },
  });
  assert.throws(() => tauriOverlay({ root: repo('0.2.0', { notices: true }), release: true }), /must bundle LICENSE/);
  assert.deepEqual(tauriOverlay({ root: repo('0.2.0-rc.1', { notices: true, license: true }), release: true }), {
    build: { beforeBuildCommand: '' },
    bundle: { resources: { [`../${NOTICES}`]: NOTICES, '../LICENSE': 'LICENSE' }, windows: { wix: { version: '0.2.0.1' } } },
  });
});

test('collect copies each system\'s packages under their release names, with demo.dbc and SHA256SUMS', () => {
  for (const system of ['windows', 'macos', 'linux']) {
    const root = repo('0.2.0-rc.1');
    const out = tmp('out');
    const entries = collect({ root, system, bundleDir: bundle(system, '0.2.0-rc.1'), out });
    const names = PACKAGES[system].map((p) => p.name('0.2.0-rc.1'));
    assert.deepEqual(entries.map((e) => e.name), [...names, 'demo.dbc']);
    assert.deepEqual(readdirSync(out).sort(), [...names, 'demo.dbc', SUMS].sort());
    const sums = parseSums(readFileSync(join(out, SUMS), 'utf8'));
    for (const e of entries) assert.equal(sums.get(e.name), sha256(join(out, e.name)));
  }
});

test('collect fails when a package is missing or ambiguous', () => {
  const root = repo('0.2.0');
  const dir = bundle('linux', '0.2.0');
  writeFileSync(join(dir, 'deb/CanViewer_0.1.0_amd64.deb'), 'old');
  assert.throws(() => collect({ root, system: 'linux', bundleDir: dir, out: tmp('out') }), /expected one file .* found CanViewer_0\.1\.0_amd64\.deb, CanViewer_0\.2\.0_amd64\.deb$/);
  assert.throws(() => collect({ root, system: 'windows', bundleDir: tmp('empty'), out: tmp('out') }), /found none/);
  assert.throws(() => collect({ root, system: 'beos', bundleDir: dir, out: tmp('out') }), /unknown system/);
});

/** The three parts as the build jobs upload them. */
function parts(version, root) {
  const dir = tmp('parts');
  for (const system of ['windows', 'macos', 'linux']) {
    collect({ root, system, bundleDir: bundle(system, version), out: join(dir, `packages-${system}`) });
  }
  return dir;
}

test('finish joins the parts into exactly the release, with one SHA256SUMS that sha256sum accepts', () => {
  const root = repo('0.2.0', { notices: true, license: true });
  const out = tmp('release');
  const assets = finish({ root, parts: parts('0.2.0', root), out, release: true });
  assert.deepEqual(readdirSync(out).sort(), releaseAssets('0.2.0').sort());
  assert.equal(assets.length, releaseAssets('0.2.0').length - 1);
  // The runbook's own check, on Linux: sha256sum --check.
  const check = execFileSync('sha256sum', ['--check', '--strict', SUMS], { cwd: out, encoding: 'utf8' });
  assert.equal(check.trim().split('\n').length, assets.length);
  assert.ok(check.trim().split('\n').every((l) => l.endsWith(': OK')), check);
});

test('finish refuses a changed file, a file outside its SHA256SUMS, and an incomplete release', () => {
  const root = repo('0.2.0', { notices: true, license: true });
  let dir = parts('0.2.0', root);
  writeFileSync(join(dir, 'packages-linux/CanViewer_0.2.0_amd64.deb'), 'tampered');
  assert.throws(() => finish({ root, parts: dir, out: tmp('r') }), /packages-linux\/CanViewer_0\.2\.0_amd64\.deb: SHA-256 .* says/);

  dir = parts('0.2.0', root);
  writeFileSync(join(dir, 'packages-macos/extra.txt'), 'x');
  assert.throws(() => finish({ root, parts: dir, out: tmp('r') }), /packages-macos\/extra\.txt is not in its SHA256SUMS/);

  dir = parts('0.2.0', root);
  writeFileSync(join(dir, 'packages-macos/demo.dbc'), 'different');
  const sums = parseSums(readFileSync(join(dir, 'packages-macos', SUMS), 'utf8'));
  sums.set('demo.dbc', sha256(join(dir, 'packages-macos/demo.dbc')));
  writeFileSync(join(dir, 'packages-macos', SUMS), formatSums([...sums].map(([name, h]) => ({ name, sha256: h }))));
  assert.throws(() => finish({ root, parts: dir, out: tmp('r') }), /demo\.dbc differs between/);

  dir = tmp('parts');
  collect({ root, system: 'linux', bundleDir: bundle('linux', '0.2.0'), out: join(dir, 'packages-linux') });
  assert.throws(() => finish({ root, parts: dir, out: tmp('r'), release: true }), /missing: CanViewer_0\.2\.0_x64-setup\.exe/);
  // A dry run may be partial.
  assert.equal(finish({ root, parts: dir, out: tmp('r') }).length, 3);

  const bare = repo('0.2.0');
  assert.throws(() => finish({ root: bare, parts: parts('0.2.0', bare), out: tmp('r'), release: true }), /must carry THIRD_PARTY_NOTICES\.md/);
});

test('the notes name each package with its size, the guide and the run', () => {
  const root = repo('0.2.0-rc.1', { notices: true, license: true });
  const out = tmp('release');
  const assets = finish({ root, parts: parts('0.2.0-rc.1', root), out, release: true });
  const notes = releaseNotes({
    version: '0.2.0-rc.1',
    assets,
    repoUrl: 'https://github.com/o/r',
    runUrl: 'https://github.com/o/r/actions/runs/1',
  });
  assert.match(notes, /^CanViewer 0\.2\.0-rc\.1, a release candidate for testing\.\n/);
  assert.match(notes, /\[the install guide\]\(https:\/\/github\.com\/o\/r\/blob\/v0\.2\.0-rc\.1\/docs\/guide\/install\.md\)/);
  for (const p of Object.values(PACKAGES).flat()) {
    const a = assets.find((x) => x.name === p.name('0.2.0-rc.1'));
    assert.ok(notes.includes(`| \`${a.name}\` | ${formatSize(a.size)} |`), a.name);
  }
  assert.match(notes, /\[this workflow run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
  assert.equal(formatSize(11050584), '11,050,584 bytes (10.5 MiB)');
});

test('the runbook names the files the release has', () => {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const runbook = readFileSync(new URL(`../${RUNBOOK}`, import.meta.url), 'utf8');
  const code = [...parseRunbook(runbook).values()].map((b) => b.code).join('\n');
  for (const name of releaseAssets(version).filter((n) => n.endsWith('.exe') || n.endsWith('.msi') || n.endsWith('.dmg') || n.endsWith('.deb'))) {
    assert.ok(code.includes(name), `the runbook's commands do not use ${name}`);
  }
  const named = new Set([...runbook.matchAll(/CanViewer_[0-9][^\s`'"\\)]*\.(?:exe|msi|dmg|deb)/g)].map((m) => m[0]));
  assert.deepEqual([...named].filter((n) => !releaseAssets(version).includes(n)), [], 'the runbook names files the release does not have');
});
