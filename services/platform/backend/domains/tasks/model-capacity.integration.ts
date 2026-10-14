/** Real PostgreSQL custody of a model at capacity: the run the provider
 * refused fails once, opens the model's hold and arms a free retry; a run on
 * the held model parks instead of starting; a run that settles on the model
 * clears the hold and wakes it; the hourly circuit counts none of it. Tasks
 * stay To do so normal retry workers refuse them, and every start the lane
 * kicks waits an hour in the queue, so no worker can launch a fixture. */
import { randomUUID } from 'node:crypto';

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { resolveAutoRetryBudget } from '../../core/tasks/task_auto_retry.ts';
import { bossDbInTx } from '../../jobs/enqueue.ts';
import {
  failAgentRunFromTurn,
  kickAgentRun,
  settleAgentRun,
} from './agent-runs.ts';
import { claimAgentWorker } from './agent-workers.ts';
import { admitAutomatedStart } from './delegated-start.ts';
import { loadTaskRetryHistory, resolveTaskKickStartArgs } from './kick-plan.ts';
import {
  MODEL_CAPACITY_MAX_WAIT_MS,
  PARKED_ON_HELD_MODEL_SQL,
  readModelCapacityHold,
} from './model-capacity-holds.ts';

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
  const otherTaskId = randomUUID();
  // A model of this lane's own: a hold is the organization's, by model.
  const model = `itest-capacity-${randomUUID().slice(0, 8)}`;
  const key = { organizationId: orgId, modelProvider: null, model };
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
      ${model}, ${userId}, ${now}, ${now})
  `;
  for (const [id, title] of [
    [taskId, 'Capacity retry'],
    [otherTaskId, 'Capacity neighbour'],
  ] as const) {
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
        assignee_id, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${projectId}, ${title}, 'todo',
        'agent', ${agentId}, 'a0', ${userId}, 'user', ${now}, ${now})
    `;
  }
  const addRun = async (task = taskId) => {
    const at = Date.now();
    const execId = randomUUID();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, broker_token_hash, trigger,
        started_via, started_via_run_id, started_via_agent_id,
        started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${task}, ${agentId}, ${execId}, ${sessionId},
        'running', 'codex', ${model}, ${userId}, 'healthy-account', 'delegated',
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
        settledAt: number;
        startAfter: string | null;
      }[]
    >`
      SELECT r.failure_code AS "failureCode", r.status,
        r.settled_at_ms::float8 AS "settledAt",
        j.data ->> 'startAfterMs' AS "startAfter"
      FROM app.project_agent_runs r
      JOIN pgboss.job j ON j.name = 'task.agent_retry'
        AND j.data ->> 'expectedRunId' = r.id
      WHERE r.id = ${first.runId}
    `;
    const row = rows[0];
    const hold = await readModelCapacityHold(sql, key);
    record(
      'model capacity: one exec-fenced refusal arms one retry and holds the model for about a minute [TASK-R40]',
      !stale &&
        won &&
        !duplicate &&
        rows.length === 1 &&
        row?.failureCode === 'model_capacity' &&
        row.status === 'failed' &&
        row.startAfter === null &&
        hold !== null &&
        hold.consecutive === 1 &&
        hold.heldUntilMs >= row.settledAt + 54_000 &&
        hold.heldUntilMs <= row.settledAt + 66_000,
      `stale=${stale} won=${won} duplicate=${duplicate} rows=${JSON.stringify(rows)} hold=${JSON.stringify(hold)}`,
    );
    if (row === undefined || hold === null)
      throw new Error('itest: capacity hold missing');

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
      'model capacity: the retry spends no attempt and keeps its account eligible [TASK-R40]',
      budget.retry &&
        budget.attempt === 0 &&
        plan.excludeBrokerTokenHashes === undefined,
      `budget=${JSON.stringify(budget)} excluded=${JSON.stringify(plan.excludeBrokerTokenHashes)}`,
    );

    // The retry's start: kicked with its turn job an hour out, so no worker
    // takes it, then claimed here the way its turn job claims it.
    const kicked = await sql.begin((tx) =>
      kickAgentRun(tx, {
        organizationId: orgId,
        projectId,
        taskId,
        agentId,
        harness: 'codex',
        model,
        startedBy: userId,
        trigger: 'auto_retry',
        autoRetryAttempt: 0,
        startAfterMs: Date.now() + 3_600_000,
      }),
    );
    const execOf = await sql<{ execId: string }[]>`
      SELECT exec_id AS "execId" FROM app.project_agent_runs WHERE id = ${kicked.runId}
    `;
    const retryExec = execOf[0]?.execId ?? kicked.execId;
    const claim = await claimAgentWorker(sql, {
      organizationId: orgId,
      runId: kicked.runId,
      execId: retryExec,
    });
    const parked = await sql<
      { reason: string | null; parked: boolean; wakeAt: Date | null }[]
    >`
      SELECT r.waiting_reason AS reason,
             r.waiting_for_capacity_at_ms IS NOT NULL AS parked,
             (SELECT j.start_after FROM pgboss.job j
              WHERE j.name = 'task.agent_park_wake'
                AND j.data ->> 'runId' = r.id
              ORDER BY j.created_on DESC LIMIT 1) AS "wakeAt"
      FROM app.project_agent_runs r WHERE r.id = ${kicked.runId}
    `;
    const park = parked[0];
    record(
      'model capacity: a run on the held model parks with its reason until the hold runs out [TASK-R40]',
      claim !== null &&
        'parked' in claim &&
        claim.parked === 'model_capacity' &&
        park !== undefined &&
        park.parked &&
        park.reason === 'model_capacity' &&
        park.wakeAt !== null &&
        Math.abs(park.wakeAt.getTime() - hold.heldUntilMs) < 5_000,
      `claim=${JSON.stringify(claim)} park=${JSON.stringify(park)} heldUntil=${hold.heldUntilMs}`,
    );
    const leftAlone = await sql<{ onHeldModel: boolean }[]>`
      SELECT ${sql.unsafe(PARKED_ON_HELD_MODEL_SQL)} AS "onHeldModel"
      FROM app.project_agent_runs r WHERE r.id = ${kicked.runId}
    `;
    record(
      'model capacity: the generic wakes leave a run parked on a held model alone [TASK-R40]',
      leftAlone[0] !== undefined && leftAlone[0].onHeldModel,
      `leftAlone=${JSON.stringify(leftAlone)}`,
    );

    // Runs that were already working when the model saturated fail in a
    // burst: the hold stays as it is. Three refusals close no circuit.
    await fail(await addRun(otherTaskId));
    await fail(await addRun(otherTaskId));
    const burst = await readModelCapacityHold(sql, key);
    const admission = await sql.begin((tx) =>
      admitAutomatedStart(tx, {
        task: { id: otherTaskId, organizationId: orgId, projectId },
        agentId,
      }),
    );
    record(
      'model capacity: refusals in a burst keep the hold and close no hourly circuit [TASK-R12]',
      burst !== null &&
        burst.consecutive === 1 &&
        burst.heldUntilMs === hold.heldUntilMs &&
        admission.admitted,
      `burst=${JSON.stringify(burst)} admission=${JSON.stringify(admission)}`,
    );

    // A run on the model that settles proves it answers: the hold goes and
    // the parked retry is woken.
    const answered = await addRun(otherTaskId);
    const settled = await settleAgentRun(sql, {
      runId: answered.runId,
      execId: answered.execId,
      resultText: 'done',
    });
    const cleared = await readModelCapacityHold(sql, key);
    const wakes = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name = 'task.agent_park_wake' AND data ->> 'runId' = ${kicked.runId}
    `;
    record(
      'model capacity: a run that settles on the model clears its hold and wakes the runs parked on it [TASK-R40]',
      settled && cleared === null && (wakes[0]?.n ?? 0) >= 2,
      `settled=${settled} cleared=${JSON.stringify(cleared)} wakes=${wakes[0]?.n}`,
    );

    // A model at capacity for twelve hours is no longer waited for.
    await fail(await addRun(otherTaskId));
    await sql`
      UPDATE app.model_capacity_holds
      SET first_refused_at_ms = ${Date.now() - MODEL_CAPACITY_MAX_WAIT_MS - 1_000}
      WHERE org_id = ${orgId} AND model = ${model}
    `;
    const longRefused = await addRun(otherTaskId);
    await fail(longRefused);
    const ended = await sql<{ armed: boolean }[]>`
      SELECT auto_retry_armed_at_ms IS NOT NULL AS armed
      FROM app.project_agent_runs WHERE id = ${longRefused.runId}
    `;
    record(
      'model capacity: after twelve hours at capacity the refused run ends without a retry [TASK-R40]',
      ended[0] !== undefined && !ended[0].armed,
      `ended=${JSON.stringify(ended)}`,
    );
  } finally {
    await sql.begin(async (tx) => {
      const owned = await tx<{ id: string; name: string }[]>`
        SELECT j.id, j.name FROM pgboss.job j
        JOIN app.project_agent_runs r ON r.id = j.data ->> 'runId'
        WHERE r.project_id = ${projectId}
          AND j.name IN ('task.agent_turn', 'task.agent_park_wake')
          AND j.state IN ('created', 'retry')
      `;
      for (const queue of ['task.agent_turn', 'task.agent_park_wake']) {
        const ids = owned
          .filter((job) => job.name === queue)
          .map((job) => job.id);
        if (ids.length > 0) {
          await boss.cancel(queue, ids, { db: bossDbInTx(tx) });
        }
      }
      await tx`
        UPDATE app.project_agent_runs SET status = 'cancelled',
          settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
        WHERE project_id = ${projectId} AND status IN ('queued', 'running')
      `;
      await tx`
        DELETE FROM app.model_capacity_holds
        WHERE org_id = ${orgId} AND model = ${model}
      `;
    });
  }
}
