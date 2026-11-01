// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Vite plugins that keep the canmatrix import adapter self-hosted.
 *
 * pyodideAssets: the Pyodide runtime (from the `pyodide` npm package) and the
 * wheels in app/src/lib/canmatrix/wheels.lock.json (from vendor/pyodide, filled by
 * scripts/fetch-wheels.mjs) are served under `<base>pyodide/` by the dev
 * server and copied to dist/pyodide/ by the build. Nothing else is published
 * there, and the build fails if a file is missing. The worker imports the lock
 * as `virtual:canviewer-pyodide-lock`, without the `tool.canviewer` download
 * sources, so that the app bundle names no host but its own.
 *
 * serviceWorker: emits sw.js (from app/src/service-worker.js) with the list of
 * built files to precache, so the app opens offline after the first visit.
 * The Pyodide files are not precached: they are cached when first used, so a
 * DBC-only visitor never downloads them.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'app/src/lib/canmatrix/wheels.lock.json'), 'utf8')) as {
  info: Record<string, string>;
  packages: Record<string, { file_name: string; tool?: unknown }>;
};

const LOCK_MODULE = 'virtual:canviewer-pyodide-lock';

/** The lock as Pyodide reads it: download sources are for scripts/fetch-wheels.mjs only. */
function runtimeLock() {
  const packages = Object.fromEntries(
    Object.entries(lock.packages).map(([name, entry]) => [name, { ...entry, tool: {} }]),
  );
  return { info: lock.info, packages };
}

/** The runtime files loadPyodide() fetches from indexURL (the lock is passed inline). */
const RUNTIME_FILES = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip'];

/** Published name -> file on disk. */
function pyodideFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const f of RUNTIME_FILES) files.set(f, join(root, 'node_modules/pyodide', f));
  for (const p of Object.values(lock.packages)) files.set(p.file_name, join(root, 'vendor/pyodide', p.file_name));
  return files;
}

const CONTENT_TYPES: Record<string, string> = {
  mjs: 'text/javascript',
  wasm: 'application/wasm',
  zip: 'application/zip',
  whl: 'application/zip',
};
const contentType = (name: string) => CONTENT_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream';

/** `virtual:canviewer-pyodide-lock`; worker builds need it in `worker.plugins` too. */
export function pyodideLock(): Plugin {
  return {
    name: 'canviewer:pyodide-lock',
    resolveId(id) {
      return id === LOCK_MODULE ? '\0' + LOCK_MODULE : undefined;
    },
    load(id) {
      return id === '\0' + LOCK_MODULE ? `export default ${JSON.stringify(runtimeLock())};` : undefined;
    },
  };
}

export function pyodideAssets(): Plugin {
  const files = pyodideFiles();
  let config: ResolvedConfig;
  const missing = () => [...files.values()].filter((f) => !existsSync(f));
  return {
    name: 'canviewer:pyodide-assets',
    configResolved(c) {
      config = c;
    },
    configureServer(server) {
      const prefix = `${config.base}pyodide/`;
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!path.startsWith(prefix)) return next();
        const src = files.get(path.slice(prefix.length));
        if (!src || !existsSync(src)) {
          res.statusCode = 404;
          res.end(src ? `missing ${src}: run npm run fetch-wheels` : 'not a Pyodide asset');
          return;
        }
        res.setHeader('Content-Type', contentType(src));
        res.setHeader('Content-Length', statSync(src).size);
        createReadStream(src).pipe(res);
      });
    },
    buildStart() {
      if (config.command === 'build' && missing().length) {
        this.error(`Pyodide assets missing, run \`npm run fetch-wheels\`:\n  ${missing().join('\n  ')}`);
      }
    },
    generateBundle() {
      for (const [name, src] of files) {
        this.emitFile({ type: 'asset', fileName: `pyodide/${name}`, source: readFileSync(src) });
      }
    },
  };
}

export function serviceWorker(): Plugin {
  return {
    name: 'canviewer:service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const precache = ['./', ...Object.keys(bundle).filter((f) => !f.startsWith('pyodide/'))].sort();
      const version = createHash('sha256')
        .update(precache.join('\n'))
        .update(JSON.stringify(lock))
        .digest('hex')
        .slice(0, 12);
      const pyodideVersion = createHash('sha256').update(JSON.stringify(lock)).digest('hex').slice(0, 12);
      const source = readFileSync(join(root, 'app/src/service-worker.js'), 'utf8')
        .replace('__SHELL_VERSION__', version)
        .replace('__PYODIDE_VERSION__', pyodideVersion)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
