import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { TIMEOUT } from '../helpers/env';
import { t } from '../helpers/i18n';

/**
 * Login smoke flow. Unauthenticated (empty storageState) with per-test
 * throwaway accounts so the login lockout can never poison a worker's owner
 * session and re-runs never collide.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('login', () => {
  test('rejects a wrong password with a uniform error', async ({
    page,
    request,
  }) => {
    const credentials = uniqueCredentials('login-negative');
    // Standalone request fixture: its cookie jar is separate from the page, so
    // creating the account does NOT log the browser in.
    await signUpViaApi(request, credentials);

    await page.goto('/log-in');
    await page
      .getByLabel(t('auth.email'), { exact: true })
      .fill(credentials.email);
    // Exact match: the password field ships a "Show password" toggle whose
    // aria-label also contains "Password", so a substring match is ambiguous.
    await page
      .getByLabel(t('auth.password'), { exact: true })
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
    await page
      .getByLabel(t('auth.email'), { exact: true })
      .fill(credentials.email);
    await page
      .getByLabel(t('auth.password'), { exact: true })
      .fill(credentials.password);
    await page
      .getByRole('button', { name: t('auth.login.loginButton'), exact: true })
      .click();

    await page.waitForURL(/\/dashboard/, { timeout: TIMEOUT.FIRST_PAINT });
  });
});

/**
 * SSO real-error surfacing. A failed Entra ID sign-in is bounced
 * back to `/log-in?error=<key>&error_code=AADSTS…&recovery=<key>` by
 * `redirectWithError`, so the login page renders the REAL reason from the query
 * params — no live IdP is needed to drive it. `error`/`recovery` are
 * `auth`-namespaced translation keys; an unmapped value renders verbatim.
 */
test.describe('SSO sign-in errors', () => {
  test('surfaces a mapped IdP error with its recovery hint', async ({
    page,
  }) => {
    await page.goto(
      '/log-in?error=sso.errors.userNotAssigned&error_code=AADSTS50105&recovery=sso.errors.recovery.contactAdmin',
    );

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(t('auth.sso.errors.userNotAssigned'), {
      timeout: TIMEOUT.VISIBLE,
    });
    await expect(alert).toContainText(
      t('auth.sso.errors.recovery.contactAdmin'),
    );
    await expect(page).toHaveURL(/\/log-in/);
  });

  test('renders the conditional-access UI for an MFA code and clears on retry', async ({
    page,
  }) => {
    await page.goto(
      '/log-in?error=sso.errors.mfaRequired&error_code=AADSTS50076&recovery=sso.errors.recovery.completeMfa',
    );

    await expect(page.getByRole('alert')).toContainText(
      t('auth.sso.errors.mfaRequired'),
      { timeout: TIMEOUT.VISIBLE },
    );
    // MFA codes get the dedicated recovery affordance (not the plain alert).
    const completeMfa = page.getByRole('button', {
      name: t('auth.sso.actions.completeMfa'),
      exact: true,
    });
    await expect(completeMfa).toBeVisible();
    const tryAgain = page.getByRole('button', {
      name: t('auth.sso.actions.tryAgain'),
      exact: true,
    });
    await expect(tryAgain).toBeVisible();

    // Retry strips the error params so a fresh attempt starts from a clean form.
    await tryAgain.click();
    await expect(page).not.toHaveURL(/error=/);
    await expect(completeMfa).toHaveCount(0);
  });

  test('renders an unmapped code verbatim without the conditional-access UI', async ({
    page,
  }) => {
    await page.goto('/log-in?error=Some+plain+reason&error_code=AADSTS999999');

    // A missing i18n key degrades to the string itself.
    await expect(page.getByRole('alert')).toContainText('Some plain reason', {
      timeout: TIMEOUT.VISIBLE,
    });
    // 999999 is not a conditional-access code, so the step-up affordance is absent.
    await expect(
      page.getByRole('button', { name: t('auth.sso.actions.completeMfa') }),
    ).toHaveCount(0);
  });
});
