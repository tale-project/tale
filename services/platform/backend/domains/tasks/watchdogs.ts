import type { Sql } from 'postgres';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { CHAT_GENERATION_STALE_MS } from '../chat/watchdogs.ts';
import { releaseProjectAgentSessionSlot } from '../sandbox/sessions.ts';
import {
  failAgentRun,
  failAgentRunFromTurn,
  listOverdueAgentRuns,
  listParkedAgentRunOrganizations,
  wakeOrganizationParkedAgentRun,
} from './agent-runs.ts';

/** Parked runs one watchdog tick wakes per organization (see the wake). */
const PARKED_WAKES_PER_TICK = 4;

/** How long a native run may be `running` with no transcript at all — the
 * job claimed it and died before opening one — before it is failed. */
const NATIVE_OPEN_GRACE_MS = 5 * 60_000;
/** How long a native run's turn may be over (or not yet begun) before its
 * settle is taken for lost. The turn ends, then the host settles within
 * seconds; this is the slack for a slow database, not for work. */
const NATIVE_SETTLE_GRACE_MS = 2 * 60_000;

/**
 * Native runs whose turn is gone: `running`, with no engine to ask — a
 * native run has no exec and no op row — so the question is asked of its
 * transcript's generation, the row a live turn keeps beating. Three ways to
 * be lost:
 *  - the job claimed the run and died before it opened a transcript;
 *  - the transcript's turn is over, or never began, yet the run was not
 *    settled: the host died between the two;
 *  - the turn's heartbeat went silent for as long as a chat reply's may
 *    (`CHAT_GENERATION_STALE_MS`, the window every tool of a turn ends well
 *    inside): the process was killed mid-turn.
 * The chat generation sweep clears a silent generation too; either order
 * ends with the run failed here.
 */
async function listLostNativeRuns(
  sql: Sql,
  limit = 50,
): Promise<{ id: string; organizationId: string; execId: string }[]> {
  const now = Date.now();
  return sql<{ id: string; organizationId: string; execId: string }[]>`
    SELECT r.id, r.org_id AS "organizationId", r.exec_id AS "execId"
    FROM app.project_agent_runs r
    LEFT JOIN app.generations g ON g.thread_id = r.thread_id
    WHERE r.engine = 'native' AND r.status = 'running'
      AND (
        (r.thread_id IS NULL
          AND r.updated_at_ms < ${now - NATIVE_OPEN_GRACE_MS})
        OR (r.thread_id IS NOT NULL AND g.thread_id IS NULL
          AND r.updated_at_ms < ${now - NATIVE_SETTLE_GRACE_MS})
        OR (g.thread_id IS NOT NULL
          AND g.heartbeat_at_ms < ${now - CHAT_GENERATION_STALE_MS})
      )
    ORDER BY r.updated_at_ms
    LIMIT ${limit}
  `;
}

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
 *    claim for every organization with a parked run, so a lost edge costs
 *    minutes, never forever.
 *
 * Re-attach of a LIVE turn (stale heartbeat with the agent still working)
 * rides the drive-continuation increment — this sweep only settles what is
 * provably overdue.
 */
export async function runTaskAgentWatchdog(sql: Sql): Promise<{
  failed: number;
  /** Agent workers hibernated because no live turn held them. */
  released: number;
  woken: number;
}> {
  let failed = 0;
  for (const run of await listOverdueAgentRuns(sql)) {
    const didFail = await failAgentRun(sql, {
      organizationId: run.organizationId,
      runId: run.id,
      execId: run.execId,
      error: 'the agent run ran past its time limit and was stopped',
      failureCode: 'deadline',
    });
    if (!didFail) continue;
    failed += 1;
    // A native run has no exec to stop and no worker slot to free: ending
    // its turn is the flag a Stop sets on its transcript's generation.
    if (run.engine === 'native') {
      if (run.threadId !== null) {
        await sql`
          UPDATE app.generations SET cancel_requested = true
          WHERE thread_id = ${run.threadId} AND org_id = ${run.organizationId}
        `;
      }
      continue;
    }
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
    // Free the agent's standing-session slot (the same running-op-guarded
    // release the host runs after a settle; it wakes a parked run too).
    await releaseProjectAgentSessionSlot(sql, {
      organizationId: run.organizationId,
      agentId: run.agentId,
    });
  }

  // A native run whose turn is gone fails as interrupted — retried, like a
  // harness run whose exec vanished — and its leftover turn, if it still
  // runs, is told to stop.
  for (const run of await listLostNativeRuns(sql)) {
    const didFail = await failAgentRunFromTurn(sql, {
      runId: run.id,
      execId: run.execId,
      error: 'the agent run was interrupted before it finished',
      failureCode: 'turn_crashed',
    });
    if (!didFail) continue;
    failed += 1;
    await sql`
      UPDATE app.generations SET cancel_requested = true
      WHERE thread_id = (
        SELECT thread_id FROM app.project_agent_runs WHERE id = ${run.id}
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
      failureCode: 'park_deadline',
    });
    if (didFail) failed += 1;
  }

  // Backstop for a slot held by nothing. A settle leaves a worker up while a
  // live run names it — one that claimed it, or a fresh kick still naming
  // the family's first worker; when that run dies before it starts
  // (cancelled, deleted, superseded by a retry) or claims another worker,
  // no later edge ever releases that worker and the org's project budget is
  // held until the 24 h TTL. The release re-checks the same guards under
  // the org's admission lock, so a live turn that appeared since is left
  // alone.
  let released = 0;
  const orphaned = await sql<{ organizationId: string; agentId: string }[]>`
    SELECT DISTINCT s.org_id AS "organizationId", s.owner_id AS "agentId"
    FROM app.sandbox_sessions s
    WHERE s.owner_type = 'project_agent'
      AND s.status IN ('creating', 'active', 'degraded') AND s.pinned = false
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_session_ops op
        WHERE op.session_id = s.session_id AND op.status = 'running'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.project_agent_runs r
        WHERE r.org_id = s.org_id AND r.session_id = s.session_id
          AND r.engine = 'harness'
          AND r.status IN ('queued', 'running')
          AND r.waiting_for_capacity_at_ms IS NULL
      )
    LIMIT 50
  `;
  for (const owner of orphaned) {
    if (await releaseProjectAgentSessionSlot(sql, owner)) released += 1;
  }

  // Room a run parked for can free without any edge of its own
  // organization: the sandbox host is shared, and its capacity frees when
  // another organization's sessions end. So each tick wakes a few parked
  // runs of every organization that has one, not one run; a start that
  // still finds no room parks again at no cost beyond the refused create.
  // One organization's failed wake is logged and the tick goes on to the
  // next: it must never leave every later organization's runs waiting.
  let woken = 0;
  for (const { organizationId } of await listParkedAgentRunOrganizations(sql)) {
    try {
      for (let wake = 0; wake < PARKED_WAKES_PER_TICK; wake += 1) {
        const one = await wakeOrganizationParkedAgentRun(sql, organizationId);
        if (one === 0) break;
        woken += one;
      }
    } catch (error) {
      console.error(
        `[task-agent] watchdog: waking parked runs of ${organizationId} failed:`,
        error,
      );
    }
  }
  return { failed, released, woken };
}
