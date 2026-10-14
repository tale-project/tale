import type { Sql, TransactionSql } from 'postgres';

import {
  isSpawnerTransportFailure,
  sandboxLeaseAcquire,
  sandboxLeaseRelease,
  sandboxLeases,
  SpawnerStatusError,
  type SandboxHeavyLease,
  type SandboxLeaseAcquisition,
  type SandboxLeaseRequest,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import type { HeldLease } from './heavy-lease-requests.ts';

/**
 * Heavy-phase leases, the platform's side. A sandbox host is admitted into
 * by the work it starts, but what presses it comes later, inside sessions
 * already admitted: a dependency install, an image build, a check of a whole
 * workspace, a full test suite. Before such a phase a project agent's task
 * run asks the host for a lease (the agent tool `host_lease_acquire`), and
 * the host grants it only while it can take the phase (the spawner's
 * `host-admission.ts`): not under pressure, fewer heavy phases than its
 * limit, room on disk and in memory beside what the others announced.
 *
 *  - A lease is asked for on the run's own session only, by the live run its
 *    token names; the run is told why a refusal holds and when to ask again,
 *    and that leases do not exist where the host cannot be judged
 *    (Kubernetes, Incus, a remote Docker daemon, a spawner without leases),
 *    so a run there never waits for one.
 *  - The platform records each lease it took (`app.sandbox_heavy_leases`),
 *    so a run releases only its own, holds one at a time, and every lease it
 *    still holds is released when it ends: a job queued in the transaction
 *    that ended it (`heavy-lease-requests.ts`), with the sandbox sweep as the
 *    backstop. A lease the host no longer holds counts as released.
 *  - The host keeps its leases in memory: one also ends at its expiry, with
 *    its session, and when the spawner restarts.
 */

/** The spawner verbs leases use. Injectable so the unit layer and the
 * real-Postgres lane drive them with a stand-in; production signs every call
 * through the session client. */
export interface LeaseSpawner {
  acquire: (
    sessionId: string,
    request: SandboxLeaseRequest,
  ) => Promise<SandboxLeaseAcquisition>;
  release: (args: {
    organizationId: string;
    sessionId: string;
    leaseId: string;
  }) => Promise<'released' | 'gone'>;
  list: (organizationId: string) => Promise<SandboxHeavyLease[] | null>;
}

const DEFAULT_LEASE_SPAWNER: LeaseSpawner = {
  acquire: (sessionId, request) => sandboxLeaseAcquire(sessionId, request),
  release: (args) => sandboxLeaseRelease(args),
  list: (organizationId) => sandboxLeases(organizationId),
};

/** When to ask again after the host did not answer at all (a restart, a
 * deploy): long enough to come back, short against a phase's wait. */
const UNREACHABLE_RETRY_MS = 15_000;

/** How long after its run ended the sweep takes over a lease the release
 * job has not ended: the job goes first. One sweep tick. */
const RUN_LEASE_SWEEP_GRACE_MS = 5 * 60_000;

/** How long a released lease's row is kept, to read back what a run held. */
const RELEASED_LEASE_RETENTION_MS = 7 * 24 * 3_600_000;

/** Why the platform stopped counting a lease (`release_reason`). */
type LeaseEnd = 'released' | 'run_ended' | 'expired';

/** The task run a lease call acts for: the live run on the token's session
 * and execution, of the project agent the session belongs to. */
interface LeaseRun {
  runId: string;
  sessionId: string;
}

type RunProof = LeaseRun | 'not_a_project_agent_run' | 'run_ended';

/**
 * Prove the run a lease call acts for from the token alone — its session
 * and its execution, never the call. Only a project agent's task run, live
 * on that execution in the agent's own session, holds leases: a session of
 * anyone else (an automation run, a chat) is no such run, and a run that has
 * ended holds nothing any more.
 */
async function proveLeaseRun(
  sql: Sql | TransactionSql,
  args: { organizationId: string; sessionId: string; taskRunExecId?: string },
): Promise<RunProof> {
  if (args.taskRunExecId === undefined) return 'not_a_project_agent_run';
  const runs = await sql<LeaseRun[]>`
    SELECT r.id AS "runId", r.session_id AS "sessionId"
    FROM app.project_agent_runs r
    WHERE r.org_id = ${args.organizationId}
      AND r.session_id = ${args.sessionId}
      AND r.exec_id = ${args.taskRunExecId}
      AND r.status IN ('queued', 'running')
      AND EXISTS (
        SELECT 1 FROM app.sandbox_sessions s
        WHERE s.org_id = r.org_id AND s.session_id = r.session_id
          AND s.owner_type = 'project_agent' AND s.owner_id = r.agent_id
      )
    ORDER BY r.seq DESC
    LIMIT 1
  `;
  const run = runs[0];
  if (run !== undefined) return run;
  const sessions = await sql<{ ownerType: string }[]>`
    SELECT owner_type AS "ownerType" FROM app.sandbox_sessions
    WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  return sessions[0]?.ownerType === 'project_agent'
    ? 'run_ended'
    : 'not_a_project_agent_run';
}

/** Stop counting a lease, once: a lease already ended keeps the time and
 * reason it ended with. */
async function markLeaseEnded(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    leaseId: string;
    reason: LeaseEnd;
    now: number;
  },
): Promise<void> {
  await sql`
    UPDATE app.sandbox_heavy_leases
    SET released_at_ms = ${args.now}, release_reason = ${args.reason}
    WHERE org_id = ${args.organizationId} AND lease_id = ${args.leaseId}
      AND released_at_ms IS NULL
  `;
}

/** When to ask again after an answer that said "not now" without a lease
 * verdict (a spawner restarting, a gateway timing out). */
function retryAfterOf(error: unknown): number {
  return error instanceof SpawnerStatusError && error.retryAfterMs !== undefined
    ? Math.max(error.retryAfterMs, 1_000)
    : UNREACHABLE_RETRY_MS;
}

/** End a lease the host granted but the platform could not record for its
 * run; a failure leaves it to its expiry and its session's end. */
async function endUnrecordedLease(
  spawner: LeaseSpawner,
  organizationId: string,
  lease: SandboxHeavyLease,
): Promise<void> {
  try {
    await spawner.release({
      organizationId,
      sessionId: lease.sessionId,
      leaseId: lease.id,
    });
  } catch (error) {
    console.warn(
      `[sandbox.leases] could not end lease ${lease.id}, which no run holds; it ends at its expiry or with session ${lease.sessionId}:`,
      error,
    );
  }
}

/** A lease as the run that holds it is told about it. */
export interface RunLeaseView {
  leaseId: string;
  label: string | null;
  expiresAtMs: number;
}

/** A lease call's request: the token's session and execution, and what the
 * agent said of the phase. Sizes left out take the host's defaults. */
export interface RunLeaseRequest {
  organizationId: string;
  sessionId: string;
  taskRunExecId?: string;
  label: string;
  predictedGrowthBytes?: number;
  memoryBytes?: number;
  ttlMs?: number;
}

/**
 * What a run is told when it asks for a lease:
 *  - `granted` — run the phase;
 *  - `already_held` — the run holds a lease already: one heavy phase at a
 *    time per run, so a run that forgot its lease cannot take every slot;
 *  - `refused` — the host holds the phase back (`pressure`, `pacing`,
 *    `stale`, `limit`, `disk`, `memory`): wait `retryAfterMs`, ask again;
 *  - `unreachable` — the host did not answer: ask again;
 *  - `unavailable` — leases do not exist here: run the phase without one;
 *  - `not_a_project_agent_run`, `run_ended` — nothing to lease for.
 */
export type RunLeaseAcquisition =
  | { outcome: 'granted'; lease: RunLeaseView }
  | { outcome: 'already_held'; lease: RunLeaseView }
  | { outcome: 'refused'; reason: string; retryAfterMs: number }
  | { outcome: 'unreachable'; retryAfterMs: number }
  | { outcome: 'unavailable' }
  | { outcome: 'not_a_project_agent_run' }
  | { outcome: 'run_ended' };

/**
 * Ask the host for a heavy-phase lease for the run the token names, on its
 * own session, and record it for the run. The record is written only while
 * the run is still live (its row locked against the end of the run); a run
 * that ended between the question and the answer has the lease ended at
 * once instead.
 *
 * A host that cannot answer at all is asked again; one that answers what
 * this client cannot read (a session being stopped, an unknown shape) is
 * treated as a host without leases, so no run ever waits for a verdict that
 * will never come.
 */
export async function acquireRunHeavyLease(
  sql: Sql,
  args: RunLeaseRequest,
  spawner: LeaseSpawner = DEFAULT_LEASE_SPAWNER,
): Promise<RunLeaseAcquisition> {
  const run = await proveLeaseRun(sql, args);
  if (typeof run === 'string') return { outcome: run };
  const now = Date.now();
  // A lease past its expiry has ended on the host by itself.
  await sql`
    UPDATE app.sandbox_heavy_leases
    SET released_at_ms = ${now}, release_reason = 'expired'
    WHERE org_id = ${args.organizationId} AND run_id = ${run.runId}
      AND released_at_ms IS NULL AND expires_at_ms <= ${now}
  `;
  const held = await sql<RunLeaseView[]>`
    SELECT lease_id AS "leaseId", label,
           expires_at_ms::float8 AS "expiresAtMs"
    FROM app.sandbox_heavy_leases
    WHERE org_id = ${args.organizationId} AND run_id = ${run.runId}
      AND released_at_ms IS NULL
    ORDER BY acquired_at_ms DESC
    LIMIT 1
  `;
  const current = held[0];
  if (current !== undefined) return { outcome: 'already_held', lease: current };

  let answer: SandboxLeaseAcquisition;
  try {
    answer = await spawner.acquire(run.sessionId, {
      organizationId: args.organizationId,
      label: args.label,
      ...(args.predictedGrowthBytes !== undefined
        ? { predictedGrowthBytes: args.predictedGrowthBytes }
        : {}),
      ...(args.memoryBytes !== undefined
        ? { memoryBytes: args.memoryBytes }
        : {}),
      ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
    });
  } catch (error) {
    if (isSpawnerTransportFailure(error)) {
      return { outcome: 'unreachable', retryAfterMs: retryAfterOf(error) };
    }
    console.warn(
      `[sandbox.leases] the host could not judge a lease for run ${run.runId}; the run goes on without one:`,
      error,
    );
    return { outcome: 'unavailable' };
  }
  if (!answer.granted) {
    return answer.reason === 'unavailable'
      ? { outcome: 'unavailable' }
      : {
          outcome: 'refused',
          reason: answer.reason,
          retryAfterMs: answer.retryAfterMs,
        };
  }

  const { lease } = answer;
  let recorded: boolean;
  try {
    recorded = await sql.begin(async (tx) => {
      // Locked against the end of the run: an end that committed first is
      // seen here, one still to come waits for this record, and the sweep
      // ends a lease an end did not see.
      const live = await tx<{ id: string }[]>`
        SELECT id FROM app.project_agent_runs
        WHERE id = ${run.runId} AND org_id = ${args.organizationId}
          AND status IN ('queued', 'running')
        FOR SHARE
      `;
      if (live.length === 0) return false;
      await tx`
        INSERT INTO app.sandbox_heavy_leases (
          lease_id, org_id, session_id, run_id, exec_id, label,
          predicted_growth_bytes, memory_bytes, acquired_at_ms, expires_at_ms
        ) VALUES (
          ${lease.id}, ${args.organizationId}, ${run.sessionId}, ${run.runId},
          ${args.taskRunExecId ?? ''}, ${lease.label},
          ${lease.predictedGrowthBytes}, ${lease.memoryBytes},
          ${lease.acquiredAtMs}, ${lease.expiresAtMs}
        )
      `;
      return true;
    });
  } catch (error) {
    await endUnrecordedLease(spawner, args.organizationId, lease);
    throw error;
  }
  if (!recorded) {
    await endUnrecordedLease(spawner, args.organizationId, lease);
    return { outcome: 'run_ended' };
  }
  return {
    outcome: 'granted',
    lease: {
      leaseId: lease.id,
      label: lease.label,
      expiresAtMs: lease.expiresAtMs,
    },
  };
}

/**
 * What a run is told when it releases a lease: `released` (also when it had
 * ended already — the call is idempotent), `not_found` when the run holds
 * no such lease (another run's lease is not found either), `deferred` when
 * the host could not be asked: the lease ends by itself at its expiry and
 * when the run ends.
 */
export type RunLeaseRelease =
  | { outcome: 'released'; leaseId: string; alreadyReleased: boolean }
  | { outcome: 'not_found' }
  | { outcome: 'deferred'; leaseId: string; expiresAtMs: number }
  | { outcome: 'not_a_project_agent_run' }
  | { outcome: 'run_ended' };

/** Release one of the run's own leases, on its own session. */
export async function releaseRunHeavyLease(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    taskRunExecId?: string;
    leaseId: string;
  },
  spawner: LeaseSpawner = DEFAULT_LEASE_SPAWNER,
): Promise<RunLeaseRelease> {
  const run = await proveLeaseRun(sql, args);
  if (typeof run === 'string') return { outcome: run };
  const rows = await sql<
    { sessionId: string; expiresAtMs: number; released: boolean }[]
  >`
    SELECT session_id AS "sessionId", expires_at_ms::float8 AS "expiresAtMs",
           released_at_ms IS NOT NULL AS released
    FROM app.sandbox_heavy_leases
    WHERE lease_id = ${args.leaseId} AND org_id = ${args.organizationId}
      AND run_id = ${run.runId} AND session_id = ${run.sessionId}
  `;
  const row = rows[0];
  if (row === undefined) return { outcome: 'not_found' };
  if (row.released) {
    return {
      outcome: 'released',
      leaseId: args.leaseId,
      alreadyReleased: true,
    };
  }
  try {
    await spawner.release({
      organizationId: args.organizationId,
      sessionId: row.sessionId,
      leaseId: args.leaseId,
    });
  } catch (error) {
    console.warn(
      `[sandbox.leases] could not release lease ${args.leaseId} of run ${run.runId} now; it ends at its expiry or with the run:`,
      error,
    );
    return {
      outcome: 'deferred',
      leaseId: args.leaseId,
      expiresAtMs: row.expiresAtMs,
    };
  }
  await markLeaseEnded(sql, {
    organizationId: args.organizationId,
    leaseId: args.leaseId,
    reason: 'released',
    now: Date.now(),
  });
  return { outcome: 'released', leaseId: args.leaseId, alreadyReleased: false };
}

/**
 * End every lease a run that has ended still holds — the
 * `sandbox.release_run_leases` job and the sweep's backstop. Idempotent: a
 * lease ended already is skipped, one the host no longer holds counts as
 * ended. `leases` are the ones the ending transaction read: a lease whose
 * row went with its run is still ended on the host. A run that is somehow
 * live again keeps its leases. Throws when the host could not end one, so
 * the job retries; the ones it did end stay ended.
 */
export async function releaseEndedRunLeases(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    leases?: readonly HeldLease[];
  },
  spawner: LeaseSpawner = DEFAULT_LEASE_SPAWNER,
): Promise<{ ended: number }> {
  const live = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND status IN ('queued', 'running')
  `;
  if (live.length > 0) {
    console.warn(
      `[sandbox.leases] run ${args.runId} is live; its leases are not released`,
    );
    return { ended: 0 };
  }
  const rows = await sql<
    { leaseId: string; sessionId: string; released: boolean }[]
  >`
    SELECT lease_id AS "leaseId", session_id AS "sessionId",
           released_at_ms IS NOT NULL AS released
    FROM app.sandbox_heavy_leases
    WHERE org_id = ${args.organizationId} AND run_id = ${args.runId}
  `;
  const recorded = new Set(rows.map((row) => row.leaseId));
  const targets: HeldLease[] = rows
    .filter((row) => !row.released)
    .map((row) => ({ leaseId: row.leaseId, sessionId: row.sessionId }));
  // A lease the ending transaction read whose row is gone (its run went
  // with its task): only the host still holds it.
  for (const lease of args.leases ?? []) {
    if (!recorded.has(lease.leaseId)) targets.push(lease);
  }
  let ended = 0;
  let failed = 0;
  let firstFailure: unknown;
  for (const lease of targets) {
    try {
      await spawner.release({
        organizationId: args.organizationId,
        sessionId: lease.sessionId,
        leaseId: lease.leaseId,
      });
    } catch (error) {
      failed += 1;
      firstFailure ??= error;
      continue;
    }
    await markLeaseEnded(sql, {
      organizationId: args.organizationId,
      leaseId: lease.leaseId,
      reason: 'run_ended',
      now: Date.now(),
    });
    ended += 1;
  }
  if (failed > 0) {
    throw new Error(
      `could not release ${failed} of ${targets.length} heavy-phase lease(s) of ended run ${args.runId}`,
      { cause: firstFailure },
    );
  }
  return { ended };
}

export interface HeavyLeaseSweepResult {
  /** Leases past their expiry, ended on the host by themselves. */
  expired: number;
  /** Leases of ended runs the sweep ended on the host this tick. */
  released: number;
  /** Rows of leases released longer ago than the retention. */
  pruned: number;
}

/**
 * The backstop of the run-end release (the sandbox sweep, every five
 * minutes): stop counting the leases past their expiry; end, on the host,
 * the leases of runs that ended more than {@link RUN_LEASE_SWEEP_GRACE_MS}
 * ago and still hold them (a release job that ran out of retries, a lease
 * recorded as its run ended); drop the rows of leases released a week ago.
 * A run whose leases cannot be ended now is left for the next tick.
 */
export async function sweepHeavyLeases(
  sql: Sql,
  options: {
    now?: number;
    batch?: number;
    graceMs?: number;
    signal?: AbortSignal;
    spawner?: LeaseSpawner;
  } = {},
): Promise<HeavyLeaseSweepResult> {
  const now = options.now ?? Date.now();
  const expired = await sql`
    UPDATE app.sandbox_heavy_leases
    SET released_at_ms = ${now}, release_reason = 'expired'
    WHERE released_at_ms IS NULL AND expires_at_ms <= ${now}
  `;
  const graceMs = options.graceMs ?? RUN_LEASE_SWEEP_GRACE_MS;
  const ended = await sql<{ organizationId: string; runId: string }[]>`
    SELECT DISTINCT l.org_id AS "organizationId", l.run_id AS "runId"
    FROM app.sandbox_heavy_leases l
    JOIN app.project_agent_runs r ON r.id = l.run_id AND r.org_id = l.org_id
    WHERE l.released_at_ms IS NULL
      AND r.status IN ('settled', 'failed', 'cancelled')
      AND coalesce(r.settled_at_ms, r.updated_at_ms) <= ${now - graceMs}
    LIMIT ${options.batch ?? 25}
  `;
  let released = 0;
  for (const run of ended) {
    if (options.signal?.aborted === true) break;
    try {
      released += (await releaseEndedRunLeases(sql, run, options.spawner))
        .ended;
    } catch (error) {
      console.warn(
        `[sandbox.leases] the leases of ended run ${run.runId} could not be released this tick:`,
        error,
      );
    }
  }
  const pruned = await sql`
    DELETE FROM app.sandbox_heavy_leases
    WHERE lease_id IN (
      SELECT lease_id FROM app.sandbox_heavy_leases
      WHERE released_at_ms IS NOT NULL
        AND released_at_ms < ${now - RELEASED_LEASE_RETENTION_MS}
      LIMIT 500
    )
  `;
  return { expired: expired.count, released, pruned: pruned.count };
}

/** One active lease on the Sandboxes readback: what the host holds, and the
 * run that took it when the platform recorded one. */
export interface ActiveHeavyLease {
  leaseId: string;
  sessionId: string;
  label: string | null;
  predictedGrowthBytes: number;
  memoryBytes: number;
  acquiredAt: number;
  expiresAt: number;
  run: {
    runId: string;
    taskId: string;
    agentId: string;
    agentName: string | null;
    projectId: string;
  } | null;
}

export type ActiveHeavyLeases =
  | { status: 'unavailable'; reason: 'unreachable' | 'unsupported' }
  | { status: 'available'; observedAt: number; leases: ActiveHeavyLease[] };

/**
 * The organization's heavy-phase leases the host holds now, oldest first,
 * each with the run that took it where the platform recorded one. The host
 * is the source: a lease it dropped (expired, its session gone, a restart)
 * is not active, whatever a row says. `unsupported` for a spawner without
 * leases, `unreachable` when it could not be asked.
 */
export async function readActiveHeavyLeases(
  sql: Sql,
  organizationId: string,
  spawner: LeaseSpawner = DEFAULT_LEASE_SPAWNER,
): Promise<ActiveHeavyLeases> {
  let leases: SandboxHeavyLease[] | null;
  try {
    leases = await spawner.list(organizationId);
  } catch (error) {
    console.warn(
      '[sandbox.leases] the host’s leases could not be read:',
      error,
    );
    return { status: 'unavailable', reason: 'unreachable' };
  }
  if (leases === null) return { status: 'unavailable', reason: 'unsupported' };
  const ids = leases.map((lease) => lease.id);
  const rows =
    ids.length === 0
      ? []
      : await sql<
          {
            leaseId: string;
            runId: string;
            taskId: string;
            agentId: string;
            agentName: string | null;
            projectId: string;
          }[]
        >`
          SELECT l.lease_id AS "leaseId", r.id AS "runId",
                 r.task_id AS "taskId", r.agent_id AS "agentId",
                 a.name AS "agentName", r.project_id AS "projectId"
          FROM app.sandbox_heavy_leases l
          JOIN app.project_agent_runs r
            ON r.id = l.run_id AND r.org_id = l.org_id
          LEFT JOIN app.project_agents a
            ON a.id = r.agent_id AND a.org_id = r.org_id
          WHERE l.org_id = ${organizationId} AND l.lease_id = ANY(${ids})
        `;
  const runs = new Map(rows.map((row) => [row.leaseId, row]));
  return {
    status: 'available',
    observedAt: Date.now(),
    leases: leases
      .filter((lease) => lease.organizationId === organizationId)
      .toSorted((a, b) => a.acquiredAtMs - b.acquiredAtMs)
      .map((lease) => {
        const run = runs.get(lease.id);
        return {
          leaseId: lease.id,
          sessionId: lease.sessionId,
          label: lease.label,
          predictedGrowthBytes: lease.predictedGrowthBytes,
          memoryBytes: lease.memoryBytes,
          acquiredAt: lease.acquiredAtMs,
          expiresAt: lease.expiresAtMs,
          run:
            run === undefined
              ? null
              : {
                  runId: run.runId,
                  taskId: run.taskId,
                  agentId: run.agentId,
                  agentName: run.agentName,
                  projectId: run.projectId,
                },
        };
      }),
  };
}

/** The two lease seams of the workspace-tool dispatch, by the names it
 * addresses them with. */
export function heavyLeaseShimHandlers(sql: Sql): ShimHandlers {
  return {
    'sandbox/heavy_leases:acquireRunLease': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as RunLeaseRequest;
      return acquireRunHeavyLease(sql, args);
    },
    'sandbox/heavy_leases:releaseRunLease': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof releaseRunHeavyLease>[1];
      return releaseRunHeavyLease(sql, args);
    },
  };
}
