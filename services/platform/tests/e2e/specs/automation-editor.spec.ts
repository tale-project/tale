import { BASE_URL, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Automation EDITOR depth: create a blank automation, edit+save+persist its
 * config, run it via the tester, and fire it via a webhook trigger. The canvas
 * step-edit path is a TODO stub (`AutomationSteps#handleCreateStep` only toasts
 * "editing not available"), so the wired save path is the Configuration form; a
 * blank automation is start-only, so it runs to `completed` under the mock LLM.
 *
 * The webhook-trigger fire IS deterministic in the hermetic stack: creating a
 * webhook reveals a tokenized URL, the dev server proxies `/api/workflows/wh/*`
 * to the in-stack Convex HTTP action, and a POST schedules a real execution
 * with no external delivery or out-of-band secret.
 */

test.describe.serial('automation editor', () => {
  // Unique per-run identity so re-runs never collide. `nameToSlug` lowercases +
  // hyphenates the name, so this maps to the slug used in the editor URL.
  const suffix = Date.now().toString(36);
  const automationName = `E2E Editor ${suffix}`;
  const automationSlug = `e2e-editor-${suffix}`;

  test('creates a blank automation and lands in the editor', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/automations`);

    const createButton = page.getByRole('button', {
      name: t('automations.createButton'),
    });
    await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // "Create automation" is a dropdown trigger; its "Blank" item opens the
    // create dialog on the blank tab (the path the smoke spec does not take).
    await createButton.click();
    await page
      .getByRole('menuitem', { name: t('automations.createDialog.tabBlank') })
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('automations.createDialog.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog
      .getByPlaceholder(t('automations.createDialog.namePlaceholder'))
      .fill(automationName);

    const continueButton = dialog.getByRole('button', {
      name: t('automations.createDialog.continue'),
      exact: true,
    });
    await expect(continueButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await continueButton.click();

    // Creating installs the workflow and navigates straight to its editor.
    await page.waitForURL(
      new RegExp(`/automations/${automationSlug}(?:[/?#]|$)`),
      { timeout: TIMEOUT.NAV },
    );

    // The bottom-center canvas toolbar carries the add-step and test controls —
    // a stable signal the flow editor (not a skeleton) mounted. The shared
    // Button suppresses the native `title` attribute (it routes `title` into
    // aria-label + a tooltip), so locate by role + accessible name, not title.
    // On-canvas step editing isn't wired up yet, so the add-step button is
    // present but disabled and labelled with the "unavailable" message.
    await expect(
      page.getByRole('button', {
        name: t('automations.steps.toolbar.addStepUnavailable'),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByRole('button', {
        name: t('automations.steps.toolbar.testAutomation'),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });

  test('configuration tab edits, saves, and persists', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/configuration`,
    );

    const nameField = page.getByLabel(t('automations.configuration.name'), {
      exact: true,
    });
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(nameField).toHaveValue(automationName, {
      timeout: TIMEOUT.VISIBLE,
    });

    // The description is optional + free-form, so editing it can't break the
    // slug/name invariants the editor URL depends on.
    const descriptionField = page.getByLabel(
      t('automations.configuration.description'),
      { exact: true },
    );
    const newDescription = `Edited by E2E ${suffix}`;
    await descriptionField.fill(newDescription);

    // Editing makes the form dirty, enabling the unified Save cluster in the
    // automations nav strip. Scope to that nav landmark: the page also renders
    // the workflow env/secrets editor below the form, which carries its own
    // "Save" button — an unscoped name match would resolve to two elements.
    const save = page
      .getByRole('navigation', {
        name: t('common.aria.automationsNavigation'),
      })
      .getByRole('button', { name: t('common.actions.save'), exact: true });
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Assert the persisted FIELD value after reload (not the transient toast):
    // the edited description must rehydrate from the backend file.
    const reloadedDescription = page.getByLabel(
      t('automations.configuration.description'),
      { exact: true },
    );
    await reloadAndSettle(page, reloadedDescription);
    await expect(reloadedDescription).toHaveValue(newDescription, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('runs via the tester and lists the run', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}`,
    );

    const openTester = page.getByRole('button', {
      name: t('automations.steps.toolbar.testAutomation'),
      exact: true,
    });
    await expect(openTester).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
    await openTester.click();

    const execute = page.getByRole('button', {
      name: t('automations.tester.execute'),
      exact: true,
    });
    await expect(execute).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await execute.click();

    // Scope to the tester panel: the canvas "viewing run" banner reuses the
    // "Completed" label, so an unscoped match is a strict-mode violation.
    await expect(
      page
        .getByRole('complementary', {
          name: t('automations.sidePanel.testAutomation'),
        })
        .getByRole('status')
        .getByText(t('automations.tester.result.completed')),
    ).toBeVisible({ timeout: TIMEOUT.EXECUTION });

    // The Executions tab must now list the run. Body rows live in a rowgroup
    // separate from the header, so scope the count to the last rowgroup.
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/executions`,
    );
    const bodyRows = page.getByRole('rowgroup').last().getByRole('row');
    await expect(bodyRows.first()).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    expect(await bodyRows.count()).toBeGreaterThan(0);
  });

  test('webhook trigger fires an execution', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/triggers`,
    );

    // The Webhooks section is a CollapsibleSection that defaults CLOSED when the
    // automation has no webhooks yet, so its "Add webhook" button is unmounted
    // until the header is expanded. Expand it (idempotently) before creating.
    const sectionToggle = page
      .getByRole('heading', {
        name: t('automations.triggers.webhooks.title'),
        level: 3,
      })
      .getByRole('button');
    await expect(sectionToggle).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    if ((await sectionToggle.getAttribute('aria-expanded')) !== 'true') {
      await sectionToggle.click();
    }

    // Create a webhook: the reveal dialog surfaces the tokenized URL.
    await page
      .getByRole('button', {
        name: t('automations.triggers.webhooks.createButton'),
      })
      .click();

    const revealDialog = page.getByRole('dialog', {
      name: t('automations.triggers.webhooks.createdTitle'),
    });
    await expect(revealDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    const revealedUrl = await revealDialog.locator('code').first().innerText();
    const token = revealedUrl.split('/api/workflows/wh/').at(-1)?.trim();
    expect(token, 'reveal dialog should expose a webhook token').toBeTruthy();

    // POST against BASE_URL (the dev server proxies `/api/workflows/wh/*` to the
    // in-stack Convex HTTP action), not the revealed SITE_URL host which may
    // differ in CI. The handler schedules a real execution and returns accepted.
    const response = await page.request.post(
      `${BASE_URL}/api/workflows/wh/${token}`,
      { data: {} },
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe('accepted');

    // The webhook-triggered run must appear on the Executions tab. The tester
    // run from the previous step is also listed, so assert ≥1 row resolves.
    await page.goto(
      `/dashboard/${organizationId}/automations/${automationSlug}/executions`,
    );
    const bodyRows = page.getByRole('rowgroup').last().getByRole('row');
    await expect(bodyRows.first()).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    expect(await bodyRows.count()).toBeGreaterThan(0);
  });

  // Unconditional teardown as the final serial step: delete the throwaway
  // automation so re-runs in the same (isolated) worker org never collide.
  test('deletes the throwaway automation', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/automations`);

    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: automationName, exact: true }),
    });
    await expect(row).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    await row
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
      .click();
    // The row menu item shares the "Delete" label, so scope the confirm to the
    // open dialog (a `button`, not a `menuitem`).
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    await expect(row).toHaveCount(0, { timeout: TIMEOUT.NAV });
  });
});
