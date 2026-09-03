import type { ServerType } from '@hono/node-server';

import { endAllEventStreams } from './realtime/sse.ts';

/**
 * How long `close` may wait for in-flight requests before force-closing the
 * remaining connections. Must land well under the orchestrator's kill grace
 * (compose default: 10s to SIGKILL; backend-api sets no stop_grace_period)
 * so `boss.stop({ graceful: true })`, `sql.end`, and the error-reporting
 * flush still get their turn — a request cut at the deadline is retryable,
 * a SIGKILL mid-job is not.
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
 * Close the HTTP server without hanging on connections that never end.
 *
 * `server.close()` waits for every open connection, and the `/events` SSE
 * responses never end on their own (15s heartbeats; their loop exits only on
 * client abort) — so with any browser connected, a plain close never
 * resolved and every deploy ended in SIGKILL with in-flight jobs killed
 * mid-write. Two measures, layered:
 *
 * 1. Proactively end every live SSE stream ({@link endAllEventStreams}) —
 *    the graceful path: clients reconnect and resume via `Last-Event-ID`.
 * 2. After {@link FORCE_CLOSE_AFTER_MS}, force-close whatever connections
 *    remain (long streaming responses, stuck keep-alives) — the backstop
 *    that keeps the deadline honest for anything the registry cannot see.
 */
export async function closeServerGracefully(
  server: ServerType,
  options: { forceAfterMs?: number } = {},
): Promise<void> {
  const forceAfterMs = options.forceAfterMs ?? FORCE_CLOSE_AFTER_MS;
  const ended = endAllEventStreams();
  if (ended > 0) {
    console.log(`[backend] ended ${ended} open /events stream(s) for shutdown`);
  }
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
          `[backend] connections still open after ${forceAfterMs}ms — force-closing`,
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
