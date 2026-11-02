// Bun server: the session manager. Serves the built single-page app from
// `./dist` through the shared React-server pipeline from `@tale/ui/server`
// (static files, `/api/health`, security headers) and adds the backend: the
// HTTP API, the live view's WebSocket and the MCP endpoint (`backend/main.ts`).

import { loadConfig, type Config } from './backend/config.ts';
import { SHUTDOWN_TIMEOUT_MS } from './backend/domains/sessions/runtime.ts';
import { startServer } from './backend/main.ts';
import {
  SHUTDOWN_MARGIN_MS,
  STOP_SIGNALS,
  createShutdown,
} from './backend/shutdown.ts';
import { explainStartupFailure } from './backend/startup-failure.ts';

let config: Config | undefined;
try {
  config = loadConfig();
  const { stop } = startServer(config);

  // A stop closes every browser gracefully, so the tabs of each session are
  // reopened at its next start. The browsers' own signal handling is off
  // (`camoufox-backend.ts`): closing the terminal (SIGHUP) must stop them here.
  // A stop that hangs is ended by a deadline, a second signal ends it at once
  // (`backend/shutdown.ts`).
  const shutdown = createShutdown({
    stop,
    exit: (code) => process.exit(code),
    log: (line, cause) =>
      cause === undefined ? console.error(line) : console.error(line, cause),
    deadlineMs: SHUTDOWN_TIMEOUT_MS + SHUTDOWN_MARGIN_MS,
  });
  for (const signal of STOP_SIGNALS) process.on(signal, () => shutdown(signal));
} catch (error) {
  // Not a crash when a person can fix it (a port that is taken, a data
  // directory that cannot be written, a database another program made): the
  // message says what to change. A bug keeps its stack.
  const reason = explainStartupFailure(error, {
    port: config?.port ?? 0,
    dataDir: config?.dataDir ?? '',
  });
  if (reason !== null) {
    console.error(`[session-manager] ${reason}`);
    process.exit(1);
  }
  throw error;
}
