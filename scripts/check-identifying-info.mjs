#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Fails when the working tree holds identifying information: personal email
// addresses, local paths of a developer's machine, links to assistant sessions,
// machine names, or identifiers on the denylist (such as the account the
// repository was moved from). CI runs it on every pull request.
//
//   node scripts/check-identifying-info.mjs            tracked and untracked (not ignored) files
//   node scripts/check-identifying-info.mjs FILE...    only these files
//   node scripts/check-identifying-info.mjs --history  every blob in every revision, counted per rule
//
// Findings print the file, line, rule and a masked excerpt, never the match in
// full, so that the check itself does not copy what it finds into a CI log.
//
// The denylist holds SHA-256 digests of lower-case words, not the words, so
// that this file does not publish the identifiers it keeps out. To add one:
//   printf '%s' 'word' | sha256sum
//
// Exceptions are by rule and file, and each one says why. There are no
// exceptions by line: fix the text instead.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** SHA-256 of words that must not appear: the account the repository was moved from. */
export const DENY_HASHES = new Set(['fca5156e0c510c4c6747adf3beed6eab0b4fb9fa2709b8004f965b2f936104b5']);

/** Addresses the project may name: GitHub's noreply domain, noreply mailboxes, the SSH remote. */
const ALLOWED_EMAIL = [/@users\.noreply\.github\.com$/i, /^no-?reply@/i, /^git@github\.com$/i];
/** File extensions that follow an @ in names that are not addresses (icon@2x.png). */
const NOT_A_TLD = /^(png|jpe?g|gif|svg|webp|ico|icns|js|mjs|cjs|ts|tsx|css|json|html|txt|whl|wasm|zip)$/i;

/** User names that are not people: CI runners, system profiles, and the home directories of
 * Pyodide's and Emscripten's in-memory file systems. */
const NEUTRAL_USERS = /^(runner|runneradmin|Shared|Public|Default|pyodide|web_user)$/;

/**
 * The rules. `test`, when given, decides whether a match counts. `exempt`
 * lists files the rule does not apply to, with the reason.
 */
const RULES = [
  {
    id: 'email',
    what: 'an email address other than a noreply or project address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})\b/g,
    test: (m) => !NOT_A_TLD.test(m[1]) && !ALLOWED_EMAIL.some((a) => a.test(m[0])),
    // Upstream copyright notices are reproduced verbatim, as their licenses
    // require; lock files copy registry metadata, such as the contact address
    // in a package's deprecation notice.
    exempt: ['THIRD_PARTY_NOTICES.md', /^scripts\/third-party\/licenses\//, 'package-lock.json', 'desktop/Cargo.lock'],
  },
  {
    id: 'home-path',
    what: 'a home directory path',
    re: /\/home\/([a-z_][A-Za-z0-9_.-]*)|\/Users\/([A-Za-z0-9_.-]+)|[A-Za-z]:\\+Users\\+([A-Za-z0-9_.-]+)|-Users-([A-Za-z0-9])/g,
    test: (m) => !NEUTRAL_USERS.test(m[1] ?? m[2] ?? m[3] ?? ''),
  },
  { id: 'root-path', what: "a path in root's home directory", re: /(?<![A-Za-z0-9_.-])\/root\//g },
  { id: 'assistant-temp', what: "an assistant's temporary directory", re: /\/tmp\/claude|\/scratchpad\//gi },
  {
    id: 'session-link',
    what: 'a link to an assistant session, or a session trailer',
    re: /claude\.ai\/code\/session|\bsession_[0-9A-Za-z]{20,}\b|^\s*Claude-Session[:]\s*\S/g,
  },
  {
    id: 'machine-name',
    what: 'a machine name',
    re: /\b[A-Za-z0-9][A-Za-z0-9-]*-(?:MacBook|iMac|Mac-mini|Mac-Studio)(?:-(?:Pro|Air))?\b|\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{7,8}\b/g,
  },
];

const mask = (s) => (s.length <= 4 ? '…' : `${s.slice(0, 3)}…`);

function isExempt(rule, path) {
  return (rule.exempt ?? []).some((e) => (typeof e === 'string' ? e === path : e.test(path)));
}

/**
 * Scans one text. Returns findings as { path, line, rule, what, excerpt },
 * where the excerpt masks the match.
 */
export function scanText(text, path, { denyHashes = DENY_HASHES } = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (isExempt(rule, path)) continue;
      for (const m of line.matchAll(rule.re)) {
        if (rule.test && !rule.test(m)) continue;
        findings.push({ path, line: i + 1, rule: rule.id, what: rule.what, excerpt: mask(m[0]) });
      }
    }
    for (const word of line.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (word.length < 4) continue;
      if (denyHashes.has(createHash('sha256').update(word).digest('hex'))) {
        findings.push({ path, line: i + 1, rule: 'denylisted-identifier', what: 'an identifier on the denylist', excerpt: mask(word) });
      }
    }
  });
  return findings;
}

