import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Apps marketplace regression net (issue #1979). The hermetic stack pins the
 * built-in catalog to the empty `tests/e2e/fixtures/config/default/apps` dir, so
 * a fresh worker org has nothing installed AND nothing in the catalog — which is
 * exactly what lets us assert the three states the Apps feature previously had
 * zero coverage for:
 *
 *  1. the hub EMPTY STATE (no installed apps, empty catalog),
 *  2. the app-detail NOT-FOUND state for an unknown slug, and
 *  3. the run-detail BACK-LINK — the regression guard for the `apps.runs.backToApp`
 *     i18n key that used to be missing (it fell back to a hardcoded English
 *     `defaultValue`); the link is now resolved from the catalog and navigates
 *     back to the app.
 *
 * Read-only — only navigates and asserts; never installs.
 */

function appsHubUrl(organizationId: string): string {
  return `/dashboard/${organizationId}/apps`;
}

test('apps hub shows the empty state for a fresh org', async ({
  page,
  org,
}) => {
  await page.goto(appsHubUrl(org.organizationId));
  await expect(
    page.getByRole('heading', { name: t('apps.empty.title'), level: 3 }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
});

test('an unknown app slug renders the not-found state', async ({
  page,
  org,
}) => {
  await page.goto(`${appsHubUrl(org.organizationId)}/this-app-does-not-exist`);
  await expect(
    page.getByRole('heading', { name: t('apps.notFound.title'), level: 3 }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
});

test('the run-detail back link resolves its i18n key and navigates to the app', async ({
  page,
  org,
}) => {
  // The run-detail page renders its "Back to app" link unconditionally (no real
  // run required), so this exercises the previously-missing `apps.runs.backToApp`
  // key directly. A deep link without `wf` degrades to just the back link + an
  // empty canvas — perfect for asserting the link alone.
  await page.goto(
    `${appsHubUrl(org.organizationId)}/sample-app/runs/sample-exec`,
  );
  const backLink = page.getByRole('link', { name: t('apps.runs.backToApp') });
  await expect(backLink).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await backLink.click();
  await page.waitForURL(`${appsHubUrl(org.organizationId)}/sample-app`, {
    timeout: TIMEOUT.NAV,
  });
});
