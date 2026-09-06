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
import {
  createOutboxReclaimer,
  latestOutboxId,
  outboxRetainsCursor,
  readHintsAfter,
  reclaimOutbox,
} from './outbox.ts';

const POLL_INTERVAL_MS = 300;
const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * How often an open stream re-proves its right to exist. Membership and the
 * session are validated at connect, but a stream never ends on its own: a
 * member removed or disabled mid-stream (and a session revoked — idle
 * enforcement, a member removal that deletes the user's sessions) would keep
 * receiving the org's entity kinds and ids until the tab reconnected. The
 * cadence is coarse on purpose — two indexed reads per stream per interval —
 * and it runs on its own clock: the heartbeat's is silenced by any hint.
 */
const AUTH_RECHECK_INTERVAL_MS = 15_000;
const ERROR_BACKOFF_MS = 1_000;

export interface EventsHandlerOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  authRecheckIntervalMs?: number;
}

/**
 * Whether the (org, user, session) behind an open stream is still allowed to
 * read it. A definite refusal — no active membership, or the session row is
 * gone or expired — is `false`; a database fault throws, so the caller's
 * poll backoff handles it and a DB blip never ends a legitimate stream.
 */
async function streamStillAuthorized(
  sql: Sql,
  args: { orgId: string; userId: string; sessionId: string },
): Promise<boolean> {
  try {
    await requireOrganizationMember(sql, args.orgId, args.userId);
  } catch (error) {
    if (error instanceof MembershipError) return false;
    throw error;
  }
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "session"
    WHERE "id" = ${args.sessionId} AND "expiresAt" > now()
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Every live SSE stream of this process — the `/events` hint stream below
 * and the per-thread chat progress lane (`domains/chat/routes.ts`). An SSE
 * response never ends on its own — each loop exits only on client abort —
 * while `server.close()` waits for every open connection: without a
 * proactive end, graceful shutdown hangs until the orchestrator SIGKILLs the
 * process (10s default compose grace), killing in-flight jobs mid-write.
 * Shutdown calls {@link endAllEventStreams}; clients reconnect against the
 * next pod (`/events` resumes via `Last-Event-ID`; the chat lane repaints
 * from the generation row).
 */
const liveStreams = new Set<SSEStreamingApi>();

/** Enrol a streaming response in the shutdown drain — pair with
 * {@link unregisterLiveStream} in the loop's `finally`. */
export function registerLiveStream(stream: SSEStreamingApi): void {
  liveStreams.add(stream);
}

export function unregisterLiveStream(stream: SSEStreamingApi): void {
  liveStreams.delete(stream);
}

/**
 * Proactively end every live SSE stream (shutdown path). `abort()` cancels
 * the response readable — the connection goes idle immediately, so
 * `server.close()` can complete — and flips `stream.aborted`, which every
 * poll loop reads as its exit condition. Returns how many streams were
 * ended.
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
 * refetch-on-reconnect covers the gap. A resume the outbox can no longer
 * serve in full (the cursor row was reclaimed past the retention horizon)
 * is answered with a `resync` event first: the client refetches its whole
 * org scope instead of trusting a cache with a hole in it.
 *
 * Membership and the session are re-proved on a coarse cadence while the
 * stream is open ({@link AUTH_RECHECK_INTERVAL_MS}); a stream whose reader
 * lost either is told `forbidden` and ended — the client closes on that
 * event, and a reconnect without it meets the 401/403 above.
 *
 * The same poll loops are the fast path that keeps the outbox from growing:
 * every poll ticks the process's one reclaimer, which sweeps delivered rows
 * older than the horizon at most once a minute. The `realtime.reclaim_outbox`
 * cron on the worker is the backstop for a deployment with no stream open
 * (headless REST/automation use, nights, weekends).
 */
export function createEventsHandler(
  sql: Sql,
  options: EventsHandlerOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const authRecheckIntervalMs =
    options.authRecheckIntervalMs ?? AUTH_RECHECK_INTERVAL_MS;
  const reclaimer = createOutboxReclaimer({
    reclaim: () => reclaimOutbox(sql),
  });
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const orgId = c.req.query('orgId');
    if (!orgId) {
      return c.json({ error: 'orgId is required' }, 400);
    }
    const { user, session } = c.get('sessionBundle');
    const userId = user.id;
    const sessionId = session.id;
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
      registerLiveStream(stream);
      const resumeCursor =
        resumeFrom !== null && /^\d+$/.test(resumeFrom) ? resumeFrom : null;
      let cursor = resumeCursor ?? (await latestOutboxId(sql));
      // Checked once, AFTER the first read, so the verdict is exact: reclaim
      // removes a strict id-prefix, so a cursor row still present after the
      // read proves every row above it was there to be read.
      let verifyResume = resumeCursor !== null;
      let lastBeatAt = Date.now();
      let lastAuthCheckAt = Date.now();

      try {
        while (!stream.aborted) {
          try {
            if (Date.now() - lastAuthCheckAt >= authRecheckIntervalMs) {
              lastAuthCheckAt = Date.now();
              if (
                !(await streamStillAuthorized(sql, {
                  orgId,
                  userId,
                  sessionId,
                }))
              ) {
                // Terminal: the reader no longer belongs here. Returning
                // closes the response; the client closes its source on this
                // event instead of reconnecting into a 401/403.
                await stream.writeSSE({ event: 'forbidden', data: '' });
                break;
              }
            }
            const rows = await readHintsAfter(sql, cursor, { orgId, userId });
            if (verifyResume) {
              verifyResume = false;
              if (!(await outboxRetainsCursor(sql, cursor))) {
                await stream.writeSSE({ event: 'resync', data: '' });
              }
            }
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
            } else if (Date.now() - lastBeatAt >= heartbeatIntervalMs) {
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
          // Housekeeping rides the poll: throttled, non-overlapping, and
          // never awaited by the stream — its failures are its own.
          void reclaimer.tick();
          await stream.sleep(pollIntervalMs);
        }
      } finally {
        unregisterLiveStream(stream);
        // Paired with the open above — an aborted stream decrements too, or
        // the gauge climbs forever on client churn.
        hintStreamClosed();
      }
    });
  };
}
