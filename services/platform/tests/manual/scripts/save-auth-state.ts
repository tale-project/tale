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
  signUpViaApi,
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
  // page.request shares the context cookie jar, so the session the sign-up
  // endpoint creates authenticates the wizard navigation that follows.
  await signUpViaApi(context.request, credentials);
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
