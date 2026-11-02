// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for scripts/release-version.mjs, on a copy of the files it reads, and
// a check that the repository's own versions agree.
// Run with: node --test "scripts/*.test.mjs"
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, RUNBOOK, bumpVersion, checkVersions, isPrerelease, msiVersion, parseVersion } from './release-version.mjs';

/** A copy of the five files that hold the version. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'release-version-'));
  mkdirSync(join(dir, 'desktop'));
  mkdirSync(join(dir, 'docs/guide'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json', 'desktop/Cargo.toml', 'desktop/Cargo.lock', RUNBOOK]) {
    cpSync(join(ROOT, f), join(dir, f));
  }
  return dir;
}

test('parses release versions and rejects others', () => {
  assert.deepEqual(parseVersion('0.2.0'), { major: 0, minor: 2, patch: 0, pre: [] });
  assert.deepEqual(parseVersion('0.2.0-rc.1'), { major: 0, minor: 2, patch: 0, pre: ['rc', '1'] });
  for (const bad of ['v0.2.0', '0.2', '0.2.0+build.1', '01.2.0', '0.2.0-', '', undefined]) {
    assert.throws(() => parseVersion(bad), /not a release version/, String(bad));
  }
  assert.equal(isPrerelease('0.2.0'), false);
  assert.equal(isPrerelease('0.2.0-rc.1'), true);
});

test('maps pre-releases to a numeric MSI version, and leaves final versions to Tauri', () => {
  assert.equal(msiVersion('0.2.0'), undefined);
  assert.equal(msiVersion('0.2.0-rc.1'), '0.2.0.1');
  assert.equal(msiVersion('1.4.2-beta.12'), '1.4.2.12');
  assert.equal(msiVersion('1.4.2-7'), '1.4.2.7');
  assert.throws(() => msiVersion('0.2.0-rc'), /ends in a number/);
  assert.throws(() => msiVersion('0.2.0-rc.70000'), /ends in a number/);
  assert.throws(() => msiVersion('256.0.0'), /too large/);
});

test('the repository agrees with itself', () => {
  const { version, problems } = checkVersions(ROOT);
  assert.deepEqual(problems, []);
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test('a tag must match package.json', () => {
  const dir = fixture();
  const { version } = checkVersions(dir);
  assert.deepEqual(checkVersions(dir, `v${version}`).problems, []);
  assert.deepEqual(checkVersions(dir, 'v9.9.9').problems, [`tag v9.9.9 does not match package.json's version (expected v${version})`]);
  assert.match(checkVersions(dir, version).problems[0], /does not match/);
});

test('a version that differs anywhere is reported where it differs', () => {
  const dir = fixture();
  const { version } = checkVersions(dir);
  const toml = readFileSync(join(dir, 'desktop/Cargo.toml'), 'utf8');
  writeFileSync(join(dir, 'desktop/Cargo.toml'), toml.replace(`version = "${version}"`, 'version = "9.9.9"'));
  const runbook = readFileSync(join(dir, RUNBOOK), 'utf8');
  writeFileSync(join(dir, RUNBOOK), runbook.replace(`CanViewer_${version}_amd64.deb`, 'CanViewer_9.9.8_amd64.deb'));
  assert.deepEqual(checkVersions(dir).problems, [
    `desktop/Cargo.toml: 9.9.9 instead of ${version}`,
    `${RUNBOOK} file names: 9.9.8 instead of ${version}`,
  ]);
});

test('bump writes the version into every place, and nothing else changes', () => {
  const dir = fixture();
  const before = Object.fromEntries(['package.json', 'package-lock.json', 'desktop/Cargo.toml', 'desktop/Cargo.lock', RUNBOOK].map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  // A version no file mentions yet, so that the bump can be undone by text.
  const { from } = bumpVersion(dir, '7.8.9-rc.4');
  assert.deepEqual(checkVersions(dir, 'v7.8.9-rc.4'), { version: '7.8.9-rc.4', prerelease: true, problems: [] });
  // Undo the bump by text: what is left must be what was there.
  for (const [f, text] of Object.entries(before)) {
    const after = readFileSync(join(dir, f), 'utf8');
    assert.equal(after.replaceAll('7.8.9-rc.4', from), text, f);
  }
  bumpVersion(dir, '7.8.9');
  assert.deepEqual(checkVersions(dir, 'v7.8.9'), { version: '7.8.9', prerelease: false, problems: [] });
  assert.throws(() => bumpVersion(dir, 'v0.3'), /not a release version/);
});
