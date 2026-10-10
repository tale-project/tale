import type { Sql, TransactionSql } from 'postgres';

import {
  sandboxWorkspaceInventory,
  sessionCreate,
  sessionDestroyIfIdle,
  sessionIsAlive,
  sessionObserve,
  sessionSetPinned,
  sessionStopIfIdle,
  type SandboxWorkspaceInventory,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import {
  releaseStaleDirectCalls,
  sweepSettledDirectCalls,
} from '../governance/direct-calls.ts';
import { closeStaleModelApiOps } from '../model_api/metering.ts';
import { sweepSettledModelApiOps } from '../model_api/retention.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import { RECOVERY_STALE_MS } from './recovery.ts';
import {
  reconcileSession,
  type ReconcileSpawner,
  type RecreateScheduler,
} from './service.ts';
import { markSessionDestroyed } from './sessions.ts';
import { reconcilePendingSessionOpKeys } from './spend-settlement.ts';
import { sweepRoomWaitLeftovers } from './wait-retention.ts';

/**
 * The spawner verbs the sweep's spawner-facing passes use. Injectable so the
 * unit layer and the real-Postgres integration probe drive the passes with a
 * scripted spawner; production uses the signed session client.
 */
export interface WatchdogSpawner extends ReconcileSpawner {
  /** DELETE /v1/sessions/:id?if_idle=1 — the spawner arbitrates busy. */
  destroyIfIdle: (
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ destroyed: boolean; busy: boolean }>;
  /** DELETE /v1/sessions/:id?if_idle=1&keep_workspace=1 — compute only:
   * the workspace stays for the owner's next turn. */
  stopIfIdle: (
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ stopped: boolean; busy: boolean }>;
}

const DEFAULT_SPAWNER: WatchdogSpawner = {
  isAlive: sessionIsAlive,
  observe: (sessionId, signal) => sessionObserve(sessionId, signal),
  setPinned: sessionSetPinned,
  create: sessionCreate,
  inventory: sandboxWorkspaceInventory,
  destroyIfIdle: sessionDestroyIfIdle,
  stopIfIdle: sessionStopIfIdle,
};

/**
 * How long after an automation run's terminal settle its sessions become
 * reclaimable. The terminal door hibernates them at once (the slot is what
 * matters for capacity); the container and workspace are reclaimed a little
 * later so a node whose settle raced the run's finish is not destroyed under
 * its last writes. Two sweep ticks.
 */
export const SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS = 10 * 60_000;

/**
 * How long after a fresh create failed its row becomes collectable. The
 * failing turn already asked the spawner to remove what the create left, so
 * this pass is the backstop for a removal that could not run or failed. Two
 * sweep ticks, so a turn that took the row over before it read `failed` has
 * started its exec by then — and the `if_idle` removal leaves a busy session
 * alone.
 */
export const SANDBOX_FAILED_SESSION_COLLECT_GRACE_MS = 10 * 60_000;

/**
 * How long a crawler render session may hold its slot. It lives for one
 * batch: a scan link creates it, renders the batch and destroys it, inside a
 * window that closes nine minutes after the link started. A render row still
 * holding compute past this belongs to a link that was cut off.
 */
export const SANDBOX_RENDER_SESSION_MAX_AGE_MS = 10 * 60_000;

export interface SandboxWatchdogOptions {
  /** Each independent spawner-facing pass owns this time budget. At most
   * four rows are in flight (one per pass), below the job's 300s expiry. */
  passTimeoutMs?: number;
  /** Rows probed per tick. One fifth is reserved for historical pin drift
   * when runtime pin metadata is available; batches below five probe active rows. */
  reconcileBatch?: number;
  /** Ended-run sessions reclaimed per tick. */
  reclaimBatch?: number;
  reclaimGraceMs?: number;
  /** Failed creates whose leftovers are collected per tick. */
  collectBatch?: number;
  collectGraceMs?: number;
  /** Abandoned render sessions released per tick. */
  releaseBatch?: number;
  renderMaxAgeMs?: number;
  /** Finalized ops whose gateway-key settlement is still open, settled per
   * tick. */
  settleBatch?: number;
  /** Skip EVERY spawner-facing pass (reconcile, reclaim, collect, release)
   * — for callers with no spawner to ask. */
  skipReconcile?: boolean;
  spawner?: WatchdogSpawner;
  /** Where the reconcile queues a pinned session's recreate — the
   * `sandbox.recreate_pinned` job by default. */
  scheduleRecreate?: RecreateScheduler;
  /** The job's signal: once pg-boss gives up on the tick (its expiry), the
   * spawner-facing passes stop visiting rows, stamping only the rows they
   * visited, so the retry never probes beside the attempt it replaces and
   * resumes where that one stopped. */
  signal?: AbortSignal;
}

export interface SandboxWatchdogResult {
  expired: number;
  healed: number;
  /** Pinned sessions gone spawner-side whose recreate in place (same id,
   * preserved workspace, re-pinned) the reconcile queued this tick. */
  recreating: number;
  reclaimed: number;
  /** Failed creates the sweep settled this tick: their spawner session
   * destroyed or confirmed absent, or already owned by a newer incarnation. */
  collected: number;
  /** Render sessions a cut-off scan link left behind, destroyed and settled
   * this tick. */
  released: number;
  /** Finalized ops whose gateway-key settlement (spend booked, key revoked)
   * the sweep closed this tick. */
  settled: number;
}

/**
 * The sandbox drift sweep (5 min) — the 0.5 twin of 0.4's
 * `recoverStuckSessions` + `reconcileSandboxSessions`:
 *
 *  - EXPIRE: unpinned sessions past their TTL among the compute-holding
 *    statuses flip to `expired` (freeing their slots), their gateway virtual
 *    keys are revoked, and the parked-run wake fires for their orgs. The spawner's own reaper collects the
 *    container on its TTL — the row must not wait for it. A session with a
 *    LIVE turn is spared until the turn ends: a `running` op whose last sign
 *    of life falls inside the recovery staleness window. Expiring it would
 *    revoke the turn's model key mid-turn and hand its slot to a parked run
 *    while the container still works. An op silent past the window spares
 *    nothing, so a dead one cannot pin its session.
 *  - RECONCILE: a bounded batch of compute-holding rows is checked against
 *    the spawner; a container gone spawner-side settles the row (phantom
 *    heal) — as stopped for an agent session whose workspace the spawner
 *    still holds, so the next turn resumes it in place, as destroyed
 *    otherwise — unless the row is pinned: a pinned agent workspace has
 *    its recreate in place queued (`sandbox.recreate_pinned` — same id, so
 *    the spawner re-attaches its preserved workspace; never inline, since a
 *    create can take minutes). Live sessions have pin drift repaired in either
 *    direction; matching pins need no write. A row another lifecycle
 *    transition holds (a Destroy, a pin, a running recreate) is skipped, not
 *    waited for. Requires a reachable spawner — when
 *    it is down the probes fail closed as `live` (never heal blind). The
 *    batch is a FAIR walk: least-recently-visited first
 *    (`last_reconciled_at_ms`, never visited before any visited), and every
 *    visited row is stamped, so a long-lived healthy session at the head of
 *    `created_at_ms` can no longer shadow a younger phantom forever.
 *  - RECLAIM: the per-execution sessions of ENDED automation runs. The run's
 *    terminal door only hibernates them (`stopped` — a LIVE status the
 *    Sandboxes page lists and the spawner keeps a workspace for), so without
 *    this pass every agent-node run left one dead row and one host workspace
 *    behind, forever. A row is reclaimed once its run is terminal (or gone —
 *    the retention purge deletes runs) past a grace, and only when the
 *    spawner confirms the session is not executing (`if_idle`): a late node
 *    is left for the next tick, and a spawner error leaves the row alone.
 *  - COLLECT: the leftovers of FAILED creates. A `failed` row holds no live
 *    status, so no pass above, no resume and no Sandboxes page ever reached
 *    it: a container its create left behind (one cut short between Docker's
 *    create and start stays `created`, pinning its runtime image through
 *    every later deploy) and its host workspace had no owner at all. The
 *    failing turn or crawler render batch destroys them best-effort before
 *    the flip (a render batch refused as a duplicate destroys nothing: the
 *    id may be another run's live session); this pass collects what that
 *    could not, past a grace, behind the same `if_idle` guard as RECLAIM,
 *    and stamps `destroyed_at_ms` on the row. An agent session's leftover
 *    loses its compute only: its id may name a workspace preserved for the
 *    owner's next turn, and deleting what nothing owns is the workspace
 *    cleanup's. A render's is destroyed whole.
 *  - RELEASE: the crawler's render sessions a stopped process left behind.
 *    A scan link destroys its render session when the batch ends; a link
 *    cut off mid-batch (a restart, a deploy, a crash) leaves the row
 *    `active` and the container running, and no pass above reached either:
 *    the row is unpinned but its TTL is a day, the container answers the
 *    reconcile probe, and it has no run that could end. Each held one of
 *    the organization's render slots (two by default) until the spawner's
 *    own idle reaper took the container half an hour later, so two of them
 *    left every website scan of the organization unable to render a page
 *    for that long. A render row still holding compute past
 *    `SANDBOX_RENDER_SESSION_MAX_AGE_MS` is destroyed when idle and
 *    settled; a worker still rendering in it is left for the next tick.
 */
export async function runSandboxWatchdog(
  sql: Sql,
  options: SandboxWatchdogOptions = {},
): Promise<SandboxWatchdogResult> {
  const now = Date.now();
  // The live-turn spare (see EXPIRE above) judges an op by the rule both
  // re-attach sweeps use: its last sign of life (`sessionOpLastSignOfLifeMs`,
  // the greatest of its start, heartbeat, finalize and finish stamps) inside
  // `RECOVERY_STALE_MS`. Spelled in SQL, so the spare and the flip are one
  // statement.
  const expired = await sql<{ orgId: string; sessionId: string }[]>`
    UPDATE app.sandbox_sessions s SET status = 'expired'
    WHERE s.status IN ('creating', 'active', 'degraded')
      AND s.pinned = false AND s.expires_at_ms < ${now}
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_session_ops op
        WHERE op.session_id = s.session_id AND op.org_id = s.org_id
          AND op.status = 'running'
          AND greatest(
                op.started_at_ms,
                coalesce(op.heartbeat_at_ms, 0),
                coalesce(op.finalized_at_ms, 0),
                coalesce(op.finished_at_ms, 0)
              ) >= ${now - RECOVERY_STALE_MS}
      )
    RETURNING s.org_id AS "orgId", s.session_id AS "sessionId"
  `;
  // Reclaim the CREDENTIALS of every session this sweep just expired: the
  // gateway key has no TTL of its own, so an expired row that keeps its key
  // leaves a spendable credential live forever (0.4's
  // `teardownExpiredSessions`). Deliberately NOT a container destroy —
  // expiry is a lifetime cap, not a user Destroy, and the workspace is the
  // user's state; the spawner's idle reaper collects the container.
  for (const row of expired) {
    await revokeSessionGatewayKeys(sql, {
      organizationId: row.orgId,
      sessionId: row.sessionId,
    }).catch((error: unknown) => {
      console.error(
        `[watchdog] gateway key reclaim after expiring ${row.sessionId} failed:`,
        error,
      );
    });
  }
  for (const orgId of new Set(expired.map((row) => row.orgId))) {
    await wakeParkedAgentRuns(sql, orgId).catch((error: unknown) => {
      console.warn('[watchdog] capacity wake after expiry failed:', error);
    });
  }

  let healed = 0;
  let recreating = 0;
  let reclaimed = 0;
  let collected = 0;
  let released = 0;
  if (options.skipReconcile !== true) {
    const spawner = options.spawner ?? DEFAULT_SPAWNER;
    const passSignal = () =>
      AbortSignal.any([
        AbortSignal.timeout(options.passTimeoutMs ?? 120_000),
        ...(options.signal !== undefined ? [options.signal] : []),
      ]);
    // Independent serial walks bound fanout to four sessions. An unreachable
    // daemon at the front of reconciliation cannot consume the reclaim,
    // failed-create or render passes' opportunity to release resources.
    const results = await Promise.allSettled([
      reconcilePass(sql, spawner, {
        batch: options.reconcileBatch ?? 25,
        now,
        ...(options.scheduleRecreate !== undefined
          ? { scheduleRecreate: options.scheduleRecreate }
          : {}),
        signal: passSignal(),
      }),
      reclaimEndedRunSessions(sql, spawner, {
        batch: options.reclaimBatch ?? 25,
        graceMs: options.reclaimGraceMs ?? SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
        now,
        signal: passSignal(),
      }),
      collectFailedSessions(sql, spawner, {
        batch: options.collectBatch ?? 25,
        graceMs:
          options.collectGraceMs ?? SANDBOX_FAILED_SESSION_COLLECT_GRACE_MS,
        now,
        signal: passSignal(),
      }),
      releaseAbandonedRenderSessions(sql, spawner, {
        batch: options.releaseBatch ?? 25,
        maxAgeMs: options.renderMaxAgeMs ?? SANDBOX_RENDER_SESSION_MAX_AGE_MS,
        now,
        signal: passSignal(),
      }),
    ]);
    const [reconciled, reclaimedRows, collectedRows, releasedRows] = results;
    if (reconciled.status === 'fulfilled')
      ({ healed, recreating } = reconciled.value);
    if (reclaimedRows.status === 'fulfilled') reclaimed = reclaimedRows.value;
    if (collectedRows.status === 'fulfilled') collected = collectedRows.value;
    if (releasedRows.status === 'fulfilled') released = releasedRows.value;
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.warn(
          `[watchdog] sandbox pass ${index} failed; other passes continued:`,
          result.reason,
        );
      }
    }
  }

  // A model-endpoint request whose process died mid-answer never closed its
  // op: close it now, so the sweep below books what the gateway metered and
  // deletes its key (domains/model_api/metering.ts).
  try {
    await closeStaleModelApiOps(sql, now);
  } catch (error: unknown) {
    console.error(
      '[watchdog] closing lost model-endpoint requests failed:',
      error,
    );
  }

  // A model-endpoint request's op row only carries its hold and its key to
  // the settlement — the ledger keeps the spend — so a week after the
  // request started, a settled row goes (domains/model_api/retention.ts).
  try {
    const pruned = await sweepSettledModelApiOps(sql, { now });
    if (pruned > 0) {
      console.log(
        `[watchdog] deleted the op rows of ${pruned} settled model-endpoint request(s)`,
      );
    }
  } catch (error: unknown) {
    console.error(
      '[watchdog] deleting settled model-endpoint request rows failed:',
      error,
    );
  }

  // A direct provider call whose process died mid-call never settled: its
  // hold stops counting once its deadline has passed, and a day after a
  // call started its settled row goes — the ledger keeps the spend
  // (domains/governance/direct-calls.ts).
  try {
    const lapsed = await releaseStaleDirectCalls(sql, now);
    if (lapsed > 0) {
      console.log(
        `[watchdog] released the holds of ${lapsed} direct provider call(s) past their deadline`,
      );
    }
    await sweepSettledDirectCalls(sql, { now });
  } catch (error: unknown) {
    console.error('[watchdog] releasing direct-call holds failed:', error);
  }

  // What waiting for sandbox room leaves behind: the op rows of refused
  // starts an hour after they ended (each session's newest kept, the run
  // view reads it) and failed session rows a day after they were collected,
  // except a project agent's newest row of its id, which names the
  // workspace its collect kept (domains/sandbox/wait-retention.ts).
  try {
    const pruned = await sweepRoomWaitLeftovers(sql, { now });
    if (pruned.ops + pruned.sessions > 0) {
      console.log(
        `[watchdog] deleted ${pruned.ops} op row(s) of refused starts and ${pruned.sessions} collected failed session row(s)`,
      );
    }
  } catch (error: unknown) {
    console.error(
      '[watchdog] deleting what waits for sandbox room left failed:',
      error,
    );
  }

  // SETTLE: finalized ops whose gateway-key settlement is still open past
  // the grace — the backstop behind the settle's own retry ladder (a
  // backend restart between retries, a gateway down for longer than it).
  let settled = 0;
  try {
    const sweep = await reconcilePendingSessionOpKeys(sql, {
      batch: options.settleBatch ?? 25,
      now,
    });
    settled = sweep.settled;
  } catch (error: unknown) {
    console.error('[watchdog] gateway key settlement sweep failed:', error);
  }

  return {
    expired: expired.length,
    healed,
    recreating,
    reclaimed,
    collected,
    released,
    settled,
  };
}

