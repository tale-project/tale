/** Shared synthetic workspace/session setup for docs screenshots and marketing motion. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Browser, type Page } from '@playwright/test';

import { createOrgViaWizard } from '../e2e/helpers/auth';
import { BASE_URL, TIMEOUT } from '../e2e/helpers/env';
import { signUpOrIn } from './capture-auth';
import { DEMO_ORG_NAME, DEMO_OWNER } from './demo-content';
import type { ShotContext } from './manifest';
import { seedDemoOrg } from './seed-demo-org';

export interface OrgState {
  orgId: string;
  email: string;
  threads: Record<string, string>;
  projects: Record<string, string>;
}

export function captureRuntime(options: {
  stateDir: string;
  configDir?: string;
}) {
  const STATE_DIR = options.stateDir;
  const AUTH_STATE = path.join(STATE_DIR, 'auth.json');
  const ORG_STATE = path.join(STATE_DIR, 'org.json');
  const VIEWPORT = { width: 1440, height: 900 };
  const MOCK_GATEWAY_URL =
    process.env.TALE_MOCK_CONNECTORS_BASE ?? 'http://127.0.0.1:4141';
  const ARGS = { configDir: options.configDir };
  async function preflight(): Promise<void> {
    const checks: Array<[string, string]> = [
      [`${MOCK_GATEWAY_URL}/health`, 'mock gateway'],
      [BASE_URL, 'platform app'],
    ];
    for (const [url, label] of checks) {
      try {
        const res = await fetch(url);
        if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        console.error(
          `Preflight failed: the ${label} is not reachable at ${url} (${String(error)}).\n\n` +
            `Start the mock gateway and platform with the database and object store available.\n` +
            `See tests/docs-screenshots/README.md for the full runbook.`,
        );
        throw error;
      }
    }
  }

  function readOrgState(): OrgState | null {
    if (!existsSync(AUTH_STATE) || !existsSync(ORG_STATE)) return null;
    try {
      return JSON.parse(readFileSync(ORG_STATE, 'utf8')) as OrgState;
    } catch (error) {
      console.warn('Discarding unreadable org state:', error);
      return null;
    }
  }

  /**
   * Block until the demo org has finished scaffolding. The e2e helper's
   * waitForSeededOrg waits for the E2E fixture agent, which this stack never
   * seeds. The "scaffold complete" marker is the seeded automation packs on the
   * Automations page — provisioning writes them at org creation, so a listed
   * pack row means the org's catalog scaffold ran. Navigate-and-retry so a page
   * that loaded before provisioning finished gets a fresh read.
   */
  async function waitForDemoScaffold(
    page: Page,
    organizationId: string,
  ): Promise<void> {
    const packRow = page
      .getByText('gmail-triage-inbox', { exact: true })
      .first();
    const ATTEMPTS = 8;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        // The navigation belongs INSIDE the retry: a cold Vite re-optimizes
        // dependencies on the first visits and reloads the page mid-load, which
        // surfaces as net::ERR_ABORTED on the goto itself.
        await page.goto(`/dashboard/${organizationId}/automations`);
        await expect(packRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
        return;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          throw new Error(
            `The seeded automation packs never appeared for org ${organizationId} at ${BASE_URL}. ` +
              `The stack must run with TALE_CONFIG_BUILTIN_DIR pointing at tests/e2e/fixtures/config/docs-demo ` +
              `(see tests/docs-screenshots/README.md).`,
            { cause: err },
          );
        }
      }
    }
  }

  /**
   * The persisted session dies while `.state/` lives on — the deployment's idle
   * timeout signs the demo owner out between runs, and a backend restarted with
   * another secret rejects the cookie outright. Probe it before reusing the
   * state and sign back in when it is gone; otherwise every stage that follows
   * meets the login screen and fails on a locator that was never the problem.
   */
  async function ensureSignedIn(browser: Browser): Promise<void> {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: AUTH_STATE,
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await page.goto('/log-in');
      const status = await page.evaluate(
        async () => (await fetch('/api/app/users/me')).status,
      );
      if (status === 200) return;
      console.log(
        `Stored session rejected (HTTP ${status}) — signing ${DEMO_OWNER.email} back in.`,
      );
      await signUpOrIn(context);
      await context.storageState({ path: AUTH_STATE });
    } finally {
      await context.close();
    }
  }

  async function bootstrap(
    browser: Browser,
    skipSeed: boolean,
  ): Promise<OrgState> {
    const cached = readOrgState();
    if (cached) {
      console.log(
        `Reusing demo org ${cached.orgId} (${cached.email}) from ${STATE_DIR}`,
      );
      await ensureSignedIn(browser);
      return cached;
    }

    console.log('Bootstrapping the demo workspace…');
    const context = await browser.newContext({
      baseURL: BASE_URL,
      serviceWorkers: 'block',
    });
    try {
      await signUpOrIn(context);
      const page = await context.newPage();
      const orgId = await createOrgViaWizard(page, { orgName: DEMO_ORG_NAME });
      await waitForDemoScaffold(page, orgId);

      mkdirSync(STATE_DIR, { recursive: true });
      await context.storageState({ path: AUTH_STATE });
      const state: OrgState = {
        orgId,
        email: DEMO_OWNER.email,
        threads: {},
        projects: {},
      };
      writeFileSync(ORG_STATE, JSON.stringify(state, null, 2));
      if (skipSeed) {
        console.warn(
          'Fresh org with --skip-seed: shots needing seeds will fail.',
        );
      }
      return state;
    } finally {
      await context.close();
    }
  }

  async function seed(browser: Browser, state: OrgState): Promise<OrgState> {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: AUTH_STATE,
      viewport: VIEWPORT,
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      const ids = await seedDemoOrg(page, state.orgId, {
        configDir: ARGS.configDir ?? undefined,
      });
      const next: OrgState = {
        ...state,
        threads: Object.fromEntries(ids.threads),
        projects: Object.fromEntries(ids.projects),
      };
      writeFileSync(ORG_STATE, JSON.stringify(next, null, 2));
      return next;
    } finally {
      await context.close();
    }
  }

  function toContext(state: OrgState): ShotContext {
    return {
      orgId: state.orgId,
      threads: new Map(Object.entries(state.threads)),
      projects: new Map(Object.entries(state.projects)),
    };
  }

  return { preflight, bootstrap, seed, toContext, authState: AUTH_STATE };
}