/** Scans the text chunks (tEXt, iTXt, zTXt keywords and text) of a PNG file. */
export function scanPngText(buf, path, options) {
  const findings = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const data = buf.subarray(offset + 8, offset + 8 + length).toString('latin1').replace(/\0/g, ' ');
      findings.push(...scanText(data, path, options));
    }
    offset += 12 + length;
  }
  return findings;
}

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

/** Scans one file's content: text, or a PNG's text chunks; other binary files are skipped. */
export function scanBuffer(buf, path, options) {
  if (isPng(buf)) return scanPngText(buf, path, options);
  if (isBinary(buf)) return [];
  return scanText(buf.toString('utf8'), path, options);
}

/** Tracked files and untracked files that are not ignored, relative to the repository root. */
function workingTreeFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))];
}

function report(findings) {
  for (const f of findings) console.log(`${f.path}:${f.line}: ${f.rule}: ${f.what} (${f.excerpt})`);
}

async function scanHistory() {
  // Every blob reachable from any ref, with one path it had.
  const objects = execFileSync('git', ['rev-list', '--all', '--objects'], { cwd: root, maxBuffer: 1 << 30 })
    .toString('utf8')
    .split('\n')
    .filter((l) => l.includes(' '))
    .map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]);
  const types = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    cwd: root,
    input: objects.map(([sha]) => sha).join('\n') + '\n',
    maxBuffer: 1 << 30,
  })
    .toString('utf8')
    .split('\n');
  const blobs = objects.filter((_, i) => types[i]?.endsWith(' blob'));
  const byRule = new Map();
  const cat = spawn('git', ['cat-file', '--batch'], { cwd: root });
  const chunks = [];
  cat.stdout.on('data', (c) => chunks.push(c));
  cat.stdin.end(blobs.map(([sha]) => sha).join('\n') + '\n');
  await new Promise((resolve, reject) => cat.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git cat-file exited ${code}`)))));
  const all = Buffer.concat(chunks);
  let pos = 0;
  for (const [, path] of blobs) {
    const nl = all.indexOf(10, pos);
    const size = Number(all.toString('latin1', pos, nl).split(' ')[2]);
    const content = all.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    for (const f of scanBuffer(content, path)) {
      const entry = byRule.get(f.rule) ?? { findings: 0, paths: new Set() };
      entry.findings += 1;
      entry.paths.add(path);
      byRule.set(f.rule, entry);
    }
  }
  console.log(`scanned ${blobs.length} blobs in every revision`);
  for (const [rule, { findings, paths }] of byRule) {
    console.log(`${rule}: ${findings} findings in ${paths.size} paths`);
    for (const p of [...paths].sort()) console.log(`  ${p}`);
  }
  return byRule.size === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--history')) {
    process.exit((await scanHistory()) ? 0 : 1);
  }
  const files = args.length ? args : workingTreeFiles();
  const findings = [];
  let scanned = 0;
  for (const path of files) {
    const full = join(root, path);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // deleted in the working tree
    }
    if (!stat.isFile()) continue; // submodules
    findings.push(...scanBuffer(readFileSync(full), path));
    scanned += 1;
  }
  report(findings);
  if (findings.length) {
    console.log(`\n${findings.length} finding(s) in ${new Set(findings.map((f) => f.path)).size} file(s) of ${scanned} scanned.`);
    console.log('Replace them with neutral wording or remove them; see the comment at the top of this script.');
    process.exit(1);
  }
  console.log(`no identifying information in ${scanned} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
