// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for scripts/runbook.mjs, and for the install runbook itself: every
// command block it marks runs in CI, every block CI runs is in it, and the
// blocks are plain ASCII, so that Windows PowerShell 5.1 and a reader's copy
// and paste take them as they are. Run with: node --test "scripts/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RUNBOOK, envFor, parseRunbook, scriptFor } from './runbook.mjs';

const md = (s) => s.replace(/^ {4}/gm, '');

test('parses marked blocks, and only those', () => {
  const blocks = parseRunbook(
    md(`
    # Title

    \`\`\`sh
    echo not marked
    \`\`\`

    <!-- runbook: linux-install -->
    \`\`\`sh
    sudo apt install ./CanViewer_0.2.0_amd64.deb
    \`\`\`

    1. In a list:

       <!-- runbook: windows-verify -->

       \`\`\`powershell
       Get-FileHash .\\a
         indented more
       \`\`\`
    `),
  );
  assert.deepEqual([...blocks.keys()], ['linux-install', 'windows-verify']);
  assert.deepEqual(blocks.get('linux-install'), { lang: 'sh', code: 'sudo apt install ./CanViewer_0.2.0_amd64.deb\n', line: 10 });
  assert.equal(blocks.get('windows-verify').code, 'Get-FileHash .\\a\n  indented more\n');
});

test('rejects a marker without a block, a duplicate id, an unclosed block and an unknown language', () => {
  assert.throws(() => parseRunbook('<!-- runbook: a -->\ntext\n'), /no code block follows/);
  assert.throws(() => parseRunbook('<!-- runbook: a -->\n```sh\nx\n```\n<!-- runbook: a -->\n```sh\ny\n```\n'), /used twice/);
  assert.throws(() => parseRunbook('<!-- runbook: a -->\n```sh\nx\n'), /not closed/);
  assert.throws(() => parseRunbook('<!-- runbook: a -->\n```python\nx\n```\n'), /language "python"/);
});

test('a block runs after its shell preamble, PowerShell with a byte order mark', () => {
  assert.equal(scriptFor({ lang: 'sh', code: 'true\n' }), 'set -eo pipefail\ntrue\n');
  assert.equal(scriptFor({ lang: 'zsh', code: 'true\n' }), 'set -eo pipefail\ntrue\n');
  assert.equal(scriptFor({ lang: 'powershell', code: 'Get-Date\n' }), "﻿$ErrorActionPreference = 'Stop'\nGet-Date\n");
});

const blocks = parseRunbook(readFileSync(RUNBOOK, 'utf8'));
const workflows = ['.github/workflows/desktop.yml', '.github/workflows/release.yml'].map((f) =>
  readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'),
);
const used = new Set(workflows.flatMap((w) => [...w.matchAll(/scripts\/runbook\.mjs run ([a-z0-9-]+)/g)].map((m) => m[1])));

test('the runbook marks its command blocks for each system', () => {
  const ids = [...blocks.keys()];
  for (const system of ['windows', 'macos', 'linux']) {
    for (const step of ['verify', 'self-test', 'uninstall', 'remove-data']) {
      assert.ok(ids.some((id) => id.startsWith(`${system}-`) && id.endsWith(step)), `${system}: no ${step} block`);
    }
    assert.ok(ids.some((id) => id.startsWith(`${system}-`) && id.endsWith('install') && !id.endsWith('uninstall')), `${system}: no install block`);
  }
  // Each system's blocks are in the shell its readers use.
  for (const [id, b] of blocks) {
    const lang = { windows: 'powershell', macos: 'zsh', linux: 'sh' }[id.split('-')[0]];
    assert.equal(b.lang, lang, `${id} is ${b.lang}, not ${lang}`);
  }
});

test('CI runs every block of the runbook, and only blocks that exist', () => {
  assert.deepEqual([...used].filter((id) => !blocks.has(id)), [], 'workflows run blocks the runbook lacks');
  assert.deepEqual([...blocks.keys()].filter((id) => !used.has(id)), [], 'runbook blocks no workflow runs');
});

test('the blocks are plain ASCII', () => {
  for (const [id, b] of blocks) {
    const bad = [...b.code].filter((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && c !== '\n'));
    assert.deepEqual(bad, [], `${id} has characters outside printable ASCII`);
  }
});

test('Windows PowerShell blocks run without an inherited PSModulePath, other shells keep the environment', () => {
  const env = { Path: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules', psmodulepath: 'x', HOME: 'h' };
  assert.deepEqual(envFor('powershell', env), { Path: 'C:\\Windows', HOME: 'h' });
  assert.equal(envFor('sh', env), env);
  assert.equal(envFor('zsh', env), env);
});
