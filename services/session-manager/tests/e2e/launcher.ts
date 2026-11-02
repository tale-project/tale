#!/usr/bin/env bun
/*
  Starts every server of the Playwright suite in ONE process: server `i` for
  worker `i`, on `E2E_BACKEND_PORT + i` with its control server on
  `E2E_CONTROL_PORT + i` (see `servers.ts` for the settings). `playwright.config.ts`
  runs it as its one `webServer` and polls the health route of the LAST
  server: they are started in order without yielding, so that one answering
  means all of them listen. Before it says READY it asks each of them anyway.

  `bun tests/e2e/launcher.ts` by hand starts the same servers a plain
  `bunx playwright test` would, which then reuses them (`E2E_USE_BUILD=1`
  skips the build, `E2E_DIST_DIR` serves a private build, and the page must be
  built already: the launcher never builds). One server alone is
  `tests/e2e/server.ts`.
*/

import { availableParallelism } from 'node:os';

import {
  startE2eServer,
  type E2eServer,
  type E2eServerOptions,
} from './server.ts';
import {
  addressOf,
  describePlan,
  E2eSetupError,
  planFrom,
  serverSettings,
} from './servers.ts';

/** How long a server may take to answer its health route once it listens. */
const READY_TIMEOUT_MS = 10_000;

const running: E2eServer[] = [];

async function stopAll(): Promise<void> {
  const results = await Promise.allSettled(
    running.splice(0).map((server) => server.stop()),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[e2e] stopping a server failed', result.reason);
    }
  }
}

async function failed(message: string, cause?: unknown): Promise<never> {
  console.error(`[e2e] ${message}`);
  if (cause !== undefined && !(cause instanceof E2eSetupError)) {
    console.error(cause);
  }
  await stopAll();
  process.exit(1);
}

async function answers(port: number): Promise<boolean> {
  try {
    // The address the server binds, not `localhost`, which may resolve to ::1.
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // Not listening, or not answering in time: the caller says which server.
    return false;
  }
}

// Before the first server starts, so a signal during startup stops what runs.
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  stopAll().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const plan = planFrom(process.env, availableParallelism());
  const settings = serverSettings(process.env);

  // In order, without yielding: the server the health URL names comes last.
  for (let index = 0; index < plan.servers; index += 1) {
    const address = addressOf(plan, index);
    const options: E2eServerOptions = {
      port: address.port,
      controlPort: address.controlPort,
      ...settings,
    };
    try {
      running.push(startE2eServer(options));
    } catch (error) {
      const taken =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EADDRINUSE';
      await failed(
        taken
          ? `Server ${index} of ${plan.servers} cannot listen: port ${address.port} or ${address.controlPort} is already in use. Stop the program that uses it, or set E2E_BACKEND_PORT to another start (the suite uses ${describePlan(plan)}).`
          : `Server ${index} of ${plan.servers} did not start.`,
        error,
      );
    }
  }

  for (let index = 0; index < plan.servers; index += 1) {
    const address = addressOf(plan, index);
    if (!(await answers(address.port))) {
      await failed(
        `Server ${index} of ${plan.servers} (port ${address.port}) does not answer its health route.`,
      );
    }
  }

  console.log(
    `[e2e] READY: ${describePlan(plan)}${settings.distDir === undefined ? '' : `, page from ${settings.distDir}`}`,
  );
} catch (error) {
  if (error instanceof E2eSetupError) await failed(error.message, error);
  await failed('The launcher failed.', error);
}
