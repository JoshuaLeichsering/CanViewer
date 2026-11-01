import { DEMO_DBC, expect, listPane, openFile, rail, test } from '../fixtures';

const h1 = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1 });
const hash = (page: import('@playwright/test').Page) => new URL(page.url()).hash;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openFile(page, DEMO_DBC);
});

test('keeps the address in step with the view, and a reload comes back to it', async ({ page }) => {
  expect(hash(page)).toBe('');
  await rail(page, 'Messages').click();
  await listPane(page).getByRole('button', { name: /BrakeData/ }).click();
  await page.getByRole('row', { name: /WheelSpeedFR/ }).click();
  await expect(page).toHaveURL(/#msg=768\/WheelSpeedFR$/);

  await page.reload();
  await expect(h1(page)).toHaveText('BrakeData');
  await expect(page.locator('.signal-card h2')).toHaveText('WheelSpeedFR');

  await rail(page, 'Nodes').click();
  await expect(page).toHaveURL(/#node=ECM$/);
  await rail(page, 'Tables').click();
  await expect(page).toHaveURL(/#vt=GearPositions$/);
  await rail(page, 'Network').click();
  await expect(page).toHaveURL(/#graph$/);
  await rail(page, 'Overview').click();
  expect(hash(page)).toBe('');
});

for (const [link, heading] of [
  ['#msg=2364539904', 'J1939_EEC1'],
  ['#msg=1024/ErrorCode', 'DiagData'],
  ['#node=TCM', 'TCM'],
  ['#vt=OnOff', 'OnOff'],
  ['#graph', 'ECU network'],
  ['#msg=999', 'demo.dbc'],
  ['#node=Nobody', 'demo.dbc'],
]) {
  test(`opens the deep link ${link} in a new tab`, async ({ context }) => {
    const tab = await context.newPage();
    await tab.goto(`/${link}`);
    await expect(h1(tab)).toHaveText(heading);
  });
}

test('copies a link to the current view', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin });
  await rail(page, 'Messages').click();
  await page.getByRole('row', { name: /EngineTemp/ }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status')).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  expect(page.url()).toMatch(/#msg=256\/EngineTemp$/);
  // The confirmation goes away by itself.
  await expect(page.getByRole('status')).toBeHidden({ timeout: 6_000 });
});
