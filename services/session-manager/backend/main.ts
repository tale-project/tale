// The composition root: the store, the browser backend, the manager and the
// three surfaces that call it (the HTTP API, the live view's WebSocket and the
// MCP endpoint), served by the shared React server next to the built page.

import { chmodSync, mkdirSync } from 'node:fs';

import {
  defaultReactServerSecurityHeaders,
  startReactServer,
  type ReactServerWebSocket,
} from '@tale/ui/server';

import { createApp } from './app.ts';
import { dbPath, loadConfig, profilesDir, type Config } from './config.ts';
import { openStore } from './db/store.ts';
import type { BrowserBackend } from './domains/browser/backend.ts';
import { CamoufoxBackend } from './domains/browser/camoufox-backend.ts';
import { countryOf } from './domains/identity/geo.ts';
import {
  createLiveViewSocket,
  type LiveViewData,
} from './domains/live_view/index.ts';
import { createMcpEndpoint } from './domains/mcp/server.ts';
import { HttpExitIpChecker } from './domains/proxies/exit-ip.ts';
import type { ExitIpChecker } from './domains/proxies/types.ts';
import type { Manager } from './domains/sessions/manager.ts';
import { createManager } from './domains/sessions/service.ts';
import { requestRefusal, websocketRefusal } from './security.ts';

/** What a test (or another host) swaps for the real browser and the real network. */
export interface BackendOverrides {
  backend?: BrowserBackend;
  checker?: ExitIpChecker;
}

export interface Backend {
  manager: Manager;
  /** Answers `/api/*` and `/mcp` (and refuses what the security checks refuse). */
  fetch: (request: Request) => Promise<Response>;
  /** The live view of a session. */
  websocket: ReactServerWebSocket<LiveViewData>;
  /** Closes every browser, stops the background work and closes the database. */
  close: () => Promise<void>;
}

/**
 * How long a request may be silent before the server closes the connection:
 * Bun's own 10 s would cut the tools of an AI assistant that start a session
 * or wait for a page (up to 120 s) and a proxy check (up to 40 s). The most
 * Bun allows.
 */
const IDLE_TIMEOUT_SECONDS = 255;

/** Opens the data directory and builds everything the server needs. */
export function createBackend(
  config: Config,
  overrides: BackendOverrides = {},
): Backend {
  if (overrides.backend === undefined) {
    // camoufox-js reads this when its modules are first loaded: the browser
    // build and the GeoIP database live there, apart from the cache of any
    // other program that uses Camoufox.
    process.env.CAMOUFOX_INSTALL_DIR = config.camoufoxInstallDir;
  }

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

  // Refuses (StoreOpenError) a database another program made, before anything
  // else starts: and before the directory it lies in is changed or filled.
  const store = openStore(dbPath(config));

  // The database holds proxy passwords and secrets, and the profiles hold the
  // cookies and logins of every session: private to this user.
  chmodSync(config.dataDir, 0o700);
  mkdirSync(profilesDir(config), { recursive: true });

  const backend =
    overrides.backend ??
    new CamoufoxBackend({ blockWebrtc: config.blockWebrtc });
  const checker =
    overrides.checker ?? new HttpExitIpChecker({ countryLookup: countryOf });
  const manager = createManager({
    dataDir: config.dataDir,
    version: config.version,
    store,
    backend,
    checker,
    blockWebrtc: config.blockWebrtc,
  });

  // Install the browser if it is missing and fetch the other first-use data,
  // while the page already answers (it shows what is going on).
  backend.warmUp().catch((error: unknown) => {
    console.error('[session-manager] warming up the browser failed', error);
  });
  const watch = new AbortController();
  manager.watchExitIps(watch.signal).catch((error: unknown) => {
    console.error('[session-manager] watching the exit IPs failed', error);
  });

  const app = createApp({
    manager,
    config,
    mcp: createMcpEndpoint({
      manager,
      serverInfo: { name: 'session-manager', version: config.version },
    }),
  });
  const websocket = createLiveViewSocket({
    manager,
    allowedHosts: config.allowedHosts,
    websocketRefusal,
  });

  return {
    manager,
    fetch: async (request) => app.fetch(request),
    websocket,
    close: async () => {
      watch.abort();
      await manager.close();
      await backend.close();
      store.close();
    },
  };
}

export interface RunningServer {
  server: ReturnType<typeof startReactServer<LiveViewData>>;
  backend: Backend;
  stop: () => Promise<void>;
}

const API_PATH = /^\/(?:api(?:\/|$)|mcp$)/;

/** Starts the backend and serves it, with the built page, on the configured address. */
export function startServer(
  config: Config = loadConfig(),
  overrides: BackendOverrides = {},
): RunningServer {
  const backend = createBackend(config, overrides);
  let server: ReturnType<typeof startReactServer<LiveViewData>>;
  try {
    server = startReactServer<LiveViewData>({
      port: config.port,
      hostname: config.host,
      distDir: config.distDir,
      logPrefix: 'session-manager',
      servingService: 'session-manager',
      localeRouting: 'none',
      shutdownMarkerPath: config.shutdownMarkerPath,
      securityHeaders: defaultReactServerSecurityHeaders,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      websocket: backend.websocket,
      // The manager has no visitors to count, and a shell that exports
      // `UMAMI_*` for another service (the platform's development shell does)
      // must not make it send anything anywhere or put a script in its page.
      analytics: false,
      extraRoutes: (request, url) => {
        // The API and MCP carry their own security checks (`createApp`).
        if (API_PATH.test(url.pathname)) return backend.fetch(request);
        // There is no login: any web page open in the person's browser could
        // reach this address. The page's own files get the Host check too (DNS
        // rebinding), as every API answer does.
        const refusal = requestRefusal(request, config.allowedHosts, 'page');
        return refusal === null
          ? null
          : Response.json(
              { error: refusal.code, message: refusal.message },
              { status: 403 },
            );
      },
    });
  } catch (error) {
    // The port is taken, say: what `createBackend` opened (the database, the
    // browser warm-up, the watch on the exit IPs) is closed now, not left to
    // the end of a process that may go on (a launcher, a test).
    backend.close().catch((closing: unknown) => {
      console.error('[session-manager] closing after a failed start', closing);
    });
    throw error;
  }

  return {
    server,
    backend,
    stop: async () => {
      // Bun's `server.stop()` waits for every open socket, and a live view
      // keeps its socket open for as long as its page is: awaited first, a
      // viewer would keep the browsers (and their tabs, which are saved as they
      // close) from ever being closed. So: refuse new connections, close the
      // browsers (each viewer is told its session closed), then cut what is left.
      const refusing = server.stop();
      try {
        await backend.close();
      } finally {
        await server.stop(true);
      }
      await refusing;
    },
  };
}
