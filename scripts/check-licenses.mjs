#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Checks the licenses of what the web app ships against the allowlist in
// scripts/license-policy.mjs. CI runs it with cargo-deny, which checks the
// Rust crates against desktop/deny.toml.
//
//   node scripts/check-licenses.mjs
//
// - npm production dependencies (package-lock.json): each license is on the
//   allowlist, matches the installed package, and comes with a license text
//   (the package's own file, or one in scripts/third-party/licenses/).
// - Python wheels (app/src/lib/canmatrix/wheels.lock.json, files in
//   vendor/pyodide/): each is reviewed in WHEELS, its METADATA still states
//   the reviewed license, and the license is on the allowlist; the libraries
//   compiled into a wheel are still there (their markers).
// - The Pyodide runtime: the markers of the libraries compiled into it are
//   still found, so the notices describe the runtime that ships.
//
// Parts listed in EXCEPTIONS are reported as warnings: they await a decision.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, EXCEPTIONS, NPM_TEXTS, PYODIDE_COMPONENTS, WHEEL_BUNDLED, WHEELS, isAllowed } from './license-policy.mjs';
import { readZip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._].*)?$/i;

const problems = [];
const warnings = [];
const ok = [];

/** Records the verdict for one part; returns true when its license is on the allowlist. */
function checkLicense(what, name, license) {
  if (isAllowed(license, ALLOWED)) return true;
  if (EXCEPTIONS[name]) warnings.push(`${what} ${name}: ${license} is not on the allowlist. ${EXCEPTIONS[name]}`);
  else problems.push(`${what} ${name}: ${license} is not on the allowlist (scripts/license-policy.mjs)`);
  return false;
}

// npm
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
let npmCount = 0;
for (const [key, entry] of Object.entries(lock.packages)) {
  if (!key || entry.dev) continue;
  npmCount += 1;
  const name = key.replace(/^.*node_modules\//, '');
  if (!entry.license) {
    problems.push(`npm ${name}: package-lock.json records no license`);
    continue;
  }
  const dir = join(root, key);
  if (!existsSync(join(dir, 'package.json'))) {
    problems.push(`npm ${name}: not installed (run npm ci)`);
    continue;
  }
  const installed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).license;
  if (installed !== entry.license) problems.push(`npm ${name}: installed package says ${installed}, the lock ${entry.license}`);
  const hasText = readdirSync(dir).some((f) => LICENSE_FILE.test(f)) || (NPM_TEXTS[name] ?? []).length > 0;
  if (!hasText) problems.push(`npm ${name}: ships no license file and none is in NPM_TEXTS`);
  if (checkLicense('npm', name, entry.license)) ok.push(`npm ${name}@${entry.version}: ${entry.license}`);
}

// wheels
const wheels = JSON.parse(readFileSync(join(root, 'app/src/lib/canmatrix/wheels.lock.json'), 'utf8'));
let wheelCount = 0;
const soStrings = (zip) =>
  [...zip.keys()]
    .filter((n) => n.endsWith('.so'))
    .map((n) => zip.get(n)().toString('latin1'))
    .join('\n');
for (const [name, entry] of Object.entries(wheels.packages)) {
  wheelCount += 1;
  const policy = WHEELS[name];
  if (!policy) {
    problems.push(`wheel ${name}: not reviewed (add it to WHEELS in scripts/license-policy.mjs)`);
    continue;
  }
  const path = join(root, 'vendor/pyodide', entry.file_name);
  if (!existsSync(path)) {
    problems.push(`wheel ${name}: ${entry.file_name} is missing (run npm run fetch-wheels)`);
    continue;
  }
  const zip = readZip(path);
  const metadataName = [...zip.keys()].find((n) => /^[^/]+\.dist-info\/METADATA$/.test(n));
  const head = zip.get(metadataName)().toString('utf8').split('\n\n')[0].split('\n');
  for (const line of policy.metadata) {
    if (!head.includes(line)) problems.push(`wheel ${name}: METADATA no longer says "${line}"; review the new version's license`);
  }
  const bundled = WHEEL_BUNDLED[name] ?? [];
  if (bundled.length) {
    const strings = soStrings(zip);
    for (const b of bundled) {
      for (const marker of b.markers) {
        if (!strings.includes(marker)) problems.push(`wheel ${name}: ${b.name} no longer found (marker "${marker}"); update WHEEL_BUNDLED`);
      }
      checkLicense(`wheel ${name}, compiled-in`, b.name, b.license);
    }
  }
  if (checkLicense('wheel', name, policy.license)) ok.push(`wheel ${name} ${entry.version}: ${policy.license}`);
}

// the Pyodide runtime
const runtime = new Map();
const runtimeFile = (file) => {
  if (!runtime.has(file)) runtime.set(file, readFileSync(join(root, 'node_modules/pyodide', file)).toString('latin1'));
  return runtime.get(file);
};
for (const c of PYODIDE_COMPONENTS) {
  for (const [file, marker] of c.markers) {
    if (!runtimeFile(file).includes(marker)) problems.push(`Pyodide runtime: ${c.name} no longer found in ${file} (marker "${marker}"); update PYODIDE_COMPONENTS`);
  }
  if (checkLicense('Pyodide runtime part', c.name, c.license)) ok.push(`Pyodide runtime part ${c.name}: ${c.license}`);
}

for (const line of ok) console.log(`ok    ${line}`);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(
  `\n${npmCount} npm production dependencies, ${wheelCount} wheels, ${PYODIDE_COMPONENTS.length} parts of the Pyodide runtime checked: ` +
    `${problems.length} problem(s), ${warnings.length} exception(s) awaiting a decision.`,
);
if (problems.length) process.exit(1);
