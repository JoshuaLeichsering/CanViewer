// SPDX-License-Identifier: GPL-2.0-or-later
// What CanViewer may ship, and what it knows about the third-party parts that
// no package metadata describes. Used by scripts/check-licenses.mjs and
// scripts/third-party-notices.mjs; the Rust crates are checked by cargo-deny
// against desktop/deny.toml, which follows the same list.
//
// CanViewer is GPL-2.0-or-later. Every license below can be combined with it.
// Apache-2.0 is compatible with the GPL version 3 only, so where an
// Apache-2.0 part is included (the Material Symbols icon paths in the web app,
// crates such as `tao` in the desktop app), the combined program is
// distributed under the terms of the GPL version 3, which "or any later
// version" allows.

/** SPDX identifiers that bundled third-party code may carry. */
export const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  // File-level copyleft. MPL-2.0 allows combination with the GPL (its section
  // 3.3) unless a file is marked "Incompatible With Secondary Licenses".
  'MPL-2.0',
  'NCSA',
  // Fonts, bundled as separate font files, which the OFL allows with any software.
  'OFL-1.1',
  'PSF-2.0',
  'Unicode-3.0',
  'Zlib',
  'bzip2-1.0.6',
  // SQLite's public-domain dedication.
  'blessing',
  'LicenseRef-Public-Domain',
]);

/**
 * Parts whose license is not on the list and that still ship while a decided
 * removal is under way, each with the reason. The check prints them as
 * warnings, and fails on an exception that matches nothing shipped, so that
 * the entry goes with the part: once it is gone, the part cannot come back
 * without failing the check. Empty since .xls import was dropped and xlrd and
 * xlwt left the wheel lock.
 */
export const EXCEPTIONS = {};

/**
 * Evaluates a simple SPDX expression (OR, AND, parentheses, WITH, and the
 * legacy "A/B" form) against an allowed set. Returns true when some choice of
 * alternatives uses allowed licenses only.
 */
export function isAllowed(expression, allowed = ALLOWED) {
  const tokens = expression
    .replace(/\s*\/\s*/g, ' OR ')
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  const primary = () => {
    if (tokens[i] === '(') {
      i += 1;
      const v = or();
      i += 1; // ')'
      return v;
    }
    let id = tokens[i++];
    if (tokens[i] === 'WITH') {
      id = `${id} WITH ${tokens[i + 1]}`;
      i += 2;
    }
    return allowed.has(id);
  };
  const and = () => {
    let v = primary();
    while (tokens[i] === 'AND') {
      i += 1;
      v = primary() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] === 'OR') {
      i += 1;
      v = and() || v;
    }
    return v;
  };
  return or();
}

/**
 * The wheels in app/src/lib/canmatrix/wheels.lock.json, as reviewed: the
 * license their license files state, and the license lines of their METADATA
 * at review time. The check fails when a wheel is missing here or its METADATA
 * no longer contains those lines, so that an upgrade gets a fresh look.
 */
export const WHEELS = {
  attrs: { license: 'MIT', metadata: ['License-Expression: MIT'] },
  canmatrix: { license: 'BSD-2-Clause', metadata: ['License: BSD-2-Clause'] },
  click: { license: 'BSD-3-Clause', metadata: ['License-Expression: BSD-3-Clause'] },
  // LICENCE.python: parts derived from CPython's xml.etree.
  'et-xmlfile': { license: 'MIT AND PSF-2.0', metadata: ['License: MIT'] },
  // LICENSES.txt: parts derived from ElementTree and CPython (PSF), and the
  // ISO Schematron resources; libxml2 and libxslt are compiled in (see WHEEL_BUNDLED).
  lxml: { license: 'BSD-3-Clause AND PSF-2.0 AND MIT', metadata: ['License: BSD-3-Clause'] },
  openpyxl: { license: 'MIT', metadata: ['License: MIT'] },
  pyyaml: { license: 'MIT', metadata: ['License: MIT'] },
  six: { license: 'MIT', metadata: ['License: MIT'] },
};

