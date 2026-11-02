// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for scripts/check-identifying-info.mjs. Run with: npm run test:scripts
//
// The sample strings are put together at run time, so that this file itself
// passes the sweep it tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { scanText, scanPngText } from './check-identifying-info.mjs';

const j = (...parts) => parts.join('');
const rules = (text, path = 'docs/example.md', options) => scanText(text, path, options).map((f) => f.rule);

test('a clean text has no findings', () => {
  assert.deepEqual(rules('CanViewer opens DBC files locally.\nNothing leaves the machine.\n'), []);
});

test('personal email addresses are found, noreply and project addresses are not', () => {
  assert.deepEqual(rules(j('Contact: someone', '@', 'example.org')), ['email']);
  assert.deepEqual(rules(j('first.last+tag', '@', 'mail.example.co.uk wrote')), ['email']);
  assert.deepEqual(rules(j('123+octocat', '@', 'users.noreply.github.com')), []);
  assert.deepEqual(rules(j('noreply', '@', 'anthropic.com')), []);
  assert.deepEqual(rules(j('git', '@', 'github.com:owner/repo.git')), []);
  // Retina image names and package specifiers are not addresses.
  assert.deepEqual(rules('icons/128x128@2x.png'), []);
  assert.deepEqual(rules('react@18.3.1 and npm@11'), []);
});

test('third-party notices may quote upstream addresses, but nothing else', () => {
  const text = j('Copyright (c) 2001 Upstream Author <author', '@', 'example.org>');
  assert.deepEqual(rules(text, 'THIRD_PARTY_NOTICES.md'), []);
  assert.deepEqual(rules(j(text, '\n/', 'home/alice/x'), 'THIRD_PARTY_NOTICES.md'), ['home-path']);
  const deprecated = j('"deprecated": "No longer supported. Contact maintainer', '@', 'example.org"');
  assert.deepEqual(rules(deprecated, 'package-lock.json'), []);
  assert.deepEqual(rules(deprecated, 'app/package-lock.json'), ['email']);
});

test('local paths are found', () => {
  assert.deepEqual(rules(j('wrote /', 'home/user/CanViewer/dist')), ['home-path']);
  assert.deepEqual(rules(j('cd /', 'Users/alice/src')), ['home-path']);
  assert.deepEqual(rules(j('C:', '\\', 'Users', '\\', 'alice', '\\', 'AppData')), ['home-path']);
  assert.deepEqual(rules(j('in /', 'root/.cache')), ['root-path']);
  assert.deepEqual(rules(j('/', 'tmp/', 'claude-0/x')), ['assistant-temp']);
  assert.deepEqual(rules(j('/private/', 'tmp/', 'claude-501/x')), ['assistant-temp']);
  assert.deepEqual(rules(j('-Users-', 'alice--project')), ['home-path']);
});

test('CI runner paths and placeholders are allowed', () => {
  assert.deepEqual(rules(j('/', 'home/runner/work/CanViewer')), []);
  assert.deepEqual(rules(j('/', 'Users/runner/work')), []);
  assert.deepEqual(rules(j('C:', '\\', 'Users', '\\', 'runneradmin', '\\', 'x')), []);
  assert.deepEqual(rules('/home/<user>/project and /tmp/out'), []);
});

test('session links and trailers are found', () => {
  assert.deepEqual(rules(j('https://claude', '.ai/code/', 'session', '_01ABCDEFGHIJKLMNOPQRSTUV')), ['session-link']);
  assert.deepEqual(rules(j('see ', 'session', '_01ABCDEFGHIJKLMNOPQRSTUV')), ['session-link']);
  assert.deepEqual(rules(j('Claude', '-Session: https://example.org/x')), ['session-link']);
});

test('machine names are found', () => {
  assert.deepEqual(rules(j('alices', '-MacBook-Pro.local')), ['machine-name']);
  assert.deepEqual(rules(j('DESKTOP', '-AB12CD3')), ['machine-name']);
});

test('denylisted identifiers are found by their hash, whole words only', () => {
  const token = 'exampleformeraccount';
  const denyHashes = new Set([createHash('sha256').update(token).digest('hex')]);
  assert.deepEqual(rules(`moved from ${token}/CanViewer`, 'a.md', { denyHashes }), ['denylisted-identifier']);
  assert.deepEqual(rules(`MOVED FROM ${token.toUpperCase()}`, 'a.md', { denyHashes }), ['denylisted-identifier']);
  assert.deepEqual(rules(`${token}2 is a different word`, 'a.md', { denyHashes }), []);
});

test('findings carry the line number and never the matched text in full', () => {
  const address = j('someone', '@', 'example.org');
  const [finding] = scanText(`first line\nsecond ${address}\n`, 'a.md');
  assert.equal(finding.line, 2);
  assert.ok(!finding.excerpt.includes(address));
});

test('text chunks of PNG files are scanned', () => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from(j('Source\0/', 'home/alice/shot.png'), 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  assert.deepEqual(scanPngText(png, 'docs/shot.png').map((f) => f.rule), ['home-path']);
});
