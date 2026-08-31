import type { Sql } from 'postgres';

import { sessionExecStatus } from '../../../convex/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { claimRecoveryResume, RECOVERY_STALE_MS } from '../sandbox/recovery.ts';

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

export async function recoverStalledTaskAgentTurns(
  sql: Sql,
  options: { staleMs?: number; probe?: typeof sessionExecStatus } = {},
): Promise<{ examined: number; resumed: number }> {
  const staleBeforeMs = Date.now() - (options.staleMs ?? RECOVERY_STALE_MS);
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
