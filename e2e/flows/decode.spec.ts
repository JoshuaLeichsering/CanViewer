// SPDX-License-Identifier: GPL-2.0-or-later
import { DEMO_DBC, expect, listPane, openFile, rail, test } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openFile(page, DEMO_DBC);
  await rail(page, 'Messages').click();
});

const decoded = (page: import('@playwright/test').Page) => page.locator('.decoded-row');

test('decodes a frame into physical values and marks the value description', async ({ page }) => {
  await page.getByRole('row', { name: /EngineRunning/ }).click();
  const payload = page.getByLabel('Hex payload');
  await payload.fill('00 10 28 FA 00 00 00 01');
  await expect(decoded(page)).toHaveText([
    /EngineSpeed\s*1024 rpm/,
    /EngineTemp\s*0 degC/,
    /ThrottlePosition\s*100 %/,
    /EngineTorque\s*0 Nm/,
    /TorqueRequest\s*0 Nm/,
    /EngineRunning\s*1\s*Running/,
  ]);
  await expect(page.locator('.value-chip.current')).toHaveText('1 · Running');

  // Short input is zero-padded, and the decoded bytes are shown.
  await payload.fill('0x00,0x20');
  await expect(page.getByText('[00 20 00 00 00 00 00 00]')).toBeVisible();
  await expect(decoded(page).first()).toHaveText(/EngineSpeed\s*2048 rpm/);

  await payload.fill('0x1');
  await expect(page.getByText('Enter full bytes as hex (e.g. “12 AB 00” or “0x12AB”).')).toBeVisible();
  await expect(decoded(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(payload).toHaveValue('');
});

test('shows multiplexed signals as inactive when their switch value does not match', async ({ page }) => {
  await listPane(page).getByRole('button', { name: /DiagData/ }).click();
  await page.getByLabel('Hex payload').fill('02 03 00');
  await expect(decoded(page)).toHaveText([
    /MuxSelector\s*2/,
    /SensorVoltage\s*—\s*mux inactive/,
    /SensorCurrent\s*—\s*mux inactive/,
    /ErrorCode\s*3\s*Sensor open circuit/,
  ]);
});

test('decodes a CAN FD frame longer than 8 bytes, and clears the input for the next message', async ({ page }) => {
  await listPane(page).getByRole('button', { name: /AdasObjects/ }).click();
  await expect(page.getByText('Hex data, up to 24 bytes — missing bytes are zero-padded')).toBeVisible();
  const payload = page.getByLabel('Hex payload');
  // ObjCount 3, Obj1Dist 0x1388 = 50 m.
  await payload.fill('03 88 13');
  await expect(decoded(page).filter({ hasText: 'ObjCount' })).toHaveText(/ObjCount\s*3/);
  await expect(decoded(page).filter({ hasText: 'Obj1Dist' })).toHaveText(/Obj1Dist\s*50 m/);
  await listPane(page).getByRole('button', { name: /PowerData/ }).click();
  await expect(payload).toHaveValue('');
});
