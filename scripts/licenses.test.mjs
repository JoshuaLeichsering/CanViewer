// SPDX-License-Identifier: GPL-2.0-or-later
// Tests for the license tooling: the allowlist's expression evaluation, the
// SPDX header helpers and the notices renderer. Run with: npm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { declaredLicense, withHeader } from './check-spdx-headers.mjs';
import { ALLOWED, BUILD_HELPERS, INSTALLER_LICENSES, WINDOWS_INSTALLERS, classifyModule, isAllowed } from './license-policy.mjs';
import { excerpt, linesBetween, render, uncomment } from './third-party-notices.mjs';

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

test('the allowlist holds no copyleft license stronger than file level, besides the LGPL of GNU libiconv', () => {
  // LGPL-2.0-or-later, whose section 3 allows the GPL instead, for libiconv in
  // lxml's etree module: a library that stays a replaceable part (license-policy.mjs).
  const reviewed = new Set(['LGPL-2.0-or-later']);
  for (const id of ALLOWED) if (!reviewed.has(id)) assert.doesNotMatch(id, /^(A?GPL|LGPL|SSPL|EUPL|CDDL|EPL)/);
  // The installers' own licenses are not compatible with the GPL: they may never reach the app.
  for (const id of INSTALLER_LICENSES) assert.equal(ALLOWED.has(id), false, `${id} is for the Windows installers only`);
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

test('a crate notice is copied without its comment markers', () => {
  const rs = [
    '// Copyright 2014-2021 The winit contributors',
    '// SPDX-License-Identifier: Apache-2.0',
    '',
    '//! Docs.',
    '/* Copyright (c) 2010 Someone. All rights reserved.',
    ' * Redistribution is permitted.',
    ' *',
    ' *    1. Keep this notice.',
    ' */',
    'fn main() {}',
  ].join('\n');
  assert.equal(uncomment(linesBetween(rs, 'winit contributors', 'SPDX')), 'Copyright 2014-2021 The winit contributors\nSPDX-License-Identifier: Apache-2.0');
  assert.equal(
    uncomment(linesBetween(rs, 'Copyright (c) 2010', '*/')),
    'Copyright (c) 2010 Someone. All rights reserved.\nRedistribution is permitted.\n\n   1. Keep this notice.\n',
  );
  assert.equal(linesBetween(rs, 'not there', 'SPDX'), undefined);
  assert.equal(linesBetween(rs, 'winit contributors', 'not there'), undefined);
});

test('a license text is cut from a longer file between two headings, without quote markers', () => {
  const md = '# Core license\nMIT\n\n# Bundled\n## a, b-plugin, c\nLicense: MIT\n\n> Copyright B\n>\n> Permission.\n\n---------------------\n\n## d\n';
  assert.equal(excerpt(md, /^# Core license$/m, /^# Bundled$/m), '# Core license\nMIT\n\n');
  assert.equal(excerpt(md, /^## [^\n]*b-plugin[^\n]*$/m, /^-{20,}$/m), '## a, b-plugin, c\nLicense: MIT\n\nCopyright B\n\nPermission.\n\n');
  assert.equal(excerpt(md, /^## nothing$/m, /^-{20,}$/m), undefined);
});

test('every module of the bundle is the app\'s own, a file, or a reviewed build helper', () => {
  const [vite, commonjs] = BUILD_HELPERS.map((h) => h.name);
  assert.equal(classifyModule('\0vite/modulepreload-polyfill.js'), vite);
  assert.equal(classifyModule('__vite-browser-external'), vite);
  assert.equal(classifyModule('\0commonjsHelpers.js'), commonjs);
  assert.equal(classifyModule('\0/repo/node_modules/react/index.js?commonjs-module'), commonjs);
  assert.equal(classifyModule('\0virtual:canviewer-pyodide-lock'), 'own');
  assert.equal(classifyModule('/repo/node_modules/react/index.js'), 'file');
  assert.equal(classifyModule('C:/repo/app/src/main.tsx'), 'file');
  assert.equal(classifyModule('\0some-plugin:helper'), 'unknown');
  assert.equal(classifyModule('virtual-thing'), 'unknown');
});

test('the notices list build helpers, crate file notices and the Rust standard library', () => {
  const data = sample();
  data.crates[0].notices = [{ file: 'src/keys.rs', what: 'W3C notice.', files: ['alpha 1.0.0, src/keys.rs:\n\nCopyright W3C'], textFiles: [] }];
  data.buildHelpers = [{ name: 'Vite (runtime helpers)', version: '6.4.3', license: 'MIT', source: 'https://example.org/vite', files: [mit('Vite')] }];
  data.rustStd = {
    version: '1.97.0',
    source: 'https://example.org/rust',
    components: [
      { name: 'core and std', crates: ['core', 'std'], license: 'MIT OR Apache-2.0', texts: ['spdx-MIT.txt'] },
      { name: 'gimli', version: '0.32.3', license: 'MIT OR Apache-2.0', texts: ['spdx-Apache-2.0.txt'] },
    ],
  };
  const md = render(data);
  assert.match(md, /^\| \[Vite \(runtime helpers\)\]\(#vite-runtime-helpers\) \| 6\.4\.3 \| MIT \|/m);
  assert.match(md, /^\| \[Rust standard library\]\(#rust-standard-library\) \| 1\.97\.0 \| see the list \| desktop app \|$/m);
  assert.match(md, /^\| core and std \| 1\.97\.0 \| MIT OR Apache-2\.0 \| \[Text \d+\]/m);
  assert.match(md, /^\| gimli \| 0\.32\.3 \|/m);
  const notice = md.match(/^\| alpha 1\.0\.0 \| `src\/keys\.rs` \| W3C notice\. \| \[Text (\d+)\]\(#text-\d+\) \|$/m);
  assert.ok(notice, 'the crate notice has a row');
  // The crate's own row links the notice's text as well.
  assert.match(md, new RegExp(`^\\| \\[alpha\\].*\\[Text ${notice[1]}\\]`, 'm'));
  assert.match(md, /alpha 1\.0\.0, src\/keys\.rs:\n\nCopyright W3C/);
});

test('the notices list the documentation site, and the fonts it shares with the app', () => {
  const data = sample();
  data.npm.push({ name: '@fontsource/roboto-mono', version: '5.3.0', license: 'OFL-1.1', source: 'https://example.org/fonts', files: ['SIL Open Font License'], policyTexts: [] });
  data.docsSite = {
    packages: [{ name: 'vue', version: '3.5.44', license: 'MIT', source: 'https://example.org/vue', files: [mit('Evan You')], standard: [] }],
    helpers: [{ name: 'Vite (runtime helpers, as VitePress builds the site)', version: '5.4.21', license: 'MIT', source: 'https://example.org/vite', files: [mit('Vite')] }],
  };
  const md = render(data);
  assert.match(md, /^\| \[vue\]\(#vue\) \| 3\.5\.44 \| MIT \| documentation site \|$/m);
  assert.match(md, /^\| \[Vite \(runtime helpers, as VitePress builds the site\)\]\(#vite-runtime-helpers-as-vitepress-builds-the-site\) \| 5\.4\.21 \| MIT \| documentation site \|$/m);
  assert.match(md, /^\| \[@fontsource\/roboto-mono\]\(#fontsourceroboto-mono\) \| 5\.3\.0 \| OFL-1\.1 \| web app, desktop app, documentation site \|$/m);
  assert.match(md, /^## Documentation site$/m);
  assert.match(md, /Copyright \(c\) Evan You/);
  // Without the site, the fonts ship in the apps only.
  assert.match(render(sample()), /^(?![\s\S]*documentation site)/);
});

test('the notices list GNU libiconv as compiled into lxml, under the LGPL, with its sources', () => {
  const committed = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  const entry = committed.match(/^#### GNU libiconv \(compiled into lxml\)\n([\s\S]*?)(?=^#{2,4} )/m)?.[1];
  assert.ok(entry, 'libiconv has an entry under lxml');
  assert.match(entry, /^- Version: 1\.16$/m);
  assert.match(entry, /^- License: LGPL-2\.0-or-later$/m);
  assert.match(entry, /<https:\/\/ftp\.gnu\.org\/gnu\/libiconv\/libiconv-1\.16\.tar\.gz>/);
  assert.match(entry, /<https:\/\/github\.com\/pyodide\/pyodide-recipes\/tree\/314-20260911\/packages\/lxml>/);
  assert.match(committed, /GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2, June 1991/);
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the notices list the parts of the Windows installers, and only those, in a section of their own', () => {
  const parts = [
    'WiX Toolset: WixUI and its custom actions',
    'NSIS',
    'NSIS LZMA compression module',
    'nsis_tauri_utils (NSIS plugin)',
    'nsis-plugin-api (in nsis_tauri_utils)',
    'semver (in nsis_tauri_utils)',
    'windows-sys (in nsis_tauri_utils)',
    'windows-link (in nsis_tauri_utils)',
    'Tauri bundler’s installer templates',
  ];
  assert.deepEqual(WINDOWS_INSTALLERS.map((p) => p.name), parts);
  const committed = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  for (const md of [render({ ...sample(), windowsInstallers: WINDOWS_INSTALLERS }), committed]) {
    // The section runs to the next heading of its level or above.
    const section = md.match(/^### Windows installers\n([\s\S]*?)(?=^#{2,3} )/m)?.[1];
    assert.ok(section, 'the notices have a section for the Windows installers');
    assert.match(section, /applies to the two Windows installers only, the `\.msi` and the `-setup\.exe`/);
    assert.deepEqual([...section.matchAll(/^#### (.+)$/gm)].map((m) => m[1]), parts);
    assert.match(section, /The source code of the LZMA compression module is available in the NSIS 3\.13 source release/);
    for (const p of WINDOWS_INSTALLERS) {
      const where = p.in.length === 2 ? '\\.msi and -setup\\.exe' : p.in[0] === 'msi' ? '\\.msi' : '-setup\\.exe';
      const row = new RegExp(`^\\| \\[${escapeRe(p.name)}\\]\\(#[^)]+\\) \\| ${escapeRe(p.version)} \\| ${escapeRe(p.license)} \\| Windows ${where} \\|$`, 'm');
      assert.match(md, row, `${p.name} is in the contents, as shipping in the installers only`);
    }
  }
  // The MS-RL and the CPL with NSIS's exception come with the parts under them.
  const md = render({ ...sample(), windowsInstallers: WINDOWS_INSTALLERS });
  assert.match(md, /Microsoft Reciprocal License \(MS-RL\)/);
  assert.match(md, /SPECIAL EXCEPTION FOR LZMA COMPRESSION MODULE/);
  // Without the list, there is no such section.
  assert.doesNotMatch(render(sample()), /^### Windows installers$/m);
});
