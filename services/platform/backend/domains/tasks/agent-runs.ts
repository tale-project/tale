import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { BROKER_RATE_LIMIT_COOLDOWN_MS } from '../../core/provider_credentials/broker_pool.ts';
import { TASK_AGENT_OP_KIND } from '../../core/sandbox/session_constants.ts';
import type { MentionSource } from '../../core/tasks/mentions.ts';
import {
  AUTO_RETRY_MAX_ATTEMPTS,
  isAutoRetryableFailure,
  resolveAutoRetryBudget,
} from '../../core/tasks/task_auto_retry.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { ProjectError } from '../projects/service.ts';
import {
  STANDARD_AGENT_REFUSAL_CODES,
  standardAgentServingForKick,
} from '../projects/standard-agent.ts';
import { revokeSessionGatewayKeys } from '../sandbox/gateway-keys.ts';
import { TaskError } from './errors.ts';
import { loadTaskRetryHistory } from './kick-plan.ts';
import { sessionIdForAgentRun } from './run-authority.ts';
import {
  announceAgentRunFailed,
  withdrawAgentRunFailedNotices,
} from './run-failure-notice.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';
import { assertTaskAutomationEnabled, lockTaskRunStart } from './run-start.ts';

/**
 * The project-agent run ledger over PG — the 0.5 twin of
 * `convex/tasks/agent_runs.ts`: the terminal transitions (the turn host's
 * settle/fail marks, the watchdog's deadline fail, the cancel) each ride
 * ONE `UPDATE … WHERE status IN (live) RETURNING` election with the
 * provenance entry in the same transaction; the capacity-park claim
 * (clearing `waiting_for_capacity_at_ms` IS the single-winner election —
 * the release-edge wake and the watchdog both claim before scheduling, so
 * one run never gets two concurrent starts); `launched_at` distinct from
 * `started_at` (a parked-out run must never pass for one that worked
 * hours); and the kick that turns an agent-owned task's move to
 * `in_progress` into a queued run + a `task.agent_turn` job; and the
 * exec-fenced launch (`queued` → `running`). The turn host's other
 * non-terminal marks (broker token, park, rotate) live on its shim
 * (`agent-turn-shim.ts`).
 *
 * Every write that changes what a task's run looks like — queued, launched,
 * parked, woken, settled, failed, cancelled — hints the task
 * ({@link emitTaskRunHint}), so an open task follows its run without asking
 * again: the run strip, the run rows of the activity list and the board's
 * indicators all key under the task entity.
 */

const TASK_AGENT_RUN_DEADLINE_MS = 12 * 60 * 60 * 1000;

/**
 * Tell every open view of the task that its run changed. The run card used
 * to poll for this every two seconds while a task was open, and the run rows
 * of the activity list had no signal at all: a run that failed kept reading
 * "Queued" there until the page was reloaded.
 */
export async function emitTaskRunHint(
  db: Sql | TransactionSql,
  run: { organizationId: string; taskId: string },
): Promise<void> {
  await emitHintInTx(db, {
    orgId: run.organizationId,
    entity: 'task',
    entityId: run.taskId,
  });
}

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
  /** The producer's classification of a failed run (`TaskRunFailureCode`);
   * null on a run that did not fail and on rows failed before the column. */
  failureCode: string | null;
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
  /** Who put the agent to work when no person pressed Start (0139). */
  startedVia: 'automation' | 'agent' | null;
  /** The automation run, or the delegating agent run. */
  startedViaRunId: string | null;
  startedViaNodeId: string | null;
  startedViaAutomation: string | null;
  startedViaAgentId: string | null;
}

