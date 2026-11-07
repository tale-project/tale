import { test as base, expect } from '@playwright/test';

import { addressOf, type E2eServerAddress } from '../servers.ts';
import { AppApi } from './api';
import { Control } from './control';
import { PLAN } from './env';

interface Fixtures {
  /** The fakes behind the server: faults, scripted exit IPs, what the fake browser was told. */
  control: Control;
  /** The manager's API, after it was reset: every spec starts from an empty one. */
  api: AppApi;
  /** Nothing to use: it makes `api` run before every spec, asked for or not. */
  emptyManager: void;
}

interface WorkerFixtures {
  /**
   * The server of this worker: `parallelIndex` `i` talks to backend port
   * `E2E_BACKEND_PORT + i` and control port `E2E_CONTROL_PORT + i`, which no
   * other worker uses. A spec that needs an address (the `Host` and `Origin`
   * checks) reads it here and never computes a port.
   */
  server: E2eServerAddress;
}

/**
 * The suite runs one isolated server per worker (`tests/e2e/launcher.ts`), so
 * every spec starts by emptying ITS server (sessions, proxies, secrets and
 * settings), withdrawing the faults of the one before, and builds the scene it
 * needs through `api` and `control`. `baseURL` is the worker's server, which
 * is what the `page` and `context` fixtures, the `request` fixture and every
 * context a spec makes itself (`browser.newContext()`) open relative addresses
 * against.
 */
export const test = base.extend<Fixtures, WorkerFixtures>({
  // The callbacks are named `provide`, not Playwright's `use`: oxlint's
  // react-hooks rule would take `use(...)` for React's hook.
  server: [
    // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads the fixtures a function needs from this pattern, and it must be an object pattern even when it needs none
    async ({}, provide, workerInfo) => {
      await provide(addressOf(PLAN, workerInfo.parallelIndex));
    },
    { scope: 'worker' },
  ],
  // With `E2E_BASE_URL` (a Vite dev server in front of the one backend) the
  // page is opened there instead, and the plan allows one worker.
  baseURL: async ({ server }, provide) => {
    await provide(PLAN.baseUrl ?? server.origin);
  },
  control: async ({ request, server }, provide) => {
    const control = new Control(request, server.controlUrl);
    await control.clear();
    await provide(control);
  },
  api: async ({ request, control: _control }, provide) => {
    const api = new AppApi(request);
    await api.reset();
    await provide(api);
  },
  // The server outlives the spec before this one on the worker. A spec that
  // only opens pages (the smoke specs) does not ask for `api`, and must not
  // start from what that spec left behind either.
  emptyManager: [
    async ({ api: _api }, provide) => {
      await provide();
    },
    { auto: true },
  ],
});

export { expect };
