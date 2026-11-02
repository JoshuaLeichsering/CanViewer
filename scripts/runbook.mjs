// SPDX-License-Identifier: GPL-2.0-or-later
// The commands of the install runbook (docs/guide/install.md), as CI runs them.
//
// Each command block in the runbook that CI runs is marked with a comment just
// above it, which Markdown renderers do not show:
//
//   <!-- runbook: linux-install -->
//   ```sh
//   sudo apt install ./CanViewer_0.2.0_amd64.deb
//   ```
//
// The desktop workflow runs these blocks, exactly as the runbook shows them,
// against the packages it has just built, so the guide cannot drift from what
// works. The block's language picks the shell a reader would use: `sh` runs in
// bash (Linux), `zsh` in zsh (macOS's default shell), `powershell` in Windows
// PowerShell 5.1 (what Windows ships), never PowerShell 7.
//
//   node scripts/runbook.mjs list
//   node scripts/runbook.mjs show <id>
//   node scripts/runbook.mjs run <id> [--cwd DIR]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNBOOK = fileURLToPath(new URL('../docs/guide/install.md', import.meta.url));

/** How each block language runs: the program, its arguments before the script, and the script's preamble. */
export const SHELLS = {
  sh: { program: 'bash', args: [], ext: '.sh', preamble: 'set -eo pipefail\n' },
  zsh: { program: 'zsh', args: [], ext: '.zsh', preamble: 'set -eo pipefail\n' },
  powershell: {
    program: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'],
    ext: '.ps1',
    preamble: "$ErrorActionPreference = 'Stop'\n",
  },
};

/**
 * The environment a block runs in. Windows PowerShell 5.1 started from
 * PowerShell 7 (as a CI step's pwsh does, through node) inherits PowerShell
 * 7's PSModulePath, then loads PowerShell 7's modules and loses cmdlets such
 * as Get-FileHash. Without the variable it builds its own default path, as it
 * does when a person opens it from the Start menu.
 */
export function envFor(lang, env = process.env) {
  if (lang !== 'powershell') return env;
  // Windows environment names are case-insensitive: drop every spelling.
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
}

const MARKER = /^\s*<!--\s*runbook:\s*([a-z0-9][a-z0-9-]*)\s*-->\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/;

/**
 * The marked blocks of a runbook: id -> { lang, code, line }. Throws on a
 * marker without a block under it, a duplicate id, an unclosed block, or a
 * language with no shell.
 */
export function parseRunbook(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const marker = MARKER.exec(lines[i]);
    if (!marker) continue;
    const id = marker[1];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const fence = FENCE.exec(lines[j] ?? '');
    if (!fence) throw new Error(`runbook block ${id} (line ${i + 1}): no code block follows the marker`);
    const [, indent, ticks, lang] = fence;
    if (!SHELLS[lang]) throw new Error(`runbook block ${id} (line ${j + 1}): language "${lang}" is not one of ${Object.keys(SHELLS).join(', ')}`);
    const body = [];
    let k = j + 1;
    for (; k < lines.length; k++) {
      const close = lines[k].trimStart();
      if (close.startsWith(ticks[0].repeat(ticks.length)) && close.replace(/[`~]/g, '').trim() === '') break;
      body.push(lines[k].startsWith(indent) ? lines[k].slice(indent.length) : lines[k].trimStart());
    }
    if (k === lines.length) throw new Error(`runbook block ${id} (line ${j + 1}): the code block is not closed`);
    if (blocks.has(id)) throw new Error(`runbook block ${id} (line ${i + 1}): the id is used twice`);
    blocks.set(id, { lang, code: body.join('\n') + '\n', line: j + 2 });
    i = k;
  }
  return blocks;
}

/** The script file a block runs as: the shell's preamble, then the block exactly. */
export function scriptFor(block) {
  const text = SHELLS[block.lang].preamble + block.code;
  // Windows PowerShell 5.1 reads a script without a byte order mark as ANSI.
  return block.lang === 'powershell' ? '﻿' + text : text;
}

export function runBlock(id, { file = RUNBOOK, cwd = process.cwd() } = {}) {
  const block = parseRunbook(readFileSync(file, 'utf8')).get(id);
  if (!block) throw new Error(`no runbook block ${id} in ${file}`);
  const shell = SHELLS[block.lang];
  console.log(`runbook ${id} (${block.lang}, ${file}:${block.line}), in ${resolve(cwd)}:`);
  for (const line of block.code.trimEnd().split('\n')) console.log(`  > ${line}`);
  const dir = mkdtempSync(join(tmpdir(), 'runbook-'));
  const script = join(dir, `${id}${shell.ext}`);
  writeFileSync(script, scriptFor(block));
  try {
    const r = spawnSync(shell.program, [...shell.args, script], { cwd, stdio: 'inherit', env: envFor(block.lang) });
    if (r.error) throw r.error;
    console.log(`runbook ${id}: exit code ${r.status}`);
    return r.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const [command, id] = argv;
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = opt('file') ?? RUNBOOK;
  if (command === 'list') {
    for (const [name, b] of parseRunbook(readFileSync(file, 'utf8'))) console.log(`${name}\t${b.lang}\tline ${b.line}`);
    return 0;
  }
  if (command === 'show' && id) {
    const block = parseRunbook(readFileSync(file, 'utf8')).get(id);
    if (!block) throw new Error(`no runbook block ${id} in ${file}`);
    process.stdout.write(block.code);
    return 0;
  }
  if (command === 'run' && id) return runBlock(id, { file, cwd: opt('cwd') });
  console.error('usage: node scripts/runbook.mjs list | show <id> | run <id> [--cwd DIR] [--file FILE]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
