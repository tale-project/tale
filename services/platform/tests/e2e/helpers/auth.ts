import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { BASE_URL, TIMEOUT } from './env';
import { t } from './i18n';
import { SEEDED_AGENT_DISPLAY_NAME } from './seed';

/**
 * Programmatic account + organization bootstrap against the Better Auth HTTP
 * endpoints, plus the create-org wizard driver. Used by the worker-scoped org
 * fixture (one isolated account+org per worker — see `fixtures.ts`) and by the
 * throwaway-account specs (auth / onboarding / rbac).
 *
 * Sign-up is restricted to the first user ONLY in the UI
 * (`app/routes/_auth/sign-up.tsx` redirects when users exist) —
 * `POST /api/auth/sign-up/email` itself accepts new accounts, which is what
 * makes hermetic per-run / per-worker identities possible.
 */

/** Satisfies the default password policy (length/lower/upper/digit/special). */
export const E2E_PASSWORD = 'TaleE2E!Passw0rd';

interface E2ECredentials {
  email: string;
  password: string;
}

/** Unique per-run identity so re-runs (and parallel workers) never collide. */
export function uniqueCredentials(label: string): E2ECredentials {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e-${label}-${suffix}@tale.test`,
    password: E2E_PASSWORD,
  };
}

/** A fresh-account-resolved URL: either an org dashboard or the create-org wizard. */
const ORG_ID_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;
const RESOLVED_URL = new RegExp(
  `(?:${ORG_ID_URL.source})|/dashboard/create-organization`,
);

/**
 * Create an account via the sign-up endpoint. The session cookie lands in the
 * given request context's cookie jar — pass `context.request` to authenticate
 * the browser context that follows, or a standalone `request` fixture for a
 * throwaway user that must NOT log the current page in.
 */
export async function signUpViaApi(
  request: APIRequestContext,
  credentials: E2ECredentials,
): Promise<void> {
  const response = await request.post('/api/auth/sign-up/email', {
    data: {
      name: credentials.email,
      email: credentials.email,
      password: credentials.password,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Sign-up failed for ${credentials.email}: ${response.status()} ${await response.text()}`,
    );
  }
}

/** Sign in an existing account via the email endpoint (mirrors sign-up). */
export async function signInViaApi(
  request: APIRequestContext,
  credentials: E2ECredentials,
): Promise<void> {
  const response = await request.post('/api/auth/sign-in/email', {
    // Better Auth's sign-in rejects a request with no Origin (CSRF defence);
    // an APIRequestContext from a fresh browser context sends none, so set it
    // explicitly to the trusted base URL.
    headers: { origin: BASE_URL },
    data: { email: credentials.email, password: credentials.password },
  });
  if (!response.ok()) {
    throw new Error(
      `Sign-in failed for ${credentials.email}: ${response.status()} ${await response.text()}`,
    );
  }
}

/**
 * Drive the create-organization wizard to completion and return the new org id.
 * A freshly signed-up user always lands on `/dashboard/create-organization`
 * (`default` is never auto-created); a user who already has an org lands
 * straight on `/dashboard/<orgId>`, in which case the wizard is skipped.
 */
export async function createOrgViaWizard(page: Page): Promise<string> {
  await page.goto('/dashboard');
  await page.waitForURL(RESOLVED_URL, { timeout: TIMEOUT.FIRST_PAINT });

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
    await expect(nextButton).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
    await nextButton.click();

    // Skip the optional provider step, then Finish to the dashboard. Next
    // creates the org (org.create + default-workflow init), which on a cold or
    // loaded backend can take well past the default expect timeout before the
    // provider step (and its Skip button) renders — so wait generously.
    const skipButton = page.getByRole('button', {
      name: t('common.actions.skip'),
      exact: true,
    });
    await expect(skipButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await skipButton.click();

    await page
      .getByRole('button', {
        name: t('onboarding.finish.goToDashboard'),
        exact: true,
      })
      .click();
  }

  await page.waitForURL(ORG_ID_URL, { timeout: TIMEOUT.FIRST_PAINT });
  const organizationId = ORG_ID_URL.exec(page.url())?.[1];
  if (!organizationId) {
    throw new Error(`Could not extract organization id from ${page.url()}`);
  }
  return organizationId;
}

/**
 * Block until the org has finished scaffolding (the Better Auth
 * `afterCreateOrganization` hook copies `fixtures/config/default/` into the new
 * org's config dir asynchronously). Waiting for the seeded agent to appear on
 * the agents page is the deterministic "scaffold complete" gate — chat and
 * automation specs depend on the seeded provider/agent/workflow existing.
 */
export async function waitForSeededOrg(
  page: Page,
  organizationId: string,
): Promise<void> {
  // Target the "All agents" tab (the table), not `/agents` — the latter is now
  // the organigram Overview, whose React-Flow + ELK canvas is far slower and
  // flakier to surface the seeded agent's name than a plain table row.
  await page.goto(`/dashboard/${organizationId}/agents/all`);

  // The agents list loads via a NON-reactive Convex action (`file_actions:
  // listAgents`), so it fires once on mount and never refetches on its own. On
  // a cold backend the first org can scaffold (the async `afterCreateOrganization`
  // hook copying `fixtures/config/default/`) *after* that initial fire, leaving
  // the list empty with nothing to invalidate it — the seeded row then never
  // materializes within a single load. Reload-and-retry so a later attempt
  // re-fires the action once scaffolding has landed, instead of staking the
  // whole suite's bootstrap on winning a cold-start race in one shot.
  const seededRow = page.getByText(SEEDED_AGENT_DISPLAY_NAME).first();
  const ATTEMPTS = 4;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await expect(seededRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) throw err;
      await page.reload();
    }
  }
}
