import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * The project-agent run ledger over PG — the 0.5 twin of
 * `convex/tasks/agent_runs.ts`: exactly-once settle, the capacity-park
 * claim (clearing `waiting_for_capacity_at_ms` IS the single-winner
 * election — the release-edge wake and the watchdog both claim before
 * scheduling, so one run never gets two concurrent starts), `launched_at`
 * distinct from `started_at` (a parked-out run must never pass for one
 * that worked hours), and the kick that turns an agent-owned task's move
 * to `in_progress` into a queued run + a `task.agent_turn` job.
 */

export const TASK_AGENT_RUN_DEADLINE_MS = 12 * 60 * 60 * 1000;

export interface AgentRunRow {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  execId: string;
  sessionId: string;
  status: string;
  harness: string;
  model: string;
  modelProvider: string | null;
  error: string | null;
  resultText: string | null;
  resultMessageId: string | null;
  trigger: string | null;
  feedback: string | null;
  waitingForCapacityAt: number | null;
  agentSessionId: string | null;
  startedBy: string;
  startedAt: number;
  launchedAt: number | null;
  deadlineAt: number;
  settledAt: number | null;
}

const RUN_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId",
  task_id AS "taskId", agent_id AS "agentId", exec_id AS "execId",
  session_id AS "sessionId", status, harness, model,
  model_provider AS "modelProvider", error, result_text AS "resultText",
  result_message_id AS "resultMessageId", trigger, feedback,
  waiting_for_capacity_at_ms::float8 AS "waitingForCapacityAt",
  agent_session_id AS "agentSessionId", started_by AS "startedBy",
  started_at_ms::float8 AS "startedAt", launched_at_ms::float8 AS "launchedAt",
  deadline_at_ms::float8 AS "deadlineAt", settled_at_ms::float8 AS "settledAt"
`;

/** The agent's STANDING session id — the workspace persists across runs. */
export function sessionIdForProjectAgent(agentId: string): string {
  return `pa-${agentId}`;
}

export interface KickAgentRunArgs {
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  harness: string;
  model: string;
  modelProvider?: string;
  startedBy: string;
  trigger?: 'manual' | 'mention' | 'auto_retry';
  feedback?: string;
}

/**
 * Kick one run: insert the `queued` row and enqueue the turn job in the
 * SAME transaction. At most one live (queued|running) run per task — a
 * concurrent kick answers with the standing run instead of double-driving.
 */
export async function kickAgentRun(
  tx: TransactionSql,
  args: KickAgentRunArgs,
): Promise<{ runId: string; execId: string; reused: boolean }> {
  const live = await tx<{ id: string; execId: string }[]>`
    SELECT id, exec_id AS "execId" FROM app.project_agent_runs
    WHERE task_id = ${args.taskId} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  if (live[0]) {
    return { runId: live[0].id, execId: live[0].execId, reused: true };
  }
  const now = Date.now();
  const execId = randomUUID();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, model_provider, trigger, feedback, started_by,
      started_at_ms, deadline_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.projectId}, ${args.taskId},
      ${args.agentId}, ${execId}, ${sessionIdForProjectAgent(args.agentId)},
      'queued', ${args.harness}, ${args.model},
      ${args.modelProvider ?? null}, ${args.trigger ?? 'manual'},
      ${args.feedback ?? null}, ${args.startedBy}, ${now},
      ${now + TASK_AGENT_RUN_DEADLINE_MS}, ${now}
    )
    RETURNING id
  `;
  const runId = rows[0]?.id;
  if (!runId) throw new Error('agent run insert failed');
  await addJobInTx(tx, 'task.agent_turn', {
    organizationId: args.organizationId,
    runId,
    execId,
  });
  return { runId, execId, reused: false };
}

export async function getAgentRun(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<AgentRunRow | null> {
  const rows = await sql<AgentRunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.project_agent_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listAgentRunsForTask(
  sql: Sql,
  organizationId: string,
  taskId: string,
  limit = 20,
): Promise<AgentRunRow[]> {
  return sql<AgentRunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.project_agent_runs
    WHERE task_id = ${taskId} AND org_id = ${organizationId}
    ORDER BY started_at_ms DESC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;
}

/** The turn actually launched — `launched_at` distinct from kick time. */
export async function setAgentRunRunning(
  sql: Sql,
  args: { organizationId: string; runId: string; execId: string },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.project_agent_runs SET
      status = 'running', launched_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId} AND status = 'queued'
    RETURNING id
  `;
  return rows.length > 0;
}

