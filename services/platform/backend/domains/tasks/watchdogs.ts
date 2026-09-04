import type { Sql } from 'postgres';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  failAgentRun,
  listOverdueAgentRuns,
  listParkedAgentRuns,
  wakeParkedAgentRuns,
} from './agent-runs.ts';

/**
 * The task-agent lane's 2-minute backstops — the 0.5 twins of
 * `tasks/recover_agent_turns` + the parked-run watchdog half of the 0.4
 * capacity machinery:
 *
 *  - DEADLINE: a run past its hard deadline is failed with the deadline
 *    reason, its sandbox exec STOPPED, its session op settled `cancelled`,
 *    and its session slot released — a lost drive chain must never strand
 *    a run `running` forever with its gateway key alive, and failing the
 *    run must not leave the agent process grinding on in the still-warm
 *    container (the in-chain deadline cut in `agent_run_host` cancels the
 *    exec too; a Retry that starts a second exec against the same standing
 *    workspace must never meet the first one). A PARKED run past deadline
 *    fails too (it never launched, so there is no exec, op or slot to
 *    settle) — under permanent capacity pressure the queue must still drain.
 *  - PARKED: the release-edge wake is best-effort; this sweep re-runs the
 *    claim per org so a lost edge costs minutes, never forever.
 *
 * Re-attach of a LIVE turn (stale heartbeat with the agent still working)
 * rides the drive-continuation increment — this sweep only settles what is
 * provably overdue.
 */
export async function runTaskAgentWatchdog(sql: Sql): Promise<{
  failed: number;
  woken: number;
}> {
  let failed = 0;
  for (const run of await listOverdueAgentRuns(sql)) {
    const didFail = await failAgentRun(sql, {
      organizationId: run.organizationId,
      runId: run.id,
      execId: run.execId,
      error: 'the agent run ran past its time limit and was stopped',
    });
    if (!didFail) continue;
    failed += 1;
    // Stop the process, not just its ledger: the exec keeps running until
    // its own end otherwise (its gateway key is revoked, so it grinds on
    // auth errors), burning the slot this sweep is about to free. Best-
    // effort — an unreachable spawner must not keep the run `running`.
    try {
      await sessionCancelExec(run.sessionId, run.execId);
    } catch (error) {
      console.warn(
        `[task-agent] watchdog: exec cancel failed for run ${run.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
    await sql`
      UPDATE app.sandbox_session_ops SET
        status = 'cancelled', finished_at_ms = ${Date.now()},
        finalized_at_ms = coalesce(finalized_at_ms, ${Date.now()})
      WHERE session_id = ${run.sessionId} AND exec_id = ${run.execId}
        AND status = 'running'
    `;
    // Free the agent's standing-session slot (running-op guard inline).
    await sql`
      UPDATE app.sandbox_sessions s SET status = 'stopped'
      WHERE s.owner_type = 'project_agent' AND s.owner_id = ${run.agentId}
        AND s.org_id = ${run.organizationId}
        AND s.status IN ('creating', 'active', 'degraded')
        AND s.pinned = false
        AND NOT EXISTS (
          SELECT 1 FROM app.sandbox_session_ops op
          WHERE op.session_id = s.session_id AND op.status = 'running'
        )
    `;
  }

  const overdueParked = await sql<
    { id: string; organizationId: string; execId: string }[]
  >`
    SELECT id, org_id AS "organizationId", exec_id AS "execId"
    FROM app.project_agent_runs
    WHERE status = 'queued' AND waiting_for_capacity_at_ms IS NOT NULL
      AND deadline_at_ms < ${Date.now()}
    ORDER BY deadline_at_ms
    LIMIT 50
  `;
  for (const run of overdueParked) {
    const didFail = await failAgentRun(sql, {
      organizationId: run.organizationId,
      runId: run.id,
      execId: run.execId,
      error:
        'the agent run waited for sandbox capacity past its time limit and was stopped',
    });
    if (didFail) failed += 1;
  }

  let woken = 0;
  const parkedOrgs = new Set(
    (await listParkedAgentRuns(sql)).map((run) => run.organizationId),
  );
  for (const organizationId of parkedOrgs) {
    woken += await wakeParkedAgentRuns(sql, organizationId);
  }
  return { failed, woken };
}