/**
 * Libraries compiled into a wheel's extension modules. `markers` are strings
 * the check finds in the wheel's .so files, so the list stays true when a
 * wheel is upgraded.
 */
export const WHEEL_BUNDLED = {
  lxml: [
    {
      name: 'libxml2',
      license: 'MIT',
      texts: ['libxml2-Copyright.txt'],
      source: 'https://gitlab.gnome.org/GNOME/libxml2',
      markers: ['xmlParserVersion'],
    },
    {
      name: 'libxslt and libexslt',
      license: 'MIT',
      texts: ['libxslt-Copyright.txt'],
      source: 'https://gitlab.gnome.org/GNOME/libxslt',
      markers: ['xsltApplyStylesheet', 'exsltDateCreateDate'],
    },
  ],
  pyyaml: [
    {
      name: 'libyaml',
      version: '0.2.1',
      license: 'MIT',
      texts: ['libyaml-License.txt'],
      source: 'https://github.com/yaml/libyaml/tree/0.2.1',
      markers: ['libyaml-0.2.1'],
    },
  ],
};

/**
 * What the Pyodide runtime (node_modules/pyodide, copied to dist/pyodide/)
 * and Pyodide's loader (pyodide.mjs, bundled into the import worker) contain
 * besides Pyodide itself. Identified from Pyodide's build files and sources at
 * its release tag (Makefile.envs, cpython/Makefile, src/js/vendor/,
 * src/js/fs/) and from CPython's Modules/_hacl/, and confirmed by the
 * markers: strings (or patterns) that scripts/check-licenses.mjs finds in the
 * runtime files.
 */
