// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * End-to-end flows (e2e/**\/*.spec.ts) against the production build, served
 * by `vite preview` on its own port. Chromium only: the app has no
 * browser-specific code paths beyond what the network check covers.
 *
 *   npm run build && npm run e2e
 *
 * Locally this uses the Chromium that Playwright finds (PLAYWRIGHT_BROWSERS_PATH
 * or its own cache; `npx playwright install chromium` fetches one). CI installs
 * it with `npx playwright install --with-deps chromium`. E2E_PORT picks the
 * port (default 4180), so that runs side by side do not collide.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4180);
const baseURL = `http://localhost:${port}/`;

if (!existsSync(fileURLToPath(new URL('dist/index.html', import.meta.url)))) {
  throw new Error('The end-to-end flows test the production build: run `npm run build` first.');
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a flaky flow is a bug to fix, not to hide.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // As in the network check: no hostname but localhost resolves, so a
      // request to any other host could not succeed even if the app tried.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
