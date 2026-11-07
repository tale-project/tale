import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createPlaywrightConfig } from '@tale/e2e/config';

import { healthUrl, planFrom } from './tests/e2e/servers.ts';

/**
 * Browser tests of the production build: `bun run build`, then
 * `tests/e2e/launcher.ts`, which serves the built page, the API and the MCP
 * endpoint from one port per worker over a fake browser and a fake exit-IP
 * checker. The real Camoufox is not needed (the real-browser lane is
 * `bun run test:camoufox`), and the data directories are thrown away with the
 * process. The inherited house defaults come from `@tale/e2e/config`.
 *
 * The suite runs in parallel on isolated servers: worker `i` talks to the
 * server on `E2E_BACKEND_PORT + i` (control server on `E2E_CONTROL_PORT + i`)
 * and to no other, so every spec still starts from an empty manager of its own.
 * `E2E_WORKERS` sets the count (default: 4, or the cores if fewer); the
 * launcher starts as many servers, in one process. `tests/e2e/servers.ts`
 * holds the settings. A dev server in front (`E2E_BASE_URL`) is one place for
 * the page to go: run it with `E2E_WORKERS=1`.
 *
 * CI restores the page through Turbo first and sets `E2E_USE_BUILD=1`;
 * `E2E_DIST_DIR` serves a page built elsewhere (a private build) and builds
 * nothing, so `dist/` stays as it is.
 */

const plan = planFrom(process.env, availableParallelism());
const buildFirst =
  process.env.E2E_USE_BUILD !== '1' && process.env.E2E_DIST_DIR === undefined;

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  testMatch: '**/*.spec.ts',
  port: plan.backendPort,
  workers: plan.workers,
  // Every spec starts from an empty manager on the server of its own worker, so
  // none depends on the one before it: the tests of a file spread over the
  // workers. Scheduled by file, the longest file sets the time (measured with
  // four workers: 14 minutes by file, 8 by test, 33 on one worker).
  fullyParallel: true,
  webServer: {
    // With `E2E_USE_BUILD=1` the page is already built (CI restores it through
    // Turbo, the same task Checks validates): boot the servers over it without
    // a second build. Ordinary local runs build first.
    command:
      (buildFirst ? 'bun run build && ' : '') + 'bun tests/e2e/launcher.ts',
    // The last server of the plan: the launcher starts them in order, so once
    // it answers, every worker has its server.
    url: healthUrl(plan),
    env: {
      E2E_BACKEND_PORT: String(plan.backendPort),
      E2E_CONTROL_PORT: String(plan.controlPort),
      E2E_SERVERS: String(plan.servers),
    },
    // Locally reuse servers that are already listening (`bun
    // tests/e2e/launcher.ts` serves the page as built when it started); in CI
    // boot fresh ones.
    reuseExistingServer: !process.env.CI,
    // The launcher stops its servers and deletes their data directories.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    timeout: 120_000,
  },
});
