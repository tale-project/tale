/** Real Postgres proof of the credential-rotation retry: the failed mark
 * stamps `failure_code` (migration 0130), and the two readers of the task's
 * run history — the retry budget and the kick plan's account exclusions —
 * tell a free rotation from an ordinary failure by it. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { resolveAutoRetryBudget } from '../../core/tasks/task_auto_retry.ts';
import { failAgentRunFromTurn } from './agent-runs.ts';
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

  /** A short attempt of this agent: launched, then failed a minute later. */
  let seq = 0;
  const failedRun = async (
    brokerTokenHash: string,
    failureCode: string,
  ): Promise<void> => {
    seq += 1;
    const at = now - 60 * 60_000 + seq * 120_000;
    await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, failure_code,
        started_at_ms, launched_at_ms, settled_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${`exec-rot-${seq}`},
        ${sessionId}, 'failed', 'claude-code', 'itest-model', ${userId},
        ${brokerTokenHash}, ${failureCode}, ${at}, ${at + 1_000},
        ${at + 60_000}, ${at + 3_600_000}, ${at + 60_000}
      )
    `;
  };
  /** A brokered attempt the host's failed mark ends on a vendor 401, a
   * minute after it launched: short, so it counts toward a rotation streak
   * (a quarter of an hour of work would start a new one). */
  const rotatedRun = async (brokerTokenHash: string): Promise<boolean> => {
    seq += 1;
    const at = Date.now() - 61_000;
    const execId = `exec-rot-${seq}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, started_at_ms,
        launched_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${execId},
        ${sessionId}, 'running', 'claude-code', 'itest-model', ${userId},
        ${brokerTokenHash}, ${at}, ${at + 1_000}, ${at + 3_600_000}, ${at}
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

  // The crash-loop budget spent, then the broker's refresh cuts the next run.
  await failedRun('account-a', 'harness_error');
  await failedRun('account-b', 'harness_error');
  await failedRun('account-c', 'harness_error');
  const marked = await rotatedRun('account-d');
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
  await rotatedRun('account-e');
  const secondBudget = resolveAutoRetryBudget(
    await loadTaskRetryHistory(sql, taskId),
  );
  await rotatedRun('account-f');
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
