import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { SEEDED_WORKFLOW_NAME } from '../helpers/seed';

/**
 * Automation run smoke: config-dir fixtures ship as uninstalled templates, so
 * install the seeded `test` workflow (or open it if already installed), then
 * execute it from the tester panel and assert the run reaches `completed`.
 */

test('runs the seeded test automation to completion', async ({ page, org }) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/automations`);

  // Idempotent across retries: installing removes `test` from the template
  // picker, so a re-run must open the existing row instead of the install flow.
  // Wait for the list to settle (the row or the empty state) before deciding,
  // since the skeleton rows carry no text and would read as "not installed".
  const installedRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: SEEDED_WORKFLOW_NAME, exact: true }),
  });
  const emptyState = page.getByText(t('emptyStates.automations.title'));
  await expect(installedRow.or(emptyState).first()).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  if (await installedRow.count()) {
    await installedRow.first().click();
  } else {
    await page
      .getByRole('button', { name: t('automations.createButton') })
      .click();
    await page
      .getByRole('menuitem', {
        name: t('automations.createDialog.tabTemplate'),
      })
      .click();
    // Clicking a template card only selects it; the dialog's footer Install
    // button performs the install and navigates to the new automation.
    await page
      .getByRole('button', { name: SEEDED_WORKFLOW_NAME, exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: t('automations.createDialog.install'),
        exact: true,
      })
      .click();
  }
  await page.waitForURL(/\/automations\/test(?:[/?#]|$)/, {
    timeout: TIMEOUT.NAV,
  });

  // The editor toolbar's flask button opens the tester side panel. The shared
  // Button suppresses the native `title` attribute (it routes `title` into
  // aria-label + a tooltip), so locate by role + accessible name, not title.
  const openTester = page.getByRole('button', {
    name: t('automations.steps.toolbar.testAutomation'),
    exact: true,
  });
  await expect(openTester).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await openTester.click();

  const execute = page.getByRole('button', {
    name: t('automations.tester.execute'),
    exact: true,
  });
  await expect(execute).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await execute.click();

  // Scope to the tester panel's result region: the "Completed" label also
  // renders in the canvas "viewing run" banner, so an unscoped match is a
  // strict-mode violation. The tester is the labelled `complementary` panel.
  await expect(
    page
      .getByRole('complementary', {
        name: t('automations.sidePanel.testAutomation'),
      })
      .getByRole('status')
      .getByText(t('automations.tester.result.completed')),
  ).toBeVisible({ timeout: TIMEOUT.EXECUTION });
});
