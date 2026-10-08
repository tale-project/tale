import type { Sql, TransactionSql } from 'postgres';

import { harnessResumesConversations } from '../../core/chat/external_turn_shared.ts';
import {
  AUTO_RETRY_HISTORY_LIMIT,
  freeCredentialRotations,
  type AutoRetryRunFacts,
} from '../../core/tasks/task_auto_retry.ts';
import { resolveTaskKickResume } from '../../core/tasks/task_kick_resume.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * The kick-time resume plan over PG — the 0.5 twin of
 * `tasks/agent_runs.resolveTaskKickStartArgs`, with the DECISION core
 * (`resolveTaskKickResume`) REUSED verbatim: only the row walk is ported.
 * Computed by the `task.agent_turn` job right before the start (0.4 bakes
 * it into the scheduled args at kick time — same inputs, fresher session
 * facts; the host re-checks the incarnation stamp after its session ensure
 * either way), so EVERY start scheduler — the kick, the capacity wake, the
 * auto-retry — inherits the resume/sweep/rotation rules from one seam.
 */

const KICK_RESUME_PREDECESSOR_SCAN_LIMIT = 15;

export interface TaskKickStartPlanArgs {
  resume?: string;
  resumeSessionCreatedAt?: number;
  resumeDiscussionSince?: number;
  /** The exec of this agent's latest launched terminal run of the task, on
   * this standing session — reaped before the new turn launches, whether or
   * not its conversation is resumed. "Stop the previous process" and "can we
   * continue its conversation" are separate questions: a drain that died on
   * a transport failure settles the run failed with the CLI still alive,
   * and a harness switch (no resume) must not leave it working beside the
   * new one on the same workspace and delivery box. */
  predecessorExecId?: string;
  excludeBrokerTokenHashes?: string[];
  sweep: boolean;
  inspectNote: boolean;
}

