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
 * Parts whose license is not on the list, shipped until the owner decides,
 * each with the reason. The checks print them as warnings and do not fail.
 */
export const EXCEPTIONS = {
  xlrd:
    'xlrd 1.2.0 includes code under the original four-clause BSD license of David Giffin, ' +
    'whose advertising clause the FSF considers incompatible with the GPL. It is used only to import .xls files. ' +
    'Pending the owner: keep it (with an additional permission for it), or drop .xls import.',
  xlwt:
    'xlwt 1.3.0 includes code under the four-clause BSD license of pyExcelerator (Roman V. Kiseliov), ' +
    'whose advertising clause the FSF considers incompatible with the GPL. canmatrix imports it whenever it reads .xls files. ' +
    'Pending the owner: keep it (with an additional permission for it), or drop .xls import.',
};

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
  xlrd: { license: 'BSD-3-Clause AND LicenseRef-BSD-4-Clause-Giffin', metadata: ['License: BSD'] },
  // The wheel ships no license file; its licenses are in the project's docs/licenses.rst.
  xlwt: {
    license: 'BSD-3-Clause AND LicenseRef-BSD-4-Clause-Kiseliov AND LGPL-2.1-or-later',
    metadata: ['License: BSD'],
    texts: ['xlwt-licenses.txt'],
    source: 'https://github.com/python-excel/xlwt/blob/1.3.0/docs/licenses.rst',
  },
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
 * contains besides Pyodide itself. Identified from Pyodide's build files at
 * its release tag (Makefile.envs and cpython/Makefile) and confirmed by the
 * markers, strings that scripts/check-licenses.mjs finds in the runtime files.
 */
export const PYODIDE_COMPONENTS = [
  {
    name: 'CPython',
    version: '3.14.2',
    license: 'PSF-2.0',
    texts: ['cpython-LICENSE.txt', 'cpython-incorporated-software.txt'],
    source: 'https://github.com/python/cpython/tree/v3.14.2',
    note: 'The interpreter in pyodide.asm.wasm and its standard library in python_stdlib.zip, with the code CPython incorporates (expat, libmpdec, HACL*, and others; see the second text).',
    markers: [
      ['pyodide.asm.wasm', 'Copyright (c) 2001 Python Software Foundation.'],
      ['pyodide.asm.wasm', 'expat_2.7.3'],
      ['pyodide.asm.wasm', 'libmpdec'],
      ['pyodide.asm.wasm', 'Hacl_'],
    ],
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
];

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