/** Settle exactly once (success). A cancelled run stays cancelled. */
export async function settleAgentRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    execId: string;
    resultText?: string;
    resultMessageId?: string;
    agentSessionId?: string;
  },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.project_agent_runs SET
      status = 'settled', result_text = ${args.resultText ?? null},
      result_message_id = ${args.resultMessageId ?? null},
      agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id),
      settled_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId} AND status IN ('queued', 'running')
    RETURNING id
  `;
  return rows.length > 0;
}

export async function failAgentRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    execId: string;
    error: string;
    apiErrorStatus?: number;
  },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.project_agent_runs SET
      status = 'failed', error = ${args.error.slice(0, 2000)},
      api_error_status = ${args.apiErrorStatus ?? null},
      settled_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId} AND status IN ('queued', 'running')
    RETURNING id
  `;
  return rows.length > 0;
}

export async function cancelAgentRun(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.project_agent_runs SET
      status = 'cancelled', settled_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND status IN ('queued', 'running')
    RETURNING id
  `;
  return rows.length > 0;
}

/** Park the run on a full session budget: it stays queued, stamped. */
export async function parkAgentRunForCapacity(
  sql: Sql,
  args: { organizationId: string; runId: string; execId: string },
): Promise<void> {
  await sql`
    UPDATE app.project_agent_runs SET
      waiting_for_capacity_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId} AND status = 'queued'
  `;
}

/** Claim a parked run for a restart — clearing the stamp IS the election. */
export async function claimParkedAgentRun(
  sql: Sql,
  args: { organizationId: string; runId: string; execId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.project_agent_runs SET
      waiting_for_capacity_at_ms = NULL, updated_at_ms = ${Date.now()}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId} AND status = 'queued'
      AND waiting_for_capacity_at_ms IS NOT NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * The release-edge wake: claim the org's OLDEST parked run and re-enqueue
 * its turn. A spurious wake (nobody parked) is a cheap no-op; a failed
 * restart re-parks, re-arming the claim.
 */
export async function wakeParkedAgentRuns(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  return sql.begin(async (tx) => {
    const parked = await tx<{ id: string; execId: string }[]>`
      SELECT id, exec_id AS "execId" FROM app.project_agent_runs
      WHERE org_id = ${organizationId} AND status = 'queued'
        AND waiting_for_capacity_at_ms IS NOT NULL
      ORDER BY waiting_for_capacity_at_ms
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const run = parked[0];
    if (!run) return 0;
    await tx`
      UPDATE app.project_agent_runs SET
        waiting_for_capacity_at_ms = NULL, updated_at_ms = ${Date.now()}
      WHERE id = ${run.id}
    `;
    await addJobInTx(tx, 'task.agent_turn', {
      organizationId,
      runId: run.id,
      execId: run.execId,
    });
    return 1;
  });
}

/** Watchdog work lists: parked runs (oldest first) and stalled launches. */
export async function listParkedAgentRuns(
  sql: Sql,
  limit = 50,
): Promise<Array<{ organizationId: string; runId: string; execId: string }>> {
  return sql<{ organizationId: string; runId: string; execId: string }[]>`
    SELECT org_id AS "organizationId", id AS "runId", exec_id AS "execId"
    FROM app.project_agent_runs
    WHERE status = 'queued' AND waiting_for_capacity_at_ms IS NOT NULL
    ORDER BY waiting_for_capacity_at_ms
    LIMIT ${limit}
  `;
}

export async function listOverdueAgentRuns(
  sql: Sql,
  limit = 50,
): Promise<AgentRunRow[]> {
  return sql<AgentRunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.project_agent_runs
    WHERE status IN ('queued', 'running')
      AND deadline_at_ms < ${Date.now()}
      AND waiting_for_capacity_at_ms IS NULL
    ORDER BY deadline_at_ms
    LIMIT ${limit}
  `;
}
