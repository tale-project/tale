import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';

import {
  createOrgViaWizard,
  signUpViaApi,
  uniqueCredentials,
  waitForSeededOrg,
} from './auth';
import { BASE_URL } from './env';

/**
 * Worker-scoped isolated-org fixture — the linchpin of the parallel suite.
 *
 * The old suite shared ONE owner account + ONE org across every spec (a global
 * `setup` project + `owner.json` storageState), which forced `workers: 1` /
 * `fullyParallel: false`: concurrent specs would have corrupted each other's
 * org state. Here each Playwright WORKER mints its own account + org once (via
 * the sign-up endpoint + create-org wizard) and blocks until the backend's
 * async post-create seeding (the "Getting started" starter project) has
 * landed, then every test in that worker runs authenticated against that
 * worker's private org. N workers get N identical, isolated orgs with zero
 * per-test setup — so `fullyParallel: true` is safe and the cross-spec
 * shared-state flakiness is gone at the root.
 *
 * Specs that need NO org (auth / onboarding / the wizard-focus keyboard test)
 * import the BASE `test` from `@playwright/test` with an empty storageState
 * instead of this one, so they never trigger the worker bootstrap.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(dirname, '..', '.auth');

interface WorkerOrg {
  organizationId: string;
  ownerEmail: string;
  storageStatePath: string;
}

interface WorkerFixtures {
  workerOrg: WorkerOrg;
}

interface TestFixtures {
  /** The current worker's isolated, fully-seeded organization. */
  org: { organizationId: string; ownerEmail: string };
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerOrg: [
    // The fixture-provider callback is named `provide` (not Playwright's
    // conventional `use`) so oxlint's react-hooks rule doesn't mistake it for
    // React 19's `use()` hook inside these async fixtures.
    async ({ browser }, provide, workerInfo) => {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      const credentials = uniqueCredentials(
        `owner-w${workerInfo.parallelIndex}`,
      );

      // page.request shares the context cookie jar, so the session created by
      // the sign-up endpoint authenticates the wizard navigation that follows.
      await signUpViaApi(context.request, credentials);
      const organizationId = await createOrgViaWizard(page);
      await waitForSeededOrg(page, organizationId);

      mkdirSync(AUTH_DIR, { recursive: true });
      const storageStatePath = path.join(
        AUTH_DIR,
        `owner-w${workerInfo.parallelIndex}.json`,
      );
      await context.storageState({ path: storageStatePath });
      await context.close();

      await provide({
        organizationId,
        ownerEmail: credentials.email,
        storageStatePath,
      });
    },
    { scope: 'worker' },
  ],

  // Override Playwright's built-in storageState option so every test in a
  // worker authenticates as that worker's owner.
  storageState: async ({ workerOrg }, provide) => {
    await provide(workerOrg.storageStatePath);
  },

  org: async ({ workerOrg }, provide) => {
    await provide({
      organizationId: workerOrg.organizationId,
      ownerEmail: workerOrg.ownerEmail,
    });
  },
});

export { expect };
