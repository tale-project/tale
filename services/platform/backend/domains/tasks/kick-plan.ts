import type { Sql } from 'postgres';

import { resolveTaskKickResume } from '../../../convex/tasks/task_kick_resume.ts';

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
  resumePredecessorExecId?: string;
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
    }[]
  >`
    SELECT status, agent_id AS "agentId", harness,
           session_id AS "sessionId", exec_id AS "execId",
           agent_session_id AS "agentSessionId",
           session_created_at_ms::float8 AS "sessionCreatedAt",
           started_at_ms::float8 AS "startedAt",
           broker_token_hash AS "brokerTokenHash",
           api_error_status AS "apiErrorStatus"
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
        if (run.brokerTokenHash !== null) {
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
    ...(plan.resume !== undefined && previousExecId !== undefined
      ? { resumePredecessorExecId: previousExecId }
      : {}),
    ...(excludeBrokerTokenHashes.size > 0
      ? { excludeBrokerTokenHashes: [...excludeBrokerTokenHashes] }
      : {}),
    sweep: plan.sweep,
    inspectNote: plan.inspectNote,
  };
}
