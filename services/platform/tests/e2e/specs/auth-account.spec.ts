import { expect, test, type Page } from '@playwright/test';

import {
  createOrgViaWizard,
  signUpViaApi,
  uniqueCredentials,
} from '../helpers/auth';
import { ENTITY_ID, ORG_DASHBOARD_URL, TIMEOUT } from '../helpers/env';
import { t } from '../helpers/i18n';
import { generateTotp } from '../helpers/totp';

/**
 * Auth depth: logout, change-password, the full 2FA loop, and org switching.
 *
 * Every test runs UNAUTHENTICATED (empty storageState) with its own throwaway
 * account, because each flow mutates session/password/2FA/membership state that
 * must never touch a worker's owner session. The suite never deletes anything;
 * unique emails keep re-runs collision-free.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const LOGIN_URL = /\/log-in(?:[/?#]|$)/;
const TWO_FA_URL = /\/2fa(?![-\w])/;
/**
 * Drive the add-org wizard for a user who ALREADY has an organization, and
 * return the new org id.
 *
 * `createOrgViaWizard` (helpers/auth) can't do this: it enters via `/dashboard`,
 * which for an existing user resolves straight to their current org (the wizard
 * is only reached on the zero-org redirect), so it would return the SAME org.
 * The `/dashboard/create-organization` route, by contrast, is reachable
 * directly by any authenticated user (its guard only bounces anonymous
 * visitors) and renders the same workspace → provider → finish wizard in
 * `add-org` mode, so we replicate the helper's step-driving here against it.
 */
async function createAdditionalOrgViaWizard(page: Page): Promise<string> {
  await page.goto('/dashboard/create-organization');

  const orgName = `E2E Org ${Date.now().toString(36)}`;
  await page
    .getByLabel(t('settings.organization.organizationName'))
    .fill(orgName);

  // Step 1 → Next creates the org and advances to the provider step.
  const nextButton = page.getByRole('button', {
    name: t('common.actions.next'),
    exact: true,
  });
  await expect(nextButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await nextButton.click();

  // Finish to the dashboard. The rewritten wizard is two steps (workspace
  // then finish); the old optional provider/Skip step is gone.
  await page
    .getByRole('button', {
      name: t('onboarding.finish.goToDashboard'),
      exact: true,
    })
    .click();

  await page.waitForURL(ORG_DASHBOARD_URL, { timeout: TIMEOUT.FIRST_PAINT });
  const organizationId = ORG_DASHBOARD_URL.exec(page.url())?.[1];
  if (!organizationId) {
    throw new Error(`Could not extract organization id from ${page.url()}`);
  }
  return organizationId;
}

/**
 * Sign up a throwaway account ON the browser context (page.request shares the
 * cookie jar, so the page is logged in too), then drive the wizard to an org.
 */
async function signUpAndCreateOrg(
  page: Page,
  label: string,
): Promise<{ email: string; password: string; organizationId: string }> {
  const credentials = uniqueCredentials(label);
  await signUpViaApi(page.request, credentials);
  const organizationId = await createOrgViaWizard(page);
  return { ...credentials, organizationId };
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
    await signUpAndCreateOrg(page, 'logout');

    // The account-menu trigger is a button labelled with the "Manage account"
    // copy (the UserCircle icon is decorative). Both the desktop sidebar and the
    // `md:hidden` mobile-header instances render it, so `.first()` picks the one
    // in the a11y tree at this viewport.
    await page
      .getByRole('button', { name: t('auth.userButton.manageAccount') })
      .first()
      .click();

    // The log-out item opens a confirmation dialog rather than signing out.
    await page
      .getByRole('menuitem', { name: t('auth.userButton.logOut') })
      .click();

    // Both the menu item and the confirm button read "Log out", so scope the
    // confirm to the dialog.
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
    await page.waitForURL(LOGIN_URL, { timeout: TIMEOUT.NAV });
  });
});

test.describe('change password', () => {
  test('changes the password and logs back in with the new one', async ({
    page,
  }) => {
    const { email, password, organizationId } = await signUpAndCreateOrg(
      page,
      'change-password',
    );
    const newPassword = `${password}-Rotated1`;

    await page.goto(`/dashboard/${organizationId}/settings/account`);

    // The section trigger and the dialog submit both read "Change password";
    // open via the page-level button, submit via the dialog-scoped one.
    await page
      .getByRole('button', {
        name: t('auth.changePassword.title'),
        exact: true,
      })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
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

    // A successful change signs the user out and hard-navigates to `/` →
    // login (no success toast by design — the session is invalidated). That
    // redirect is the proof the mutation succeeded.
    await page.waitForURL(LOGIN_URL, { timeout: TIMEOUT.NAV });

    // Prove the new password took: it logs in and reaches a dashboard.
    await logInViaUi(page, email, newPassword);
    await page.waitForURL(/\/dashboard/, { timeout: TIMEOUT.FIRST_PAINT });
  });
});

