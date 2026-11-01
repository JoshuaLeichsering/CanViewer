// Prints the coverage of a Vitest run as a Markdown table: all of app/src,
// app/src/lib (which has its own threshold in vite.config.ts) and each
// directory. CI appends it to the job summary; the full report is the HTML in
// coverage/.
//
// Usage: npm run test:coverage && node scripts/coverage-summary.mjs [coverage/coverage-summary.json]
import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

const path = process.argv[2] ?? 'coverage/coverage-summary.json';
const summary = JSON.parse(readFileSync(path, 'utf8'));
const KINDS = ['lines', 'statements', 'functions', 'branches'];

const files = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, data]) => ({ file: relative(process.cwd(), file), data }));

function aggregate(selected) {
  return Object.fromEntries(
    KINDS.map((kind) => {
      const covered = selected.reduce((n, f) => n + f.data[kind].covered, 0);
      const total = selected.reduce((n, f) => n + f.data[kind].total, 0);
      return [kind, { covered, total }];
    }),
  );
}

// Rounded down to two decimals, as Vitest's own report does.
const percent = (covered, total) => (Math.floor((10000 * covered) / total) / 100).toFixed(2);
const cell = ({ covered, total }) => (total === 0 ? '–' : `${percent(covered, total)} % (${covered}/${total})`);
const row = (name, data) => `| ${name} | ${KINDS.map((k) => cell(data[k])).join(' | ')} |`;

const directories = [...new Set(files.map((f) => dirname(f.file)))].sort();
const lines = [
  `| Area | ${KINDS.map((k) => k[0].toUpperCase() + k.slice(1)).join(' | ')} |`,
  `|---|${KINDS.map(() => '---:').join('|')}|`,
  row('**all of app/src**', aggregate(files)),
  row('**all of app/src/lib**', aggregate(files.filter((f) => f.file.startsWith('app/src/lib/')))),
  ...directories.map((dir) => row(dir, aggregate(files.filter((f) => dirname(f.file) === dir)))),
];
console.log(lines.join('\n'));
