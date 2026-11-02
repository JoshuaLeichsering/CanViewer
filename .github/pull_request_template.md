## What and why

<!-- What this pull request changes, and why. Reference issues as "Refs #12". -->

## Evidence

<!-- Quote the commands you ran and the lines of their output that matter. -->

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run --coverage` within the thresholds, and `node scripts/check-test-report.mjs` ends with "every corpus suite ran in full"
- [ ] `npm run test:scripts`
- [ ] `npm run build`
- [ ] the network check reports `requests outside …: 0`
- [ ] `npm run e2e`, `node e2e/ui-checks.mjs` and `node --test e2e/import-ui.test.mjs`
- [ ] `node e2e/signal-table.mjs`, `node e2e/large-database.mjs`, `node e2e/export-check.mjs`, `node e2e/diff-check.mjs`, `node e2e/trc-traces-encoder.mjs`, `node e2e/editing.mjs` and `node e2e/desktop-csp-check.mjs`
- [ ] `npm run check:identifying-info` and `npm run check:licenses`
- [ ] for the docs or the app: `npm run docs:links`, the docs build, the site link check, the network check under `/app/` and `node e2e/docs-crawl.mjs`

## Checklist

- [ ] New interface text exists in English and German.
- [ ] No request outside the app's origin was added.
- [ ] No test, threshold or baseline was weakened. A regenerated baseline is explained above.
- [ ] A changed dependency is pinned, its license is allowed, and `THIRD_PARTY_NOTICES.md` is regenerated (`npm run notices`).
- [ ] User-facing changes are described in the documentation.
