// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for the license tooling: the allowlist's expression evaluation, the
// SPDX header helpers and the notices renderer. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { declaredLicense, withHeader } from './check-spdx-headers.mjs';
import { ALLOWED, isAllowed } from './license-policy.mjs';
import { render } from './third-party-notices.mjs';

test('license expressions are allowed when some choice uses allowed licenses only', () => {
  assert.equal(isAllowed('MIT'), true);
  assert.equal(isAllowed('MIT OR Apache-2.0'), true);
  assert.equal(isAllowed('Apache-2.0/MIT'), true);
  assert.equal(isAllowed('(MIT OR Apache-2.0) AND Unicode-3.0'), true);
  assert.equal(isAllowed('Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT'), true);
  assert.equal(isAllowed('MIT OR Apache-2.0 OR LGPL-2.1-or-later'), true);
  assert.equal(isAllowed('GPL-3.0-only'), false);
  assert.equal(isAllowed('MIT AND GPL-3.0-only'), false);
  assert.equal(isAllowed('BSD-3-Clause AND LicenseRef-BSD-4-Clause-Giffin'), false);
  assert.equal(isAllowed('MIT', new Set(['Apache-2.0'])), false);
});

test('the allowlist holds no copyleft license stronger than file level', () => {
  for (const id of ALLOWED) assert.doesNotMatch(id, /^(A?GPL|LGPL|SSPL|EUPL|CDDL|EPL)/);
});

test('SPDX headers go first, after a shebang, or after a Python coding line', () => {
  const id = 'GPL-2.0-or-later';
  assert.equal(withHeader('const a = 1;\n', 'x.ts', id), `// SPDX-License-Identifier: ${id}\nconst a = 1;\n`);
  assert.equal(withHeader('#!/usr/bin/env node\nrun();\n', 'x.mjs', id), `#!/usr/bin/env node\n// SPDX-License-Identifier: ${id}\nrun();\n`);
  assert.equal(withHeader('# -*- coding: utf-8 -*-\n"""Doc."""\n', 'x.py', id), `# -*- coding: utf-8 -*-\n# SPDX-License-Identifier: ${id}\n"""Doc."""\n`);
  assert.equal(withHeader('a { color: red; }\n', 'x.css', id), `/* SPDX-License-Identifier: ${id} */\na { color: red; }\n`);
  assert.equal(declaredLicense(withHeader('fn main() {}\n', 'x.rs', id)), id);
  assert.equal(declaredLicense('/* SPDX-License-Identifier: Apache-2.0 */\n'), 'Apache-2.0');
  assert.equal(declaredLicense('// nothing here\n'), undefined);
});

const apache = readFileSync(new URL('./third-party/licenses/spdx-Apache-2.0.txt', import.meta.url), 'utf8');
const mit = (holder) => `MIT License\n\nCopyright (c) ${holder}\n\nPermission is hereby granted, free of charge, to any person.\n`;

function sample() {
  return {
    npm: [
      { name: 'pyodide', version: '1.0.0', license: 'MPL-2.0', source: 'https://example.org/pyodide', files: [], policyTexts: ['pyodide-LICENSE.txt'] },
      { name: 'react', version: '18.3.1', license: 'MIT', source: 'https://example.org/react', files: [mit('Meta')], policyTexts: [] },
      { name: 'react-dom', version: '18.3.1', license: 'MIT', source: 'https://example.org/react', files: [mit('Meta')], policyTexts: [] },
    ],
    wheels: [],
    crates: [
      { name: 'alpha', version: '1.0.0', license: 'MIT OR Apache-2.0', source: 'https://example.org/alpha', files: [apache, mit('Alpha')], standard: [] },
      // Re-wrapped, with a copyright line filled into the appendix.
      { name: 'beta', version: '2.0.0', license: 'Apache-2.0', source: 'https://example.org/beta', files: [apache.replace(/\n/g, '\n\n').replace('[yyyy] [name of copyright owner]', '2024 Beta Authors')], standard: [] },
      { name: 'gamma', version: '0.1.0', license: 'MIT', source: 'https://example.org/gamma', files: [], standard: ['spdx-MIT.txt'] },
    ],
  };
}

test('the notices list every component in the contents, with its version', () => {
  const md = render(sample());
  assert.match(md, /^\| \[react\]\(#react\) \| 18\.3\.1 \| MIT \| web app, desktop app \|$/m);
  assert.match(md, /^\| \[pyodide\]\(#pyodide\) \| 1\.0\.0 \| MPL-2\.0 \| web app, desktop app \|$/m);
  assert.match(md, /^\| \[Rust crates\]\(#rust-crates\) \| 3 crates \|/m);
  assert.match(md, /^\| \[alpha\]\(https:\/\/example\.org\/alpha\) \| 1\.0\.0 \| MIT OR Apache-2\.0 \| \[Text \d+\]/m);
});

test('identical texts appear once, and the Apache License once, keeping what a copy adds', () => {
  const md = render(sample());
  // Texts that are a copy of the Apache License (CPython's list of incorporated
  // software quotes it too, inside a longer document).
  assert.equal([...md.matchAll(/^```text\nApache License\s+Version 2\.0, January 2004/gm)].length, 1);
  const textsOf = (row) => [...md.match(new RegExp(`^\\| \\[${row}\\].*$`, 'm'))[0].matchAll(/Text (\d+)/g)].map((m) => m[1]);
  // alpha ships the Apache License first, then its MIT license.
  const [apacheText] = textsOf('alpha');
  assert.ok(textsOf('beta').includes(apacheText), 'beta shares the Apache text with alpha');
  assert.equal(textsOf('beta').length, 2, 'beta keeps its filled-in appendix as a text of its own');
  assert.match(md, /2024 Beta Authors/);
  // react and react-dom share one MIT text; gamma gets the standard MIT text.
  assert.match(md, /Used by: react, react-dom\./);
  assert.match(md, /Copyright \(c\) <year> <copyright holders>/);
});
