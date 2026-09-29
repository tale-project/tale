/** Real Postgres proof of the credential-rotation retry: the failed mark
 * stamps `failure_code` (migration 0133), and the two readers of the task's
 * run history — the retry budget and the kick plan's account exclusions —
 * tell a free rotation from an ordinary failure by it. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { resolveAutoRetryBudget } from '../../core/tasks/task_auto_retry.ts';
import { failAgentRunFromTurn, kickAgentRun } from './agent-runs.ts';
import { loadTaskRetryHistory, resolveTaskKickStartArgs } from './kick-plan.ts';

export async function checkCredentialRotationRetry(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const sessionId = `pa-${agentId}`;
  const now = Date.now();

  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Credential rotation', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Rotation agent', 'claude-code',
      'itest-model', ${userId}, ${now}, ${now})
  `;
  // Not in progress: the retry job each failed mark arms reads the card
  // first and stands down (`task_moved`), so the live worker kicks nothing
  // while this lane reads the history itself.
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
      assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${taskId}, ${orgId}, ${projectId}, 'Rotated under the run', 'todo',
      'agent', ${agentId}, 'a0', ${userId}, 'user', ${now}, ${now})
  `;

  /** A short attempt of this agent: launched, then failed a minute later.
   * An auto-retry carries the attempt its card showed. */
  let seq = 0;
  const failedRun = async (
    brokerTokenHash: string,
    failureCode: string,
    autoRetryAttempt: number | null = null,
  ): Promise<void> => {
    seq += 1;
    const at = now - 60 * 60_000 + seq * 120_000;
    await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, failure_code,
        trigger, auto_retry_attempt,
        started_at_ms, launched_at_ms, settled_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${`exec-rot-${seq}`},
        ${sessionId}, 'failed', 'claude-code', 'itest-model', ${userId},
        ${brokerTokenHash}, ${failureCode},
        ${autoRetryAttempt === null ? 'manual' : 'auto_retry'}, ${autoRetryAttempt},
        ${at}, ${at + 1_000},
        ${at + 60_000}, ${at + 3_600_000}, ${at + 60_000}
      )
    `;
  };
  /** A brokered auto-retry the host's failed mark ends on a vendor 401, a
   * minute after it launched: short, so it counts toward a rotation streak
   * (a quarter of an hour of work would start a new one). */
  const rotatedRun = async (
    brokerTokenHash: string,
    autoRetryAttempt: number,
  ): Promise<boolean> => {
    seq += 1;
    const at = Date.now() - 61_000;
    const execId = `exec-rot-${seq}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, trigger,
        auto_retry_attempt, started_at_ms, launched_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${execId},
        ${sessionId}, 'running', 'claude-code', 'itest-model', ${userId},
        ${brokerTokenHash}, 'auto_retry', ${autoRetryAttempt}, ${at},
        ${at + 1_000}, ${at + 3_600_000}, ${at}
      ) RETURNING id
    `;
    return failAgentRunFromTurn(sql, {
      runId: rows[0]?.id ?? '',
      execId,
      error: 'API Error: 401 OAuth access token has been revoked.',
      failureCode: 'credential_rotated',
      apiErrorStatus: 401,
    });
  };
  const planArgs = {
    organizationId: orgId,
    taskId,
    agentId,
    harness: 'claude-code',
    sessionId,
  };

  // The crash-loop budget spent, then the broker's refresh cuts the third
  // retry, whose card showed "3 of 3".
  await failedRun('account-a', 'harness_error');
  await failedRun('account-b', 'harness_error', 1);
  await failedRun('account-c', 'harness_error', 2);
  const marked = await rotatedRun('account-d', 3);
  const stamped = await sql<{ failureCode: string | null; status: number }[]>`
    SELECT failure_code AS "failureCode", api_error_status AS status
    FROM app.project_agent_runs
    WHERE task_id = ${taskId} AND exec_id = 'exec-rot-4'
  `;
  const freeBudget = resolveAutoRetryBudget(
    await loadTaskRetryHistory(sql, taskId),
  );
  const freePlan = await resolveTaskKickStartArgs(sql, planArgs);
  const freeExcluded = [...(freePlan.excludeBrokerTokenHashes ?? [])].sort();
  record(
    'credential rotation: the failed mark stamps the code; the retry resumes free, keeping the account',
    marked &&
      stamped[0]?.failureCode === 'credential_rotated' &&
      stamped[0].status === 401 &&
      freeBudget.retry &&
      freeBudget.attempt === 3 &&
      freeExcluded.join(',') === 'account-a,account-b,account-c',
    `marked=${marked} code=${stamped[0]?.failureCode ?? 'none'}/${stamped[0]?.status ?? 'none'} (want credential_rotated/401), budget=${JSON.stringify(freeBudget)} (want retry, attempt 3), excluded=${freeExcluded.join(',')} (want account-a,account-b,account-c)`,
  );

  // A grant that answers 401 on every vend: the second rotation in a row is
  // still free, the third takes the ordinary path — counted (the budget is
  // spent) and its account excluded.
  await rotatedRun('account-e', 3);
  const secondBudget = resolveAutoRetryBudget(
    await loadTaskRetryHistory(sql, taskId),
  );
  await rotatedRun('account-f', 3);
  const thirdBudget = resolveAutoRetryBudget(
    await loadTaskRetryHistory(sql, taskId),
  );
  const thirdPlan = await resolveTaskKickStartArgs(sql, planArgs);
  const thirdExcluded = [...(thirdPlan.excludeBrokerTokenHashes ?? [])].sort();
  record(
    'credential rotation: a third in a row is an ordinary failure, so a dead grant stops',
    secondBudget.retry &&
      !thirdBudget.retry &&
      thirdExcluded.join(',') === 'account-a,account-b,account-c,account-f',
    `second=${JSON.stringify(secondBudget)} (want retry), third=${JSON.stringify(thirdBudget)} (want no retry), excluded=${thirdExcluded.join(',')} (want account-a,account-b,account-c,account-f)`,
  );
}

/** Real Postgres proof of the wait for a cooling broker pool: a start
 * refused while every account cooled down arms its retry with the moment
 * the first comes back, the retry budget reads the wait after the run's own
 * 429 as free, and the retry's kick queues the run at once — the card shows
 * it — with its start job held in pg-boss until then. */
export async function checkCooledStartRetry(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Cooled start', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Cooled agent', 'claude-code',
      'itest-model', ${userId}, ${now}, ${now})
  `;
  // Not in progress, so the live worker's retry job stands down
  // (`task_moved`) and this lane kicks the retry itself.
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
      assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${taskId}, ${orgId}, ${projectId}, 'Refused while the pool cooled', 'todo',
      'agent', ${agentId}, 'a0', ${userId}, 'user', ${now}, ${now})
  `;
  // The run before it ended on the vendor's rate limit, which cooled the
  // pool down.
  await sql`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, failure_code, api_error_status,
      started_at_ms, launched_at_ms, settled_at_ms, deadline_at_ms,
      updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, ${agentId}, 'exec-limited-1',
      ${`pa-${agentId}`}, 'failed', 'claude-code', 'itest-model', ${userId},
      'harness_error', 429, ${now - 120_000}, ${now - 119_000},
      ${now - 60_000}, ${now + 3_600_000}, ${now - 60_000}
    )
  `;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, trigger, auto_retry_attempt,
      started_at_ms, deadline_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, ${agentId}, 'exec-cooled-1',
      ${`pa-${agentId}`}, 'queued', 'claude-code', 'itest-model', ${userId},
      'auto_retry', 1, ${now}, ${now + 3_600_000}, ${now}
    ) RETURNING id
  `;
  const failedRunId = rows[0]?.id ?? '';
  const retryAtMs = Date.now() + 45_000;
  await failAgentRunFromTurn(sql, {
    runId: failedRunId,
    execId: 'exec-cooled-1',
    error:
      'the agent run could not start: Every account behind credential "Pool" is cooling down after a rate limit — try again in 45 seconds.',
    failureCode: 'credential_cooldown',
    retryAtMs,
  });
  const armed = await sql<{ startAfterMs: string | null }[]>`
    SELECT data ->> 'startAfterMs' AS "startAfterMs" FROM pgboss.job
    WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${failedRunId}
  `;
  const budget = resolveAutoRetryBudget(
    await loadTaskRetryHistory(sql, taskId),
  );
  const kicked = await sql.begin((tx) =>
    kickAgentRun(tx, {
      organizationId: orgId,
      projectId,
      taskId,
      agentId,
      harness: 'claude-code',
      model: 'itest-model',
      startedBy: userId,
      trigger: 'auto_retry',
      autoRetryAttempt: 1,
      startAfterMs: retryAtMs,
    }),
  );
  const started = await sql<
    { status: string; startAfter: Date; state: string }[]
  >`
    SELECT r.status, j.start_after AS "startAfter", j.state
    FROM app.project_agent_runs r
    JOIN pgboss.job j ON j.name = 'task.agent_turn' AND j.data ->> 'runId' = r.id
    WHERE r.id = ${kicked.runId}
  `;
  // The held start finds nothing to start when it fires.
  await sql`
    UPDATE app.project_agent_runs SET status = 'cancelled',
      settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
    WHERE id = ${kicked.runId} AND status = 'queued'
  `;
  const start = started[0];
  const heldBy =
    start === undefined ? Number.NaN : start.startAfter.getTime() - retryAtMs;
  record(
    'cooled start: the retry is armed with the moment the first account is back, the wait after its own 429 spends no attempt, and its run is queued with the start held until then',
    armed.length === 1 &&
      armed[0]?.startAfterMs === String(retryAtMs) &&
      budget.retry &&
      budget.attempt === 1 &&
      !kicked.reused &&
      start?.status === 'queued' &&
      start.state === 'created' &&
      Math.abs(heldBy) < 1_000,
    `armed=${JSON.stringify(armed)} (want one arm, startAfterMs ${retryAtMs}), budget=${JSON.stringify(budget)} (want retry, attempt 1 — the 429 counted, the wait did not), run=${start?.status ?? 'none'} (want queued), start job=${start?.state ?? 'none'} held ${heldBy} ms off the cooldown end (want created, |off| < 1000)`,
  );
}
