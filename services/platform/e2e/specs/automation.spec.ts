import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Automation run smoke flow: open the seeded start-only `test` workflow from
 * the automations list, execute it from the test panel, and assert the
 * execution reaches `completed` (reactive status subscription in
 * `automation-tester.tsx`).
 */

test('runs the seeded test automation to completion', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/automations`);

  // Row click navigates to the workflow editor.
  const row = page.getByRole('cell', { name: 'test', exact: true }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await page.waitForURL(/\/automations\/test(?:[/?#]|$)/, { timeout: 60_000 });

  // The editor toolbar's flask button opens the test side panel.
  const openTester = page.getByTitle(
    t('automations.steps.toolbar.testAutomation'),
  );
  await expect(openTester).toBeEnabled({ timeout: 60_000 });
  await openTester.click();

  const execute = page.getByRole('button', {
    name: t('automations.tester.execute'),
    exact: true,
  });
  await expect(execute).toBeEnabled();
  await execute.click();

  await expect(
    page
      .getByRole('status')
      .getByText(t('automations.tester.result.completed')),
  ).toBeVisible({ timeout: 120_000 });
});
