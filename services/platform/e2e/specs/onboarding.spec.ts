import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';

/**
 * Onboarding wizard flow. Runs unauthenticated (empty storageState) with a
 * per-test throwaway account so it never collides with the shared owner
 * session. A fresh user has no organization, so `/dashboard` routes into the
 * wizard at `/dashboard/create-organization` — `default` is never
 * auto-created. The wizard creates the org on the first "Next", the optional
 * provider step is skippable, and "Finish" lands on the org dashboard.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const ORG_ID_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

test.describe('onboarding wizard', () => {
  test('first-run user names their workspace and reaches the dashboard', async ({
    page,
  }) => {
    const credentials = uniqueCredentials('onboarding');
    // page.request shares the browser cookie jar, so this also logs the page in.
    await signUpViaApi(page.request, credentials);

    await page.goto('/dashboard');
    // No org yet → always routed into the wizard (no auto-`default`).
    await page.waitForURL(/\/dashboard\/create-organization/, {
      timeout: 120_000,
    });

    const nameField = page.getByLabel(
      t('settings.organization.organizationName'),
    );
    const next = page.getByRole('button', {
      name: t('common.actions.next'),
      exact: true,
    });

    // "default" is reserved — Next stays disabled and the reserved error shows.
    await nameField.fill('default');
    await expect(
      page.getByText(t('settings.organization.nameReserved')),
    ).toBeVisible();
    await expect(next).toBeDisabled();

    // A real name enables Next.
    await nameField.fill(`E2E Onboarding ${Date.now().toString(36)}`);
    await expect(next).toBeEnabled();
    await next.click();

    // Org created → advanced to the optional provider step; skip it to Finish.
    const skip = page.getByRole('button', {
      name: t('common.actions.skip'),
      exact: true,
    });
    await expect(skip).toBeVisible();
    await skip.click(); // provider → finish

    await page
      .getByRole('button', {
        name: t('onboarding.finish.goToDashboard'),
        exact: true,
      })
      .click();

    await page.waitForURL(ORG_ID_URL, { timeout: 120_000 });
    expect(ORG_ID_URL.test(page.url())).toBe(true);
  });
});