interface Candidate {
  id: string;
  sessionId: string;
  orgId: string;
}

/** Stamp the rows a pass visited — whatever the verdict — so the next tick's
 * batch moves on to the rows it has not seen for longest. Concurrent passes
 * can visit the same rows through different scan plans. Lock their immutable
 * IDs in one order before updating, without serializing the remote probes. */
export async function stampVisited(
  sql: Sql | TransactionSql,
  candidates: readonly Candidate[],
  now: number,
): Promise<void> {
  if (candidates.length === 0) return;
  await sql`
    WITH visited AS MATERIALIZED (
      SELECT id FROM app.sandbox_sessions
      WHERE id = ANY(${candidates.map((candidate) => candidate.id)})
      ORDER BY id
      FOR NO KEY UPDATE
    )
    UPDATE app.sandbox_sessions AS session SET last_reconciled_at_ms = ${now}
    FROM visited WHERE session.id = visited.id
  `;
}

async function reconcilePass(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: {
    batch: number;
    now: number;
    organizationId?: string;
    scheduleRecreate?: RecreateScheduler;
    signal?: AbortSignal;
  },
): Promise<{ healed: number; recreating: number }> {
  // Compute-holding rows may heal/recreate. The newest stopped/expired
  // unpinned incarnation is visited only to remove an old runtime pin: its
  // missing compute is expected and can never destroy its preserved workspace.
  // Separate quotas prevent a large historical inventory from starving live
  // health checks. Both queues rotate independently; every four active rows
  // give a historical row a turn before the pass's deadline.
  const scope = args.organizationId ?? null;
  const pinBatch =
    spawner.observe === undefined ? 0 : Math.floor(args.batch / 5);
  const active = await sql<Candidate[]>`
    SELECT id, session_id AS "sessionId", org_id AS "orgId"
    FROM app.sandbox_sessions
    WHERE status IN ('creating', 'active', 'degraded')
      AND (${scope}::text IS NULL OR org_id = ${scope})
    ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC, id ASC
    LIMIT ${args.batch - pinBatch}
  `;
  const historical =
    pinBatch === 0
      ? []
      : await sql<Candidate[]>`
    SELECT id, session_id AS "sessionId", org_id AS "orgId"
    FROM app.sandbox_sessions
    WHERE status IN ('stopped', 'expired') AND pinned = false
        AND NOT EXISTS (
          SELECT 1 FROM app.sandbox_sessions newer
          WHERE newer.org_id = sandbox_sessions.org_id
            AND newer.session_id = sandbox_sessions.session_id
            AND (newer.created_at_ms, newer.id) > (sandbox_sessions.created_at_ms, sandbox_sessions.id)
        )
      AND (${scope}::text IS NULL OR org_id = ${scope})
    ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC, id ASC
    LIMIT ${pinBatch}
  `;
  const candidates: Candidate[] = [];
  for (
    let offset = 0;
    offset < Math.max(active.length, historical.length * 4);
    offset += 4
  ) {
    candidates.push(...active.slice(offset, offset + 4));
    const retained = historical[offset / 4];
    if (retained !== undefined) candidates.push(retained);
  }
  let healed = 0;
  let recreating = 0;
  const visited: Candidate[] = [];
  const passSpawner = sharingInventory(spawner);
  for (const candidate of candidates) {
    if (args.signal?.aborted === true) break;
    visited.push(candidate);
    try {
      const outcome = await reconcileSession(
        sql,
        { organizationId: candidate.orgId, sessionId: candidate.sessionId },
        passSpawner,
        {
          ...(args.scheduleRecreate !== undefined
            ? { schedule: args.scheduleRecreate }
            : {}),
          ...(args.signal !== undefined ? { signal: args.signal } : {}),
        },
      );
      if (outcome === 'healed') healed += 1;
      if (outcome === 'recreating') recreating += 1;
    } catch (error) {
      // Spawner unreachable or refusing ⇒ no verdict on this row; leave it
      // alone for its next visit.
      console.warn(
        `[watchdog] reconcile failed for ${candidate.sessionId}:`,
        error,
      );
    }
  }
  await stampVisited(sql, visited, args.now);
  return { healed, recreating };
}

