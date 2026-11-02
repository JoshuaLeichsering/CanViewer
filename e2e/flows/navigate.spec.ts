// SPDX-License-Identifier: GPL-2.0-or-later
import { DEMO_DBC, expect, listPane, openFile, openText, rail, test } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openFile(page, DEMO_DBC);
});

const h1 = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1 });

test('walks every destination from the rail, and each returns to what it showed last', async ({ page }) => {
  await rail(page, 'Messages').click();
  await expect(h1(page)).toHaveText('EngineData');
  await expect(listPane(page).locator('.list-label')).toHaveText('Messages · 9');
  await listPane(page).getByRole('button', { name: /BrakeData/ }).click();
  await expect(h1(page)).toHaveText('BrakeData');
  await expect(listPane(page).getByRole('button', { name: /BrakeData/ })).toHaveAttribute('aria-current', 'true');

  await rail(page, 'Network').click();
  await expect(h1(page)).toHaveText('ECU network');
  await expect(listPane(page)).toHaveCount(0);

  await rail(page, 'Nodes').click();
  await expect(h1(page)).toHaveText('ECM');
  await listPane(page).getByRole('button', { name: /Tester/ }).click();
  await expect(h1(page)).toHaveText('Tester');

  await rail(page, 'Tables').click();
  await expect(h1(page)).toHaveText('GearPositions');
  await expect(page.getByRole('cell', { name: 'Reverse' })).toBeVisible();

  await rail(page, 'Overview').click();
  await expect(h1(page)).toHaveText('demo.dbc');

  await rail(page, 'Messages').click();
  await expect(h1(page)).toHaveText('BrakeData');
  await rail(page, 'Nodes').click();
  await expect(h1(page)).toHaveText('Tester');
});

test('searches and filters the message list', async ({ page }) => {
  await rail(page, 'Messages').click();
  const search = page.getByPlaceholder('Search messages, signals, IDs');
  await search.fill('wheel');
  await expect(listPane(page).locator('.list-item .title')).toHaveText(['BrakeData', 'J1939_CCVS1']);
  await expect(listPane(page).locator('.list-label')).toHaveText('Messages · 2 / 9');
  await search.fill('0x600');
  await expect(listPane(page).locator('.list-item .title')).toHaveText(['AdasObjects']);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');

  await page.getByRole('radio', { name: 'Extended' }).click();
  await expect(listPane(page).locator('.list-item .title')).toHaveText(['J1939_TSC1', 'J1939_EEC1', 'J1939_CCVS1']);
  await page.getByRole('radio', { name: 'CAN FD' }).click();
  await expect(listPane(page).locator('.list-item .title')).toHaveText(['AdasObjects']);
  await search.fill('Engine');
  await expect(page.getByText('No messages match “Engine”.')).toBeVisible();
  await page.getByRole('radio', { name: 'All' }).click();
  await expect(listPane(page).locator('.list-item .title')).toHaveText(['EngineData', 'J1939_EEC1']);
});

test('follows links between views: overview, message, node, value table, network graph', async ({ page }) => {
  // Overview row -> message.
  await page.getByRole('row', { name: /GearboxData/ }).click();
  await expect(h1(page)).toHaveText('GearboxData');

  // Network graph: a node, its connection, and a message behind it.
  await rail(page, 'Network').click();
  await page.locator('.ng-node', { has: page.locator('title', { hasText: /^Tester$/ }) }).click();
  const side = page.locator('.side-card');
  await expect(side.getByRole('heading', { name: 'Tester' })).toBeVisible();
  await side.getByRole('button', { name: /→ ECM/ }).click();
  await expect(side.getByRole('heading', { name: 'Tester → ECM' })).toBeVisible();
  await side.getByRole('button', { name: /DiagData/ }).click();
  await expect(h1(page)).toHaveText('DiagData');

  // Graph -> node view.
  await rail(page, 'Network').click();
  await page.locator('.ng-node', { has: page.locator('title', { hasText: /^IC$/ }) }).click();
  await side.getByRole('button', { name: 'Open node' }).click();
  await expect(h1(page)).toHaveText('IC');

  // Node -> received signal, selected in its message.
  await page.getByRole('row', { name: /AbsActive/ }).click();
  await expect(h1(page)).toHaveText('BrakeData');
  await expect(page.locator('.signal-card h2')).toHaveText('AbsActive');

  // Value table -> the signal that uses the same values.
  await rail(page, 'Tables').click();
  await page.getByRole('button', { name: 'GearboxData.GearPosition' }).click();
  await expect(h1(page)).toHaveText('GearboxData');
  await expect(page.locator('.signal-card h2')).toHaveText('GearPosition');
});

test('selects signals from the table and the bit layout', async ({ page }) => {
  await rail(page, 'Messages').click();
  await page.getByRole('row', { name: /ThrottlePosition/ }).click();
  await expect(page.locator('.signal-card h2')).toHaveText('ThrottlePosition');
  await expect(page.locator('.bitlayout .cell.selected')).toHaveCount(8);
  await page.locator('.bitlayout .cell[title="EngineTemp (bit 16)"]').click();
  await expect(page.locator('.signal-card h2')).toHaveText('EngineTemp');
  await page.locator('.bitlayout .cell[title="EngineTemp (bit 16)"]').click();
  await expect(page.getByText('Select a signal in the table or bit layout to see its details.')).toBeVisible();
});

test('starts another file at its overview, and the rail at its own first items', async ({ page }) => {
  // Something shown in every destination with a list, in demo.dbc.
  await rail(page, 'Messages').click();
  await listPane(page).getByRole('button', { name: /BrakeData/ }).click();
  await page.getByRole('row', { name: /WheelSpeedFL/ }).click();
  await expect(page).toHaveURL(/#msg=768\/WheelSpeedFL$/);
  await rail(page, 'Nodes').click();
  await listPane(page).getByRole('button', { name: /Tester/ }).click();
  await rail(page, 'Messages').click();
  await expect(h1(page)).toHaveText('BrakeData');

  // Another file, with none of them: each destination starts at its first item.
  await openText(
    page,
    'other.dbc',
    'VERSION ""\nBU_: Gateway\nBO_ 1 First: 8 Gateway\n SG_ A : 0|8@1+ (1,0) [0|255] "" Gateway\nBO_ 2 Second: 8 Gateway\n',
  );
  await expect(h1(page)).toHaveText('other.dbc');
  await expect(page).toHaveURL(/\/$/);
  await rail(page, 'Messages').click();
  await expect(h1(page)).toHaveText('First');
  await expect(page).toHaveURL(/#msg=1$/);
  await rail(page, 'Nodes').click();
  await expect(h1(page)).toHaveText('Gateway');
});
