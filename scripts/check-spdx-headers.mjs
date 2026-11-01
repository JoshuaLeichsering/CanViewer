#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Checks that every source file of the project starts with an SPDX license
// identifier, so that each file states its license on its own.
//
//   node scripts/check-spdx-headers.mjs        report files without the header, exit 1 if any
//   node scripts/check-spdx-headers.mjs --fix  add the header where it is missing
//
// Source files are the tracked (and untracked, not ignored) .ts, .tsx, .js,
// .mjs, .cjs, .rs, .py and .css files. Third-party code is not tracked here:
// the corpora are submodules, the wheels and node_modules are ignored.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_LICENSE = 'GPL-2.0-or-later';

/** Files whose content is not the project's own, with the license it is under. */
const OTHER_LICENSES = {
  // The icon paths are Material Symbols (Google), copied as they are.
  'app/src/components/icon-paths.ts': 'Apache-2.0',
};

const COMMENT = {
  '.ts': (id) => `// SPDX-License-Identifier: ${id}`,
  '.tsx': (id) => `// SPDX-License-Identifier: ${id}`,
  '.js': (id) => `// SPDX-License-Identifier: ${id}`,
  '.mjs': (id) => `// SPDX-License-Identifier: ${id}`,
  '.cjs': (id) => `// SPDX-License-Identifier: ${id}`,
  '.rs': (id) => `// SPDX-License-Identifier: ${id}`,
  '.py': (id) => `# SPDX-License-Identifier: ${id}`,
  '.css': (id) => `/* SPDX-License-Identifier: ${id} */`,
};

/** How many lines from the top the identifier may start (after a shebang or coding line). */
const WITHIN_LINES = 3;

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))]
    .filter((f) => extname(f) in COMMENT)
    .filter((f) => existsSync(join(root, f)))
    .sort();
}

/** The identifier a file declares near its top, or undefined. */
export function declaredLicense(text) {
  const head = text.split('\n').slice(0, WITHIN_LINES).join('\n');
  return head.match(/SPDX-License-Identifier:\s*([^\s*]+)/)?.[1];
}

/** The text with the header inserted: after a shebang or a Python coding line, else first. */
export function withHeader(text, path, id) {
  const header = COMMENT[extname(path)](id);
  const lines = text.split('\n');
  let at = 0;
  if (lines[0]?.startsWith('#!')) at = 1;
  if (extname(path) === '.py' && /^#.*coding[:=]/.test(lines[at] ?? '')) at += 1;
  lines.splice(at, 0, header);
  return lines.join('\n');
}

function main() {
  const fix = process.argv.includes('--fix');
  const problems = [];
  let fixed = 0;
  const files = sourceFiles();
  for (const path of files) {
    const expected = OTHER_LICENSES[path] ?? PROJECT_LICENSE;
    const text = readFileSync(join(root, path), 'utf8');
    const declared = declaredLicense(text);
    if (declared === expected) continue;
    if (declared === undefined && fix) {
      writeFileSync(join(root, path), withHeader(text, path, expected));
      fixed += 1;
      continue;
    }
    problems.push(declared === undefined ? `${path}: no SPDX-License-Identifier in its first ${WITHIN_LINES} lines (expected ${expected})` : `${path}: declares ${declared}, expected ${expected}`);
  }
  if (fixed) console.log(`added the header to ${fixed} file(s)`);
  for (const p of problems) console.log(p);
  if (problems.length) {
    console.log(`\n${problems.length} of ${files.length} source files lack the right header. Run: node scripts/check-spdx-headers.mjs --fix`);
    process.exit(1);
  }
  console.log(`every one of ${files.length} source files declares its license`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
