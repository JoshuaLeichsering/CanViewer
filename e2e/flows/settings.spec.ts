// SPDX-License-Identifier: GPL-2.0-or-later
import { DEMO_DBC, expect, openFile, rail, test } from '../fixtures';

const theme = (page: import('@playwright/test').Page) => page.locator('html');
const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('switches between the light and dark theme, and keeps the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  const light = await background(page);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).not.toBe(light);

  await page.reload();
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(light);
});

test('follows the system theme until one is chosen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
});

test('switches the language to German and back, and keeps the choice', async ({ page }) => {
  await page.goto('/');
  await openFile(page, DEMO_DBC);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(rail(page, 'Übersicht')).toBeVisible();
  await expect(page.getByText('Ohne Probleme eingelesen.', { exact: false })).toBeVisible();
  await rail(page, 'Botschaften').click();
  await expect(page.getByRole('heading', { name: 'Frame dekodieren' })).toBeVisible();
  await expect(page.getByPlaceholder('Botschaft, Signal, ID suchen')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Frame dekodieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Decode frame' })).toBeVisible();
});

test.describe('with a German browser', () => {
  // The fixture's own context and page, so that the foreign-request guard
  // watches this flow too (it does not see a context made by the test).
  test.use({ locale: 'de-DE' });

  test('starts in German for a German browser', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ein Viewer für DBC-CAN-Datenbanken.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Datei öffnen…' })).toBeVisible();
  });
});

test('closes the settings menu with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});
