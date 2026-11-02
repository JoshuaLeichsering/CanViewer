// SPDX-License-Identifier: GPL-2.0-or-later
// Checks the file that the desktop app's self-test saved through Export, then
// Messages as CSV (desktop/src/smoke.js), after the app has quit: it must be
// in the Downloads folder the job looks in, and equal the browser's export of
// demo.dbc byte for byte, that is the pinned file the unit tests and
// e2e/export-check.mjs compare against, with the byte order mark the
// download adds.
//
// Usage: node e2e/desktop-download-check.mjs <Downloads folder>/demo.messages.csv
import { existsSync, readFileSync } from 'node:fs';

const [, , file] = process.argv;
if (!file) {
  console.error('usage: node e2e/desktop-download-check.mjs <downloaded demo.messages.csv>');
  process.exit(2);
}
const pinned = new URL('../app/src/lib/export/pinned/demo.messages.csv', import.meta.url);
const expected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(pinned)]);
if (!existsSync(file)) {
  console.error(`FAIL ${file} does not exist: the desktop app saved no export there`);
  process.exit(1);
}
const got = readFileSync(file);
if (!got.equals(expected)) {
  let at = 0;
  while (at < got.length && at < expected.length && got[at] === expected[at]) at++;
  console.error(`FAIL ${file} (${got.length} bytes) differs from the pinned export (${expected.length} bytes) from byte ${at} on`);
  console.error(`  saved:    ${JSON.stringify(got.subarray(at, at + 60).toString('utf8'))}`);
  console.error(`  expected: ${JSON.stringify(expected.subarray(at, at + 60).toString('utf8'))}`);
  process.exit(1);
}
console.log(`ok   ${file} equals the pinned export of demo.dbc (${got.length} bytes)`);
