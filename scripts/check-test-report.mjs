// Checks a Vitest JSON report for CI: every test passed, nothing was skipped,
// and each corpus suite ran over exactly the expected number of files.
//
// The corpus suites skip themselves when the submodules are missing, which
// would make a green run meaningless; the counts make that impossible to miss.
// When a corpus legitimately grows or shrinks, update EXPECTED in the same
// pull request and say why.
//
// Usage: node scripts/check-test-report.mjs <vitest-json-report>
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

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
  { file: 'import-corpus.test.ts', pattern: / reads as pinned$/, count: 122, what: 'non-DBC corpus files read through canmatrix' },
  { file: 'import-corpus.test.ts', pattern: / matches its DBC twin .* as pinned$/, count: 78, what: 'non-DBC files compared with their DBC twin' },
  { file: 'mapper.test.ts', pattern: / differs from CanViewer’s parser only as pinned$/, count: 58, what: 'OEM DBC files through the canmatrix mapper', when: 'app/src/lib/canmatrix/mapper.test.ts' },
];

const problems = [];
if (tests.length === 0) problems.push('the report contains no tests');

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

const byStatus = {};
for (const t of tests) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
console.log(`tests: ${tests.length} ${JSON.stringify(byStatus)}`);
console.log('corpus suites:');
console.log(rows.join('\n'));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nall tests passed, none skipped, every corpus suite ran in full');