const RUN_COLUMNS = `
  id, org_id AS "organizationId", project_id AS "projectId",
  task_id AS "taskId", agent_id AS "agentId", exec_id AS "execId",
  session_id AS "sessionId", status, harness, model,
  model_provider AS "modelProvider", error, failure_code AS "failureCode",
  result_text AS "resultText",
  result_message_id AS "resultMessageId", trigger, feedback,
  waiting_for_capacity_at_ms::float8 AS "waitingForCapacityAt",
  agent_session_id AS "agentSessionId", started_by AS "startedBy",
  started_at_ms::float8 AS "startedAt", launched_at_ms::float8 AS "launchedAt",
  deadline_at_ms::float8 AS "deadlineAt", settled_at_ms::float8 AS "settledAt",
  started_via AS "startedVia", started_via_run_id AS "startedViaRunId",
  started_via_node_id AS "startedViaNodeId",
  started_via_automation AS "startedViaAutomation",
  started_via_agent_id AS "startedViaAgentId"
`;

/** How a run was kicked — the `trigger` column (migrations 0021, 0139). */
export type TaskAgentRunTrigger =
  | 'manual'
  | 'mention'
  | 'auto_retry'
  | 'automation'
  | 'delegated';

/**
 * Who put a project agent to work when no person pressed Start (0139): an
 * automation run's `task.start_agent` step, or another project agent's run
 * through the `task_start_agent` tool. Kept on the run and on its
 * auto-retries, never on a person's own later kick.
 */
export type StartedVia =
  | {
      kind: 'automation';
      /** The automation run whose step started it. */
      runId: string;
      /** The step (node) id — with the run and the task, the slot receipt. */
      nodeId: string;
      /** The automation's name, kept for display once the run is gone. */
      automation: string;
    }
  | {
      kind: 'agent';
      /** The delegating agent's run. */
      runId: string;
      /** The delegating project agent. */
      agentId: string;
    };

export interface KickAgentRunArgs {
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  harness: string;
  model: string;
  modelProvider?: string;
  startedBy: string;
  trigger?: TaskAgentRunTrigger;
  /** Who put the agent to work when no person pressed Start: an automation
   * step or another agent's run (`delegated-start.ts`). An `automation` or
   * `delegated` kick names it; an auto-retry carries its predecessor's. */
  startedVia?: StartedVia;
  /** The start left the card where it stood (`moveToInProgress: false`):
   * the run's successful completion neither moves the card nor requests a
   * review. Only with `startedVia`; an auto-retry carries its
   * predecessor's. */
  inPlace?: boolean;
  feedback?: string;
  /** Which text named the agent on a `mention` kick. A comment's body rides
   * as `feedback`; a description kick carries none, because the turn reads
   * the description as it stands when it starts (`buildKickPrompts`). */
  mentionSource?: MentionSource;
  /** Display stamp for `trigger: 'auto_retry'` kicks: the attempt of the
   * budget the retry spends, 1-based, or 0 for a free credential rotation
   * with none spent yet (`resolveAutoRetryBudget`). */
  autoRetryAttempt?: number;
  /** The turn may not start before this, epoch ms: the run is queued at
   * once, its start job waits (a subscription broker's cooldown). */
  startAfterMs?: number;
  /** The workspace the caller already chose and judged free for this run
   * (`sessionIdForAgentRun`): the automatic retry, whose busy probe looked
   * there, so the run lands where it looked. Absent, the kick chooses it
   * from the starter. */
  sessionId?: string;
}

/** The kick's serving for this agent (`standardAgentServingForKick`), its
 * refusals answered as the task door's own errors. */
