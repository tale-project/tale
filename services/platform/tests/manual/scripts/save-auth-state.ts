/**
 * Mint an authenticated owner + fully-seeded organization and write a Playwright
 * `storageState` file, so a browser (e.g. the Playwright MCP) can start signed
 * in instead of driving login every session.
 *
 * Reuses the e2e auth helpers (the canonical, i18n-safe wizard driver) rather
 * than re-implementing sign-up — see `services/platform/tests/e2e/helpers/auth.ts`.
 *
 * Usage (stack already up on :3000 — see services/platform/tests/manual/SETUP.md):
 *
 *   bunx playwright install chromium            # once
 *   bun services/platform/tests/manual/scripts/save-auth-state.ts
 *
 * Then point the Playwright MCP at the file by adding to the `playwright` server
 * args in .mcp.json:  --storage-state=.playwright-mcp/auth-state.json
 *
 * Override the output path with QA_STORAGE_STATE and the target with E2E_BASE_URL.
 */

import { chromium } from '@playwright/test';

import {
  createOrgViaWizard,
  uniqueCredentials,
  waitForSeededOrg,
} from '../../e2e/helpers/auth';
import { BASE_URL } from '../../e2e/helpers/env';

const OUTPUT_PATH =
  process.env.QA_STORAGE_STATE ?? '.playwright-mcp/auth-state.json';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  const credentials = uniqueCredentials('qa-owner');
  // Sign up via the BROWSER's own fetch rather than Playwright's
  // APIRequestContext: under the Bun runtime the latter crashes parsing the
  // Set-Cookie response ("/api/... cannot be parsed as a URL"). The in-page
  // fetch sets the session cookie in the browser context natively and sends a
  // same-origin Origin header (Better Auth CSRF defence), authenticating the
  // wizard navigation that follows.
  await page.goto('/log-in');
  const signup = await page.evaluate(async (creds) => {
    const res = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: creds.email,
        email: creds.email,
        password: creds.password,
      }),
    });
    return { status: res.status, body: await res.text() };
  }, credentials);
  if (signup.status >= 400) {
    throw new Error(
      `Sign-up failed for ${credentials.email}: ${signup.status} ${signup.body}`,
    );
  }
  const organizationId = await createOrgViaWizard(page);
  await waitForSeededOrg(page, organizationId);

  await context.storageState({ path: OUTPUT_PATH });
  await browser.close();

  console.log(
    `Wrote storageState for ${credentials.email} (org ${organizationId}) → ${OUTPUT_PATH}`,
  );
  console.log(
    `Add to .mcp.json playwright args:  --storage-state=${OUTPUT_PATH}`,
  );
}

main().catch((error) => {
  console.error('save-auth-state failed:', error);
  process.exit(1);
});
