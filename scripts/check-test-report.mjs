// SPDX-License-Identifier: GPL-2.0-or-later
// Checks a Vitest JSON report for CI: every test file loaded and passed, every
// test passed, nothing was skipped, and each corpus suite ran over exactly the
// expected number of files.
//
// The corpus suites skip themselves when the submodules are missing, which
// would make a green run meaningless; the counts make that impossible to miss.
// A test file that fails to load (a bad import, say) contributes no tests at
// all, so the files' own status is checked as well as each test's.
// When a corpus legitimately grows or shrinks, update EXPECTED in the same
// pull request and say why.
//
// Usage: node scripts/check-test-report.mjs <vitest-json-report>
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';

const [, , reportPath] = process.argv;
if (!reportPath) {
  console.error('usage: node scripts/check-test-report.mjs <vitest-json-report>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const tests = report.testResults.flatMap((file) =>
  file.assertionResults.map((a) => ({ file: basename(file.name), title: a.title, fullName: a.fullName, status: a.status })),
);

/**
 * Corpus suites and how many tests each must contribute. `when` limits a
 * check to repositories that have the test file (the mapper suite arrives
 * with its pull request).
 */
const EXPECTED = [
  { file: 'corpus.test.ts', pattern: / parses cleanly$/, count: 58, what: 'OEM DBC files parsed' },
  { file: 'corpus.test.ts', pattern: / matches the pinned baseline$/, count: 58, what: 'OEM DBC files matched against the baseline' },
  { file: 'import-corpus.test.ts', pattern: / reads as pinned$/, count: 114, what: 'non-DBC corpus files read through canmatrix' },
  { file: 'import-corpus.test.ts', pattern: / matches its DBC twin .* as pinned$/, count: 70, what: 'non-DBC files compared with their DBC twin' },
  { file: 'mapper.test.ts', pattern: / differs from CanViewer’s parser only as pinned$/, count: 58, what: 'OEM DBC files through the canmatrix mapper', when: 'app/src/lib/canmatrix/mapper.test.ts' },
  // The export suites run over every DBC file of the submodules: the 58 OEM
  // files, 87 from cantools and 4 from canmatrix. The C compile tests also
  // fail, rather than skip, when CI has no C compiler.
  { file: 'table.test.ts', pattern: /: CSV and JSON read back as the model$/, count: 149, what: 'corpus DBC files exported as CSV and JSON and read back' },
  { file: 'pseudo-code.test.ts', pattern: /: every signal decodes as CanViewer decodes it$/, count: 149, what: 'corpus DBC files decoded by the generated pseudo-code' },
  { file: 'c-struct.test.ts', pattern: /^every pinned C struct$/, count: 1, what: 'run of cc over the pinned C structs' },
  { file: 'c-struct.test.ts', pattern: /: every message's C struct compiles$/, count: 149, what: 'corpus DBC files whose C structs compiled with cc' },
  { file: 'diff-corpus.test.ts', pattern: / has no differences with itself$/, count: 58, what: 'OEM DBC files diffed with themselves' },
  { file: 'diff-corpus.test.ts', pattern: / gives the pinned diff$/, count: 2, what: 'opendbc version pairs diffed as pinned' },
  { file: 'encode.corpus.test.ts', pattern: /: every signal round-trips through the encoder$/, count: 58, what: 'OEM DBC files with every signal round-tripped through the frame encoder', when: 'app/src/lib/dbc/encode.corpus.test.ts' },
  { file: 'encode.corpus.test.ts', pattern: /: its sampled messages round-trip as whole frames$/, count: 58, what: 'OEM DBC files with sampled whole frames round-tripped through the encoder', when: 'app/src/lib/dbc/encode.corpus.test.ts' },
];

const problems = [];
if (report.testResults.length === 0) problems.push('the report contains no test files');
if (tests.length === 0) problems.push('the report contains no tests');

for (const file of report.testResults.filter((f) => f.status !== 'passed')) {
  const why = file.message ? file.message.split('\n')[0] : 'see its tests below';
  problems.push(`test file ${file.status}: ${relative(process.cwd(), file.name)}: ${why}`);
}
if (report.success !== true) {
  problems.push(
    `Vitest reports success: ${report.success} (${report.numFailedTestSuites} failed suite(s), ${report.numFailedTests} failed test(s))`,
  );
}

for (const t of tests.filter((t) => t.status !== 'passed')) {
  problems.push(`${t.status}: ${t.file} > ${t.fullName}`);
}

const rows = [];
for (const e of EXPECTED) {
  if (e.when && !existsSync(e.when)) {
    rows.push(`  -     ${e.what}: not in this tree (${e.when} absent)`);
    continue;
  }
  const ran = tests.filter((t) => t.file === e.file && e.pattern.test(t.title) && t.status === 'passed').length;
  rows.push(`  ${ran === e.count ? 'ok' : 'XX'}  ${String(ran).padStart(3)} / ${e.count} ${e.what}`);
  if (ran !== e.count) problems.push(`${e.what}: ${ran} passed, expected ${e.count}`);
}

const count = (items) => {
  const byStatus = {};
  for (const i of items) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  return `${items.length} ${JSON.stringify(byStatus)}`;
};
console.log(`test files: ${count(report.testResults)}`);
console.log(`tests: ${count(tests)}`);
console.log('corpus suites:');
console.log(rows.join('\n'));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nall test files and tests passed, none skipped, every corpus suite ran in full');
