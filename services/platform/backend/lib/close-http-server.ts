import type { ServerType } from '@hono/node-server';

/**
 * How long `close` may wait for in-flight requests before force-closing the
 * remaining connections. Must land well under the orchestrator's kill grace
 * (30 s at the least — compose.yml and the CLI's compose services) so the
 * job stop, `sql.end`, and the error-reporting flush still get their turn
 * (`shutdown-sequence.ts`) — a request cut at the deadline is retryable, a
 * SIGKILL mid-job is not.
 */
const FORCE_CLOSE_AFTER_MS = 5_000;

/**
 * How often to sweep freshly-idle connections while close is pending.
 * `server.close()` reaps idle keep-alive connections once, at the moment it
 * is called; a connection whose response ends a tick LATER (exactly what
 * ending the SSE streams produces) is never reaped server-side and lingers
 * until the CLIENT's keep-alive timer closes it (undici: 4s) — observed as
 * shutdown stalling to the force deadline. The sweep closes them as they
 * become idle; in-flight requests are untouched.
 */
const IDLE_REAP_INTERVAL_MS = 200;

/**
 * Close an HTTP listener and wait until it has: no new connection is taken,
 * a connection is closed as soon as it is idle, and whatever is still open
 * after the deadline (a long streaming response, a stuck keep-alive) is
 * force-closed, so the wait is bounded.
 *
 * The caller ends the streams it knows never end on their own first
 * (`closeServerGracefully` for the API's, `endFileEventStreams` for the web
 * tier's); this is the part every listener of the process shares, and it
 * imports nothing of the backend, so the web role can use it alone.
 */
export async function closeHttpServer(
  server: ServerType,
  options: { forceAfterMs?: number; name?: string } = {},
): Promise<void> {
  const forceAfterMs = options.forceAfterMs ?? FORCE_CLOSE_AFTER_MS;
  const name = options.name ?? 'backend';
  await new Promise<void>((resolve) => {
    // The `in` checks narrow ServerType: the http/1 server (what `serve`
    // builds here) has both close methods, the HTTP/2 flavors do not.
    const reap = setInterval(() => {
      if ('closeIdleConnections' in server) {
        server.closeIdleConnections();
      }
    }, IDLE_REAP_INTERVAL_MS);
    const force = setTimeout(() => {
      if ('closeAllConnections' in server) {
        console.warn(
          `[${name}] connections still open after ${forceAfterMs}ms — force-closing`,
        );
        server.closeAllConnections();
      }
    }, forceAfterMs);
    server.close(() => {
      clearInterval(reap);
      clearTimeout(force);
      resolve();
    });
  });
}