export async function resolveTaskKickStartArgs(
  sql: Sql,
  args: {
    organizationId: string;
    taskId: string;
    agentId: string;
    harness: string;
    sessionId: string;
  },
): Promise<TaskKickStartPlanArgs> {
  const liveSessions = await sql<{ createdAt: number }[]>`
    SELECT created_at_ms::float8 AS "createdAt" FROM app.sandbox_sessions
    WHERE owner_type = 'project_agent' AND owner_id = ${args.agentId}
      AND org_id = ${args.organizationId}
      AND session_id = ${args.sessionId}
      AND status IN ('creating', 'active', 'stopped')
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  const liveSessionCreatedAt = liveSessions[0]?.createdAt;

  // One row past the scan limit detects exhaustion (the 0.4 walk's
  // "scanned > limit" break): a launched failed run beyond the horizon may
  // hold the only copy of unpublished work, so an exhausted walk must not
  // masquerade as a first start.
  const runs = await sql<
    {
      status: string;
      agentId: string;
      harness: string;
      sessionId: string;
      execId: string;
      agentSessionId: string | null;
      sessionCreatedAt: number | null;
      startedAt: number;
      brokerTokenHash: string | null;
      apiErrorStatus: number | null;
      failureCode: string | null;
      launchedAt: number | null;
      settledAt: number | null;
    }[]
  >`
    SELECT status, agent_id AS "agentId", harness,
           session_id AS "sessionId", exec_id AS "execId",
           agent_session_id AS "agentSessionId",
           session_created_at_ms::float8 AS "sessionCreatedAt",
           started_at_ms::float8 AS "startedAt",
           broker_token_hash AS "brokerTokenHash",
           api_error_status AS "apiErrorStatus",
           failure_code AS "failureCode",
           launched_at_ms::float8 AS "launchedAt",
           settled_at_ms::float8 AS "settledAt"
    FROM app.project_agent_runs
    WHERE task_id = ${args.taskId}
    ORDER BY seq DESC
    LIMIT ${KICK_RESUME_PREDECESSOR_SCAN_LIMIT + 1}
  `;

  let previous: Exclude<
    Parameters<typeof resolveTaskKickResume>[0]['previous'],
    'unknown'
  > = null;
  let exhausted = false;
  let previousExecId: string | undefined;
  let collectingHashes = true;
  const excludeBrokerTokenHashes = new Set<string>();
  // A free credential rotation left a healthy account behind — its token was
  // refreshed under the turn — so the next vend may pick it again. The retry
  // budget skips the same rows (`resolveAutoRetryBudget`).
  const freeRotations = freeCredentialRotations(
    runs.map((run) => ({
      agentId: run.agentId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column CHECK admits exactly these statuses
      status: run.status as AutoRetryRunFacts['status'],
      launchedAt: run.launchedAt ?? undefined,
      settledAt: run.settledAt ?? undefined,
      failureCode: run.failureCode ?? undefined,
    })),
  );
  for (const [index, run] of runs.entries()) {
    if (index >= KICK_RESUME_PREDECESSOR_SCAN_LIMIT) {
      exhausted = true;
      break;
    }
    const terminal =
      run.status === 'settled' ||
      run.status === 'failed' ||
      run.status === 'cancelled';
    // Hash collection spans the consecutive-failed prefix of THIS agent's
    // terminal rows, skips non-terminal rows, and seals at the first
    // terminal row that is not this agent's failure.
    if (collectingHashes && terminal) {
      if (run.status === 'failed' && run.agentId === args.agentId) {
        // Model capacity says nothing about the account's health. Keep it
        // eligible without changing counted retry/circuit budgets, and
        // continue collecting every other failed account in the prefix.
        if (
          run.brokerTokenHash !== null &&
          !freeRotations[index] &&
          run.failureCode !== 'model_capacity'
        ) {
          excludeBrokerTokenHashes.add(run.brokerTokenHash);
        }
      } else {
        collectingHashes = false;
      }
    }
    if (previous !== null) {
      if (!collectingHashes) break;
      continue;
    }
    if (!terminal) continue;
    if (run.agentId !== args.agentId) continue;
    let handle = run.agentSessionId ?? undefined;
    if (handle === undefined) {
      // Rows predating the stamp: the run's OWN op row holds the handle its
      // windows captured — a point read, never a session-wide scan (which
      // could surface a sibling task's conversation).
      const ops = await sql<{ agentSessionId: string | null }[]>`
        SELECT agent_session_id AS "agentSessionId"
        FROM app.sandbox_session_ops
        WHERE session_id = ${run.sessionId} AND exec_id = ${run.execId}
        LIMIT 1
      `;
      if (ops.length === 0) continue; // never launched — look further back
      handle = ops[0]?.agentSessionId ?? undefined;
    }
    previous = {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the terminal guard above admits exactly these statuses
      status: run.status as 'settled' | 'failed' | 'cancelled',
      agentId: run.agentId,
      harness: run.harness,
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      ...(handle !== undefined ? { agentSessionId: handle } : {}),
      ...(run.sessionCreatedAt !== null
        ? { sessionCreatedAt: run.sessionCreatedAt }
        : {}),
      ...(run.apiErrorStatus !== null
        ? { apiErrorStatus: run.apiErrorStatus }
        : {}),
    };
    previousExecId = run.execId;
    if (!collectingHashes) break;
  }

  const plan = resolveTaskKickResume({
    previous: previous === null && exhausted ? 'unknown' : previous,
    kick: {
      agentId: args.agentId,
      harness: args.harness,
      sessionId: args.sessionId,
      ...(liveSessionCreatedAt !== undefined ? { liveSessionCreatedAt } : {}),
      resumable: harnessResumesConversations(args.harness),
    },
  });
  const previousStartedAt = previous?.startedAt ?? 0;
  return {
    ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
    ...(plan.sessionCreatedAt !== undefined
      ? { resumeSessionCreatedAt: plan.sessionCreatedAt }
      : {}),
    ...(plan.resume !== undefined
      ? { resumeDiscussionSince: previousStartedAt }
      : {}),
    // Only a predecessor on THIS session can be reaped here (another
    // session's exec is not this session's to cancel); the resume decision
    // already refuses a cross-session predecessor for the same reason.
    ...(previousExecId !== undefined && previous?.sessionId === args.sessionId
      ? { predecessorExecId: previousExecId }
      : {}),
    ...(excludeBrokerTokenHashes.size > 0
      ? { excludeBrokerTokenHashes: [...excludeBrokerTokenHashes] }
      : {}),
    sweep: plan.sweep,
    inspectNote: plan.inspectNote,
  };
}

/** One row of a task's run history, as the auto-retry decides on it. */
export interface TaskRetryHistoryRow extends AutoRetryRunFacts {
  readonly id: string;
  readonly startedBy: string;
  /** The API key the run was started with; its retry carries it. */
  readonly apiKeyId?: string | undefined;
  readonly inPlace: boolean;
  /** Original task decision; absent on legacy in-place kicks. */
  readonly inPlaceRetryStatus?: string | undefined;
  readonly inPlaceRetryActivityId?: string | undefined;
  /** When this failed run's automatic retry was refused for good
   * (`markAutoRetryRetired`); absent while it may still start. */
  readonly autoRetryRefusedAt?: number | undefined;
  /** When this failed run's automatic retry was armed (migration 0142);
   * absent when none was — the run failed through a door that arms none, or
   * with a failure no retry changes. */
  readonly autoRetryArmedAt?: number | undefined;
}

/**
 * The run history `resolveAutoRetryBudget` walks, newest first: as far back
 * as a spent budget hidden behind free rotations and waits can reach
 * (`AUTO_RETRY_HISTORY_LIMIT`), each run with the failure code and vendor
 * status its failed mark stamped — the rotations and cooldown waits the
 * budget skips are told apart by them — and the attempt its card showed.
 */
export async function loadTaskRetryHistory(
  sql: Sql | TransactionSql,
  taskId: string,
): Promise<TaskRetryHistoryRow[]> {
  const rows = await sql<
    {
      id: string;
      status: string;
      agentId: string;
      startedBy: string;
      apiKeyId: string | null;
      inPlace: boolean;
      inPlaceRetryStatus: string | null;
      inPlaceRetryActivityId: string | null;
      launchedAt: number | null;
      settledAt: number | null;
      failureCode: string | null;
      apiErrorStatus: number | null;
      autoRetryAttempt: number | null;
      autoRetryRefusedAt: number | null;
      autoRetryArmedAt: number | null;
    }[]
  >`
    SELECT id, status, agent_id AS "agentId",
           started_by AS "startedBy", api_key_id AS "apiKeyId",
           in_place AS "inPlace",
           in_place_retry_status AS "inPlaceRetryStatus",
           in_place_retry_activity_id::text AS "inPlaceRetryActivityId",
           launched_at_ms::float8 AS "launchedAt",
           settled_at_ms::float8 AS "settledAt",
           failure_code AS "failureCode",
           api_error_status AS "apiErrorStatus",
           auto_retry_attempt AS "autoRetryAttempt",
           auto_retry_refused_at_ms::float8 AS "autoRetryRefusedAt",
           auto_retry_armed_at_ms::float8 AS "autoRetryArmedAt"
    FROM app.project_agent_runs
    WHERE task_id = ${taskId}
    ORDER BY seq DESC
    LIMIT ${AUTO_RETRY_HISTORY_LIMIT}
  `;
  return rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    startedBy: row.startedBy,
    apiKeyId: row.apiKeyId ?? undefined,
    inPlace: row.inPlace,
    inPlaceRetryStatus: row.inPlaceRetryStatus ?? undefined,
    inPlaceRetryActivityId: row.inPlaceRetryActivityId ?? undefined,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column CHECK admits exactly these statuses
    status: row.status as AutoRetryRunFacts['status'],
    launchedAt: row.launchedAt ?? undefined,
    settledAt: row.settledAt ?? undefined,
    failureCode: row.failureCode ?? undefined,
    apiErrorStatus: row.apiErrorStatus ?? undefined,
    autoRetryAttempt: row.autoRetryAttempt ?? undefined,
    autoRetryRefusedAt: row.autoRetryRefusedAt ?? undefined,
    autoRetryArmedAt: row.autoRetryArmedAt ?? undefined,
  }));
}

/**
 * Mark one failed run's automatic retry retired for good
 * (`auto_retry_refused_at_ms`, migration 0141): every later delivery of that
 * retry stands down on it, and the task's run card stops reading the failure
 * as one about to be retried. Returns whether THIS call set the mark, so the
 * caller says what the refusal means exactly once.
 */
export async function markAutoRetryRetired(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; failedRunId: string },
): Promise<boolean> {
  const retired = await tx<{ id: string }[]>`
    UPDATE app.project_agent_runs SET auto_retry_refused_at_ms = ${Date.now()}
    WHERE id = ${args.failedRunId} AND org_id = ${args.organizationId}
      AND task_id = ${args.taskId} AND status = 'failed'
      AND auto_retry_refused_at_ms IS NULL
    RETURNING id
  `;
  if (retired.length === 0) return false;
  // A silent final refusal changes retryPending too. A prior task-move hint
  // can already have been read before this transaction retires the arm.
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'task',
    entityId: args.taskId,
  });
  return true;
}
