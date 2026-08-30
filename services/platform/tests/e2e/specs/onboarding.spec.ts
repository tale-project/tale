import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { ENTITY_ID, TIMEOUT } from '../helpers/env';
import { t } from '../helpers/i18n';

/**
 * Create-organization wizard, run unauthenticated with a throwaway account.
 * Covers workspace-name validation, the slug preview, idempotent Back-nav, the
 * skippable provider step, and Finish landing on the new org dashboard.
 *
 * The genuine first-run `/setup` walk (zero global users → in-place account
 * creation) is unreachable here: the shared hermetic backend always already has
 * orgs/users, so `/setup` routes an authenticated, org-less user straight into
 * this wizard. The account step is left to its own component coverage.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const ORG_ID_URL = new RegExp(`/dashboard/(${ENTITY_ID})(?:[/?#]|$)`);
const LOGIN_URL = /\/log-in(?:[/?#]|$)/;
const CREATE_ORG_URL = /\/dashboard\/create-organization(?:[/?#]|$)/;

test.describe('onboarding wizard', () => {
  test('redirects anonymous visitors away from the setup and create-organization routes', async ({
    page,
  }) => {
    // The setup project created an owner, so this install already has users.
    // First-run setup is owner-only — an anonymous visitor is sent to log in.
    await page.goto('/setup');
    await page.waitForURL(LOGIN_URL, { timeout: TIMEOUT.FIRST_PAINT });
    await expect(page).toHaveURL(LOGIN_URL);

    // Spinning up another organization also requires an authenticated session.
    await page.goto('/dashboard/create-organization');
    await page.waitForURL(LOGIN_URL, { timeout: TIMEOUT.FIRST_PAINT });
    await expect(page).toHaveURL(LOGIN_URL);
  });

  test('user creates a workspace through the wizard and reaches the dashboard', async ({
    page,
  }) => {
    const credentials = uniqueCredentials('onboarding');
    // page.request shares the browser cookie jar, so this also logs the page in.
    await signUpViaApi(page.request, credentials);

    // An authenticated, org-less user is routed past `/setup` into the wizard.
    await page.goto('/setup');
    await page.waitForURL(CREATE_ORG_URL, { timeout: TIMEOUT.FIRST_PAINT });

    const nameField = page.getByLabel(
      t('settings.organization.organizationName'),
    );
    const next = page.getByRole('button', {
      name: t('common.actions.next'),
      exact: true,
    });

    // Invalid characters are rejected with the character-set hint.
    await nameField.fill('Acme!');
    await expect(
      page.getByText(t('settings.organization.companyNameCharacterError')),
    ).toBeVisible();
    await expect(next).toBeDisabled();

    // "default" is reserved — Next stays disabled and the reserved error shows.
    await nameField.fill('default');
    await expect(
      page.getByText(t('settings.organization.nameReserved')),
    ).toBeVisible();
    await expect(next).toBeDisabled();

    // A valid name clears the error and enables Next. (The slug preview and
    // the field descriptions were intentionally removed in the wizard UX
    // refinement — #1903 — so they are no longer asserted here.)
    await nameField.fill('Acme QA');
    await expect(next).toBeEnabled();

    // A unique name so the derived slug never collides on re-runs, then create.
    const orgName = `E2E Onboarding ${Date.now().toString(36)}`;
    await nameField.fill(orgName);
    await expect(next).toBeEnabled();
    await next.click();

    // Org created → advanced to the finish step (so Back appears). The
    // rewritten wizard is two steps: the optional provider step is gone —
    // connecting a provider is now a finish-step CTA.
    const back = page.getByRole('button', {
      name: t('common.actions.back'),
      exact: true,
    });
    await expect(back).toBeVisible();

    // Stepping back is idempotent: the org exists, so the name field is locked
    // (and keeps its value) rather than offering a second workspace.
    await back.click();
    await expect(nameField).toBeDisabled();
    await expect(nameField).toHaveValue(orgName);
    await expect(next).toBeEnabled();
    await next.click(); // forward to the finish step again — no re-create

    // Finish step: the what's-next checklist, then off to the dashboard.
    await expect(
      page.getByRole('heading', { name: t('onboarding.finish.heading') }),
    ).toBeVisible();
    // Assert the checklist body rendered (not just the hero heading) via a
    // state-independent item. The provider row flips to "connected" whenever the
    // org has a keyed provider, and the E2E builtin-config seeds a mock provider
    // whose key is set — so `providerItem` never shows here; the invite row always
    // renders as a pending next step. (The provider-connected vs CTA branching is
    // unit-tested in finish-step.test.tsx.)
    await expect(
      page.getByText(t('onboarding.finish.inviteItem')),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: t('onboarding.finish.goToDashboard'),
        exact: true,
      })
      .click();

    await page.waitForURL(ORG_ID_URL, { timeout: TIMEOUT.FIRST_PAINT });
  });
});
