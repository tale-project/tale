import type { ServerType } from '@hono/node-server';

import { closeHttpServer } from './lib/close-http-server.ts';
import { endAllEventStreams } from './realtime/sse.ts';

/**
 * Close the HTTP server without hanging on connections that never end.
 *
 * `server.close()` waits for every open connection, and the SSE responses
 * (`/events`, the per-thread chat progress lane) never end on their own (15s
 * heartbeats; their loops exit only on client abort) — so with any browser
 * connected, a plain close never resolved and every deploy ended in SIGKILL
 * with in-flight jobs killed mid-write. Two measures, layered:
 *
 * 1. Proactively end every live SSE stream ({@link endAllEventStreams}) —
 *    the graceful path: clients reconnect (`/events` resumes via
 *    `Last-Event-ID`).
 * 2. After the force deadline, force-close whatever connections remain (long
 *    streaming responses, stuck keep-alives) — the backstop that keeps the
 *    deadline honest for anything the registry cannot see
 *    (`lib/close-http-server.ts`, which the web tier's listener shares).
 */
export async function closeServerGracefully(
  server: ServerType,
  options: { forceAfterMs?: number } = {},
): Promise<void> {
  const ended = endAllEventStreams();
  if (ended > 0) {
    console.log(`[backend] ended ${ended} open SSE stream(s) for shutdown`);
  }
  await closeHttpServer(server, options);
}
