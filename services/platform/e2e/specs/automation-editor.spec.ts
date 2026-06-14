import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext, STORAGE_STATE_PATH } from '../helpers/test-context';

/**
 * Automation EDITOR depth (wave 2). Where `automation.spec.ts` runs the seeded
 * `test` template, this spec creates a brand-new BLANK automation from scratch
 * (the "Blank" tab, not the template path) and exercises the editor surface the
 * smoke leaves uncovered: the canvas affordances, the Configuration form
 * save-and-persist round-trip, every sub-tab's primary affordance (executions,
 * triggers, plus the org-level metrics page), a test-panel run, and finally the
 * delete. Runs as the pre-authenticated owner against the seeded org.
 *
 * Idempotency / shared state: this spec NEVER touches the seeded `test`
 * workflow (automation.spec depends on it). It creates ONE throwaway automation
 * with a `Date.now().toString(36)` suffix, mutates only that, and deletes it in
 * `afterAll` (tolerant of an already-removed row) so re-runs never collide and
 * the shared backend is left clean. The tests share one page/context (created
 * with the owner storageState) and run serially so the created automation
 * persists across them.
 *
 * Hermetic limits (noted, not worked around): the flow-editor CANVAS is not
 * wired to persist step edits — `AutomationSteps#handleCreateStep`/`onConnect`
 * are TODO stubs that only toast "editing not available". So "add a step in the
 * editor and save" is NOT reachable through the canvas here; the wired, save-
 * able edit path is the Configuration tab (a `useFormEditor` form persisted via
 * `useSaveWorkflow`), which is what test 2 drives. A blank automation ships with
 * a single `start` step, which — like the seeded start-only `test` workflow —
 * runs to `completed` under the mock stack, so the tester run in test 4 is
 * hermetic.
 */

