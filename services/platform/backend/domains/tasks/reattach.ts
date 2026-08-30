import type { Sql } from 'postgres';

import { sessionExecStatus } from '../../../convex/node_only/sandbox/helpers/session_client.ts';
import { sessionOpLastSignOfLifeMs } from '../../../convex/sandbox/agent_deadline.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Re-attach abandoned task-agent turns — the 0.5 twin of 0.4's
 * `recoverStalledTaskAgentTurns`.
 *
 * A turn is driven by a chain of jobs holding a live drain on the exec. When
 * that chain dies mid-turn — a backend restart, an unhandled throw, a lost
 * reschedule — the sandbox keeps running the agent while the run row sits at
 * `running` with a silent op row and an unrevoked gateway key, and NOTHING
 * notices until the 12-hour deadline, because the deadline is only evaluated
 * inside the very chain that died.
 *
 * Re-attaching is safe by construction: the drive window replays the exec's
 * ring buffer, the settle is claimed exactly once, and the resume CLAIM
 * closes the query→enqueue race — so a turn whose chain merely stuttered
 * cannot be driven twice.
 *
 * Three rules carried over verbatim:
 *  - PROBE FIRST: a transport hiccup must never read as "dead agent"; an
 *    unreachable spawner leaves the run for the next sweep;
 *  - a REFUSED claim is logged, never silent — the original wedge hid behind
 *    a logless skip for hours;
 *  - a run whose op row was never written (a start that died before it) is
 *    claimed by CREATING the row: the run row is the durable proof the turn
 *    exists.
 */

/** A live drainer bumps the op heartbeat once per window (~90s); silence
 * past this means the chain is gone. Same knob as 0.4. */
const STALE_MS = (() => {
  const configured = Number(process.env.TALE_AGENT_TURN_RECOVERY_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 4 * 60 * 1000;
})();

/** Runs examined per sweep. */
const SWEEP_LIMIT = 25;

interface StalledTurn {
  runId: string;
  organizationId: string;
  taskId: string;
  agentId: string;
  execId: string;
  sessionId: string;
  harness: string;
  deadlineAt: number;
}

/**
 * Runs at `running` whose turn shows no sign of life: either the op row's
 * lease went silent, or there is no op row at all (a start that died before
 * writing one). Deadline-overdue runs belong to the deadline sweep, not
 * here — failing them is that sweep's job.
 */
async function listStalledTurns(
  sql: Sql,
  staleBeforeMs: number,
): Promise<StalledTurn[]> {
  const now = Date.now();
  return sql<StalledTurn[]>`
    SELECT r.id AS "runId", r.org_id AS "organizationId",
           r.task_id AS "taskId", r.agent_id AS "agentId",
           r.exec_id AS "execId", r.session_id AS "sessionId", r.harness,
           r.deadline_at_ms::float8 AS "deadlineAt"
    FROM app.project_agent_runs r
    LEFT JOIN app.sandbox_session_ops op
      ON op.session_id = r.session_id AND op.exec_id = r.exec_id
    WHERE r.status = 'running'
      AND r.deadline_at_ms > ${now}
      AND (
        op.id IS NULL
        OR greatest(
             op.started_at_ms,
             coalesce(op.heartbeat_at_ms, 0),
             coalesce(op.finalized_at_ms, 0),
             coalesce(op.finished_at_ms, 0)
           ) < ${staleBeforeMs}
      )
    ORDER BY r.updated_at_ms
    LIMIT ${SWEEP_LIMIT}
  `;
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
async function claimRecoveryResume(
  sql: Sql,
  args: {
    sessionId: string;
    execId: string;
    staleBeforeMs: number;
    createMissing: {
      organizationId: string;
      kind: string;
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
      await tx`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, exec_id, kind, status, deadline_ms,
          started_at_ms, heartbeat_at_ms, resumed_by
        ) VALUES (
          ${args.createMissing.organizationId}, ${args.sessionId},
          ${args.execId}, ${args.createMissing.kind}, 'running',
          ${args.createMissing.deadlineMs}, ${now}, ${now}, 'watchdog'
        )
        ON CONFLICT (session_id, exec_id) DO NOTHING
      `;
      return true;
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

export async function recoverStalledTaskAgentTurns(
  sql: Sql,
  options: { staleMs?: number; probe?: typeof sessionExecStatus } = {},
): Promise<{ examined: number; resumed: number }> {
  const staleBeforeMs = Date.now() - (options.staleMs ?? STALE_MS);
  const stalled = await listStalledTurns(sql, staleBeforeMs);
  const probe = options.probe ?? sessionExecStatus;
  let resumed = 0;
  for (const turn of stalled) {
    try {
      // Probe first — the drive window handles running, terminal and
      // vanished execs alike; this only proves the sandbox is reachable.
      await probe(turn.sessionId, turn.execId);
    } catch (error) {
      console.warn(
        `[task-agent-watchdog] exec probe failed for ${turn.execId} (leaving for the next sweep):`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }
    const claimed = await claimRecoveryResume(sql, {
      sessionId: turn.sessionId,
      execId: turn.execId,
      staleBeforeMs,
      createMissing: {
        organizationId: turn.organizationId,
        kind: 'agent-run',
        deadlineMs: turn.deadlineAt,
      },
    });
    if (!claimed) {
      console.warn(
        `[task-agent-watchdog] resume claim refused for ${turn.execId} of run ${turn.runId} — a live chain or a fresh settle owns it`,
      );
      continue;
    }
    await addJobInTx(sql, 'task.agent_drive', {
      organizationId: turn.organizationId,
      runId: turn.runId,
      taskId: turn.taskId,
      agentId: turn.agentId,
      execId: turn.execId,
      sessionId: turn.sessionId,
      harness: turn.harness,
      deadlineAt: turn.deadlineAt,
    });
    resumed += 1;
    console.warn(
      `[task-agent-watchdog] re-attached abandoned turn ${turn.execId} of run ${turn.runId} (task ${turn.taskId})`,
    );
  }
  return { examined: stalled.length, resumed };
}
