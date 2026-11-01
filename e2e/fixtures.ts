// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The `test` every end-to-end flow uses: Playwright's, plus a check after each
 * test that the page and its workers made no request outside the app's own
 * origin (the network check also records the service worker's).
 *
 * The check watches the fixture's `context`. A flow that needs other context
 * options (a locale, say) sets them with `test.use`, not `browser.newContext`,
 * which the check would not see.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

export { expect };

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
export const DEMO_DBC = fromRoot('examples/demo.dbc');
export const DEMO_DBC_TEXT = readFileSync(DEMO_DBC, 'utf8');
export const TEST_ARXML = fromRoot('third_party/canmatrix/tests/files/arxml/test.arxml');

export const test = base.extend<{ foreignRequests: string[] }>({
  foreignRequests: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const foreign: string[] = [];
      context.on('request', (request) => {
        const url = request.url();
        if (!url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
      });
      await use(foreign);
      expect(foreign, `requests outside ${origin}`).toEqual([]);
    },
    { auto: true },
  ],
});

/** Open a file through the app's own (hidden) file input and wait until it is shown. */
export async function openFile(page: Page, path: string, name = path.split('/').pop()!) {
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Open a file with the given name and content. */
export async function openText(page: Page, name: string, text: string) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
}

/** A destination button in the navigation rail. */
export const rail = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'CanViewer' }).getByRole('button', { name: label, exact: true });

/** The message, node or table list next to the rail. */
export const listPane = (page: Page) => page.locator('.list-pane');
