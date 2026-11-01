import { DEMO_DBC, DEMO_DBC_TEXT, TEST_ARXML, expect, openFile, openText, rail, test } from '../fixtures';

test.describe('opening files', () => {
  test('welcomes, then opens a DBC file and remembers it', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('CanViewer — CAN Database Viewer');
    await expect(page.getByText('A viewer for DBC CAN database files.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open file…' })).toBeVisible();
    await expect(rail(page, 'Messages')).toBeDisabled();

    await openFile(page, DEMO_DBC);
    await expect(page).toHaveTitle('demo.dbc — CanViewer');
    await expect(page.locator('.facts .fact').first()).toHaveText(/Messages\s*9/);
    await expect(page.getByText(/Parsed without problems\./)).toBeVisible();
    await expect(rail(page, 'Overview')).toHaveAttribute('aria-current', 'page');

    // A reload restores the file.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'demo.dbc' })).toBeVisible();
  });

  test('opens a file dropped onto the window', async ({ page }) => {
    await page.goto('/');
    const dataTransfer = await page.evaluateHandle((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'dropped.dbc'));
      return transfer;
    }, DEMO_DBC_TEXT);
    await page.dispatchEvent('.app', 'dragenter', { dataTransfer });
    await expect(page.getByText('Drop the file to open it')).toBeVisible();
    await page.dispatchEvent('.app', 'drop', { dataTransfer });
    await expect(page.getByText('Drop the file to open it')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'dropped.dbc' })).toBeVisible();
  });

  test('lists the lines of a broken file as problems and loads the rest', async ({ page }) => {
    await page.goto('/');
    await openText(
      page,
      'broken.dbc',
      'VERSION ""\nBU_: A\nBO_ 1 Fine: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\nBO_ nonsense\nCM_ BO_ 99 "orphan";\n',
    );
    await expect(page.getByRole('heading', { level: 1, name: 'broken.dbc' })).toBeVisible();
    await expect(page.getByText('2 parse problems.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Parse problems (2)' })).toBeVisible();
    await expect(page.getByText('CM_ BO_ references unknown message id')).toBeVisible();
    await expect(page.locator('.rail-badge')).toHaveText('2');
    await expect(page.getByRole('cell', { name: 'Fine', exact: true })).toBeVisible();
  });

  test('imports ARXML through canmatrix with visible stages, and reports a file it cannot read', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(TEST_ARXML);
    // The first import loads the runtime: its stage shows while it does.
    await expect(page.getByRole('status')).toContainText('test.arxml');
    await expect(page.getByRole('heading', { level: 1, name: 'test.arxml' })).toBeVisible({ timeout: 150_000 });
    await expect(page.getByRole('status')).toBeHidden();
    await rail(page, 'Messages').click();
    await expect(page.locator('.list-pane .list-item').first()).toBeVisible();

    await openText(page, 'broken.kcd', 'this is not XML');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Could not read broken.kcd');
    // The database that was open stays open.
    await expect(page).toHaveTitle('test.arxml — CanViewer');
    await alert.getByRole('button', { name: 'Dismiss' }).click();
    await expect(alert).toBeHidden();
  });
});
