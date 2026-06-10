import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';

/**
 * Login smoke flow. Runs unauthenticated (empty storageState) and uses
 * per-test throwaway accounts created via the sign-up endpoint, so the
 * exponential login lockout (`loginAttempts`) can never poison the shared
 * owner session and re-runs never collide.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('login', () => {
  test('rejects a wrong password with a uniform error', async ({
    page,
    request,
  }) => {
    const credentials = uniqueCredentials('login-negative');
    // Standalone request fixture: its cookie jar is separate from the page,
    // so creating the account does NOT log the browser in.
    await signUpViaApi(request, credentials);

    await page.goto('/log-in');
    await page.getByLabel(t('auth.email')).fill(credentials.email);
    await page
      .getByLabel(t('auth.password'))
      .fill(`${credentials.password}-wrong`);
    await page
      .getByRole('button', { name: t('auth.login.loginButton'), exact: true })
      .click();

    await expect(page.getByRole('alert')).toContainText(
      t('auth.login.wrongCredentials'),
    );
    await expect(page).toHaveURL(/\/log-in/);
  });

  test('logs in with valid credentials and reaches the dashboard', async ({
    page,
    request,
  }) => {
    const credentials = uniqueCredentials('login-positive');
    await signUpViaApi(request, credentials);

    await page.goto('/log-in');
    await page.getByLabel(t('auth.email')).fill(credentials.email);
    await page.getByLabel(t('auth.password')).fill(credentials.password);
    await page
      .getByRole('button', { name: t('auth.login.loginButton'), exact: true })
      .click();

    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });
});
