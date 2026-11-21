/**
 * The `web` role: the web tier alone.
 *
 * It serves the built app, the status page and the web tier's other doors
 * (`../server.ts`) and nothing else: no database, no job queue, no API. The
 * backend process serves the same app beside its API in the `api` and `all`
 * roles (`main.ts`); this entry is for a deployment that keeps the tier that
 * answers every anonymous request apart from the one that holds the
 * database credentials. It asks the API for the two verdicts it cannot give
 * itself, at TALE_BACKEND_URL.
 *
 * An entry of its own (`web-main.js` in the build) and not a branch of
 * `main.ts`: a process that starts there reads the whole backend before it
 * reads its role.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { startWebServer, webPort } from '../server.ts';
import { initTelemetry } from '../telemetry.ts';

/** The interface to listen on; every interface when unset, as the API does
 * (`BACKEND_LISTEN_HOST` in `env.ts`). */
function listenHost(): { hostname?: string } {
  const host = process.env.BACKEND_LISTEN_HOST ?? '';
  return host === '' ? {} : { hostname: host };
}

async function main(): Promise<void> {
  initTelemetry();
  const web = await startWebServer({
    // This role has one listener, and `PORT` named its port before
    // `APP_PORT` did; a deployment that set it still gets that port.
    port: webPort(process.env.APP_PORT || process.env.PORT),
    ...listenHost(),
  });
  web.markReady();

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // Health says 503 from here; the listener keeps answering until the
    // balancer that checks it has had time to notice. Nothing waits where
    // nothing checks.
    const drainMs = web.drainMs();
    console.log(
      `[web] ${signal} received — answering for ${drainMs} ms more, then closing`,
    );
    web.markShuttingDown();
    await sleep(drainMs);
    await web.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[web] fatal startup error:', error);
  process.exit(1);
});
