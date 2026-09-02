import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { AUTO_RETRY_MAX_ATTEMPTS } from '../../core/tasks/task_auto_retry.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { revokeSessionGatewayKeys } from '../sandbox/gateway-keys.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';

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
  /** 1-based display stamp for `trigger: 'auto_retry'` kicks. */
  autoRetryAttempt?: number;
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
      harness, model, model_provider, trigger, feedback, auto_retry_attempt,
      started_by, started_at_ms, deadline_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.projectId}, ${args.taskId},
      ${args.agentId}, ${execId}, ${sessionIdForProjectAgent(args.agentId)},
      'queued', ${args.harness}, ${args.model},
      ${args.modelProvider ?? null}, ${args.trigger ?? 'manual'},
      ${args.feedback ?? null}, ${args.autoRetryAttempt ?? null},
      ${args.startedBy}, ${now},
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
  // The status guard IS the settle election, so the provenance entry rides
  // the same transaction: a raced double-settle that degrades to a no-op
  // also writes no second ledger row.
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'settled', result_text = ${args.resultText ?? null},
        result_message_id = ${args.resultMessageId ?? null},
        agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id),
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND status IN ('queued', 'running')
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await recordTaskAgentRunLedgerEntry(tx, {
      runId: args.runId,
      organizationId: args.organizationId,
      finalStatus: 'settled',
      settledAt: now,
    });
    return true;
  });
}

