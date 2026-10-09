import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { Sql } from 'postgres';

import {
  MembershipError,
  requireOrganizationMember,
} from '../auth/membership.ts';
import type { AuthEnv } from '../auth/session.ts';
import { ROUTINE_RESTART_MS } from '../db/unavailable.ts';
import { hintStreamClosed, hintStreamOpened } from '../telemetry.ts';
import { createHintHub } from './hint-hub.ts';

const POLL_INTERVAL_MS = 300;
const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * How often an open stream re-proves its right to exist. Membership and the
 * session are validated at connect, but a stream never ends on its own: a
 * member removed or disabled mid-stream (and a session revoked — idle
 * enforcement, a member removal that deletes the user's sessions) would keep
 * receiving the org's entity kinds and ids until the tab reconnected. The
 * cadence is coarse on purpose and the reads are batched across every
 * stream of the process (two queries per 500 streams per interval); it runs
 * on its own clock, independent of hints and heartbeats.
 */
const AUTH_RECHECK_INTERVAL_MS = 15_000;
const ERROR_BACKOFF_MS = 1_000;
/**
 * The ceiling a stream's backoff doubles up to while the database is
 * unavailable: a restart takes seconds to a minute, so the streams of a
 * process stop polling a dead database every second, and a stream lags the
 * database's return by at most this. Inside the heartbeat interval, so an
 * idle lane still gets its heartbeats on time.
 */
const UNAVAILABLE_BACKOFF_MAX_MS = 10_000;
/**
 * How long the database may stay unavailable before the streams say so to
 * error tracking — once per outage, at warning level. A managed upgrade
 * recreates `db` on every release; a restart shorter than this is routine
 * and only logged.
 */
const OUTAGE_REPORT_AFTER_MS = ROUTINE_RESTART_MS;

export interface EventsHandlerOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  authRecheckIntervalMs?: number;
  /** First backoff after a failed poll; doubles while the database is
   * unavailable. */
  errorBackoffMs?: number;
  unavailableBackoffMaxMs?: number;
  outageReportAfterMs?: number;
  /** Newest outbox rows kept in memory for resume (tests shrink it). */
  ringCapacity?: number;
  /** Rows one tail read takes. */
  tailPage?: number;
  /** How long the shared loop keeps reading after its last stream left. */
  lingerMs?: number;
  /** Writes a stream may have queued before it is treated as gone. */
  maxPendingWrites?: number;
  /** How long the shared tail looks for an outbox id it read past. */
  lateCommitGraceMs?: number;
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
 * The streams of a process share ONE tail of the outbox (`hint-hub.ts`): it
 * reads each new row once and fans it out in memory, so the database cost is
 * per process, not per open tab. No cross-pod coordination and no sticky
 * sessions: every pod tails the same table. A client resumes after a
 * reconnect by replaying from `Last-Event-ID` (the outbox id it last saw),
 * served from the hub's in-memory ring when it can be; without one it starts
 * at the tail — TanStack Query's refetch-on-reconnect covers the gap. A
 * resume the outbox can no longer serve in full (the cursor row was
 * reclaimed past the retention horizon) is answered with a `resync` event
 * first: the client refetches its whole org scope instead of trusting a
 * cache with a hole in it.
 *
 * Membership and the session are re-proved on a coarse cadence while the
 * stream is open ({@link AUTH_RECHECK_INTERVAL_MS}), batched across every
 * stream of the process; a stream whose reader lost either is told
 * `forbidden` and ended — the client closes on that event, and a reconnect
 * without it meets the 401/403 above.
 *
 * The shared tail is also the fast path that keeps the outbox from growing:
 * it ticks the process's one reclaimer, which sweeps delivered rows older
 * than the horizon at most once a minute. The `realtime.reclaim_outbox` cron
 * on the worker is the backstop for a deployment with no stream open
 * (headless REST/automation use, nights, weekends).
 */
export function createEventsHandler(
  sql: Sql,
  options: EventsHandlerOptions = {},
) {
  const hub = createHintHub(sql, {
    pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    authRecheckIntervalMs:
      options.authRecheckIntervalMs ?? AUTH_RECHECK_INTERVAL_MS,
    errorBackoffMs: options.errorBackoffMs ?? ERROR_BACKOFF_MS,
    unavailableBackoffMaxMs:
      options.unavailableBackoffMaxMs ?? UNAVAILABLE_BACKOFF_MAX_MS,
    outageReportAfterMs: options.outageReportAfterMs ?? OUTAGE_REPORT_AFTER_MS,
    ringCapacity: options.ringCapacity,
    tailPage: options.tailPage,
    lingerMs: options.lingerMs,
    maxPendingWrites: options.maxPendingWrites,
    lateCommitGraceMs: options.lateCommitGraceMs,
  });
  return async (c: Context<AuthEnv>): Promise<Response> => {
    const orgId = c.req.query('orgId');
    if (!orgId) {
      return c.json(
        { error: '"orgId" is required', code: 'INVALID_QUERY' },
        400,
      );
    }
    const { user, session } = c.get('sessionBundle');
    const userId = user.id;
    const sessionId = session.id;
    try {
      await requireOrganizationMember(sql, orgId, userId);
    } catch (error) {
      if (error instanceof MembershipError) {
        return c.json(
          {
            error: 'Not a member of this organization',
            code: 'ORG_FORBIDDEN',
          },
          403,
        );
      }
      throw error;
    }
    const resumeCursor = c.req.header('Last-Event-ID') ?? null;

    return streamSSE(c, async (stream) => {
      hintStreamOpened();
      registerLiveStream(stream);
      try {
        await hub.attach(stream, { orgId, userId, sessionId, resumeCursor });
      } finally {
        unregisterLiveStream(stream);
        // Paired with the open above — an aborted stream decrements too, or
        // the gauge climbs forever on client churn.
        hintStreamClosed();
      }
    });
  };
}