/** The spawner, reading its workspace inventory at most once for the pass
 * (when the first heal asks): a host reboot leaves every session's compute
 * gone at once, and each agent session's heal asks whether its workspace is
 * still held. A failed read is shared too; each heal reads it as unknown.
 * The first heal's options bound the read: every heal of the pass passes
 * the same pass signal. */
function sharingInventory(spawner: WatchdogSpawner): WatchdogSpawner {
  const read = spawner.inventory;
  if (read === undefined) return spawner;
  let shared: Promise<SandboxWorkspaceInventory | null> | undefined;
  return { ...spawner, inventory: (options) => (shared ??= read(options)) };
}

/**
 * The Sandboxes page's mount-time probe (the 0.4 `reconcileOrgSessions`):
 * the SAME fair lifecycle and pin-drift pass the sweep runs, scoped to one
 * organization and stamped like a sweep tick. One implementation, so the
 * page can never heal a row the sweep would leave alone — a hibernated
 * project workspace stays listed until someone destroys it; only a leaked
 * runtime pin may be repaired on such an allocation. A pinned
 * session's recreate is queued like the sweep's, so the request answers
 * once the probes have, never after a create.
 */
export async function reconcileOrgSessions(
  sql: Sql,
  organizationId: string,
  spawner: WatchdogSpawner = DEFAULT_SPAWNER,
  scheduleRecreate?: RecreateScheduler,
): Promise<{ healed: number }> {
  const { healed } = await reconcilePass(sql, spawner, {
    batch: 25,
    now: Date.now(),
    organizationId,
    signal: AbortSignal.timeout(20_000),
    ...(scheduleRecreate !== undefined ? { scheduleRecreate } : {}),
  });
  return { healed };
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
async function reclaimEndedRunSessions(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: { batch: number; graceMs: number; now: number; signal?: AbortSignal },
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
  const visited: Candidate[] = [];
  for (const candidate of candidates) {
    if (args.signal?.aborted === true) break;
    visited.push(candidate);
    let outcome: { destroyed: boolean; busy: boolean };
    try {
      outcome = await spawner.destroyIfIdle(candidate.sessionId, {
        signal: args.signal,
      });
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
  await stampVisited(sql, visited, args.now);
  return reclaimed;
}

/**
 * Release the render sessions of cut-off scan links — see the RELEASE lane
 * above. Only a compute-holding `render` row older than a link can keep one
 * is a candidate, and the spawner destroys its session only when idle
 * (`if_idle`), as the reclaim does: busy and errors leave the row for a
 * later tick.
 */
async function releaseAbandonedRenderSessions(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: { batch: number; maxAgeMs: number; now: number; signal?: AbortSignal },
): Promise<number> {
  const horizon = args.now - args.maxAgeMs;
  const candidates = await sql<Candidate[]>`
    SELECT id, session_id AS "sessionId", org_id AS "orgId"
    FROM app.sandbox_sessions
    WHERE owner_type = 'render' AND status IN ('creating', 'active')
      AND created_at_ms < ${horizon}
    ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC, id ASC
    LIMIT ${args.batch}
  `;
  let released = 0;
  const visited: Candidate[] = [];
  for (const candidate of candidates) {
    if (args.signal?.aborted === true) break;
    visited.push(candidate);
    let outcome: { destroyed: boolean; busy: boolean };
    try {
      outcome = await spawner.destroyIfIdle(candidate.sessionId, {
        signal: args.signal,
      });
    } catch (error) {
      // Spawner unreachable or refusing ⇒ the container may survive; the row
      // must not settle ahead of it. Next tick retries.
      console.warn(
        `[watchdog] render-session release failed for ${candidate.sessionId}:`,
        error,
      );
      continue;
    }
    // The worker the dead link started is still rendering: nobody reads its
    // output, but it ends on its own budget — the next tick takes it.
    if (outcome.busy) continue;
    await markSessionDestroyed(sql, {
      organizationId: candidate.orgId,
      sessionId: candidate.sessionId,
    });
    released += 1;
  }
  await stampVisited(sql, visited, args.now);
  return released;
}

/**
 * Collect the leftovers of failed creates — see the COLLECT lane above.
 * Session ids are deterministic, so the next turn inserts a fresh row under
 * the failed row's id: a row whose id a newer or live incarnation carries is
 * settled WITHOUT a spawner call, since whatever the spawner holds under the
 * id is that incarnation's. Otherwise the spawner removes the session only
 * when idle (`if_idle`), exactly like the reclaim — an agent session's
 * compute alone, keeping its workspace, a render's whole: busy and errors
 * leave the row for a later tick.
 */
async function collectFailedSessions(
  sql: Sql,
  spawner: WatchdogSpawner,
  args: { batch: number; graceMs: number; now: number; signal?: AbortSignal },
): Promise<number> {
  const horizon = args.now - args.graceMs;
  const candidates = await sql<(Candidate & { ownerType: string })[]>`
    SELECT id, session_id AS "sessionId", org_id AS "orgId",
           owner_type AS "ownerType"
    FROM app.sandbox_sessions
    WHERE status = 'failed' AND destroyed_at_ms IS NULL
      AND coalesce(last_activity_at_ms, created_at_ms) < ${horizon}
    ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC, id ASC
    LIMIT ${args.batch}
  `;
  let collected = 0;
  const visited: Candidate[] = [];
  for (const candidate of candidates) {
    if (args.signal?.aborted === true) break;
    visited.push(candidate);
    // Asked per row, right before the spawner call, so a successor inserted
    // after the batch was selected still holds the destroy off.
    if (!(await isSupersededIncarnation(sql, candidate))) {
      let outcome: { busy: boolean };
      try {
        outcome = AGENT_OWNER_TYPES.has(candidate.ownerType)
          ? await spawner.stopIfIdle(candidate.sessionId, {
              signal: args.signal,
            })
          : await spawner.destroyIfIdle(candidate.sessionId, {
              signal: args.signal,
            });
      } catch (error) {
        console.warn(
          `[watchdog] failed-session collect failed for ${candidate.sessionId}:`,
          error,
        );
        continue;
      }
      if (outcome.busy) continue;
    }
    if (await stampFailedSessionCollected(sql, candidate)) collected += 1;
  }
  await stampVisited(sql, visited, args.now);
  return collected;
}

/** The owners whose sessions run an agent in a workspace kept between its
 * turns or steps: a project agent's, an automation run's. */
const AGENT_OWNER_TYPES: ReadonlySet<string> = new Set([
  'project_agent',
  'workflow_run',
]);

/** Does another incarnation own the spawner session a failed row names — a
 * newer row of any status, or a live row of any age? Deployment-wide, not
 * per organization: the spawner's session namespace is. */
async function isSupersededIncarnation(
  sql: Sql,
  candidate: Candidate,
): Promise<boolean> {
  const rows = await sql<{ superseded: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.sandbox_sessions f
      JOIN app.sandbox_sessions n
        ON n.session_id = f.session_id AND n.id <> f.id
      WHERE f.id = ${candidate.id}
        AND (n.created_at_ms > f.created_at_ms
          OR n.status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]}))
    ) AS superseded
  `;
  return rows[0]?.superseded ?? false;
}

/** Settle one collected row by primary key: `destroyed_at_ms` records that
 * its leftovers are gone, and the status stays `failed` — the fact of that
 * incarnation. NOT `markSessionDestroyed`: it settles every row and revokes
 * every token under the session id, a live successor's included, while a
 * failed incarnation never minted credentials (the hosts mint only after
 * `ensureAgentSession` returns). */
async function stampFailedSessionCollected(
  sql: Sql,
  candidate: Candidate,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.sandbox_sessions SET destroyed_at_ms = ${Date.now()}
    WHERE id = ${candidate.id} AND status = 'failed'
      AND destroyed_at_ms IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}
