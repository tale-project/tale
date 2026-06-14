import { expect, test, type Page } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';

/**
 * Auth depth: logout, change-password, 2FA enrollment, and org switching.
 *
 * Every test in this file runs UNAUTHENTICATED (empty storageState) and drives
 * its own per-test THROWAWAY account created via `signUpViaApi` + unique
 * suffixes. That is non-negotiable here: each flow mutates the session
 * (logout), the password, 2FA state, or org membership — none of which may ever
 * touch the shared owner session (`owner.json`) the chromium project loads. The
 * shared owner is never signed out, never has its password changed, and never
 * has 2FA enabled. Unique `e2e-*@tale.test` emails keep re-runs collision-free
 * against the shared backend, and the suite never deletes anything.
 *
 * Hermeticity caveats:
 *  - 2FA: the enroll page reveals the TOTP secret, but turning it into a valid
 *    6-digit code needs a TOTP (RFC-6238) implementation. The platform ships no
 *    TOTP/OTP dependency, and this suite must not add one or hand-roll crypto in
 *    a spec, so the verify/code-entry step is asserted-then-skipped (see the
 *    2FA test). We still exercise the real `twoFactor.enable` round-trip (it
 *    returns the secret), just not the final `verifyTotp` confirmation.
 *  - Email/SMS/SSO/IdP factors are out of scope (no hermetic transport).
 */

test.use({ storageState: { cookies: [], origins: [] } });

