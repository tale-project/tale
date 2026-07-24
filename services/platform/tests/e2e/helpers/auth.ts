import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { BASE_URL, TIMEOUT } from './env';
import { t } from './i18n';
import { SEEDED_PROVIDER_DISPLAY_NAME } from './seed';

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
export async function createOrgViaWizard(
  page: Page,
  options?: { orgName?: string },
): Promise<string> {
  // The wizard's forward actions run through Better Auth endpoints that
  // enforce the trusted-origin (CSRF) check for real browser requests. A
  // rejection leaves the wizard visually stuck with no error the locators can
  // see, so record auth failures and surface the last one if a step times out.
  // (signUpViaApi never trips this: an APIRequestContext sends neither cookies
  // nor Sec-Fetch metadata, which is exactly what arms the check.)
  // Holder object rather than a plain `let`: the value is only ever written
  // inside the response callback, and TS control-flow analysis would narrow a
  // never-reassigned-in-scope local back to its `null` initializer at the
  // read site (→ `never` under restrict-template-expressions).
  const authFailure: { last: string | null } = { last: null };
  const onResponse = (response: {
    url(): string;
    status(): number;
    text(): Promise<string>;
  }): void => {
    if (response.url().includes('/api/auth/') && response.status() >= 400) {
      authFailure.last = `${response.status()} from ${response.url()}`;
      // Body is the actual diagnosis (e.g. INVALID_ORIGIN vs a validation
      // error) — capture it asynchronously, best-effort.
      void response
        .text()
        .then((body) => {
          authFailure.last = `${response.status()} from ${response.url()}: ${body.slice(0, 300)}`;
        })
        .catch(() => {});
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto('/dashboard');
    await page.waitForURL(RESOLVED_URL, { timeout: TIMEOUT.FIRST_PAINT });

    if (page.url().includes('/dashboard/create-organization')) {
      // Same shape as uniqueCredentials: a ms timestamp ALONE collides when
      // parallel workers bootstrap in the same instant, and the org slug
      // derives from the name — a collision 400s the create call.
      const orgName =
        options?.orgName ??
        `E2E Org ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await page
        .getByLabel(t('settings.organization.organizationName'))
        .fill(orgName);

      // Step 1 → Next creates the org and advances to the finish step. (The
      // rewritten wizard is two steps — workspace then finish; the old
      // optional provider/Skip step is gone.)
      const nextButton = page.getByRole('button', {
        name: t('common.actions.next'),
        exact: true,
      });
      await expect(nextButton).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
      await nextButton.click();

      // Finish to the dashboard. Next creates the org (org.create +
      // default-workflow init), which on a cold or loaded backend can take
      // well past the default expect timeout before the finish step (and its
      // "Go to dashboard" button) renders — so wait generously.
      const finishButton = page.getByRole('button', {
        name: t('onboarding.finish.goToDashboard'),
        exact: true,
      });
      try {
        await expect(finishButton).toBeVisible({ timeout: TIMEOUT.EXECUTION });
      } catch (err) {
        if (authFailure.last) {
          throw new Error(
            `Create-organization never advanced past the workspace step — the last auth API failure was ${authFailure.last}. ` +
              `A 403 INVALID_ORIGIN here means the deployment's SITE_URL does not match the app origin (${BASE_URL}), ` +
              `so Better Auth rejects the browser's org-create call. See tests/e2e/README.md ("Running locally").`,
            { cause: err },
          );
        }
        throw err;
      }
      await finishButton.click();
    }

    await page.waitForURL(ORG_ID_URL, { timeout: TIMEOUT.FIRST_PAINT });
    const organizationId = ORG_ID_URL.exec(page.url())?.[1];
    if (!organizationId) {
      throw new Error(`Could not extract organization id from ${page.url()}`);
    }
    return organizationId;
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Block until the org has finished scaffolding (the Better Auth
 * `afterCreateOrganization` hook copies `fixtures/config/default/` into the new
 * org's config dir asynchronously). The deterministic "scaffold complete" gate
 * is the seeded org-custom AI provider appearing on the providers settings
 * page: it is a CUSTOM connector (not a shipped one), so it can only render
 * once the scaffold has copied the fixture — chat and workflow specs depend on
 * that seeded config existing. (The old gate — a seeded roster agent on
 * `/dashboard/{org}/agents` — is gone with the agent roster and its route in
 * the AI-backend rewrite.)
 */
export async function waitForSeededOrg(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/settings/providers`);

  // The providers catalog loads via a NON-reactive Convex action
  // (`listConnectorCatalogs`), so it fires once on mount and never refetches on
  // its own. On a cold backend the first org can scaffold (the async
  // `afterCreateOrganization` hook copying `fixtures/config/default/`) *after*
  // that initial fire, leaving the custom provider absent with nothing to
  // invalidate it — it then never materializes within a single load.
  // Reload-and-retry so a later attempt re-fires the action once scaffolding
  // has landed, instead of staking the whole suite's bootstrap on winning a
  // cold-start race in one shot.
  const seededRow = page
    .getByRole('heading', { name: SEEDED_PROVIDER_DISPLAY_NAME })
    .first();
  // CI cold boot (Convex pre-warm + first push) can exceed 90s before the stack
  // is READY; org scaffold is scheduled immediately after create but still
  // races the first agents-list fetch. Extra reload attempts beat extending
  // VISIBLE, which would slow every assertion in the suite.
  const ATTEMPTS = 8;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await expect(seededRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        // The seeded provider only exists when the stack seeds new orgs from
        // tests/e2e/fixtures/config. The by-far most common way to get here is
        // NOT a slow scaffold but the mock-mode/reuse trap: a dev stack was
        // already serving this port, Playwright reused it
        // (reuseExistingServer), and its orgs seed from THAT stack's config
        // dir — no fixture provider can ever appear. Diagnose instead of
        // leaving bare locator timeouts.
        throw new Error(
          `Seeded provider "${SEEDED_PROVIDER_DISPLAY_NAME}" never appeared for org ${organizationId} at ${BASE_URL}. ` +
            `If a stack was already running on this port, Playwright reused it — with ITS config dir, not the E2E fixtures — ` +
            `and the hermetic mock mode cannot pass against it. Either stop that stack (or run the suite from an isolated ` +
            `worktree on another port) so the suite boots its own, or explicitly target a live stack with E2E_MOCK_LLM=0. ` +
            `If Playwright DID boot this stack itself, org seeding is genuinely broken — check the [WebServer] logs. ` +
            `See tests/e2e/README.md ("Running locally").`,
          { cause: err },
        );
      }
      await page.reload();
    }
  }
}
