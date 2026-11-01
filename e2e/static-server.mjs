// SPDX-License-Identifier: GPL-2.0-or-later
// A static file server that answers the way GitHub Pages does, for checking the
// Pages site locally and in CI: a directory serves its index.html (after a
// redirect that adds the trailing slash), a path without extension also finds
// <path>.html, and anything else is a 404 with the site's 404.html.
//
// Usage: node e2e/static-server.mjs <root-dir> <port>
//   The Pages workflow puts the site in <root-dir>/<repository>/, so that it is
//   served under /<repository>/ as on GitHub Pages.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.whl': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const [, , dir, port] = process.argv;
if (!dir || !port) {
  console.error('usage: node e2e/static-server.mjs <root-dir> <port>');
  process.exit(2);
}
const root = resolve(dir);

/** The nearest 404.html above a path, as Pages uses the site's own. */
function notFoundPage(path) {
  let d = path;
  while ((d + sep).startsWith(root + sep)) {
    if (existsSync(join(d, '404.html'))) return join(d, '404.html');
    const up = resolve(d, '..');
    if (up === d) break;
    d = up;
  }
  return undefined;
}

function send(res, status, file) {
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path;
  try {
    path = resolve(root, '.' + decodeURIComponent(url.pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!(path + sep).startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) {
    if (!url.pathname.endsWith('/')) {
      res.writeHead(301, { Location: url.pathname + '/' + url.search }).end();
      return;
    }
    path = join(path, 'index.html');
  } else if (!existsSync(path) && existsSync(path + '.html')) {
    path += '.html';
  }
  if (existsSync(path) && statSync(path).isFile()) {
    send(res, 200, path);
    return;
  }
  const page = notFoundPage(resolve(path, '..'));
  if (page) send(res, 404, page);
  else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`serving ${root} on http://localhost:${port}/`);
});