export const PYODIDE_COMPONENTS = [
  {
    name: 'CPython',
    version: '3.14.2',
    license: 'PSF-2.0',
    texts: ['cpython-LICENSE.txt', 'cpython-incorporated-software.txt'],
    source: 'https://github.com/python/cpython/tree/v3.14.2',
    note:
      'The interpreter in pyodide.asm.wasm and its standard library in python_stdlib.zip, with the code CPython ' +
      'incorporates that the second text lists (expat, libmpdec, mimalloc, SipHash24 and others). ' +
      'HACL* and KaRaMeL, which CPython also incorporates, are listed below. ' +
      'Some standard-library files carry their own notice, which python_stdlib.zip keeps in the file: ' +
      'tomllib (MIT), profile.py and pstats.py (Apache-2.0).',
    markers: [
      ['pyodide.asm.wasm', 'Copyright (c) 2001 Python Software Foundation.'],
      ['pyodide.asm.wasm', 'expat_2.7.3'],
      ['pyodide.asm.wasm', 'libmpdec'],
      ['python_stdlib.zip', 'tomllib/_parser.py'],
      ['python_stdlib.zip', 'pstats.py'],
    ],
  },
  {
    name: 'HACL* (in CPython)',
    version: 'commit 8ba599b',
    license: 'MIT',
    texts: ['hacl-star-LICENSE.txt'],
    source: 'https://github.com/hacl-star/hacl-star/tree/8ba599b2f6c9701b3dc961db895b0856a2210f76',
    note: 'The hash functions of CPython’s hashlib, from CPython’s Modules/_hacl/ (the commit its refresh.sh records), compiled into pyodide.asm.wasm. The text is the header of those files.',
    markers: [
      ['pyodide.asm.wasm', './Modules/_hacl/Hacl_Hash_SHA3.c'],
      ['pyodide.asm.wasm', 'HACL* internal routine failed'],
    ],
  },
  {
    name: 'KaRaMeL krmllib (in CPython’s HACL* copy)',
    license: 'Apache-2.0 AND MIT',
    texts: ['karamel-krmllib-notice.txt', 'spdx-Apache-2.0.txt', 'spdx-MIT.txt'],
    source: 'https://github.com/python/cpython/tree/v3.14.2/Modules/_hacl/include/krml',
    note: 'The runtime headers of the KaRaMeL compiler that HACL* is generated with, compiled into pyodide.asm.wasm. Their files state the notice in the first text.',
    markers: [['pyodide.asm.wasm', 'KaRaMeL abort at']],
  },
  {
    name: 'Emscripten runtime',
    version: '5.0.3',
    license: 'MIT OR NCSA',
    texts: ['emscripten-LICENSE.txt'],
    source: 'https://github.com/emscripten-core/emscripten/tree/5.0.3',
    note: 'The JavaScript glue in pyodide.asm.mjs and the system libraries compiled into pyodide.asm.wasm.',
    markers: [['pyodide.asm.wasm', 'emscripten_']],
  },
  {
    name: 'MiniLZ4 (part of the Emscripten runtime)',
    license: 'MIT',
    texts: ['mini-lz4-LICENSE.txt'],
    source: 'https://github.com/emscripten-core/emscripten/blob/5.0.3/third_party/mini-lz4.js',
    markers: [['pyodide.asm.mjs', 'MiniLZ4']],
  },
  {
    name: 'musl libc (as Emscripten’s C library)',
    license: 'MIT',
    texts: ['musl-COPYRIGHT.txt'],
    source: 'https://github.com/emscripten-core/emscripten/tree/5.0.3/system/lib/libc/musl',
    markers: [],
  },
  {
    name: 'LLVM libc++abi and compiler-rt (as Emscripten’s runtime libraries)',
    license: 'Apache-2.0 WITH LLVM-exception',
    texts: ['llvm-libcxxabi-LICENSE.txt', 'llvm-compiler-rt-LICENSE.txt'],
    source: 'https://github.com/emscripten-core/emscripten/tree/5.0.3/system/lib',
    markers: [
      ['pyodide.asm.wasm', 'system/lib/libcxxabi'],
      ['pyodide.asm.wasm', 'system/lib/compiler-rt'],
    ],
  },
  {
    name: 'zlib',
    version: '1.3.1',
    license: 'Zlib',
    texts: ['zlib-LICENSE.txt'],
    source: 'https://github.com/madler/zlib/tree/v1.3.1',
    markers: [['pyodide.asm.wasm', 'deflate 1.3.1 Copyright 1995-2024 Jean-loup Gailly and Mark Adler']],
  },
  {
    name: 'bzip2',
    version: '1.0.6',
    license: 'bzip2-1.0.6',
    texts: ['bzip2-1.0.6-LICENSE.txt'],
    source: 'https://github.com/emscripten-ports/bzip2',
    markers: [['pyodide.asm.wasm', '1.0.6, 6-Sept-2010']],
  },
  {
    name: 'SQLite',
    version: '3.39.0',
    license: 'blessing',
    texts: ['sqlite-blessing.txt'],
    source: 'https://www.sqlite.org/copyright.html',
    markers: [['pyodide.asm.wasm', 'sqlite3_libversion']],
  },
  {
    name: 'XZ Utils (liblzma)',
    version: '5.2.2',
    license: 'LicenseRef-Public-Domain',
    texts: ['xz-5.2.2-COPYING.txt'],
    source: 'https://github.com/tukaani-project/xz/tree/v5.2.2',
    markers: [['pyodide.asm.wasm', 'lzma_filter_decoder_is_supported']],
  },
  {
    name: 'libffi',
    version: 'commit f08493d',
    license: 'MIT',
    texts: ['libffi-LICENSE.txt'],
    source: 'https://github.com/libffi/libffi/tree/f08493d249d2067c8b3207ba46693dd858f95db3',
    markers: [['pyodide.asm.wasm', 'ffi_prep_cif']],
  },
  {
    name: 'Zstandard',
    version: '1.5.7',
    // Dual-licensed BSD-3-Clause OR GPL-2.0-only; shipped under BSD-3-Clause.
    license: 'BSD-3-Clause',
    texts: ['zstd-LICENSE.txt'],
    source: 'https://github.com/facebook/zstd/tree/v1.5.7',
    markers: [['pyodide.asm.wasm', 'ZSTD_versionString']],
  },
  {
    name: 'stackframe (in Pyodide’s loader)',
    version: '1.3.4',
    license: 'MIT',
    texts: ['pyodide-stackframe-LICENSE.txt'],
    source: 'https://github.com/stacktracejs/stackframe',
    note: 'Ported by Pyodide (src/js/vendor/stackframe/) into pyodide.mjs, which the import worker’s JavaScript bundles. The text is the license Pyodide keeps with the port.',
    markers: [['pyodide.mjs', 'StackFrame']],
  },
  {
    name: 'error-stack-parser (in Pyodide’s loader)',
    version: '2.1.4',
    license: 'MIT',
    texts: ['pyodide-stackframe-LICENSE.txt'],
    source: 'https://github.com/stacktracejs/error-stack-parser',
    note: 'Ported by Pyodide (src/js/vendor/stackframe/) into pyodide.mjs, which the import worker’s JavaScript bundles.',
    markers: [['pyodide.mjs', 'ErrorStackParser']],
  },
  {
    name: '@arrowood.dev/socket (as Pyodide’s wintercg-sockets)',
    version: '0.2.0',
    license: 'MIT',
    texts: ['arrowood-socket-LICENSE.txt'],
    source: 'https://github.com/Ethan-Arrowood/socket',
    note: 'Adapted by Pyodide (src/js/fs/wintercg-sockets.ts) into pyodide.asm.mjs. It serves sockets in Node.js only; the browser does not run it.',
    markers: [['pyodide.asm.mjs', 'wintercg-sockets: call init() first']],
  },
  {
    name: 'esbuild helpers (in Pyodide’s JavaScript)',
    license: 'MIT',
    texts: ['esbuild-LICENSE.txt'],
    source: 'https://github.com/evanw/esbuild',
    note: 'The small helper that esbuild adds to code it builds with names kept, in pyodide.mjs and pyodide.asm.mjs, which Pyodide builds with esbuild.',
    markers: [
      ['pyodide.mjs', /\(\w+,\w+\)=>\w+\(\w+,"name",\{value:\w+,configurable:!0\}\)/],
      ['pyodide.asm.mjs', /\(\w+,\w+\)=>\w+\(\w+,"name",\{value:\w+,configurable:!0\}\)/],
    ],
  },
];

