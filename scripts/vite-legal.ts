// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Puts CanViewer's license and the third-party notices into the build, and
 * checks that the notices cover what the build bundles.
 *
 * - Every npm package with a module or an asset in the bundle (the app's and
 *   the import worker's) must have a row with its version in the contents of
 *   THIRD_PARTY_NOTICES.md; the build fails if one is missing, or if a package
 *   that scripts/license-policy.mjs lists as not bundled turns up after all.
 * - Every file under pyodide/ must be covered: the runtime files by the
 *   pyodide row, each wheel by its file name.
 * - dist/LICENSE.txt and dist/THIRD_PARTY_NOTICES.md are written after the
 *   bundle, so the service worker does not precache them: they cost a visitor
 *   nothing until opened.
 *
 * Regenerate the notices with `node scripts/third-party-notices.mjs`.
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { NOT_BUNDLED } from './license-policy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = join(root, 'THIRD_PARTY_NOTICES.md');
const RUNTIME_FILES = new Set(['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip']);

/** The npm package a module or asset path belongs to, from its last node_modules segment. */
function packageOf(path: string): string | undefined {
  const m = path.replace(/\\/g, '/').match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return m?.[1];
}

const versionOf = (name: string) =>
  (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the notices' contents table has a row for this component and version. */
function hasRow(notices: string, name: string, version: string) {
  return new RegExp(`^\\| \\[${escape(name)}\\]\\(#[^)]*\\) \\| ${escape(version)} \\|`, 'm').test(notices);
}

export function legalFiles({ emit }: { emit: boolean }): Plugin {
  let outDir = '';
  return {
    name: 'canviewer:legal-files',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      const notices = readFileSync(NOTICES, 'utf8');
      const packages = new Set<string>();
      for (const item of Object.values(bundle)) {
        const paths =
          item.type === 'chunk'
            ? Object.keys(item.modules)
            : [...((item as { originalFileNames?: string[] }).originalFileNames ?? [])];
        for (const p of paths) {
          const name = packageOf(p);
          if (name) packages.add(name.replace(/^\0/, ''));
        }
      }
      const problems: string[] = [];
      for (const name of [...packages].sort()) {
        if (name in NOT_BUNDLED) problems.push(`${name} is bundled, but scripts/license-policy.mjs says it is not (NOT_BUNDLED)`);
        else if (!hasRow(notices, name, versionOf(name))) problems.push(`${name} ${versionOf(name)} is bundled but not in THIRD_PARTY_NOTICES.md`);
      }
      for (const file of Object.keys(bundle).filter((f) => f.startsWith('pyodide/'))) {
        const name = file.slice('pyodide/'.length);
        const covered = RUNTIME_FILES.has(name) ? hasRow(notices, 'pyodide', versionOf('pyodide')) : notices.includes(`\`${name}\``);
        if (!covered) problems.push(`${file} is in the build but not in THIRD_PARTY_NOTICES.md`);
      }
      if (problems.length) {
        this.error(`${problems.join('\n')}\nRegenerate the notices: node scripts/third-party-notices.mjs`);
      }
    },
    writeBundle() {
      if (!emit) return;
      copyFileSync(join(root, 'LICENSE'), join(outDir, 'LICENSE.txt'));
      copyFileSync(NOTICES, join(outDir, 'THIRD_PARTY_NOTICES.md'));
    },
  };
}
