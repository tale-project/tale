#!/usr/bin/env bun
/*
  The backend for the e2e specs and for a look around without a browser build or
  the internet: the real HTTP stack (API, MCP, the built page when there is
  one) over the fake browser and the fake exit-IP checker, on a throw-away data
  directory. `bun tests/e2e/server.ts` starts ONE server on
  `E2E_BACKEND_PORT` (default 3204), where `vite.config.ts` points the dev
  server's proxy. The suite itself runs one server per Playwright worker, all
  started by `launcher.ts` through `startE2eServer`; everything a server holds
  (the fakes, the data directory, the control server) belongs to that call, so
  two servers in one process share nothing.

  The fake browser opens no window: what the page does to the window of a
  session (bring it to the front, type into it) is written down for a spec to
  read. A proxy exits through 203.0.113.<last octet of its host>, in Germany.

  The fakes can be driven from outside through `control.ts` (on
  `E2E_CONTROL_PORT`, default the backend's port + 1000): a spec makes a page
  open a dialog, a browser crash, a field of a window lose the focus, a proxy
  fail, and reads what the fake browser was told.

  `E2E_DIST_DIR` serves a page built somewhere else than `dist/` (a private
  build), `E2E_APP_PORT` (default 3004) is the dev server the page may be
  opened through, `E2E_LAUNCH_DELAY_MS` and `E2E_CHECK_DELAY_MS` set how long
  a start and a proxy check take.
*/

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../../backend/config.ts';
import { startServer } from '../../backend/main.ts';
import { FakeBackend } from '../../backend/testing/fake-browser.ts';
import { FakeExitIpChecker } from '../../backend/testing/fake-exit-ip.ts';
import { startControlServer } from './control.ts';
import {
  DEFAULT_APP_PORT,
  DEFAULT_CHECK_DELAY_MS,
  DEFAULT_LAUNCH_DELAY_MS,
  E2eSetupError,
  serverSettings,
  soloAddress,
  type E2eServerSettings,
} from './servers.ts';

export type E2eServerOptions = {
  /** The backend's port. */
  port: number;
  /** The control server's port. */
  controlPort: number;
} & Partial<E2eServerSettings>;

export interface E2eServer {
  port: number;
  controlPort: number;
  /** Where its database and profiles live, until `stop()`. */
  dataDir: string;
  /** Closes the fakes and both servers, and deletes the data directory. */
  stop: () => Promise<void>;
}

/**
 * Starts one server and returns once it listens (the control server first, the
 * backend last, so an answer from the backend means both are up). It makes
 * its own fakes, data directory and control server and keeps no module-level
 * state, so any number of them can run in one process.
 */
export function startE2eServer(options: E2eServerOptions): E2eServer {
  const {
    port,
    controlPort,
    appPort = DEFAULT_APP_PORT,
    launchDelayMs = DEFAULT_LAUNCH_DELAY_MS,
    checkDelayMs = DEFAULT_CHECK_DELAY_MS,
    distDir,
  } = options;
  const dataDir = mkdtempSync(join(tmpdir(), 'session-manager-e2e-'));
  let control: ReturnType<typeof startControlServer> | undefined;
  try {
    const config = loadConfig(
      {
        PORT: String(port),
        SESSION_MANAGER_DATA_DIR: dataDir,
        // The page is addressed through the dev server's port.
        SESSION_MANAGER_ALLOWED_HOSTS: `localhost:${appPort},127.0.0.1:${appPort}`,
      },
      { distDir },
    );

    const backend = new FakeBackend();
    backend.geo = {
      country: 'DE',
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      latitude: 52.52,
      longitude: 13.405,
    };
    // A started session takes a moment to come up, so that "Starting…" is seen.
    backend.launchDelayMs = launchDelayMs;

    const checker = new FakeExitIpChecker();
    checker.defaultCountry = 'DE';
    checker.delayMs = checkDelayMs;

    control = startControlServer(controlPort, {
      backend,
      checker,
      defaults: { launchDelayMs, checkDelayMs },
    });
    const running = startServer(config, { backend, checker });

    const closeControl = control;
    let stopping: Promise<void> | undefined;
    return {
      port,
      controlPort,
      dataDir,
      stop: () => {
        stopping ??= (async () => {
          void closeControl.stop(true);
          try {
            await running.stop();
          } finally {
            rmSync(dataDir, { recursive: true, force: true });
          }
        })();
        return stopping;
      },
    };
  } catch (error) {
    void control?.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}

// `bun tests/e2e/server.ts`: one server, from the environment.
if (import.meta.main) {
  try {
    const address = soloAddress(process.env);
    const server = startE2eServer({
      port: address.port,
      controlPort: address.controlPort,
      ...serverSettings(process.env),
    });
    console.log(
      `[e2e] backend on :${server.port}, control on :${server.controlPort}, data in ${server.dataDir}`,
    );

    const shutdown = () => {
      server.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    // A setting a person can fix is one sentence, not a stack.
    if (error instanceof E2eSetupError) {
      console.error(`[e2e] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