async function standardAgentServing(
  tx: TransactionSql,
  args: KickAgentRunArgs,
): Promise<{ harness: string; model: string; modelProvider?: string }> {
  try {
    return await standardAgentServingForKick(tx, {
      organizationId: args.organizationId,
      agentId: args.agentId,
      startedBy: args.startedBy,
      harness: args.harness,
      model: args.model,
      ...(args.modelProvider !== undefined
        ? { modelProvider: args.modelProvider }
        : {}),
    });
  } catch (error) {
    if (
      error instanceof ProjectError &&
      STANDARD_AGENT_REFUSAL_CODES.has(error.code)
    ) {
      throw new TaskError(
        error.code,
        error.message,
        error.status === 403 ? 403 : 409,
        error.data,
      );
    }
    throw error;
  }
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
  await lockTaskRunStart(tx, args.organizationId, args.taskId);
  const automations = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
      AND status IN ('queued', 'running', 'waiting')
      AND input -> 'task' ->> 'id' = ${args.taskId}
    LIMIT 1
  `;
  if (automations.length > 0) {
    throw new TaskError(
      'TASK_HAS_LIVE_RUN',
      'An automation holds this task; cancel it before starting an agent',
      409,
    );
  }
  const liveRun = async (): Promise<
    { id: string; execId: string } | undefined
  > => {
    const live = await tx<{ id: string; execId: string }[]>`
      SELECT id, exec_id AS "execId" FROM app.project_agent_runs
      WHERE task_id = ${args.taskId} AND status IN ('queued', 'running')
      LIMIT 1
    `;
    return live[0];
  };
  const standing = await liveRun();
  if (standing) {
    return { runId: standing.id, execId: standing.execId, reused: true };
  }
  await assertTaskAutomationEnabled(tx, args.organizationId);
  // The organization's standard agent runs what its policy says now, not
  // what its row said when the caller read it (`standard-agent.ts`); every
  // other agent runs what the caller read.
  const serving = await standardAgentServing(tx, args);
  // The workspace follows the starter: a project editor's run joins the
  // agent's standing session, a member's run works in its own
  // (`run-authority.ts`).
  const sessionId = args.sessionId ?? (await sessionIdForAgentRun(tx, args));
  const now = Date.now();
  const execId = randomUUID();
  // "At most one live run per task" is the schema's rule (migration 0080's
  // partial unique index over the live statuses), not this read's: the human
  // doors kick SERIALIZABLE but the auto-retry job and the steer-miss
  // fallback kick READ COMMITTED, so the probe above can miss a run another
  // transaction is minting. The insert defers to the index — a loser answers
  // with the winner's run, exactly as if the probe had seen it. The re-read
  // only serves READ COMMITTED callers: under a serializable door a
  // conflicting row invisible to the snapshot makes the ON CONFLICT raise
  // 40001 instead, which `transactSerializable` retries — that throw path is
  // by design, not a gap.
  const via = args.startedVia;
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, model_provider, trigger, feedback, mention_source,
      auto_retry_attempt, started_by, started_at_ms, deadline_at_ms,
      updated_at_ms, started_via, started_via_run_id, started_via_node_id,
      started_via_automation, started_via_agent_id, in_place
    ) VALUES (
      ${args.organizationId}, ${args.projectId}, ${args.taskId},
      ${args.agentId}, ${execId}, ${sessionId},
      'queued', ${serving.harness}, ${serving.model},
      ${serving.modelProvider ?? null}, ${args.trigger ?? 'manual'},
      ${args.feedback ?? null}, ${args.mentionSource ?? null},
      ${args.autoRetryAttempt ?? null},
      ${args.startedBy}, ${now},
      ${now + TASK_AGENT_RUN_DEADLINE_MS}, ${now},
      ${via?.kind ?? null}, ${via?.runId ?? null},
      ${via?.kind === 'automation' ? via.nodeId : null},
      ${via?.kind === 'automation' ? via.automation : null},
      ${via?.kind === 'agent' ? via.agentId : null},
      ${via !== undefined && args.inPlace === true}
    )
    ON CONFLICT (task_id) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING id
  `;
  const runId = rows[0]?.id;
  if (!runId) {
    const winner = await liveRun();
    if (!winner) throw new Error('agent run insert failed');
    return { runId: winner.id, execId: winner.execId, reused: true };
  }
  await addJobInTx(
    tx,
    'task.agent_turn',
    { organizationId: args.organizationId, runId, execId },
    args.startAfterMs !== undefined && args.startAfterMs > now
      ? { startAfter: new Date(args.startAfterMs) }
      : {},
  );
  // A new run answers whatever the last failure asked of its readers: their
  // unread "the run failed" rows stop ringing. An automatic retry never gets
  // here with one to withdraw — the notice is written only once no retry
  // follows.
  await withdrawAgentRunFailedNotices(tx, {
    organizationId: args.organizationId,
    taskId: args.taskId,
  });
  await emitTaskRunHint(tx, args);
  return { runId, execId, reused: false };
}

