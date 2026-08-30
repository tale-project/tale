import type { Sql } from 'postgres';

import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { reconcileSession } from './service.ts';
import { reapStaleAdmissionTickets } from './sessions.ts';

/**
 * The sandbox drift sweep (5 min) — the 0.5 twin of 0.4's
 * `recoverStuckSessions` + `reconcileSandboxSessions` +
 * `recoverStuckAdmissionTickets`:
 *
 *  - EXPIRE: unpinned sessions past their TTL among the compute-holding
 *    statuses flip to `expired` (freeing their slots) and the parked-run
 *    wake fires for their orgs. The spawner's own reaper collects the
 *    container on its TTL — the row must not wait for it.
 *  - RECONCILE: a bounded batch of the stalest compute-holding rows is
 *    checked against the spawner; a container gone spawner-side settles the
 *    row as destroyed (phantom heal). Requires a reachable spawner — when
 *    it is down the probes fail closed as `live` (never heal blind).
 *  - REAP: admission tickets whose poll chain died are deleted — the ONLY
 *    guard against permanent queue-head starvation in the FIFO.
 */
export async function runSandboxWatchdog(
  sql: Sql,
  options: {
    ticketStaleMs?: number;
    reconcileBatch?: number;
    skipReconcile?: boolean;
  } = {},
): Promise<{ expired: number; healed: number; reaped: number }> {
  const now = Date.now();
  const expired = await sql<{ orgId: string }[]>`
    UPDATE app.sandbox_sessions SET status = 'expired'
    WHERE status IN ('creating', 'active', 'degraded')
      AND pinned = false AND expires_at_ms < ${now}
    RETURNING org_id AS "orgId"
  `;
  for (const orgId of new Set(expired.map((row) => row.orgId))) {
    await wakeParkedAgentRuns(sql, orgId).catch((error: unknown) => {
      console.warn('[watchdog] capacity wake after expiry failed:', error);
    });
  }

  let healed = 0;
  if (options.skipReconcile !== true) {
    const candidates = await sql<{ sessionId: string; orgId: string }[]>`
      SELECT session_id AS "sessionId", org_id AS "orgId"
      FROM app.sandbox_sessions
      WHERE status IN ('creating', 'active', 'degraded')
      ORDER BY created_at_ms
      LIMIT ${options.reconcileBatch ?? 25}
    `;
    for (const candidate of candidates) {
      try {
        const outcome = await reconcileSession(sql, {
          organizationId: candidate.orgId,
          sessionId: candidate.sessionId,
        });
        if (outcome === 'healed') healed += 1;
      } catch (error) {
        // Spawner unreachable ⇒ no verdict on this row; leave it alone.
        console.warn(
          `[watchdog] reconcile probe failed for ${candidate.sessionId}:`,
          error,
        );
      }
    }
  }

  const staleBefore = now - (options.ticketStaleMs ?? 5 * 60_000);
  const reaped = await reapStaleAdmissionTickets(sql, staleBefore);
  return { expired: expired.length, healed, reaped };
}