test.describe('two-factor authentication', () => {
  test('enrolls with a generated TOTP code, then passes the sign-in challenge', async ({
    page,
  }) => {
    const { email, password } = await signUpAndCreateOrg(page, 'twofa');

    // The standalone enrollment wall requires an active session (its
    // beforeLoad bounces anonymous visitors to /log-in) — we have one.
    await page.goto('/2fa-enroll');
    await expect(
      page.getByRole('heading', { name: t('twoFactor.enroll.title') }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // Confirm the account password to begin enrollment — the real
    // `twoFactor.enable` round-trip, which returns the otpauth secret.
    const enableButton = page.getByRole('button', {
      name: t('twoFactor.enrollment.enableButton'),
      exact: true,
    });
    await page
      .getByLabel(t('twoFactor.confirmPassword.label'), { exact: true })
      .fill(password);
    await enableButton.click();

    // Verify step: the manual-entry secret is rendered in a copyable field
    // (a button) labelled by the manual-entry hint. The button's visible text
    // is the secret itself (the label lives in a sibling <label> referenced via
    // aria-labelledby). Read it and derive a live TOTP code.
    await expect(page.getByText(t('twoFactor.setup.manualEntry'))).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
    const secret = (
      await page
        .getByRole('button', { name: t('twoFactor.setup.manualEntry') })
        .innerText()
    ).trim();
    expect(secret, 'the enroll page should reveal the base32 secret').toMatch(
      /^[A-Z2-7]+$/,
    );

    const codeInput = page.getByLabel(t('twoFactor.setup.verifyCodeLabel'));
    const verifyButton = page.getByRole('button', {
      name: t('twoFactor.setup.verifyButton'),
      exact: true,
    });

    // A code generated near a 30s boundary can land in the wrong window;
    // regenerate per attempt until `verifyTotp` succeeds — which enables 2FA
    // server-side and swaps the verify form for the backup-codes view.
    await expect(async () => {
      await codeInput.fill(generateTotp(secret));
      await verifyButton.click();
      await expect(
        page.getByText(t('twoFactor.backupCodes.title')),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    }).toPass({ timeout: TIMEOUT.PERSIST });

    // Drop the session so the next sign-in hits the challenge (sign-out is a
    // programmatic POST in-app; clearing the context cookies is the hermetic
    // equivalent and avoids depending on a GET sign-out route).
    await page.context().clearCookies();

    // Password sign-in now redirects to the /2fa challenge instead of the
    // dashboard.
    await logInViaUi(page, email, password);
    await page.waitForURL(TWO_FA_URL, { timeout: TIMEOUT.NAV });
    await expect(
      page.getByRole('heading', { name: t('twoFactor.verify.title') }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Enter a fresh code at the challenge (input id "two-factor-code"); retry
    // across the boundary, then assert we reached the dashboard.
    const challengeInput = page.locator('#two-factor-code');
    const challengeSubmit = page.getByRole('button', {
      name: t('twoFactor.verify.submitButton'),
      exact: true,
    });
    await expect(async () => {
      await challengeInput.fill(generateTotp(secret));
      await challengeSubmit.click();
      await page.waitForURL(/\/dashboard/, { timeout: TIMEOUT.NAV });
    }).toPass({ timeout: TIMEOUT.PERSIST });
  });
});

test.describe('organization switching', () => {
  test('switches between two orgs and keeps project data isolated', async ({
    page,
  }) => {
    const { organizationId: orgA } = await signUpAndCreateOrg(
      page,
      'org-switch',
    );

    // Create a project (unique name) inside org A.
    const projectName = `E2E Isolation ${Date.now().toString(36)}`;
    await page.goto(`/dashboard/${orgA}/projects`);
    const createButton = page
      .getByRole('button', { name: t('projects.list.createButton') })
      .first();
    await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await createButton.click();

    const createDialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await createDialog
      .getByRole('textbox', { name: t('projects.create.nameLabel') })
      .fill(projectName);
    await createDialog
      .getByRole('button', { name: t('projects.create.submit') })
      .click();
    await page.waitForURL(
      new RegExp(`/dashboard/${orgA}/projects/${ENTITY_ID}`),
      { timeout: TIMEOUT.NAV },
    );
    // Create lands on the project's Tasks tab, which no longer renders the
    // project's own name heading (the breadcrumb's level-1 heading wraps the
    // name in the project-switcher button, so its accessible name is LONGER
    // than the bare project name). General holds the Name field, and that
    // field carrying the typed name is the stable proof the project exists
    // and is visible in org A.
    const projectId = new RegExp(`/projects/(${ENTITY_ID})`).exec(
      page.url(),
    )?.[1];
    expect(projectId, 'a project id should appear in the URL').toBeTruthy();
    await page.goto(`/dashboard/${orgA}/projects/${projectId}/overview`);
    await expect(
      page.getByRole('textbox', {
        name: t('projects.settings.name'),
        exact: true,
      }),
    ).toHaveValue(projectName, {
      timeout: TIMEOUT.VISIBLE,
    });

    // Create a SECOND org (a user who already has one can still reach the
    // create-organization route to add another), landing on org B's dashboard.
    const orgB = await createAdditionalOrgViaWizard(page);
    expect(orgB).not.toBe(orgA);

    // Data isolation: org B's projects list must not contain org A's project.
    await page.goto(`/dashboard/${orgB}/projects`);
    await expect(
      page
        .getByRole('button', { name: t('projects.list.createButton') })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(page.getByText(projectName)).toHaveCount(0, {
      timeout: TIMEOUT.VISIBLE,
    });

    // Switch back to org A via the staging route the switcher uses, and confirm
    // the project is present there.
    await page.goto(`/dashboard/switching?to=${orgA}`);
    await page.waitForURL(new RegExp(`/dashboard/${orgA}(?:[/?#]|$)`), {
      timeout: TIMEOUT.NAV,
    });
    await page.goto(`/dashboard/${orgA}/projects`);
    // On the projects list the project surfaces as a table row; its name cell
    // is the stable, visible target (a bare `getByText` could match an
    // off-screen/clipped node).
    await expect(page.getByRole('cell', { name: projectName })).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  });
});
