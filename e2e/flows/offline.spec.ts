import { DEMO_DBC, expect, openFile, openText, rail, test } from '../fixtures';

test('works offline after the first visit: reload, restore the file and its view, open another', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The service worker controls pages loaded after it activated.
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await openFile(page, DEMO_DBC);
  await rail(page, 'Messages').click();
  await page.getByRole('row', { name: /TorqueRequest/ }).click();
  await expect(page).toHaveURL(/#msg=256\/TorqueRequest$/);

  await context.setOffline(true);
  // The network is really gone: a file the service worker never cached fails.
  const probe = await page.evaluate(() =>
    fetch('/offline-probe', { cache: 'no-store' }).then(
      () => 'reachable',
      () => 'unreachable',
    ),
  );
  expect(probe).toBe('unreachable');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'EngineData' })).toBeVisible();
  await expect(page.locator('.signal-card h2')).toHaveText('TorqueRequest');

  await openText(page, 'offline.dbc', 'VERSION ""\nBU_: Off Line\nBO_ 1 Opened: 8 Off\n SG_ S : 0|8@1+ (1,0) [0|255] "" Line\n');
  await expect(page.getByRole('heading', { level: 1, name: 'offline.dbc' })).toBeVisible();
  await rail(page, 'Network').click();
  await expect(page.locator('.ng-label')).toHaveText(['Off', 'Line']);
});
