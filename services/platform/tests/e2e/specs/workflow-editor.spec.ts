import { BASE_URL, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';
import { SEEDED_WORKFLOW_NAME } from '../helpers/seed';

/**
 * Workflow EDITOR depth against the seeded `test` workflow (installed into
 * every worker org from `fixtures/config/default/automations/test/` — a
 * hidden autoInstall automation whose inline workflow the editor tab renders): open
 * the editor via deep link, edit+save+persist its config, run it via the
 * tester, and fire it via a webhook trigger. The standalone list/catalog/
 * creation surface was removed, so the detail pages are reached by direct
 * link only. On-canvas step editing isn't wired up yet, so the canvas is
 * read-only (the add-step button is disabled) and the wired save path is the
 * Configuration form; the seeded workflow is start-only, so it runs to
 * `completed` under the mock LLM.
 *
 * The webhook-trigger fire IS deterministic in the hermetic stack: creating a
 * webhook reveals a tokenized URL, the dev server proxies `/api/workflows/wh/*`
 * to the in-stack Convex HTTP action, and a POST schedules a real execution
 * with no external delivery or out-of-band secret.
 */

test.describe.serial('workflow editor', () => {
  // Unique per-run marker so persisted-edit assertions never collide across
  // re-runs of the same (isolated) worker org.
  const suffix = Date.now().toString(36);
  const workflowSlug = SEEDED_WORKFLOW_NAME;

  test('opens the seeded workflow editor via deep link', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=editor`,
    );

    // The bottom-center canvas toolbar carries the add-step and test controls —
    // a stable signal the flow editor (not a skeleton) mounted. The shared
    // Button suppresses the native `title` attribute (it routes `title` into
    // aria-label + a tooltip), so locate by role + accessible name, not title.
    // On-canvas step editing isn't wired up yet, so the add-step button is
    // present but disabled and labelled with the "unavailable" message.
    const addStepButton = page.getByRole('button', {
      name: t('workflows.steps.toolbar.addStepUnavailable'),
      exact: true,
    });
    await expect(addStepButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(addStepButton).toBeDisabled();
    await expect(
      page.getByRole('button', {
        name: t('workflows.steps.toolbar.testWorkflow'),
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
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=configuration`,
    );

    // The Configuration tab owns the workflow's RUNTIME settings only —
    // identity (name/description) moved to the owning automation. Backoff is
    // a safe persistence probe: it only applies on retries, which the seeded
    // start-only workflow never hits, so editing it can't affect the run and
    // webhook tests that follow in this serial file.
    const backoffField = page.getByLabel(t('workflows.configuration.backoff'), {
      exact: true,
    });
    await expect(backoffField).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    // Derived from the per-run suffix so re-runs never collide with a value
    // an earlier run already persisted (the seeded config ships no backoff).
    const newBackoff = String(500 + (parseInt(suffix, 36) % 1000));
    await backoffField.fill(newBackoff);

    // Editing makes the form dirty, enabling the unified Save cluster in the
    // workflow nav strip. Scope to that nav landmark: the page also renders
    // the workflow env/secrets editor below the form, which carries its own
    // "Save" button — an unscoped name match would resolve to two elements.
    const save = page
      .getByRole('navigation', {
        name: t('automations.tabs.ariaLabel'),
      })
      .getByRole('button', { name: t('common.actions.save'), exact: true });
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Assert the persisted FIELD value after reload (not the transient toast):
    // the edited backoff must rehydrate from the backend file.
    const reloadedBackoff = page.getByLabel(
      t('workflows.configuration.backoff'),
      { exact: true },
    );
    await reloadAndSettle(page, reloadedBackoff);
    await expect(reloadedBackoff).toHaveValue(newBackoff, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('runs via the tester and lists the run', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=editor`,
    );

    const openTester = page.getByRole('button', {
      name: t('workflows.steps.toolbar.testWorkflow'),
      exact: true,
    });
    await expect(openTester).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
    await openTester.click();

    const execute = page.getByRole('button', {
      name: t('workflows.tester.execute'),
      exact: true,
    });
    await expect(execute).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await execute.click();

    // Scope to the tester panel: the canvas "viewing run" banner reuses the
    // "Completed" label, so an unscoped match is a strict-mode violation.
    await expect(
      page
        .getByRole('complementary', {
          name: t('workflows.sidePanel.testWorkflow'),
        })
        .getByRole('status')
        .getByText(t('workflows.tester.result.completed')),
    ).toBeVisible({ timeout: TIMEOUT.EXECUTION });

    // The Executions tab must now list the run. Body rows live in a rowgroup
    // separate from the header, so scope the count to the last rowgroup.
    await page.goto(
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=executions`,
    );
    const bodyRows = page.getByRole('rowgroup').last().getByRole('row');
    await expect(bodyRows.first()).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    expect(await bodyRows.count()).toBeGreaterThan(0);
  });

  test('webhook trigger fires an execution', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=triggers`,
    );

    // The Webhooks section is a CollapsibleSection that defaults CLOSED when the
    // workflow has no webhooks yet, so its "Add webhook" button is unmounted
    // until the header is expanded. Expand it (idempotently) before creating.
    const sectionToggle = page
      .getByRole('heading', {
        name: t('workflows.triggers.webhooks.title'),
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
        name: t('workflows.triggers.webhooks.createButton'),
      })
      .click();

    const revealDialog = page.getByRole('dialog', {
      name: t('workflows.triggers.webhooks.createdTitle'),
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
    // run from the previous step is also listed, so assert >=1 row resolves.
    await page.goto(
      `/dashboard/${organizationId}/automations/${workflowSlug}?tab=executions`,
    );
    const bodyRows = page.getByRole('rowgroup').last().getByRole('row');
    await expect(bodyRows.first()).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    expect(await bodyRows.count()).toBeGreaterThan(0);
  });
});