/**
 * Code that the build tools put into the app's JavaScript. scripts/vite-legal.ts
 * sorts every module of the bundle: the app's own, an npm package's, or one of
 * these, by its module id; an unknown virtual module fails the build. The
 * version is the one of `versionOf` in package-lock.json (for a part that
 * package bundles, `bundledIn`, the version of that package), and the license
 * text comes from that package's own license file in node_modules/.
 */
export const BUILD_HELPERS = [
  {
    name: 'Vite (runtime helpers)',
    versionOf: 'vite',
    license: 'MIT',
    source: 'https://github.com/vitejs/vite',
    note: 'The module preload polyfill and the stub for Node.js built-ins that Vite adds to the bundle.',
    ids: [/^\0vite\//, /^__vite-browser-external$/],
    text: { file: 'node_modules/vite/LICENSE.md', from: /^# Vite core license$/m, to: /^# Licenses of bundled dependencies$/m },
  },
  {
    name: '@rollup/plugin-commonjs (helpers, as bundled in Vite)',
    versionOf: 'vite',
    bundledIn: true,
    license: 'MIT',
    source: 'https://github.com/rollup/plugins/tree/master/packages/commonjs',
    note: 'The wrappers and helpers with which Vite’s copy of the plugin bundles CommonJS modules such as React. The text is the plugin’s entry in Vite’s license file.',
    ids: [/^\0commonjsHelpers\.js$/, /\?commonjs-[a-z-]+$/],
    text: { file: 'node_modules/vite/LICENSE.md', from: /^## [^\n]*@rollup\/plugin-commonjs[^\n]*$/m, to: /^-{20,}$/m },
  },
];

/**
 * The documentation site (docs/, built with VitePress and published with
 * GitHub Pages next to the web app). Its pages carry VitePress's default theme
 * and what the theme uses: dev dependencies of the repository, so not among
 * the production dependencies the web app's notices are read from.
 *
 * - `packages`: every npm package with code or styles in the site's client
 *   bundle, besides the web app's fonts, which the site shares. Their versions,
 *   licenses and license files come from package-lock.json and node_modules/;
 *   `notice` names the file whose leading comment is a package's notice when it
 *   ships no license file.
 * - `helpers`: the code the build tools add to the site's JavaScript, as in
 *   BUILD_HELPERS.
 *
 * The site's build (scripts/docs/site-legal.mjs) fails when its bundle and this
 * list disagree, in either direction.
 */
export const DOCS_SITE = {
  packages: [
    { name: '@docsearch/css', notice: 'dist/style.css' },
    { name: '@vue/reactivity' },
    { name: '@vue/runtime-core' },
    { name: '@vue/runtime-dom' },
    { name: '@vue/shared' },
    { name: '@vueuse/core' },
    { name: '@vueuse/integrations' },
    { name: '@vueuse/shared' },
    { name: 'focus-trap' },
    { name: 'mark.js' },
    { name: 'minisearch' },
    { name: 'tabbable' },
    { name: 'vitepress' },
    { name: 'vue' },
  ],
  helpers: [
    {
      name: 'Vite (runtime helpers, as VitePress builds the site)',
      versionOf: 'vitepress/node_modules/vite',
      license: 'MIT',
      source: 'https://github.com/vitejs/vite',
      note: 'The module preload helper that Vite adds to the site’s JavaScript, from the copy of Vite that VitePress uses.',
      ids: [/^\0vite\/preload-helper(\.js)?$/],
      text: { file: 'node_modules/vitepress/node_modules/vite/LICENSE.md', from: /^# Vite core license$/m, to: /^# Licenses of bundled dependencies$/m },
    },
    {
      name: '@vitejs/plugin-vue (export helper)',
      versionOf: '@vitejs/plugin-vue',
      license: 'MIT',
      source: 'https://github.com/vitejs/vite-plugin-vue',
      note: 'The helper with which the plugin attaches the render functions of the theme’s Vue components.',
      ids: [/^\0plugin-vue:export-helper$/],
      text: { file: 'node_modules/@vitejs/plugin-vue/LICENSE', from: /^MIT License$/m, to: /$(?![\s\S])/ },
    },
  ],
};

/** Virtual modules of CanViewer's own Vite plugins (scripts/vite-plugins.ts), by module id. */
export const OWN_VIRTUAL_MODULES = [/^\0virtual:canviewer-/];

/**
 * Sorts a module id of the bundle: the name of the build helper it belongs
 * to, 'own' for CanViewer's own virtual modules, 'file' for a module read from
 * a file, or 'unknown' for a virtual module nobody has reviewed.
 */
export function classifyModule(id) {
  const helper = BUILD_HELPERS.find((h) => h.ids.some((re) => re.test(id)));
  if (helper) return helper.name;
  if (OWN_VIRTUAL_MODULES.some((re) => re.test(id))) return 'own';
  // A virtual module's id starts with \0 by convention; a file's is an absolute path.
  if (id.startsWith('\0') || !/^(\/|[A-Za-z]:[\\/])/.test(id)) return 'unknown';
  return 'file';
}

/** Third-party parts copied into CanViewer's own sources. */
export const VENDORED = [
  {
    name: 'Material Symbols (icon paths)',
    version: '@material-symbols/svg-400 0.48.2',
    license: 'Apache-2.0',
    texts: ['material-symbols-LICENSE.txt'],
    source: 'https://github.com/google/material-design-icons',
    note: 'The SVG paths of the icons the app shows, in app/src/components/icon-paths.ts, bundled into the app’s JavaScript.',
  },
];

/**
 * npm production dependencies that the web build does not include, and why.
 * The Vite plugin in scripts/vite-legal.ts fails the build if one of them
 * turns up in the bundle after all.
 */
export const NOT_BUNDLED = {
  '@types/emscripten': 'type definitions for pyodide, used only by the TypeScript compiler',
  'js-tokens': 'used by loose-envify, a build-time transform for browserify; Vite does not run it',
  'loose-envify': 'a build-time transform for browserify listed by react; Vite does not run it',
  ws: 'used by pyodide in Node only; the browser build leaves it out',
};

/** License texts for npm packages that ship none. */
export const NPM_TEXTS = {
  pyodide: ['pyodide-LICENSE.txt'],
};

/** Standard texts for crates that ship no license file, by SPDX identifier. */
export const STANDARD_TEXTS = {
  MIT: 'spdx-MIT.txt',
  'Apache-2.0': 'spdx-Apache-2.0.txt',
  'BSD-3-Clause': 'spdx-BSD-3-Clause.txt',
  Zlib: 'spdx-Zlib.txt',
  'MPL-2.0': 'pyodide-LICENSE.txt',
};

/**
 * Notices in the source files of crates that the crates' license files do
 * not carry. scripts/third-party-notices.mjs copies each from the crate as
 * cargo downloads it: the lines from the one that contains `from` to the one
 * that contains `to`, without the comment markers. It fails when they are no
 * longer found, so the list stays true when a crate is upgraded. With `texts`
 * instead, the file must exist and contain `marker`, and the texts come from
 * scripts/third-party/licenses/.
 */
export const CRATE_FILE_NOTICES = [
  {
    crate: 'tao',
    file: 'src/keyboard.rs',
    from: 'The winit contributors',
    to: 'END OF W3C SHORT NOTICE',
    what:
      'The winit copyright that tao’s files derived from winit carry, and the W3C license and short notice ' +
      'for the `Key` and `KeyCode` enums, which the license asks to show where users can see them.',
  },
  {
    crate: 'keyboard-types',
    file: 'README.md',
    from: 'are derived from the two W3C working',
    to: 'uievents-code/',
    what:
      'src/named_key.rs and src/code.rs are derived from W3C documents; the W3C license reproduced with ' +
      'tao’s src/keyboard.rs applies to them too.',
  },
  {
    crate: 'tauri',
    file: 'src/resources/mod.rs',
    from: 'the Deno authors',
    to: 'core/resources.rs',
    what: 'Code derived from Deno, under the MIT license.',
  },
  {
    crate: 'muda',
    file: 'src/platform_impl/gtk/icon.rs',
    from: 'The winit contributors',
    to: 'SPDX-License-Identifier: Apache-2.0',
    what:
      'The winit copyright of the files derived from winit (also src/platform_impl/gtk4/icon.rs; ' +
      'src/icon.rs and src/platform_impl/windows/ name the winit file they are taken from).',
  },
  {
    crate: 'futures-channel',
    file: 'src/mpsc/queue.rs',
    from: 'Copyright (c) 2010-2011 Dmitry Vyukov',
    to: 'policies, either expressed or implied, of Dmitry Vyukov.',
    what: 'The queue of the channel, under a BSD-2-Clause-Views license.',
  },
  {
    crate: 'webview2-com-sys',
    file: 'x64/WebView2Loader.dll',
    marker: '1.0.3800.47',
    texts: ['webview2-sdk-LICENSE.txt'],
    what:
      'The WebView2 loader from Microsoft’s WebView2 SDK 1.0.3800.47, which the crate bundles (Windows). ' +
      'The text is the SDK’s license, as its NuGet package states it.',
  },
];

/**
 * The Rust standard library, which the desktop binary links statically. It
 * comes with the Rust toolchain that builds the release, so the list is
 * reviewed for one version: the toolchain's share/doc/rust/COPYRIGHT-library.html
 * (in-tree files) and library/Cargo.lock at the release tag. That document
 * leaves out addr2line, adler2, memchr, miniz_oxide and object, whose license
 * files come from crates.io. The crates of the dual-licensed parts are used
 * under the MIT license, whose texts carry their copyright lines.
 *
 * scripts/third-party-notices.mjs fails when the toolchain it runs with ships
 * a library (an rlib for the host) that is in neither `components` nor
 * `notLinked`, so a new dependency of the standard library gets a review.
 */
export const RUST_STD = {
  version: '1.97.0',
  source: 'https://github.com/rust-lang/rust/tree/1.97.0/library',
  components: [
    {
      name: 'core, alloc, std and the other in-tree libraries',
      crates: ['core', 'alloc', 'std', 'std_detect', 'panic_unwind', 'panic_abort', 'unwind'],
      license: 'MIT OR Apache-2.0',
      texts: ['rust-std/COPYRIGHT-library.txt', 'spdx-MIT.txt', 'spdx-Apache-2.0.txt', 'rust-std/Unicode-3.0.txt'],
    },
    {
      name: 'compiler_builtins, with libm',
      crates: ['compiler_builtins'],
      version: '0.1.160',
      license: 'MIT AND Apache-2.0 WITH LLVM-exception AND (MIT OR Apache-2.0)',
      texts: ['rust-std/compiler-builtins-LICENSE.txt', 'rust-std/libm-LICENSE.txt', 'llvm-compiler-rt-LICENSE.txt'],
    },
    { name: 'addr2line', version: '0.25.1', license: 'Apache-2.0 OR MIT', texts: ['rust-std/addr2line-LICENSE-MIT.txt'] },
    { name: 'adler2', version: '2.0.1', license: '0BSD OR MIT OR Apache-2.0', texts: ['rust-std/adler2-LICENSE-MIT.txt'] },
    { name: 'cfg-if', version: '1.0.4', license: 'MIT OR Apache-2.0', texts: ['rust-std/cfg-if-LICENSE-MIT.txt'] },
    { name: 'gimli', version: '0.32.3', license: 'MIT OR Apache-2.0', texts: ['rust-std/gimli-LICENSE-MIT.txt'] },
    { name: 'hashbrown', version: '0.17.1', license: 'MIT OR Apache-2.0', texts: ['rust-std/hashbrown-LICENSE-MIT.txt'] },
    { name: 'libc', version: '0.2.185', license: 'MIT OR Apache-2.0', texts: ['rust-std/libc-LICENSE-MIT.txt'] },
    { name: 'memchr', version: '2.7.6', license: 'Unlicense OR MIT', texts: ['rust-std/memchr-LICENSE-MIT.txt'] },
    { name: 'miniz_oxide', version: '0.8.9', license: 'MIT OR Zlib OR Apache-2.0', texts: ['rust-std/miniz_oxide-LICENSE-MIT.txt'] },
    { name: 'object', version: '0.37.3', license: 'Apache-2.0 OR MIT', texts: ['rust-std/object-LICENSE-MIT.txt'] },
    { name: 'rustc-demangle', version: '0.1.27', license: 'MIT/Apache-2.0', texts: ['rust-std/rustc-demangle-LICENSE-MIT.txt'] },
  ],
  /** Libraries of the toolchain that a release binary does not link: the compiler's, the test harness's, profiling, shims. */
  notLinked: [
    'getopts',
    'proc_macro',
    'profiler_builtins',
    'rustc_literal_escaper',
    'rustc_std_workspace_alloc',
    'rustc_std_workspace_core',
    'rustc_std_workspace_std',
    'sysroot',
    'test',
  ],
};
