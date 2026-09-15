import { expect, test } from '@playwright/test';

test('settings demo saves a new baseline and discards later edits', async ({
  page,
}) => {
  await page.goto('/docs/patterns/settings-page');
  const name = page.getByRole('textbox', { name: 'Workspace name' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await name.fill('Local demonstration');
  await save.click();
  await expect(
    page.getByText('Everything saved', { exact: true }),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await name.fill('Uncommitted edit');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(name).toHaveValue('Local demonstration');
  await page.reload();
  await expect(name).toHaveValue('Northwind Trading');
});

test('toast examples share one notification viewport', async ({ page }) => {
  await page.goto('/docs/components/toast');
  await page
    .getByRole('button', { name: 'Save settings', exact: true })
    .click();
  await expect(page.getByText('Settings saved', { exact: true })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'Success', exact: true }).click();
  await expect(
    page.getByText('Provider connected', { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText('Settings saved', { exact: true })).toHaveCount(
    0,
  );
});

test('a deep page preserves the first Tab and skip-link destination', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.goto('/docs/marketing-ui/overview');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Marketing UI overview',
  );
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});