/**
 * Fail exactly once (the watchdog's deadline pass — the drive chain's own
 * failures go through the shim's `markTaskAgentRunFailed`). The turn died
 * without reaching `releaseTurnKey`, so its gateway key is reclaimed here:
 * the winning flip IS the election, so the revoke fires once even when two
 * sweeps race. Scoped to THIS exec — a sibling turn on the same standing
 * `pa-<agentId>` session keeps its own key.
 */
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
  const failed = await sql.begin(async (tx) => {
    const rows = await tx<{ sessionId: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'failed', error = ${args.error.slice(0, 2000)},
        api_error_status = ${args.apiErrorStatus ?? null},
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND status IN ('queued', 'running')
      RETURNING session_id AS "sessionId"
    `;
    const run = rows[0];
    if (run === undefined) return null;
    // Inside the election's transaction: the provenance entry still reads
    // the turn's token row by key id, which the revoke below leaves in
    // place (it marks `revoked_at_ms`, it does not drop the id).
    await recordTaskAgentRunLedgerEntry(tx, {
      runId: args.runId,
      organizationId: args.organizationId,
      finalStatus: 'failed',
      settledAt: now,
      error: args.error.slice(0, 2000),
    });
    return run.sessionId;
  });
  if (failed === null) return false;
  await revokeSessionGatewayKeys(sql, {
    organizationId: args.organizationId,
    sessionId: failed,
    execId: args.execId,
  }).catch((error: unknown) => {
    console.error(
      `[task-agent] gateway key reclaim for deadline-failed run ${args.runId} failed:`,
      error,
    );
  });
  return true;
}

export async function cancelAgentRun(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'cancelled', settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND status IN ('queued', 'running')
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await recordTaskAgentRunLedgerEntry(tx, {
      runId: args.runId,
      organizationId: args.organizationId,
      finalStatus: 'cancelled',
      settledAt: now,
    });
    return true;
  });
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

// ---------------------------------------------------------------------------
// Detail-sheet reads (the run card + the live sandbox transcript)
// ---------------------------------------------------------------------------

/** The 0.4 run-card wire: the task's NEWEST run with its agent's name. */
export interface TaskAgentRunCard {
  _id: string;
  status: string;
  agentId: string;
  agentName?: string;
  harness: string;
  model: string;
  error?: string;
  resultText?: string;
  waitingForCapacity?: boolean;
  trigger?: string;
  autoRetryAttempt?: number;
  autoRetryMax: number;
  startedAt: number;
  settledAt?: number;
}

export async function getLatestAgentRunCardForTask(
  sql: Sql,
  organizationId: string,
  taskId: string,
): Promise<TaskAgentRunCard | null> {
  const rows = await sql<
    {
      id: string;
      status: string;
      agentId: string;
      agentName: string | null;
      harness: string;
      model: string;
      error: string | null;
      resultText: string | null;
      waitingForCapacityAt: number | null;
      trigger: string | null;
      autoRetryAttempt: number | null;
      startedAt: number;
      settledAt: number | null;
    }[]
  >`
    SELECT r.id, r.status, r.agent_id AS "agentId", a.name AS "agentName",
           r.harness, r.model, r.error, r.result_text AS "resultText",
           r.waiting_for_capacity_at_ms::float8 AS "waitingForCapacityAt",
           r.trigger, r.auto_retry_attempt AS "autoRetryAttempt",
           r.started_at_ms::float8 AS "startedAt",
           r.settled_at_ms::float8 AS "settledAt"
    FROM app.project_agent_runs r
    LEFT JOIN app.project_agents a ON a.id = r.agent_id
    WHERE r.org_id = ${organizationId} AND r.task_id = ${taskId}
    ORDER BY r.started_at_ms DESC
    LIMIT 1
  `;
  const run = rows[0];
  if (!run) return null;
  return {
    _id: run.id,
    status: run.status,
    agentId: run.agentId,
    ...(run.agentName !== null ? { agentName: run.agentName } : {}),
    harness: run.harness,
    model: run.model,
    ...(run.error !== null ? { error: run.error } : {}),
    ...(run.resultText !== null ? { resultText: run.resultText } : {}),
    ...(run.waitingForCapacityAt !== null ? { waitingForCapacity: true } : {}),
    ...(run.trigger !== null ? { trigger: run.trigger } : {}),
    ...(run.autoRetryAttempt !== null
      ? { autoRetryAttempt: run.autoRetryAttempt }
      : {}),
    autoRetryMax: AUTO_RETRY_MAX_ATTEMPTS,
    startedAt: run.startedAt,
    ...(run.settledAt !== null ? { settledAt: run.settledAt } : {}),
  };
}

/** The 0.4 sandbox-op wire for one run's live transcript. */
export interface TaskAgentRunSandboxOp {
  execId: string;
  status: string;
  progressText?: string;
  liveTimeline?: unknown;
  modelRef?: string;
  visionModelRef?: string;
  startedAt: number;
  finishedAt?: number;
  lastEventAt?: number;
}

/**
 * What a task's agent run is DOING inside the sandbox: the run's own op row
 * (its exec, plus `-`-suffixed derived incarnations) on the agent's STANDING
 * session — never a sibling run's op. Fail-closed null.
 */
export async function getAgentRunSandboxOp(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ projectId: string; op: TaskAgentRunSandboxOp | null } | null> {
  const runs = await sql<
    { projectId: string; sessionId: string; execId: string }[]
  >`
    SELECT project_id AS "projectId", session_id AS "sessionId",
           exec_id AS "execId"
    FROM app.project_agent_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (!run) return null;
  const ops = await sql<
    {
      execId: string;
      status: string;
      progressText: string | null;
      liveTimeline: unknown;
      modelRef: string | null;
      visionModelRef: string | null;
      startedAt: number;
      finishedAt: number | null;
      lastEventAt: number | null;
    }[]
  >`
    SELECT exec_id AS "execId", status, progress_text AS "progressText",
           live_timeline AS "liveTimeline", model_ref AS "modelRef",
           vision_model_ref AS "visionModelRef",
           started_at_ms::float8 AS "startedAt",
           finished_at_ms::float8 AS "finishedAt",
           last_event_at_ms::float8 AS "lastEventAt"
    FROM app.sandbox_session_ops
    WHERE org_id = ${organizationId} AND session_id = ${run.sessionId}
      AND kind = 'task-agent'
      AND (exec_id = ${run.execId} OR exec_id LIKE ${`${run.execId}-%`})
    ORDER BY started_at_ms DESC
    LIMIT 1
  `;
  const op = ops[0];
  if (!op) return { projectId: run.projectId, op: null };
  return {
    projectId: run.projectId,
    op: {
      execId: op.execId,
      status: op.status,
      ...(op.progressText !== null ? { progressText: op.progressText } : {}),
      ...(op.liveTimeline !== null && op.liveTimeline !== undefined
        ? { liveTimeline: op.liveTimeline }
        : {}),
      ...(op.modelRef !== null ? { modelRef: op.modelRef } : {}),
      ...(op.visionModelRef !== null
        ? { visionModelRef: op.visionModelRef }
        : {}),
      startedAt: op.startedAt,
      ...(op.finishedAt !== null ? { finishedAt: op.finishedAt } : {}),
      ...(op.lastEventAt !== null ? { lastEventAt: op.lastEventAt } : {}),
    },
  };
}
