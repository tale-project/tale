import type { Sql } from 'postgres';

import { sessionOpLastSignOfLifeMs } from '../../core/sandbox/agent_deadline.ts';
import type { SandboxAgentOpKind } from '../../core/sandbox/session_constants.ts';

/**
 * The agent-turn recovery primitives shared by the task and automation
 * re-attach sweeps — the 0.5 twin of 0.4's
 * `sandbox/session_mutations.claimRecoveryResume`. The op row is the one
 * liveness record every drive chain bumps, so the claim that fences a
 * re-attach lives with the sandbox domain that owns it, not with either
 * lane's sweep.
 */

/** A live drainer bumps the op heartbeat once per window (~90s); silence
 * past this means the chain is gone — to the re-attach sweeps, and to the
 * sandbox expiry sweep, which stops sparing a turn's session once its op has
 * been silent this long. Same knob as 0.4. */
export const RECOVERY_STALE_MS = (() => {
  const configured = Number(process.env.TALE_AGENT_TURN_RECOVERY_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 4 * 60 * 1000;
})();

/** A sweep has 60 s to probe, inside its queue's 120 s expiry. Four
 * concurrent five-second probes keep a full offline batch below that budget.
 * A reservation expires with the sweep, independently of the agent lease. */
export const RECOVERY_PROBE_BUDGET_MS = 60_000;
export const RECOVERY_PROBE_TIMEOUT_MS = 5_000;

export function recoveryProbeSignal(signal?: AbortSignal): AbortSignal {
  const budget = AbortSignal.timeout(RECOVERY_PROBE_BUDGET_MS);
  return signal === undefined ? budget : AbortSignal.any([signal, budget]);
}

/** Shared bounded walker; the visit passes this signal into network I/O.
 * Every selected row was reserved in SQL before this starts, so a killed
 * worker or an expired budget leaves fair, retryable work for another tick. */
export async function visitRecoveryCandidates<T>(
  candidates: readonly T[],
  signal: AbortSignal,
  visit: (candidate: T, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  let next = 0;
  const visits = await Promise.allSettled(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (!signal.aborted && next < candidates.length) {
        const candidate = candidates[next++];
        if (candidate !== undefined) await visit(candidate, signal);
      }
    }),
  );
  // Do not let one failed database call leave other probes detached from
  // the job that owns them while its retry begins.
  const failed = visits.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/**
 * Whether a drive job for this exec is already on its way: queued (or
 * waiting out a retry) for a worker slot, or running and started inside the
 * staleness window. A live chain bumps the op heartbeat only when a window
 * ends, so a turn whose next window waits behind a full worker reads as
 * silent while its chain is alive; re-attaching it would start a second
 * chain beside the first, and a third on a later sweep. A running job that
 * started before the window, with the op silent since, belongs to a worker
 * that died with it: drive jobs carry no heartbeat and expire only after
 * twelve hours, so the re-attach must not wait for it.
 */
export async function driveJobPending(
  sql: Sql,
  args: {
    queue: 'task.agent_drive' | 'automation.agent_drive';
    execId: string;
    staleBeforeMs: number;
  },
): Promise<boolean> {
  const rows = await sql<{ pending: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pgboss.job
      WHERE name = ${args.queue} AND data ->> 'execId' = ${args.execId}
        AND (state IN ('created', 'retry')
          OR (state = 'active'
            AND started_on >= to_timestamp(${args.staleBeforeMs / 1000})))
    ) AS pending
  `;
  return rows[0]?.pending ?? false;
}

/**
 * Claim the resume for one turn. Returns false when something signed the
 * op's lease after the listing read it — a live chain's bump, a concurrent
 * sweep, or a settle still proving life.
 *
 * The three phase shapes 0.4 documented all heal here: a MISSING op row is
 * created (the insert IS the claim), a TERMINAL op row is latched (the op
 * finished; only the run-side settle died), and a RUNNING one has its lease
 * bumped with a dead finalize winner's election RE-OPENED.
 */
export async function claimRecoveryResume(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    staleBeforeMs: number;
    createMissing: {
      organizationId: string;
      /** The lane's own op kind — the run-card and metric reads are keyed
       * on it, so a row created under any other kind stays invisible. */
      kind: SandboxAgentOpKind;
      /** The harness the abandoned turn runs on, so the row the watchdog
       * creates counts under it like one the host opened. */
      harness?: string;
      deadlineMs: number;
    };
  },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        status: string;
        startedAt: number;
        heartbeatAt: number | null;
        finalizedAt: number | null;
        finishedAt: number | null;
      }[]
    >`
      SELECT id, status, started_at_ms::float8 AS "startedAt",
             heartbeat_at_ms::float8 AS "heartbeatAt",
             finalized_at_ms::float8 AS "finalizedAt",
             finished_at_ms::float8 AS "finishedAt"
      FROM app.sandbox_session_ops
      WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
      FOR UPDATE
    `;
    const row = rows[0];
    const now = Date.now();
    if (row === undefined) {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, exec_id, kind, status, harness, deadline_ms,
          started_at_ms, heartbeat_at_ms, resumed_by
        ) VALUES (
          ${args.createMissing.organizationId}, ${args.sessionId},
          ${args.execId}, ${args.createMissing.kind}, 'running',
          ${args.createMissing.harness ?? null},
          ${args.createMissing.deadlineMs}, ${now}, ${now}, 'watchdog'
        )
        ON CONFLICT (session_id, exec_id) DO NOTHING
        RETURNING id
      `;
      return inserted.length > 0;
    }
    const lastSignOfLife = sessionOpLastSignOfLifeMs({
      startedAt: row.startedAt,
      ...(row.heartbeatAt !== null ? { heartbeatAt: row.heartbeatAt } : {}),
      ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
      ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
    });
    // A live chain signed the lease after the listing → NOT abandoned.
    if (lastSignOfLife >= args.staleBeforeMs) return false;
    if (row.status !== 'running') {
      // Terminal op, dead run-side settle: latch only — the op is done.
      await tx`
        UPDATE app.sandbox_session_ops
        SET heartbeat_at_ms = ${now}, resumed_by = 'watchdog'
        WHERE id = ${row.id}
      `;
      return true;
    }
    await tx`
      UPDATE app.sandbox_session_ops SET
        heartbeat_at_ms = ${now}, resumed_by = 'watchdog',
        -- Dead finalize winner: re-open the election it claimed but never won.
        finalized_at_ms = NULL
      WHERE id = ${row.id}
    `;
    return true;
  });
}