test.describe.serial('automation editor', () => {
  // Unique per-run identity so re-runs never collide with an existing
  // automation. `nameToSlug` (BlankTabContent) lowercases + hyphenates the
  // name, so this flat name maps to the slug used in the editor URL.
  const suffix = Date.now().toString(36);
  const automationName = `E2E Editor ${suffix}`;
  const automationSlug = `e2e-editor-${suffix}`;

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // `browser.newPage()` would skip the chromium project's storageState, so
    // open the shared page on a context built with the owner session instead.
    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    // Best-effort cleanup of the throwaway automation. If an earlier test
    // already deleted it (or never created it), the row simply isn't there —
    // treat that as success rather than failing the run on teardown.
    try {
      const { organizationId } = readRunContext();
      await page.goto(`/dashboard/${organizationId}/automations`);

      const row = automationRow(page, automationName);
      if (await row.count()) {
        await row
          .getByRole('button', { name: t('common.actions.openMenu') })
          .click();
        await page
          .getByRole('menuitem', {
            name: t('common.actions.delete'),
            exact: true,
          })
          .click();
        // Scope the confirm to the dialog: the row menu item shares the
        // "Delete" label, but it's a `menuitem` and this is a `button` inside
        // the open dialog, so the dialog scope makes it unambiguous.
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: t('common.actions.delete'),
            exact: true,
          })
          .click();
        await expect(automationRow(page, automationName)).toHaveCount(0, {
          timeout: 60_000,
        });
      }
    } catch (error) {
      // Never let teardown noise mask a real test failure — log and move on.
      console.warn('automation-editor cleanup skipped:', error);
    } finally {
      await page.close();
    }
  });

  test('creates a blank automation and lands in the editor', async () => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/automations`);

    // The list loads behind a skeleton; wait for the create control to settle.
    const createButton = page.getByRole('button', {
      name: t('automations.createButton'),
    });
    await expect(createButton).toBeVisible({ timeout: 60_000 });

    // "Create automation" is a dropdown trigger (AutomationsActionMenu →
    // DataTableActionMenu); its "Blank" item opens the create dialog on the
    // blank tab — the path automation.spec deliberately does NOT take.
    await createButton.click();
    await page
      .getByRole('menuitem', { name: t('automations.createDialog.tabBlank') })
      .click();

    // Blank tab: only the name is required (Continue stays disabled until it's
    // filled). The dialog title and the Name field both carry "Create
    // automation"/"Name" copy, so target the field by its label.
    const dialog = page.getByRole('dialog', {
      name: t('automations.createDialog.title'),
    });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog
      .getByPlaceholder(t('automations.createDialog.namePlaceholder'))
      .fill(automationName);

    const continueButton = dialog.getByRole('button', {
      name: t('automations.createDialog.continue'),
      exact: true,
    });
    await expect(continueButton).toBeEnabled({ timeout: 20_000 });
    await continueButton.click();

    // Creating saves + installs the workflow and navigates straight to its
    // editor (BlankTabContent#onSubmit → navigate to /automations/$amId).
    await page.waitForURL(
      new RegExp(`/automations/${automationSlug}(?:[/?#]|$)`),
      { timeout: 60_000 },
    );

    // The editor's bottom-center canvas toolbar carries the add-step and
    // test-automation controls — a stable signal the flow editor (not a
    // skeleton) mounted for the freshly created automation.
    await expect(
      page.getByTitle(t('automations.steps.toolbar.addStep')),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTitle(t('automations.steps.toolbar.testAutomation')),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('configuration tab edits, saves, and persists', async () => {
    const { organizationId } = readRunContext();
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/configuration`,
    );

    // The Configuration form (useFormEditor) is the wired save path. The Name
    // field loads the created automation's name.
    const nameField = page.getByLabel(t('automations.configuration.name'), {
      exact: true,
    });
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await expect(nameField).toHaveValue(automationName, { timeout: 20_000 });

    // Edit the description: it's optional and free-form, so it doesn't risk the
    // slug/name invariants the editor URL depends on.
    const descriptionField = page.getByLabel(
      t('automations.configuration.description'),
      { exact: true },
    );
    const newDescription = `Edited by E2E ${suffix}`;
    await descriptionField.fill(newDescription);

    // Editing makes the form dirty, which enables the unified Save cluster in
    // the tab strip (AutomationNavigation → EditorActions). It's rendered once
    // here (unlike the duplicated settings cluster), so the label is unique.
    const save = page.getByRole('button', {
      name: t('common.actions.save'),
      exact: true,
    });
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();

    // The configuration save toasts the shared "Changes saved" success.
    await expect(page.getByText(t('toast.success.saved')).first()).toBeVisible({
      timeout: 20_000,
    });

    // Reload: the edited description must come back from the backend file, not
    // local form state — proving the save persisted.
    await page.reload();
    const reloadedDescription = page.getByLabel(
      t('automations.configuration.description'),
      { exact: true },
    );
    await expect(reloadedDescription).toBeVisible({ timeout: 60_000 });
    await expect(reloadedDescription).toHaveValue(newDescription, {
      timeout: 20_000,
    });
  });

  test('triggers tab renders its schedule/webhook/event sections', async () => {
    const { organizationId } = readRunContext();
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/triggers`,
    );

    // Each trigger section is a collapsible `<h3>` (CollapsibleSection). Their
    // presence proves the triggers route mounted its primary affordances; the
    // accessible name includes a trailing count badge, so match by substring
    // (no `exact`).
    for (const titleKey of [
      'automations.triggers.schedules.title',
      'automations.triggers.webhooks.title',
      'automations.triggers.events.title',
    ]) {
      await expect(
        page.getByRole('heading', { name: t(titleKey), level: 3 }),
      ).toBeVisible({ timeout: 60_000 });
    }
  });

  test('executions tab runs via the tester and shows the run', async () => {
    const { organizationId } = readRunContext();

    // Open the editor and run the automation from the test panel (same flow as
    // automation.spec). A blank automation is start-only, so it completes.
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}`,
    );

    const openTester = page.getByTitle(
      t('automations.steps.toolbar.testAutomation'),
    );
    await expect(openTester).toBeEnabled({ timeout: 60_000 });
    await openTester.click();

    const execute = page.getByRole('button', {
      name: t('automations.tester.execute'),
      exact: true,
    });
    await expect(execute).toBeEnabled({ timeout: 20_000 });
    await execute.click();

    // Scope to the tester side panel's result region (role="status" inside the
    // labelled `complementary`) — the canvas "viewing run" banner reuses the
    // same "Completed" label, so an unscoped match is a strict-mode violation.
    await expect(
      page
        .getByRole('complementary', {
          name: t('automations.sidePanel.testAutomation'),
        })
        .getByRole('status')
        .getByText(t('automations.tester.result.completed')),
    ).toBeVisible({ timeout: 120_000 });

    // The Executions tab must now list at least one run. The table renders rows
    // (DataTable) once the reactive list query resolves; the data rows live in a
    // rowgroup separate from the header, so scope the count to the body.
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/executions`,
    );
    const bodyRows = page.getByRole('rowgroup').last().getByRole('row');
    await expect(bodyRows.first()).toBeVisible({ timeout: 120_000 });
    expect(await bodyRows.count()).toBeGreaterThan(0);
  });

  test('org automations metrics page renders', async () => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/automations/metrics`);

    // The metrics page title (an <h1>) and the first summary card prove the
    // org-level metrics route mounted and resolved its aggregate query.
    await expect(
      page.getByRole('heading', {
        name: t('automations.metrics.title'),
        level: 1,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(t('automations.metrics.cards.totalRuns')).first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});

/** The automations list table row carrying the given name (exact cell). */
function automationRow(page: Page, name: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}