/** Whether a run was started in place (`moveToInProgress: false`) — what
 * an auto-retry copies, so the retried run completes the same way. */
export async function inPlaceOfRun(
  sql: Sql | TransactionSql,
  runId: string,
): Promise<boolean> {
  const rows = await sql<{ inPlace: boolean }[]>`
    SELECT in_place AS "inPlace" FROM app.project_agent_runs
    WHERE id = ${runId} LIMIT 1
  `;
  return rows[0]?.inPlace ?? false;
}

/** The provenance a run carries when an automation step or another agent
 * started it (or started the run it retries) — what an auto-retry copies,
 * so a retried run keeps its lane. `undefined` for a person's own kick. */
export async function startedViaOfRun(
  sql: Sql | TransactionSql,
  runId: string,
): Promise<StartedVia | undefined> {
  const rows = await sql<
    {
      kind: string | null;
      runId: string | null;
      nodeId: string | null;
      automation: string | null;
      agentId: string | null;
    }[]
  >`
    SELECT started_via AS kind, started_via_run_id AS "runId",
           started_via_node_id AS "nodeId",
           started_via_automation AS automation,
           started_via_agent_id AS "agentId"
    FROM app.project_agent_runs WHERE id = ${runId} LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined || row.runId === null) return undefined;
  if (
    row.kind === 'automation' &&
    row.nodeId !== null &&
    row.automation !== null
  ) {
    return {
      kind: 'automation',
      runId: row.runId,
      nodeId: row.nodeId,
      automation: row.automation,
    };
  }
  if (row.kind === 'agent' && row.agentId !== null) {
    return { kind: 'agent', runId: row.runId, agentId: row.agentId };
  }
  return undefined;
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

/**
 * The turn host's RUNNING flip — the launch, `launched_at` distinct from kick
 * time. Exec-FENCED and elected on `queued`: between the start's idempotency
 * gate and this flip lie the session ensure, the skill and input staging and
 * the key mint (a cold sandbox create alone may take minutes), and in that
 * window the queued-run recovery may rotate the run onto a fresh exec and
 * re-kick it, or a cancel may land. A start whose exec no longer owns the
 * run must NOT launch — a second spawn double-drives the run, and a spawn
 * under a superseded exec is reaped as an orphan by the next drive window.
 * Returns whether THIS exec's start won the launch.
 */
export async function launchAgentRun(
  sql: Sql,
  args: { runId: string; execId: string },
): Promise<boolean> {
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<{ organizationId: string; taskId: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'running',
        launched_at_ms = coalesce(launched_at_ms, ${now}),
        updated_at_ms = ${now}
      WHERE id = ${args.runId} AND exec_id = ${args.execId}
        AND status = 'queued'
      RETURNING org_id AS "organizationId", task_id AS "taskId"
    `;
    const run = rows[0];
    if (run === undefined) return false;
    await emitTaskRunHint(tx, run);
    return true;
  });
}

/**
 * The turn host's SETTLE mark (the drive chain's success path). Exec-guarded
 * when the host passes its exec: a chain superseded by a restart-steer
 * rotation must not terminal-stamp the run its successor is working on. The
 * status guard IS the settle election, so the provenance entry rides the same
 * transaction — a raced double-settle that degrades to a no-op also writes no
 * second ledger row. Returns whether THIS call won the flip.
 */
export interface SettleAgentRunArgs {
  runId: string;
  resultText: string;
  resultMessageId?: string;
  execId?: string;
  /** The harness conversation id — the next kick's `--resume` handle. */
  agentSessionId?: string;
  sessionCreatedAt?: number;
}

export async function settleAgentRun(
  sql: Sql,
  args: SettleAgentRunArgs,
): Promise<boolean> {
  return sql.begin((tx) => settleAgentRunInTx(tx, args));
}

