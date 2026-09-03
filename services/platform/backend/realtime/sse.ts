import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Sql } from 'postgres';

import {
  MembershipError,
  requireOrganizationMember,
} from '../auth/membership.ts';
import type { AuthEnv } from '../auth/session.ts';
import { reportError } from '../error-reporting.ts';
import { hintStreamClosed, hintStreamOpened } from '../telemetry.ts';
import { coalesceHints } from './hints.ts';
import { latestOutboxId, readHintsAfter } from './outbox.ts';

const POLL_INTERVAL_MS = 300;
const HEARTBEAT_INTERVAL_MS = 15_000;
const ERROR_BACKOFF_MS = 1_000;

/**
 * Every live `/events` stream of this process. An SSE response never ends on
 * its own — the loop below exits only on client abort — while
 * `server.close()` waits for every open connection: without a proactive end,
 * graceful shutdown hangs until the orchestrator SIGKILLs the process (10s
 * default compose grace), killing in-flight jobs mid-write. Shutdown calls
 * {@link endAllEventStreams}; clients reconnect against the next pod and
 * resume via `Last-Event-ID`.
 */
const liveStreams = new Set<SSEStreamingApi>();

/**
 * Proactively end every live `/events` stream (shutdown path). `abort()`
 * cancels the response readable — the connection goes idle immediately, so
 * `server.close()` can complete — and flips `stream.aborted`, which the poll
 * loop reads as its exit condition. Returns how many streams were ended.
 */
export function endAllEventStreams(): number {
  const ended = liveStreams.size;
  for (const stream of liveStreams) {
    stream.abort();
  }
  liveStreams.clear();
  return ended;
}

/**
 * GET /events — the Tier-2 invalidation-hint stream.
 *
 * Auth: requires a Better Auth session (requireSession middleware) AND
 * membership of the requested organization — the org scope is validated
 * server-side, never trusted from the client.
 *
 * Each API pod polls the outbox independently and fans hints out to its own
 * connected clients; no cross-pod coordination, no sticky sessions. A client
 * resumes after a reconnect by replaying from `Last-Event-ID` (the outbox id
 * it last saw); without one it starts at the tail — TanStack Query's
 * refetch-on-reconnect covers the gap.
 */
export function createEventsHandler(sql: Sql) {
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const orgId = c.req.query('orgId');
    if (!orgId) {
      return c.json({ error: 'orgId is required' }, 400);
    }
    const userId = c.get('sessionBundle').user.id;
    try {
      await requireOrganizationMember(sql, orgId, userId);
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json({ error: 'not a member of this organization' }, 403);
      }
      throw error;
    }
    const resumeFrom = c.req.header('Last-Event-ID') ?? null;

    return streamSSE(c, async (stream) => {
      hintStreamOpened();
      liveStreams.add(stream);
      let cursor =
        resumeFrom !== null && /^\d+$/.test(resumeFrom)
          ? resumeFrom
          : await latestOutboxId(sql);
      let lastBeatAt = Date.now();

      try {
        while (!stream.aborted) {
          try {
            const rows = await readHintsAfter(sql, cursor, { orgId, userId });
            if (rows.length > 0) {
              const lastRow = rows[rows.length - 1];
              if (lastRow !== undefined) {
                cursor = lastRow.id;
              }
              for (const hint of coalesceHints(rows)) {
                await stream.writeSSE({
                  event: 'hint',
                  id: hint.id,
                  data: JSON.stringify({
                    entity: hint.entity,
                    entityId: hint.entityId,
                  }),
                });
              }
              lastBeatAt = Date.now();
            } else if (Date.now() - lastBeatAt >= HEARTBEAT_INTERVAL_MS) {
              await stream.writeSSE({ event: 'heartbeat', data: '' });
              lastBeatAt = Date.now();
            }
          } catch (error) {
            if (stream.aborted) {
              break;
            }
            console.error('[backend] /events poll failed, backing off:', error);
            // DB-blip bursts here were a load-bearing production signal in
            // the 0.4 GlitchTip topology; the SDK's dedupe absorbs repeats.
            reportError(error, { tags: { 'tale.lane': 'events-poll' } });
            await stream.sleep(ERROR_BACKOFF_MS);
            continue;
          }
          await stream.sleep(POLL_INTERVAL_MS);
        }
      } finally {
        liveStreams.delete(stream);
        // Paired with the open above — an aborted stream decrements too, or
        // the gauge climbs forever on client churn.
        hintStreamClosed();
      }
    });
  };
}
