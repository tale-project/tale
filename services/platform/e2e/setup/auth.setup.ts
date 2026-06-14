import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test as setup } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';
import {
  AUTH_DIR,
  CONTEXT_PATH,
  STORAGE_STATE_PATH,
  type E2ERunContext,
} from '../helpers/test-context';

/**
 * Auth setup project: creates a fresh per-run account via the sign-up
 * endpoint (see helpers/auth.ts), completes first-run setup through the
 * onboarding wizard, and persists the session (`owner.json` storageState)
 * plus the organization id (`context.json`) for the chromium specs.
 *
 * Fresh users always land on `/dashboard/create-organization` (the onboarding
 * wizard) — `default` is never auto-created. The wizard creates the org on the
 * first "Next", then the optional provider step is skipped and "Finish"
 * navigates to `/dashboard/<orgId>`. A user who already has an org (local
 * re-run) lands straight on `/dashboard/<orgId>`.
 */

const ORG_ID_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;
const RESOLVED_URL = new RegExp(
  `(?:${ORG_ID_URL.source})|/dashboard/create-organization`,
);

setup('create owner account and organization', async ({ page }) => {
  const credentials = uniqueCredentials('owner');

  // page.request shares the browser context's cookie jar, so the session
  // created by the sign-up endpoint authenticates the page that follows.
  await signUpViaApi(page.request, credentials);

  await page.goto('/dashboard');
  await page.waitForURL(RESOLVED_URL, { timeout: 120_000 });

  if (page.url().includes('/dashboard/create-organization')) {
    const orgName = `E2E Org ${Date.now().toString(36)}`;
    await page
      .getByLabel(t('settings.organization.organizationName'))
      .fill(orgName);

    // Step 1 → Next creates the org and advances to the provider step.
    const nextButton = page.getByRole('button', {
      name: t('common.actions.next'),
      exact: true,
    });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // Skip the optional provider step, then Finish to the dashboard.
    const skipButton = page.getByRole('button', {
      name: t('common.actions.skip'),
      exact: true,
    });
    await expect(skipButton).toBeVisible();
    await skipButton.click(); // provider → finish

    await page
      .getByRole('button', {
        name: t('onboarding.finish.goToDashboard'),
        exact: true,
      })
      .click();
  }

  await page.waitForURL(ORG_ID_URL, { timeout: 120_000 });
  const match = ORG_ID_URL.exec(page.url());
  if (!match?.[1]) {
    throw new Error(`Could not extract organization id from ${page.url()}`);
  }

  mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  const context: E2ERunContext = {
    organizationId: match[1],
    ownerEmail: credentials.email,
  };
  writeFileSync(CONTEXT_PATH, `${JSON.stringify(context, null, 2)}\n`);
});
