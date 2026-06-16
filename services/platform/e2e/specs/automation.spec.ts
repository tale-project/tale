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

// The seeded fixture workflow's NAME, defined in
// `fixtures/config/default/workflows/test.json`. Not translated UI copy — this
// is rename-safety, so it stays a single literal rather than going through
// `t()`. Only this spec consumes it, so a local constant is enough.
const WORKFLOW_NAME = 'test';

test('runs the seeded test automation to completion', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/automations`);

  // Reaching the editor must be idempotent across Playwright retries: the
  // first attempt installs the `test` template (which removes it from the
  // "From template" picker), so a retry — or any prior run — that still went
  // through the install flow would hang on a `test` button that no longer
  // exists. If `test` is already in the installed list, open its row directly;
  // otherwise install it through the create-automation menu. Both paths land
  // on the editor at `/automations/test`.
  const installedRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: WORKFLOW_NAME, exact: true }),
  });
  const emptyState = page.getByText(t('emptyStates.automations.title'));

  // The list loads via a Convex action behind a skeleton (whose rows carry no
  // text), so the count check below must wait for the table to settle first —
  // otherwise a retry would read 0 mid-load and wrongly take the install path.
  //
  // The org is shared across specs, so the settled list has THREE possible
  // states, not two: the `test` row present, OTHER automations present (e.g.
  // rows left behind by sibling specs), or genuinely empty. The robust
  // "loaded with rows" signal that covers the first two is the table's count
  // footer (DataTable renders `pagination.showingAll` as a `role="status"`
  // `<output>` whenever any automation exists); the empty case is the
  // empty-state title. Waiting on `test` alone would hang whenever the org
  // holds only unrelated automations. Match the footer with a count-agnostic
  // regex built from the i18n template so it tolerates any `{count}`/`{entity}`.
  const countFooter = page.getByText(
    new RegExp(
      t('common.pagination.showingAll')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\{[a-z]+\\\}/g, '.+'),
    ),
  );
  await expect(countFooter.or(emptyState).first()).toBeVisible({
    timeout: 60_000,
  });

  if (await installedRow.count()) {
    await installedRow.first().click();
  } else {
    // The seeded `test` workflow ships as a template; install it through the
    // create-automation menu so it lands in the org's installed set and the
    // editor opens. (Installing also navigates straight to the editor.)
    await page
      .getByRole('button', { name: t('automations.createButton') })
      .click();
    await page
      .getByRole('menuitem', {
        name: t('automations.createDialog.tabTemplate'),
      })
      .click();
    await page
      .getByRole('button', { name: WORKFLOW_NAME, exact: true })
      .click();
  }
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

  // Scope the assertion to the tester panel's result region. After completion,
  // the same "Completed" label renders in two `role="status"` regions — the
  // tester result *and* the canvas's "viewing run" status banner — so a bare
  // `getByRole('status')` is a strict-mode violation. The tester is the side
  // panel (`role="complementary"`, labelled "Test automation"); the banner
  // lives on the canvas outside it, so scoping to the panel is unambiguous.
  await expect(
    page
      .getByRole('complementary', {
        name: t('automations.sidePanel.testAutomation'),
      })
      .getByRole('status')
      .getByText(t('automations.tester.result.completed')),
  ).toBeVisible({ timeout: 120_000 });
});
