/**
 * Write a Playwright `storageState` file so a browser (e.g. the Playwright
 * MCP) can start signed in instead of driving login every session.
 *
 * Two modes:
 * - Default: mint an authenticated owner + fully-seeded organization (reuses
 *   the e2e auth helpers — the canonical, i18n-safe wizard driver — see
 *   `services/platform/tests/e2e/helpers/auth.ts`).
 * - `QA_AUTH_EMAIL` + `QA_AUTH_PASSWORD`: sign in as an EXISTING account
 *   instead, e.g. the `docker:dev` seeded dev login (SETUP.md mode C).
 *
 * Usage (stack already up — see services/platform/tests/manual/SETUP.md):
 *
 *   bunx playwright install chromium            # once
 *   # Mint a fresh owner + seeded org (modes A/B):
 *   bun services/platform/tests/manual/scripts/save-auth-state.ts
 *   # Sign in as an existing account (mode C's seeded dev login):
 *   E2E_BASE_URL=https://localhost \
 *     QA_AUTH_EMAIL=dev@tale.test QA_AUTH_PASSWORD='TaleDev!Passw0rd' \
 *     bun services/platform/tests/manual/scripts/save-auth-state.ts
 *
 * Then point the Playwright MCP at the file by adding to the `playwright` server
 * args in .mcp.json:  --storage-state=.playwright-mcp/auth-state.json
 *
 * Override the output path with QA_STORAGE_STATE and the target with E2E_BASE_URL.
 */

import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';

import {
  createOrgViaWizard,
  uniqueCredentials,
  waitForSeededOrg,
} from '../../e2e/helpers/auth';
import { BASE_URL, TIMEOUT } from '../../e2e/helpers/env';

const OUTPUT_PATH =
  process.env.QA_STORAGE_STATE ?? '.playwright-mcp/auth-state.json';

/** Same shape as the module-private regex in e2e helpers/auth.ts. */
const ORG_ID_URL = /\/dashboard\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

/**
 * POST to a Better Auth endpoint via the BROWSER's own fetch rather than
 * Playwright's APIRequestContext: under the Bun runtime the latter crashes
 * parsing the Set-Cookie response ("/api/... cannot be parsed as a URL"). The
 * in-page fetch sets the session cookie in the browser context natively and
 * sends a same-origin Origin header (Better Auth CSRF defence), authenticating
 * the navigation that follows.
 */
async function postAuthViaPageFetch(
  page: Page,
  path: string,
  body: Record<string, string>,
): Promise<void> {
  const result = await page.evaluate(
    async (args: { path: string; body: Record<string, string> }) => {
      const res = await fetch(args.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args.body),
      });
      return { status: res.status, body: await res.text() };
    },
    { path, body },
  );
  if (result.status >= 400) {
    throw new Error(`${path} failed: ${result.status} ${result.body}`);
  }
}

/**
 * Sign in an existing account and resolve its org id from the dashboard
 * redirect. No `waitForSeededOrg`: that gate waits for the e2e fixture agent,
 * which only exists in mode A orgs — an existing account (e.g. the docker:dev
 * seeded `dev@tale.test`) already owns a fully-provisioned org.
 */
async function signInExisting(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  await page.goto('/log-in');
  await postAuthViaPageFetch(page, '/api/auth/sign-in/email', {
    email,
    password,
  });
  await page.goto('/dashboard');
  await page.waitForURL(ORG_ID_URL, { timeout: TIMEOUT.FIRST_PAINT });
  const organizationId = ORG_ID_URL.exec(page.url())?.[1];
  if (!organizationId) {
    throw new Error(`Could not extract organization id from ${page.url()}`);
  }
  return organizationId;
}

/** Mint a throwaway owner + org via sign-up and the create-org wizard. */
async function signUpFresh(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  await page.goto('/log-in');
  await postAuthViaPageFetch(page, '/api/auth/sign-up/email', {
    name: email,
    email,
    password,
  });
  const organizationId = await createOrgViaWizard(page);
  await waitForSeededOrg(page, organizationId);
  return organizationId;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  // docker:dev (SETUP.md mode C) serves https://localhost with a self-signed
  // cert; a QA storage-state mint never needs certificate validation.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const existingEmail = process.env.QA_AUTH_EMAIL;
  let email: string;
  let organizationId: string;
  if (existingEmail) {
    const password = process.env.QA_AUTH_PASSWORD;
    if (!password) {
      throw new Error('QA_AUTH_EMAIL is set but QA_AUTH_PASSWORD is not');
    }
    email = existingEmail;
    organizationId = await signInExisting(page, email, password);
  } else {
    const credentials = uniqueCredentials('qa-owner');
    email = credentials.email;
    organizationId = await signUpFresh(page, email, credentials.password);
  }

  await context.storageState({ path: OUTPUT_PATH });
  await browser.close();

  console.log(
    `Wrote storageState for ${email} (org ${organizationId}) → ${OUTPUT_PATH}`,
  );
  console.log(
    `Add to .mcp.json playwright args:  --storage-state=${OUTPUT_PATH}`,
  );
}

main().catch((error) => {
  console.error('save-auth-state failed:', error);
  process.exit(1);
});