const DASHBOARD_ORG_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;
const LOGIN_URL = /\/log-in(?:[/?#]|$)/;
const CREATE_ORG_URL = /\/dashboard\/create-organization(?:[/?#]|$)/;

/**
 * Sign up a fresh throwaway account ON the browser context (page.request shares
 * the cookie jar, so this also logs the page in), then walk the onboarding
 * wizard to create an organization. Mirrors `setup/auth.setup.ts` and
 * `specs/onboarding.spec.ts` exactly. Returns the created org id.
 *
 * A fresh user has no org, so `/dashboard` routes into the wizard at
 * `/dashboard/create-organization`; if a (re-run) user already has one, it
 * lands straight on the org dashboard.
 */
async function signUpAndCreateOrg(
  page: Page,
  label: string,
): Promise<{ email: string; password: string; organizationId: string }> {
  const credentials = uniqueCredentials(label);
  await signUpViaApi(page.request, credentials);

  await page.goto('/dashboard');
  const resolved = new RegExp(
    `(?:${DASHBOARD_ORG_URL.source})|${CREATE_ORG_URL.source}`,
  );
  await page.waitForURL(resolved, { timeout: 120_000 });

  if (CREATE_ORG_URL.test(page.url())) {
    await runCreateOrgWizard(page, `E2E Account ${Date.now().toString(36)}`);
  }

  await page.waitForURL(DASHBOARD_ORG_URL, { timeout: 120_000 });
  const match = DASHBOARD_ORG_URL.exec(page.url());
  if (!match?.[1]) {
    throw new Error(`Could not extract organization id from ${page.url()}`);
  }
  return { ...credentials, organizationId: match[1] };
}

/**
 * Drive the org-creation wizard already showing at
 * `/dashboard/create-organization`: fill the name, Next (creates the org and
 * advances to the optional provider step), Skip the provider, then Finish to
 * land on the new org dashboard. Same steps as the setup project.
 */
async function runCreateOrgWizard(page: Page, orgName: string): Promise<void> {
  await page
    .getByLabel(t('settings.organization.organizationName'))
    .fill(orgName);

  const next = page.getByRole('button', {
    name: t('common.actions.next'),
    exact: true,
  });
  await expect(next).toBeEnabled();
  await next.click();

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
}

/** Log in through the UI (same form/selectors as `specs/auth.spec.ts`). */
async function logInViaUi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/log-in');
  await page.getByLabel(t('auth.email'), { exact: true }).fill(email);
  // Exact match: the password field also ships a "Show password" toggle whose
  // aria-label contains "Password", so a substring match is ambiguous.
  await page.getByLabel(t('auth.password'), { exact: true }).fill(password);
  await page
    .getByRole('button', { name: t('auth.login.loginButton'), exact: true })
    .click();
}

test.describe('logout', () => {
  test('signs out from the user menu and returns to the login page', async ({
    page,
  }) => {
    // Throwaway account so we never sign out the shared owner session.
    await signUpAndCreateOrg(page, 'logout');

    // Open the account menu. The trigger carries the "Manage account" tooltip
    // as its accessible name; the desktop sidebar copy is the one in the a11y
    // tree at this viewport (the mobile-header copy is `md:hidden`). `.first()`
    // guards against either being matched.
    await page
      .getByRole('button', { name: t('auth.userButton.manageAccount') })
      .first()
      .click();

    // The log-out menu item opens a confirmation dialog rather than signing out
    // immediately.
    await page
      .getByRole('menuitem', { name: t('auth.userButton.logOut') })
      .click();

    // Confirm inside the dialog. Both the menu item and this button read
    // "Log out", so scope to the dialog to disambiguate.
    const confirmDialog = page.getByRole('dialog');
    await expect(
      confirmDialog.getByText(t('auth.userButton.logOutConfirm.description')),
    ).toBeVisible();
    await confirmDialog
      .getByRole('button', {
        name: t('auth.userButton.logOutConfirm.confirm'),
        exact: true,
      })
      .click();

    // Sign-out hard-navigates to `/`, which redirects an anonymous visitor to
    // the login page.
    await page.waitForURL(LOGIN_URL, { timeout: 60_000 });
    expect(LOGIN_URL.test(page.url())).toBe(true);
  });
});

test.describe('change password', () => {
  test('changes the password and logs back in with the new one', async ({
    page,
  }) => {
    // Throwaway account: changing the password rotates sessions server-side, so
    // this MUST NOT run against the shared owner.
    const { email, password, organizationId } = await signUpAndCreateOrg(
      page,
      'change-password',
    );
    const newPassword = `${password}-Rotated1`;

    await page.goto(`/dashboard/${organizationId}/settings/account`);

    // Security section → open the change-password dialog. The section trigger
    // and the dialog submit both read "Change password", so open via the
    // page-level button, then submit via the one scoped to the dialog.
    await page
      .getByRole('button', {
        name: t('auth.changePassword.title'),
        exact: true,
      })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog
      .getByLabel(t('auth.changePassword.currentPassword'), { exact: true })
      .fill(password);
    await dialog
      .getByLabel(t('auth.changePassword.newPassword'), { exact: true })
      .fill(newPassword);
    await dialog
      .getByLabel(t('auth.changePassword.confirmPassword'), { exact: true })
      .fill(newPassword);
    await dialog
      .getByRole('button', {
        name: t('auth.changePassword.title'),
        exact: true,
      })
      .click();

    // A successful change signs the user out and hard-navigates to `/`, which
    // redirects to the login page (no success toast on this path by design —
    // the session is intentionally invalidated). That redirect is the proof the
    // mutation succeeded.
    await page.waitForURL(LOGIN_URL, { timeout: 60_000 });

    // Prove the new password took: it logs in and reaches a dashboard.
    await logInViaUi(page, email, newPassword);
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });
});

test.describe('two-factor enrollment', () => {
  test('renders the enroll page and reveals the TOTP secret', async ({
    page,
  }) => {
    // Throwaway account — we never enable 2FA on the shared owner. We also stop
    // BEFORE verifying a code, so this account never actually enrolls.
    const { password } = await signUpAndCreateOrg(page, 'twofa');

    // The standalone enrollment wall requires an active session (its beforeLoad
    // bounces anonymous visitors to /log-in) — we have one.
    await page.goto('/2fa-enroll');

    // Primary content: the page renders the password step (title + enable
    // button) before any external authenticator is involved.
    await expect(
      page.getByRole('heading', { name: t('twoFactor.enroll.title') }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(t('twoFactor.enroll.description')),
    ).toBeVisible();
    const enableButton = page.getByRole('button', {
      name: t('twoFactor.enrollment.enableButton'),
      exact: true,
    });
    await expect(enableButton).toBeVisible();

    // Confirm the account password to begin enrollment. This runs the real
    // `twoFactor.enable` round-trip, which returns the otpauth secret.
    await page
      .getByLabel(t('twoFactor.confirmPassword.label'), { exact: true })
      .fill(password);
    await enableButton.click();

    // Verify step: the QR + manual-entry secret are shown alongside the code
    // input. Asserting these renders proves enrollment got as far as a usable
    // secret without a real authenticator app.
    await expect(page.getByText(t('twoFactor.setup.manualEntry'))).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByLabel(t('twoFactor.setup.verifyCodeLabel')),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: t('twoFactor.setup.verifyButton'),
        exact: true,
      }),
    ).toBeVisible();

    // SKIPPED: entering a valid 6-digit TOTP code to finish enrollment. That
    // requires generating a code from the revealed secret (RFC-6238), which
    // needs a TOTP implementation the platform doesn't ship; we won't add a dep
    // or hand-roll crypto in a spec. The account is therefore left un-enrolled.
  });
});

test.describe('organization switching', () => {
  test('creates a second org and switches between the two', async ({
    page,
  }) => {
    // Throwaway account so we never mutate the shared owner's org membership.
    const { organizationId: firstOrgId } = await signUpAndCreateOrg(
      page,
      'org-switch',
    );

    // Create a SECOND org via the wizard. A user who already belongs to an org
    // can still reach this route to add another.
    await page.goto('/dashboard/create-organization');
    await page.waitForURL(CREATE_ORG_URL, { timeout: 120_000 });
    const secondOrgName = `E2E Second ${Date.now().toString(36)}`;
    await runCreateOrgWizard(page, secondOrgName);

    await page.waitForURL(DASHBOARD_ORG_URL, { timeout: 120_000 });
    const secondMatch = DASHBOARD_ORG_URL.exec(page.url());
    const secondOrgId = secondMatch?.[1];
    expect(secondOrgId).toBeTruthy();
    expect(secondOrgId).not.toBe(firstOrgId);

    // Switch back to the FIRST org via the staging route the switcher uses.
    // It performs setActive then lands on that org's dashboard.
    await page.goto(`/dashboard/switching?to=${firstOrgId}`);
    await page.waitForURL(new RegExp(`/dashboard/${firstOrgId}(?:[/?#]|$)`), {
      timeout: 120_000,
    });

    // And switch forward to the SECOND org the same way.
    await page.goto(`/dashboard/switching?to=${secondOrgId ?? ''}`);
    await page.waitForURL(
      new RegExp(`/dashboard/${secondOrgId ?? ''}(?:[/?#]|$)`),
      { timeout: 120_000 },
    );
  });
});
