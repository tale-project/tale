/** Real PostgreSQL custody of a counted model-capacity retry. Tasks stay
 * To do so normal retry workers refuse them. The direct kick, queue readback
 * and native cancellation share one transaction: no worker can observe an
 * executable fixture start, even if a database statement stalls. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { resolveAutoRetryBudget } from '../../core/tasks/task_auto_retry.ts';
import { bossDbInTx } from '../../jobs/enqueue.ts';
import {
  cancelAgentRunInTx,
  failAgentRunFromTurn,
  kickAgentRun,
} from './agent-runs.ts';
import { admitAutomatedStart } from './delegated-start.ts';
import { loadTaskRetryHistory, resolveTaskKickStartArgs } from './kick-plan.ts';

export async function checkModelCapacityRetry(
  sql: Sql,
  boss: PgBoss,
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
    VALUES (${projectId}, ${orgId}, 'Model capacity', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Capacity agent', 'codex',
      'itest-model', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
      assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${taskId}, ${orgId}, ${projectId}, 'Capacity retry', 'todo',
      'agent', ${agentId}, 'a0', ${userId}, 'user', ${now}, ${now})
  `;
  const addRun = async () => {
    const at = Date.now();
    const execId = randomUUID();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, trigger,
        started_via, started_via_run_id, started_via_agent_id,
        started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${execId}, ${sessionId},
        'running', 'codex', 'itest-model', ${userId}, 'healthy-account', 'delegated',
        'agent', 'itest-manager-run', ${agentId},
        ${at - 2_000}, ${at - 1_000}, ${at + 3_600_000}, ${at}
      ) RETURNING id
    `;
    const runId = rows[0]?.id;
    if (runId === undefined) throw new Error('itest: capacity run missing');
    return { runId, execId };
  };
  const fail = (run: { runId: string; execId: string }) =>
    failAgentRunFromTurn(sql, {
      ...run,
      error: 'Selected model is at capacity. Please try a different model.',
      failureCode: 'model_capacity',
      agentSessionId: 'capacity-conversation',
    });
  try {
    const first = await addRun();
    const stale = await fail({ ...first, execId: 'stale-exec' });
    const won = await fail(first);
    const duplicate = await fail(first);
    const rows = await sql<
      {
        failureCode: string;
        status: string;
        apiErrorStatus: number | null;
        settledAt: number;
        startAfter: string | null;
      }[]
    >`
      SELECT r.failure_code AS "failureCode", r.status,
        r.api_error_status AS "apiErrorStatus", r.settled_at_ms::float8 AS "settledAt",
        j.data ->> 'startAfterMs' AS "startAfter"
      FROM app.project_agent_runs r
      JOIN pgboss.job j ON j.name = 'task.agent_retry'
        AND j.data ->> 'expectedRunId' = r.id
      WHERE r.id = ${first.runId}
    `;
    const row = rows[0];
    const floor = Number(row?.startAfter ?? 0);
    record(
      'model capacity: one exec-fenced failure durably holds its retry for 60s',
      !stale &&
        won &&
        !duplicate &&
        rows.length === 1 &&
        row?.failureCode === 'model_capacity' &&
        row.status === 'failed' &&
        row.apiErrorStatus === null &&
        floor >= row.settledAt + 60_000,
      `stale=${stale} won=${won} duplicate=${duplicate} rows=${JSON.stringify(rows)}`,
    );
    if (row === undefined || floor === 0)
      throw new Error('itest: capacity retry missing');
    const history = await loadTaskRetryHistory(sql, taskId);
    const budget = resolveAutoRetryBudget(history);
    const plan = await resolveTaskKickStartArgs(sql, {
      organizationId: orgId,
      taskId,
      agentId,
      sessionId,
      harness: 'codex',
    });
    record(
      'model capacity: the retry counts and keeps its account eligible',
      budget.retry &&
        budget.attempt === 1 &&
        plan.excludeBrokerTokenHashes === undefined,
      `budget=${JSON.stringify(budget)} excluded=${JSON.stringify(plan.excludeBrokerTokenHashes)} resume=${plan.resume}`,
    );
    await sql.begin(async (tx) => {
      const kicked = await kickAgentRun(tx, {
        organizationId: orgId,
        projectId,
        taskId,
        agentId,
        harness: 'codex',
        model: 'itest-model',
        startedBy: userId,
        trigger: 'auto_retry',
        autoRetryAttempt: 1,
        startAfterMs: floor,
      });
      const jobs = await tx<
        { status: string; startAfter: Date; state: string }[]
      >`
        SELECT r.status, j.start_after AS "startAfter", j.state
        FROM app.project_agent_runs r
        JOIN pgboss.job j ON j.name = 'task.agent_turn' AND j.data ->> 'runId' = r.id
        WHERE r.id = ${kicked.runId}
      `;
      const job = jobs[0];
      record(
        'model capacity: pg-boss holds the queued start until the recorded floor',
        !kicked.reused &&
          jobs.length === 1 &&
          job?.status === 'queued' &&
          job.state === 'created' &&
          job.startAfter.getTime() === floor,
        `jobs=${JSON.stringify(jobs)} floor=${floor}`,
      );
      const cancelled = await cancelAgentRunInTx(tx, {
        organizationId: orgId,
        taskId,
        runId: kicked.runId,
      });
      // Native cancellation enqueues an orphan-drive cleanup. Cancel both
      // owned jobs before commit; this fixture has no sandbox exec to reap.
      for (const queue of ['task.agent_turn', 'task.agent_drive']) {
        const owned = await tx<{ id: string }[]>`
          SELECT id FROM pgboss.job
          WHERE name = ${queue} AND data ->> 'runId' = ${kicked.runId}
        `;
        if (owned.length !== 1)
          throw new Error('itest: capacity fixture job ownership mismatch');
        await boss.cancel(
          queue,
          owned.map(({ id }) => id),
          {
            db: bossDbInTx(tx),
          },
        );
      }
      const remaining = await tx<{ id: string }[]>`
        SELECT id FROM pgboss.job
        WHERE name IN ('task.agent_turn', 'task.agent_drive')
          AND data ->> 'runId' = ${kicked.runId} AND state != 'cancelled'
      `;
      if (!cancelled || remaining.length !== 0)
        throw new Error('itest: capacity fixture cancellation failed');
      record(
        'model capacity: start and cleanup jobs are cancelled before visibility',
        true,
        'native run and pg-boss cancellation committed with the queue readback',
      );
    });
    await fail(await addRun());
    await fail(await addRun());
    const admission = await sql.begin((tx) =>
      admitAutomatedStart(tx, {
        task: { id: taskId, organizationId: orgId, projectId },
        agentId,
      }),
    );
    record(
      'model capacity: three actual automated starts still close the hourly circuit [TASK-R12]',
      !admission.admitted,
      `admission=${JSON.stringify(admission)}`,
    );
  } finally {
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE project_id = ${projectId} AND status IN ('queued', 'running')
    `;
  }
}
