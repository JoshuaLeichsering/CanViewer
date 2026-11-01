#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Fetches the Python wheels that the canmatrix import adapter runs on into
// vendor/pyodide/, verifying each against the SHA-256 pinned in
// app/src/lib/canmatrix/wheels.lock.json. The Pyodide runtime itself comes from the
// `pyodide` npm package; nothing here is fetched by the app at run time.
//
//   node scripts/fetch-wheels.mjs              download what is missing
//   node scripts/fetch-wheels.mjs --check      verify only, never touch the network
//   node scripts/fetch-wheels.mjs --from DIR   copy from a local directory first,
//                                              e.g. an unpacked Pyodide release
//   node scripts/fetch-wheels.mjs --quiet      print only what was fetched or failed
//
// Files that are already present with the right hash are left alone, so the
// script is cheap to run before every build and test run, and works offline
// once the cache is filled.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'app/src/lib/canmatrix/wheels.lock.json'), 'utf8'));
const target = join(root, 'vendor/pyodide');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const quiet = args.includes('--quiet');
const fromIndex = args.indexOf('--from');
const fromDir = fromIndex >= 0 ? args[fromIndex + 1] : undefined;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(target, { recursive: true });
let failed = 0;
for (const pkg of Object.values(lock.packages)) {
  const dest = join(target, pkg.file_name);
  const { source } = pkg.tool.canviewer;
  if (existsSync(dest) && sha256(readFileSync(dest)) === pkg.sha256) {
    if (!quiet) console.log(`ok       ${pkg.file_name}`);
    continue;
  }
  if (checkOnly) {
    console.error(`missing  ${pkg.file_name}`);
    failed++;
    continue;
  }
  let buf;
  let via;
  if (fromDir && existsSync(join(fromDir, pkg.file_name))) {
    buf = readFileSync(join(fromDir, pkg.file_name));
    via = join(fromDir, pkg.file_name);
  } else {
    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      via = source;
    } catch (e) {
      console.error(`FAILED   ${pkg.file_name} from ${source}: ${e.cause?.code ?? e.message}`);
      failed++;
      continue;
    }
  }
  const got = sha256(buf);
  if (got !== pkg.sha256) {
    console.error(`MISMATCH ${pkg.file_name} from ${via}: sha256 ${got}, lock says ${pkg.sha256}`);
    failed++;
    continue;
  }
  writeFileSync(dest + '.part', buf);
  renameSync(dest + '.part', dest);
  console.log(`fetched  ${pkg.file_name} (${buf.length} bytes) from ${via}`);
}
if (failed) {
  console.error(
    `\n${failed} wheel(s) missing or wrong. Re-run with network access, or pass --from <dir> ` +
      'with the files (the Pyodide release tarball holds the pyodide-built ones).',
  );
  process.exit(1);
}
