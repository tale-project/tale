import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';

/**
 * Onboarding wizard coverage. Every test runs unauthenticated (empty
 * storageState) with a per-test throwaway account so it never collides with
 * the shared owner session.
 *
 * What the in-app onboarding solution does, and where each part is exercised:
 *
 *  - Route gating — first-run setup (`/setup`) and add-org
 *    (`/dashboard/create-organization`) are reachable only in the right auth
 *    state. The setup project already created an owner, so this install has
 *    users: anonymous visitors are bounced to `/log-in`, while an authenticated
 *    user with no org is routed past `/setup` into the org wizard.
 *  - Workspace step — organization-name validation (invalid characters, the
 *    reserved `default` slug), the live identifier (slug) preview, the
 *    workspace-language picker, and idempotent org creation that survives
 *    stepping back into the step.
 *  - Provider step — the optional OpenRouter connect: skippable, and links out
 *    to the key page. (The key-submission path needs the live OpenRouter API,
 *    so it stays out of this hermetic suite.)
 *  - Finish step — the what's-next checklist, then "Go to dashboard" lands on
 *    the freshly created org dashboard.
 *
 * The wizard's pure mechanics (Next/Back/Skip/validity gating) are unit-tested
 * in `app/components/ui/wizard/wizard.test.tsx`; these specs cover the wired-up
 * integration against the real routes, auth, and Convex backend.
 *
 * The genuine first-run walk (`/setup` with NO users → in-place account
 * creation) can't run here: the shared backend always has the owner the setup
 * project created, so `/setup` redirects away. The account step is left to its
 * own component coverage and the standalone sign-up route.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const ORG_ID_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;
const LOGIN_URL = /\/log-in(?:[/?#]|$)/;
const CREATE_ORG_URL = /\/dashboard\/create-organization(?:[/?#]|$)/;

test.describe('onboarding wizard', () => {
  test('redirects anonymous visitors away from the setup and create-organization routes', async ({
    page,
  }) => {
    // The setup project created an owner, so this install already has users.
    // First-run setup is owner-only — an anonymous visitor is sent to log in.
    await page.goto('/setup');
    await page.waitForURL(LOGIN_URL, { timeout: 120_000 });
    expect(LOGIN_URL.test(page.url())).toBe(true);

    // Spinning up another organization also requires an authenticated session.
    await page.goto('/dashboard/create-organization');
    await page.waitForURL(LOGIN_URL, { timeout: 120_000 });
    expect(LOGIN_URL.test(page.url())).toBe(true);
  });

  test('user creates a workspace through the wizard and reaches the dashboard', async ({
    page,
  }) => {
    const credentials = uniqueCredentials('onboarding');
    // page.request shares the browser cookie jar, so this also logs the page in.
    await signUpViaApi(page.request, credentials);

    // An authenticated user with no org is routed past `/setup` (this install
    // already has an owner) straight into the org-creation wizard.
    await page.goto('/setup');
    await page.waitForURL(CREATE_ORG_URL, { timeout: 120_000 });

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

    // A valid name clears the error, previews the derived identifier (slug),
    // surfaces the workspace-language picker, and enables Next.
    await nameField.fill('Acme QA');
    await expect(
      page.getByText(
        t('settings.organization.identifierPreview').replace(
          '{slug}',
          'acme-qa',
        ),
      ),
    ).toBeVisible();
    await expect(
      page.getByText(t('onboarding.workspace.languageDescription')),
    ).toBeVisible();
    await expect(next).toBeEnabled();

    // Switch to a unique name so the derived slug never collides on re-runs,
    // then create the workspace.
    const orgName = `E2E Onboarding ${Date.now().toString(36)}`;
    await nameField.fill(orgName);
    await expect(next).toBeEnabled();
    await next.click();

    // Org created → advanced to the optional provider step (so Back appears).
    const back = page.getByRole('button', {
      name: t('common.actions.back'),
      exact: true,
    });
    await expect(back).toBeVisible();

    // Stepping back is idempotent: the org already exists, so the name field is
    // locked (and keeps its value) rather than offering a second workspace.
    await back.click();
    await expect(nameField).toBeDisabled();
    await expect(nameField).toHaveValue(orgName);
    await expect(next).toBeEnabled();
    await next.click(); // forward to the provider step again — no re-create

    // Provider step: an optional OpenRouter connect that links out to the keys
    // page so a first-time user can grab a key without leaving the flow.
    await expect(
      page.getByRole('heading', { name: t('onboarding.provider.heading') }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: t('onboarding.provider.getKeyLink') }),
    ).toHaveAttribute('href', 'https://openrouter.ai/keys');

    const skip = page.getByRole('button', {
      name: t('common.actions.skip'),
      exact: true,
    });
    await expect(skip).toBeVisible();
    await skip.click(); // provider → finish

    // Finish step: the what's-next checklist, then off to the dashboard.
    await expect(
      page.getByRole('heading', { name: t('onboarding.finish.heading') }),
    ).toBeVisible();
    await expect(
      page.getByText(t('onboarding.finish.providerItem')),
    ).toBeVisible();

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
