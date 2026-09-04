import type { Sql } from 'postgres';

import {
  sessionDestroyIfIdle,
  sessionIsAlive,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { reconcileSession } from './service.ts';
import { markSessionDestroyed, reapStaleAdmissionTickets } from './sessions.ts';

/**
 * The spawner verbs the sweep's spawner-facing passes use. Injectable so the
 * unit layer and the real-Postgres integration probe drive the passes with a
 * scripted spawner; production uses the signed session client.
 */
export interface WatchdogSpawner {
  /** GET /v1/sessions/:id — false ONLY on a definitive 404; throws otherwise. */
  isAlive: (sessionId: string) => Promise<boolean>;
  /** DELETE /v1/sessions/:id?if_idle=1 — the spawner arbitrates busy. */
  destroyIfIdle: (
    sessionId: string,
  ) => Promise<{ destroyed: boolean; busy: boolean }>;
}

const DEFAULT_SPAWNER: WatchdogSpawner = {
  isAlive: sessionIsAlive,
  destroyIfIdle: sessionDestroyIfIdle,
};

/**
 * How long after an automation run's terminal settle its sessions become
 * reclaimable. The terminal door hibernates them at once (the slot is what
 * matters for capacity); the container and workspace are reclaimed a little
 * later so a node whose settle raced the run's finish is not destroyed under
 * its last writes. Two sweep ticks.
 */
export const SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS = 10 * 60_000;

export interface SandboxWatchdogOptions {
  ticketStaleMs?: number;
  /** Rows probed against the spawner per tick (reconcile). */
  reconcileBatch?: number;
  /** Ended-run sessions reclaimed per tick. */
  reclaimBatch?: number;
  reclaimGraceMs?: number;
  /** Skip BOTH spawner-facing passes (reconcile + reclaim) — for callers
   * with no spawner to ask. */
  skipReconcile?: boolean;
  spawner?: WatchdogSpawner;
}

export interface SandboxWatchdogResult {
  expired: number;
  healed: number;
  reclaimed: number;
  reaped: number;
}

/**
 * The sandbox drift sweep (5 min) — the 0.5 twin of 0.4's
 * `recoverStuckSessions` + `reconcileSandboxSessions` +
 * `recoverStuckAdmissionTickets`:
 *
 *  - EXPIRE: unpinned sessions past their TTL among the compute-holding
 *    statuses flip to `expired` (freeing their slots) and the parked-run
 *    wake fires for their orgs. The spawner's own reaper collects the
 *    container on its TTL — the row must not wait for it.
 *  - RECONCILE: a bounded batch of compute-holding rows is checked against
 *    the spawner; a container gone spawner-side settles the row as destroyed
 *    (phantom heal). Requires a reachable spawner — when it is down the
 *    probes fail closed as `live` (never heal blind). The batch is a FAIR
 *    walk: least-recently-visited first (`last_reconciled_at_ms`, never
 *    visited before any visited), and every visited row is stamped, so a
 *    long-lived healthy session at the head of `created_at_ms` can no longer
 *    shadow a younger phantom forever.
 *  - RECLAIM: the per-execution sessions of ENDED automation runs. The run's
 *    terminal door only hibernates them (`stopped` — a LIVE status the
 *    Sandboxes page lists and the spawner keeps a workspace for), so without
 *    this pass every agent-node run left one dead row and one host workspace
 *    behind, forever. A row is reclaimed once its run is terminal (or gone —
 *    the retention purge deletes runs) past a grace, and only when the
 *    spawner confirms the session is not executing (`if_idle`): a late node
 *    is left for the next tick, and a spawner error leaves the row alone.
 *  - REAP: admission tickets whose poll chain died are deleted — the ONLY
 *    guard against permanent queue-head starvation in the FIFO.
 */
export async function runSandboxWatchdog(
  sql: Sql,
  options: SandboxWatchdogOptions = {},
): Promise<SandboxWatchdogResult> {
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
  let reclaimed = 0;
  if (options.skipReconcile !== true) {
    const spawner = options.spawner ?? DEFAULT_SPAWNER;
    healed = await reconcilePass(sql, spawner, {
      batch: options.reconcileBatch ?? 25,
      now,
    });
    reclaimed = await reclaimEndedRunSessions(sql, spawner, {
      batch: options.reclaimBatch ?? 25,
      graceMs: options.reclaimGraceMs ?? SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
      now,
    });
  }

  const staleBefore = now - (options.ticketStaleMs ?? 5 * 60_000);
  const reaped = await reapStaleAdmissionTickets(sql, staleBefore);
  return { expired: expired.length, healed, reclaimed, reaped };
}

interface Candidate {
  id: string;
  sessionId: string;
  orgId: string;
}

/** Stamp the rows a pass visited — whatever the verdict — so the next tick's
 * batch moves on to the rows it has not seen for longest. */
async function stampVisited(
  sql: Sql,
  candidates: readonly Candidate[],
  now: number,
): Promise<void> {
  if (candidates.length === 0) return;
  await sql`
    UPDATE app.sandbox_sessions SET last_reconciled_at_ms = ${now}
    WHERE id = ANY(${candidates.map((candidate) => candidate.id)})
  `;
}

async function reconcilePass(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: { batch: number; now: number },
): Promise<number> {
  const candidates = await sql<Candidate[]>`
    SELECT id, session_id AS "sessionId", org_id AS "orgId"
    FROM app.sandbox_sessions
    WHERE status IN ('creating', 'active', 'degraded')
    ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC, id ASC
    LIMIT ${args.batch}
  `;
  let healed = 0;
  for (const candidate of candidates) {
    try {
      const outcome = await reconcileSession(
        sql,
        { organizationId: candidate.orgId, sessionId: candidate.sessionId },
        { isAlive: spawner.isAlive },
      );
      if (outcome === 'healed') healed += 1;
    } catch (error) {
      // Spawner unreachable ⇒ no verdict on this row; leave it alone.
      console.warn(
        `[watchdog] reconcile probe failed for ${candidate.sessionId}:`,
        error,
      );
    }
  }
  await stampVisited(sql, candidates, args.now);
  return healed;
}

/**
 * Reclaim the per-execution sessions of ended automation runs — see the
 * RECLAIM lane above. The run is matched off the step-scoped owner id
 * (`${runId}` or `${runId}:<suffix>`); `stopped` and `expired` rows both
 * qualify (the terminal door hibernates, the TTL expires — neither destroys).
 * A live session is never a candidate: `creating`/`active`/`degraded` rows
 * are excluded outright, and a non-terminal run keeps its hibernated row for
 * the resume the next node performs.
 */
export async function reclaimEndedRunSessions(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: { batch: number; graceMs: number; now: number },
): Promise<number> {
  const horizon = args.now - args.graceMs;
  const candidates = await sql<Candidate[]>`
    SELECT s.id, s.session_id AS "sessionId", s.org_id AS "orgId"
    FROM app.sandbox_sessions s
    LEFT JOIN app.automation_runs r
      ON r.org_id = s.org_id AND r.id = split_part(s.owner_id, ':', 1)
    WHERE s.owner_type = 'workflow_run'
      AND s.status IN ('stopped', 'expired')
      AND (
        (r.id IS NOT NULL
          AND r.status IN ('success', 'failed', 'cancelled')
          AND coalesce(r.finished_at_ms, r.started_at_ms) < ${horizon})
        OR (r.id IS NULL AND s.created_at_ms < ${horizon})
      )
    ORDER BY s.last_reconciled_at_ms ASC NULLS FIRST, s.created_at_ms ASC,
             s.id ASC
    LIMIT ${args.batch}
  `;
  let reclaimed = 0;
  for (const candidate of candidates) {
    let outcome: { destroyed: boolean; busy: boolean };
    try {
      outcome = await spawner.destroyIfIdle(candidate.sessionId);
    } catch (error) {
      // Spawner unreachable or refusing ⇒ the container may survive; the row
      // must not settle ahead of it. Next tick retries.
      console.warn(
        `[watchdog] reclaim destroy failed for ${candidate.sessionId}:`,
        error,
      );
      continue;
    }
    // A node whose turn outlived the run's terminal settle is still executing
    // there — the spawner refused; leave the row for a later tick.
    if (outcome.busy) continue;
    // Destroyed now, or nothing existed spawner-side — either way the
    // compute and workspace are gone, so the row settles.
    await markSessionDestroyed(sql, {
      organizationId: candidate.orgId,
      sessionId: candidate.sessionId,
    });
    reclaimed += 1;
  }
  await stampVisited(sql, candidates, args.now);
  return reclaimed;
}
