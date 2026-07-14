import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Automations marketplace regression net (issue #1979). The hermetic stack pins the
 * built-in catalog to the empty `tests/e2e/fixtures/config/default/automations`
 * dir, so a fresh worker org has nothing installed AND nothing in the catalog —
 * which is exactly what lets us assert the three states the Automations feature
 * previously had zero coverage for:
 *
 *  1. the hub EMPTY STATE (no installed automations, empty catalog),
 *  2. the automation-detail NOT-FOUND state for an unknown slug, and
 *  3. the run-detail BACK-LINK — the regression guard for the `automations.runs.backToApp`
 *     i18n key that used to be missing (it fell back to a hardcoded English
 *     `defaultValue`); the link is now resolved from the catalog and navigates
 *     back to the automation.
 *
 * Read-only — only navigates and asserts; never installs.
 */

function appsHubUrl(organizationId: string): string {
  return `/dashboard/${organizationId}/automations`;
}

/** The seeded fixture automation (`fixtures/config/default/automations/test/`),
 *  hidden + autoInstall — the hermetic catalog's stand-in for the shipped packs. */
const SEEDED_AUTOMATION_NAME = 'Test workflow';

test('automations hub shows the auto-installed automation on a fresh org', async ({
  page,
  org,
}) => {
  // A fresh org is never durably empty any more: the default-automation
  // provisioner installs every `autoInstall` manifest shortly after org
  // creation (in production the task-ops packs; in this hermetic catalog the
  // seeded `test` automation). Its card proves the autoInstall pipeline
  // end to end — the Installed tab lists hidden automations too, and the
  // generous timeout absorbs the provisioner's head-start delay.
  await page.goto(appsHubUrl(org.organizationId));
  // The card is an overlay button; its 3-dots menu carries the name too, so
  // take the first match rather than asserting a strict single element.
  await expect(
    page.getByRole('button', { name: SEEDED_AUTOMATION_NAME }).first(),
  ).toBeVisible({ timeout: 60_000 });
});

test('an unknown automation slug renders the not-found state', async ({
  page,
  org,
}) => {
  await page.goto(`${appsHubUrl(org.organizationId)}/this-app-does-not-exist`);
  await expect(
    page.getByRole('heading', {
      name: t('automations.notFound.title'),
      level: 3,
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
});

test('the run-detail back link resolves its i18n key and navigates to the app', async ({
  page,
  org,
}) => {
  // The run-detail page renders its "Back to automation" link unconditionally (no real
  // run required), so this exercises the previously-missing `automations.runs.backToApp`
  // key directly. A deep link without `wf` degrades to just the back link + an
  // empty canvas — perfect for asserting the link alone.
  await page.goto(
    `${appsHubUrl(org.organizationId)}/sample-automation/runs/sample-exec`,
  );
  const backLink = page.getByRole('link', {
    name: t('automations.runs.backToApp'),
  });
  await expect(backLink).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await backLink.click();
  await page.waitForURL(`${appsHubUrl(org.organizationId)}/sample-automation`, {
    timeout: TIMEOUT.NAV,
  });
});
