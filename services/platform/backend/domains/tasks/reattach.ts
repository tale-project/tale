import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { sessionExecStatus } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { claimRecoveryResume, RECOVERY_STALE_MS } from '../sandbox/recovery.ts';
import { failAgentRun } from './agent-runs.ts';

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
 *    exists — once that row has been quiet past the staleness window, so a
 *    restart-steer that just rotated the exec and has not yet written the
 *    new op row is not mistaken for a dead start.
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
        -- No op row: a start that died before writing one — but only once
        -- the run row itself has been quiet past the window. A restart-steer
        -- rotates the exec (bumping updated_at_ms) and writes the new exec's
        -- op row only after re-staging; in that gap the run is alive, not
        -- abandoned, and claiming it would drive an exec nobody spawned yet.
        (op.id IS NULL AND r.updated_at_ms < ${staleBeforeMs})
        -- An op row whose lease went silent. The arm is fenced to rows that
        -- EXIST: over a missing op every mark is NULL and greatest() folds
        -- the coalesced zeros to 0, which is "stale" for every op-less run
        -- and would swallow the age rule above.
        OR (
          op.id IS NOT NULL
          AND greatest(
                op.started_at_ms,
                coalesce(op.heartbeat_at_ms, 0),
                coalesce(op.finalized_at_ms, 0),
                coalesce(op.finished_at_ms, 0)
              ) < ${staleBeforeMs}
        )
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

/**
 * Recover runs stranded at `queued` — the start job (task.agent_turn) died
 * before it could flip the run to `running` (a deploy/restart in the start
 * window: resolve model, ensure session, stage, spawn).
 *
 * This is the gap the running-state re-attach above cannot see and the
 * deadline sweep will not touch until the 12-hour wall — the run has no op
 * row yet (the start dies before writing one), no capacity stamp (it never
 * parked), and its deadline is hours away, so `recoverStalledTaskAgentTurns`
 * (status='running' only), the parked-run wake (needs a capacity stamp), and
 * `listOverdueAgentRuns` (past deadline only) all pass it by. Without this
 * the card shows `queued` for up to 12 hours, then fails with a misleading
 * time-limit message.
 *
 * Two outcomes, both honest:
 *  - the assigned agent is GONE (deleted after the kick): the start job skips
 *    forever (task-list.ts), so the run is FAILED immediately with a real
 *    reason instead of aging to the deadline;
 *  - otherwise the start is re-kicked under a ROTATED exec id — the
 *    single-winner claim (guarded on the old exec id) means a lost-but-slow
 *    original start, if it ever runs, reads the mismatch and skips, so the
 *    turn can never double-start (at-most-once LLM spend preserved).
 *
 * A run only enters this list once it has been idle past the staleness window
 * (a healthy start flips to `running` within seconds), and the claim bumps
 * `updated_at_ms`, so a re-kicked run is not swept again on the next tick.
 */
export async function recoverStuckQueuedTaskAgentRuns(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ examined: number; requeued: number; failed: number }> {
  const staleBeforeMs = Date.now() - (options.staleMs ?? RECOVERY_STALE_MS);
  const now = Date.now();
  const stuck = await sql<
    {
      runId: string;
      organizationId: string;
      execId: string;
      agentPresent: boolean;
    }[]
  >`
    SELECT r.id AS "runId", r.org_id AS "organizationId",
           r.exec_id AS "execId", (a.id IS NOT NULL) AS "agentPresent"
    FROM app.project_agent_runs r
    LEFT JOIN app.project_agents a
      ON a.id = r.agent_id AND a.org_id = r.org_id
    WHERE r.status = 'queued'
      AND r.waiting_for_capacity_at_ms IS NULL
      AND r.deadline_at_ms > ${now}
      AND r.updated_at_ms < ${staleBeforeMs}
    ORDER BY r.updated_at_ms
    LIMIT ${SWEEP_LIMIT}
  `;
  let requeued = 0;
  let failed = 0;
  for (const run of stuck) {
    if (!run.agentPresent) {
      const didFail = await failAgentRun(sql, {
        organizationId: run.organizationId,
        runId: run.runId,
        execId: run.execId,
        error: 'the assigned agent was deleted before the run could start',
      });
      if (didFail) {
        failed += 1;
        console.warn(
          `[task-agent-watchdog] failed stranded queued run ${run.runId} — its agent was deleted`,
        );
      }
      continue;
    }
    // Single-winner claim: rotate the exec id so a lost-but-slow original
    // start orphans itself (both its idempotency gate and its running flip
    // — `launchAgentRun` — are exec-id fenced, so it cannot spawn).
    const newExecId = randomUUID();
    const claimed = await sql<{ id: string }[]>`
      UPDATE app.project_agent_runs SET
        exec_id = ${newExecId}, updated_at_ms = ${Date.now()}
      WHERE id = ${run.runId} AND status = 'queued'
        AND exec_id = ${run.execId} AND waiting_for_capacity_at_ms IS NULL
      RETURNING id
    `;
    if (claimed.length === 0) continue;
    await addJobInTx(sql, 'task.agent_turn', {
      organizationId: run.organizationId,
      runId: run.runId,
      execId: newExecId,
    });
    requeued += 1;
    console.warn(
      `[task-agent-watchdog] re-kicked stranded queued run ${run.runId} (exec ${run.execId} → ${newExecId})`,
    );
  }
  return { examined: stuck.length, requeued, failed };
}
