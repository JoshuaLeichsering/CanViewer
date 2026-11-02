// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Starting the import worker, so that in the desktop app it runs under the
 * page's Content Security Policy.
 *
 * The Tauri shell sends the policy in desktop/tauri.conf.json as a header, and
 * only with HTML responses. A dedicated worker loaded from its own URL takes
 * its policy from its own response, so it would run with none: nothing but the
 * app's own code would keep its requests local. A worker created from a blob:
 * URL inherits the policy of the document that created it. So in the desktop
 * app the worker starts from a one-line blob: module that imports the real
 * worker script, and the policy allows `blob:` in `worker-src` for this.
 * e2e/desktop-csp-check.mjs checks it in Chromium, and the self-test
 * (desktop/src/smoke.js) in each system's webview.
 *
 * The web build keeps the plain URL. It sends no policy for a worker to
 * inherit, and its service worker must serve the worker's requests when the
 * app is offline, which not every browser extends to blob: workers. See
 * docs/decisions/0009-desktop-shell.md.
 */

/** The source of the blob: module that loads the worker script at `scriptUrl` (absolute). */
export function workerBootstrap(scriptUrl: string): string {
  return `import ${JSON.stringify(scriptUrl)};\n`;
}

/**
 * Start the module worker at `scriptUrl` (relative to the document, or
 * absolute): from a blob: URL in the desktop app, from the URL itself in a
 * browser.
 */
export function startImportWorker(scriptUrl: string, desktop: boolean): Worker {
  const url = new URL(scriptUrl, document.baseURI).href;
  if (!desktop) return new Worker(url, { type: 'module' });
  // The blob URL is not revoked: the worker module's imports resolve against
  // the real script's URL, but some engines fetch the blob only after the
  // constructor returns. It is one line, made once per worker.
  const bootstrap = new Blob([workerBootstrap(url)], { type: 'text/javascript' });
  return new Worker(URL.createObjectURL(bootstrap), { type: 'module' });
}
