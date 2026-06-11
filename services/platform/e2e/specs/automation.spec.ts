import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Automation run smoke flow: install the seeded start-only `test` workflow
 * template (config-dir fixtures ship as uninstalled templates — the
 * automations list only shows *installed* workflows), open it in the editor,
 * execute it from the test panel, and assert the execution reaches `completed`
 * (reactive status subscription in `automation-tester.tsx`).
 */

test('runs the seeded test automation to completion', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/automations`);

  // The seeded `test` workflow ships as a template; install it through the
  // create-automation menu so it lands in the org's installed set and the
  // editor opens. (Installing also navigates straight to the editor.)
  await page
    .getByRole('button', { name: t('automations.createButton') })
    .click();
  await page
    .getByRole('menuitem', { name: t('automations.createDialog.tabTemplate') })
    .click();
  await page.getByRole('button', { name: 'test', exact: true }).click();
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