export async function settleAgentRunInTx(
  tx: TransactionSql,
  args: SettleAgentRunArgs,
): Promise<boolean> {
  const now = Date.now();
  const rows = await tx<{ organizationId: string; taskId: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'settled', result_text = ${args.resultText},
        result_message_id = ${args.resultMessageId ?? null},
        agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id),
        session_created_at_ms = coalesce(${args.sessionCreatedAt ?? null}::bigint, session_created_at_ms),
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId}
        AND status NOT IN ('settled', 'failed', 'cancelled')
        AND (${args.execId ?? null}::text IS NULL
             OR exec_id = ${args.execId ?? null})
      RETURNING org_id AS "organizationId", task_id AS "taskId"
    `;
  const run = rows[0];
  if (run === undefined) return false;
  await recordTaskAgentRunLedgerEntry(tx, {
    runId: args.runId,
    organizationId: run.organizationId,
    finalStatus: 'settled',
    settledAt: now,
  });
  await emitTaskRunHint(tx, run);
  return true;
}

/**
 * The turn host's FAILED mark (the drive chain's own failures: harness
 * error, harvest failure, start failure, empty turn, deadline cut inside the
 * chain). Same exec guard and same election as {@link settleAgentRun}; the
 * provenance entry rides the flip. Auto-retry hangs off the SAME once-only
 * claim: only the winning terminal flip arms `task.agent_retry`, so at most
 * one retry arm per failed run — the kick job re-derives the budget and
 * every guard; this is just the arm. A failure no retry follows is final
 * here, so the people the run answers to are told in the same transaction
 * ({@link announceAgentRunFailed}); one a retry follows is announced by the
 * retry job, once its budget is spent. Returns whether THIS call won the
 * flip.
 */
export async function failAgentRunFromTurn(
  sql: Sql,
  args: {
    runId: string;
    error: string;
    execId?: string;
    agentSessionId?: string;
    sessionCreatedAt?: number;
    /** Producer-side classification (`TaskRunFailureCode`); absent = retryable
     * (the default posture). Stamped on the row: the retry budget and the kick
     * plan read it back (`freeCredentialRotations`). */
    failureCode?: string;
    apiErrorStatus?: number;
    /** No retry can start before this, epoch ms — every account of the
     * subscription broker was cooling down after a rate limit. The retry is
     * still kicked at once, so the card shows it queued; its start waits. */
    retryAtMs?: number;
  },
): Promise<boolean> {
  const now = Date.now();
  const error = args.error.slice(0, 2000);
  // Stamped on the failed row with the arm, so the run card knows a retry
  // is coming without asking the queue.
  const armRetry = isAutoRetryableFailure(args.failureCode);
  return sql.begin(async (tx) => {
    const flipped = await tx<
      { organizationId: string; taskId: string; agentId: string }[]
    >`
      UPDATE app.project_agent_runs SET
        status = 'failed', error = ${error},
        failure_code = ${args.failureCode ?? null},
        auto_retry_armed_at_ms = ${armRetry ? now : null},
        api_error_status = ${args.apiErrorStatus ?? null},
        agent_session_id = coalesce(${args.agentSessionId ?? null}, agent_session_id),
        session_created_at_ms = coalesce(${args.sessionCreatedAt ?? null}::bigint, session_created_at_ms),
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId}
        AND status NOT IN ('settled', 'failed', 'cancelled')
        AND (${args.execId ?? null}::text IS NULL
             OR exec_id = ${args.execId ?? null})
      RETURNING org_id AS "organizationId", task_id AS "taskId",
                agent_id AS "agentId"
    `;
    const run = flipped[0];
    if (run === undefined) return false;
    await recordTaskAgentRunLedgerEntry(tx, {
      runId: args.runId,
      organizationId: run.organizationId,
      finalStatus: 'failed',
      settledAt: now,
      error,
    });
    if (armRetry) {
      // A cooldown ends a minute after its 429 at the latest, so a wait
      // stays far inside the stranded-queued-run sweep's window.
      const startAfterMs =
        args.retryAtMs !== undefined && args.retryAtMs > now
          ? Math.min(args.retryAtMs, now + BROKER_RATE_LIMIT_COOLDOWN_MS)
          : undefined;
      await addJobInTx(tx, 'task.agent_retry', {
        organizationId: run.organizationId,
        taskId: run.taskId,
        agentId: run.agentId,
        expectedRunId: args.runId,
        ...(startAfterMs !== undefined && { startAfterMs }),
      });
    } else {
      await announceAgentRunFailed(tx, {
        organizationId: run.organizationId,
        runId: args.runId,
      });
    }
    await emitTaskRunHint(tx, run);
    return true;
  });
}

/**
 * Fail exactly once (the watchdog's deadline pass — the drive chain's own
 * failures go through {@link failAgentRunFromTurn}). The turn died
 * without reaching `releaseTurnKey`, so its gateway key is reclaimed here:
 * the winning flip IS the election, so the revoke fires once even when two
 * sweeps race. Scoped to THIS exec — a sibling turn on the same standing
 * `pa-<agentId>` session keeps its own key. Nothing retries a run failed
 * here, so it is announced in the same transaction.
 */
export async function failAgentRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    execId: string;
    error: string;
    /** Why the sweep failed it (`TaskRunFailureCode`), so the run reads as
     * what happened instead of as an unclassified failure. */
    failureCode?: string;
    apiErrorStatus?: number;
  },
): Promise<boolean> {
  const now = Date.now();
  const failed = await sql.begin(async (tx) => {
    const rows = await tx<{ sessionId: string; taskId: string }[]>`
      UPDATE app.project_agent_runs SET
        status = 'failed', error = ${args.error.slice(0, 2000)},
        failure_code = ${args.failureCode ?? null},
        api_error_status = ${args.apiErrorStatus ?? null},
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND exec_id = ${args.execId} AND status IN ('queued', 'running')
      RETURNING session_id AS "sessionId", task_id AS "taskId"
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
    await announceAgentRunFailed(tx, {
      organizationId: args.organizationId,
      runId: args.runId,
    });
    await emitTaskRunHint(tx, {
      organizationId: args.organizationId,
      taskId: run.taskId,
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

export interface CancelAgentRunArgs {
  organizationId: string;
  runId: string;
  /** The task the caller was AUTHORIZED on. The cancel binds to it inside
   * the UPDATE predicate, so a run id lifted from another task (one the
   * caller may not even read) never matches — there is no unbound cancel
   * door: every lane that cancels a run holds its task. */
  taskId: string;
}

/**
 * The transactional body of {@link cancelAgentRun} — for callers already
 * inside a transaction (the task hard delete cancels the subtree's live runs
 * in the same tx that removes the rows, so the provenance entry lands before
 * the FK cascade takes the run row). The status guard is the settle
 * election, so the ledger entry rides the same transaction: a raced cancel
 * that degrades to a no-op also writes no second row.
 */
export async function cancelAgentRunInTx(
  tx: TransactionSql,
  args: CancelAgentRunArgs,
): Promise<boolean> {
  const now = Date.now();
  const rows = await tx<
    {
      id: string;
      execId: string;
      sessionId: string;
      agentId: string;
      harness: string;
      deadlineAt: number;
    }[]
  >`
    UPDATE app.project_agent_runs SET
      status = 'cancelled', settled_at_ms = ${now}, updated_at_ms = ${now}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND task_id = ${args.taskId}
      AND status IN ('queued', 'running')
    RETURNING id, exec_id AS "execId", session_id AS "sessionId",
              agent_id AS "agentId", harness, deadline_at_ms::float8 AS "deadlineAt"
  `;
  const run = rows[0];
  if (run === undefined) return false;
  await recordTaskAgentRunLedgerEntry(tx, {
    runId: args.runId,
    organizationId: args.organizationId,
    finalStatus: 'cancelled',
    settledAt: now,
  });
  // The active drive may be draining a long window. Enqueue its existing
  // orphan cleanup immediately; it kills only this exec, preserving sibling
  // turns in the agent's standing session. This survives process restarts.
  await addJobInTx(tx, 'task.agent_drive', {
    ...args,
    execId: run.execId,
    sessionId: run.sessionId,
    agentId: run.agentId,
    harness: run.harness,
    deadlineAt: run.deadlineAt,
  });
  await emitTaskRunHint(tx, args);
  return true;
}

export async function cancelAgentRun(
  sql: Sql,
  args: CancelAgentRunArgs,
): Promise<boolean> {
  const cancelled = await sql.begin((tx) => cancelAgentRunInTx(tx, args));
  if (cancelled) {
    const run = await getAgentRun(sql, args.organizationId, args.runId);
    if (run !== null) {
      // Do not wait for the active drain or the cleanup job's worker slot.
      // The queued orphan cleanup also covers a request/process interruption.
      await sessionCancelExec(run.sessionId, run.execId).catch((error) => {
        console.warn('[task-agent] immediate cancel exec reap failed:', error);
      });
    }
  }
  return cancelled;
}

/**
 * The release-edge wake: claim the org's OLDEST parked run and re-enqueue
 * its turn. A spurious wake (nobody parked) is a cheap no-op; a failed
 * restart re-parks, re-arming the claim. A parked run already past its
 * deadline is NOT a candidate: it belongs to the task-agent watchdog's
 * deadline lane (failed as "waited for capacity past its time limit"), and
 * waking it would launch a turn the drive's deadline cut stops on arrival —
 * un-parking it first would also hide it from that lane, which keys on
 * `waiting_for_capacity_at_ms IS NOT NULL`.
 */
export async function wakeParkedAgentRuns(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  return sql.begin(async (tx) => {
    const parked = await tx<{ id: string; execId: string; taskId: string }[]>`
      SELECT id, exec_id AS "execId", task_id AS "taskId"
      FROM app.project_agent_runs
      WHERE org_id = ${organizationId} AND status = 'queued'
        AND waiting_for_capacity_at_ms IS NOT NULL
        AND deadline_at_ms > ${Date.now()}
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
    await emitTaskRunHint(tx, { organizationId, taskId: run.taskId });
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
  /** The producer's classification of a failed run — what the card words
   * its reason by (`lib/shared/task-run-failure.ts`); `error` stays the raw
   * detail. */
  failureCode?: string;
  /** A failed run the platform is about to retry by itself: the card says
   * "Failed" for the moment it takes the retry to queue, and nothing should
   * tell the reader to act on a failure that is not final. */
  retryPending?: boolean;
  resultText?: string;
  waitingForCapacity?: boolean;
  trigger?: string;
  autoRetryAttempt?: number;
  autoRetryMax: number;
  /** The run's starter — a bare user id for every project-agent run. */
  startedBy: string;
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
      failureCode: string | null;
      resultText: string | null;
      waitingForCapacityAt: number | null;
      trigger: string | null;
      autoRetryAttempt: number | null;
      startedBy: string;
      startedAt: number;
      settledAt: number | null;
    }[]
  >`
    SELECT r.id, r.status, r.agent_id AS "agentId", a.name AS "agentName",
           r.harness, r.model, r.error, r.failure_code AS "failureCode",
           r.result_text AS "resultText",
           r.waiting_for_capacity_at_ms::float8 AS "waitingForCapacityAt",
           r.trigger, r.auto_retry_attempt AS "autoRetryAttempt",
           r.started_by AS "startedBy",
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
  const retryPending =
    run.status === 'failed' && run.agentName !== null
      ? await failedRunRetryPending(sql, taskId, run.id)
      : false;
  return {
    _id: run.id,
    status: run.status,
    agentId: run.agentId,
    ...(run.agentName !== null ? { agentName: run.agentName } : {}),
    harness: run.harness,
    model: run.model,
    ...(run.error !== null ? { error: run.error } : {}),
    ...(run.failureCode !== null ? { failureCode: run.failureCode } : {}),
    ...(retryPending ? { retryPending: true } : {}),
    ...(run.resultText !== null ? { resultText: run.resultText } : {}),
    ...(run.waitingForCapacityAt !== null ? { waitingForCapacity: true } : {}),
    ...(run.trigger !== null ? { trigger: run.trigger } : {}),
    ...(run.autoRetryAttempt !== null
      ? { autoRetryAttempt: run.autoRetryAttempt }
      : {}),
    autoRetryMax: AUTO_RETRY_MAX_ATTEMPTS,
    // Who the run answers to — the person who may stop and steer it even
    // once the task is no longer theirs.
    startedBy: run.startedBy,
    startedAt: run.startedAt,
    ...(run.settledAt !== null ? { settledAt: run.settledAt } : {}),
  };
}

/**
 * Whether the task's newest run, which failed, is one the retry job will
 * start again: its retry was armed when it failed, it is still the newest
 * run, the job has not retired it, and the budget has room — the job's own
 * walk (`resolveAutoRetryBudget` over `loadTaskRetryHistory`). Every final
 * refusal the job makes retires the run, so the card and the job cannot
 * disagree about whether a failure is final; the job's other stand-downs
 * (the card moved, the agent reassigned, a newer run) change what the task
 * shows by themselves.
 */
async function failedRunRetryPending(
  sql: Sql,
  taskId: string,
  runId: string,
): Promise<boolean> {
  const history = await loadTaskRetryHistory(sql, taskId);
  const newest = history[0];
  if (newest === undefined || newest.id !== runId) return false;
  if (newest.autoRetryArmedAt === undefined) return false;
  if (newest.autoRetryRefusedAt !== undefined) return false;
  return resolveAutoRetryBudget(history).retry;
}

/** How much of a run's `feedback` an agent reading the task sees — enough
 * for the ids a manager's restart message opens with. */
export const AGENT_RUN_FEEDBACK_EXCERPT_CHARS = 500;

/**
 * One run as an agent reading its task sees it (`task_get`): identity,
 * status and timing, the start's message as an excerpt — never the
 * transcript, the error text, the result or the run's workspace handles
 * (exec, session, model).
 */
export interface TaskAgentRunSummary {
  id: string;
  /** Creation order, tie-free — the walk's position (`seq`). */
  seq: number;
  agentId: string;
  status: string;
  trigger: string | null;
  startedAt: number;
  launchedAt: number | null;
  settledAt: number | null;
  waitingForCapacity: boolean;
  failureCode: string | null;
  feedback: string | null;
  feedbackTruncated: boolean;
}

/**
 * A task's runs, newest first on `seq` (the creation order the kick plan and
 * the retry budget walk, which never ties on a same-millisecond clock), from
 * before `beforeSeq` when a previous page ended there. The one live run a
 * task can have (migration 0080) is always the newest: a run is inserted
 * only while none is live.
 */
export async function listTaskAgentRunSummaries(
  sql: Sql,
  args: {
    organizationId: string;
    taskId: string;
    limit: number;
    beforeSeq?: number;
  },
): Promise<TaskAgentRunSummary[]> {
  return sql<TaskAgentRunSummary[]>`
    SELECT id, seq::float8 AS seq, agent_id AS "agentId", status, trigger,
           started_at_ms::float8 AS "startedAt",
           launched_at_ms::float8 AS "launchedAt",
           settled_at_ms::float8 AS "settledAt",
           (status = 'queued' AND waiting_for_capacity_at_ms IS NOT NULL)
             AS "waitingForCapacity",
           failure_code AS "failureCode",
           left(feedback, ${AGENT_RUN_FEEDBACK_EXCERPT_CHARS}) AS feedback,
           coalesce(char_length(feedback) > ${AGENT_RUN_FEEDBACK_EXCERPT_CHARS},
                    false) AS "feedbackTruncated"
    FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId} AND task_id = ${args.taskId}
      AND (${args.beforeSeq ?? null}::bigint IS NULL
           OR seq < ${args.beforeSeq ?? null}::bigint)
    ORDER BY seq DESC
    LIMIT ${Math.min(Math.max(Math.floor(args.limit), 1), 100)}
  `;
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
      AND kind = ${TASK_AGENT_OP_KIND}
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
