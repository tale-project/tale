import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { resolveOrgSlug } from '../../lib/org-config.ts';
/** Real Postgres proof: task agents and workflows share one start fence,
 * including a loser whose SERIALIZABLE snapshot predates the winner. */
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import { kickAgentRun } from './agent-runs.ts';
import { addTaskComment } from './comments.ts';
import { startWorkflowForTaskInTx } from './external-ref.ts';
import { loadTaskOrThrow, TaskError } from './service.ts';

export async function checkTaskRunStartFence(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const automation = `itest-start-fence-${randomUUID()}`;
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Task start fence', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Fence agent', 'claude-code',
      'itest-model', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.automations (org_id, name, version, document, created_by, created_at_ms)
    VALUES (${orgId}, ${automation}, 1, ${sql.json({ steps: [] })}, ${userId}, ${now})
  `;
  await sql`
    INSERT INTO app.automation_deployments (org_id, name, version, deployed_by, deployed_at_ms)
    VALUES (${orgId}, ${automation}, 1, ${userId}, ${now})
  `;

  for (const winner of ['agent', 'automation'] as const) {
    for (const isolation of ['read committed', 'serializable'] as const) {
      const taskId = randomUUID();
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${taskId}, ${orgId}, ${projectId}, 'Engine race', 'in_progress',
          ${taskId}, ${userId}, 'user', ${now}, ${now})
      `;
      const task = await loadTaskOrThrow(sql, taskId, orgId);
      const start = async (
        tx: TransactionSql,
        engine: 'agent' | 'automation',
      ) => {
        if (engine === 'agent') {
          return kickAgentRun(tx, {
            organizationId: orgId,
            projectId,
            taskId,
            agentId,
            harness: 'claude-code',
            model: 'itest-model',
            startedBy: userId,
          });
        }
        return startWorkflowForTaskInTx(tx, {
          organizationId: orgId,
          task,
          workflowSlug: automation,
          startedByUserId: userId,
        });
      };
      let releaseWinner = () => {};
      const release = new Promise<void>((resolve) => {
        releaseWinner = resolve;
      });
      let reportHeld = () => {};
      const held = new Promise<void>((resolve) => {
        reportHeld = resolve;
      });
      const winning = sql.begin(async (tx) => {
        const result = await start(tx, winner);
        // This synthetic run must remain live for the collision test, without
        // letting the worker execute a harness or settle an empty workflow.
        await tx`
          UPDATE pgboss.job SET start_after = now() + interval '1 day'
          WHERE data ->> 'runId' = ${result?.runId ?? ''}
        `;
        reportHeld();
        await release;
      });
      await Promise.race([held, winning]);
      let reportSnapshot = () => {};
      const snapshot = new Promise<void>((resolve) => {
        reportSnapshot = resolve;
      });
      const runLoser = async (tx: TransactionSql) => {
        await tx`SELECT id FROM app.tasks WHERE id = ${taskId}`;
        reportSnapshot();
        return start(tx, winner === 'agent' ? 'automation' : 'agent');
      };
      const losing = (
        isolation === 'serializable'
          ? transactSerializable(sql, runLoser)
          : sql.begin(runLoser)
      ).then(
        () => 'started',
        (error: unknown) =>
          error instanceof TaskError ? error.code : String(error),
      );
      await Promise.race([snapshot, losing]);
      releaseWinner();
      await winning;
      const result = await losing;
      const counts = await sql<{ agents: number; automations: number }[]>`
        SELECT
          (SELECT count(*)::int FROM app.project_agent_runs
           WHERE task_id = ${taskId} AND status IN ('queued', 'running')) AS agents,
          (SELECT count(*)::int FROM app.automation_runs
           WHERE org_id = ${orgId} AND input -> 'task' ->> 'id' = ${taskId}
             AND status IN ('queued', 'running', 'waiting')) AS automations
      `;
      const row = counts[0];
      record(
        `task start fence: ${winner} wins against ${isolation} other engine`,
        result === 'TASK_HAS_LIVE_RUN' &&
          row?.agents === (winner === 'agent' ? 1 : 0) &&
          row.automations === (winner === 'automation' ? 1 : 0),
        `loser=${result}, live agents=${row?.agents}, automations=${row?.automations}`,
      );
      await sql`UPDATE app.project_agent_runs SET status = 'cancelled' WHERE task_id = ${taskId}`;
      await sql.begin(async (fixtureTx) => {
        await markAutomationWriterInTx(fixtureTx);
        return fixtureTx`
        UPDATE app.automation_runs SET status = 'cancelled'
        WHERE org_id = ${orgId} AND input -> 'task' ->> 'id' = ${taskId}
      `;
      });
    }
  }

  const slug = await resolveOrgSlug(sql, orgId);
  if (!slug || !process.env.TALE_CONFIG_DIR)
    throw new Error('Missing isolated policy fixture root');
  const directory = path.join(process.env.TALE_CONFIG_DIR, slug, 'governance');
  await mkdir(directory, { recursive: true });
  const policy = path.join(directory, 'task-automation.yml');
  const previous = await readFile(policy).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  });
  const taskId = randomUUID();
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
      assignee_type, assignee_id, created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${taskId}, ${orgId}, ${projectId}, 'Disabled policy task', 'in_progress',
      ${taskId}, 'agent', ${agentId}, ${userId}, 'user', ${now}, ${now})
  `;
  const task = await loadTaskOrThrow(sql, taskId, orgId);
  const kick = {
    organizationId: orgId,
    projectId,
    taskId,
    agentId,
    harness: 'claude-code',
    model: 'itest-model',
    startedBy: userId,
  };
  const ongoing = await sql.begin(async (tx) => {
    const run = await kickAgentRun(tx, kick);
    await tx`UPDATE pgboss.job SET start_after = now() + interval '1 day' WHERE data ->> 'runId' = ${run.runId}`;
    return run;
  });
  try {
    await writeFile(policy, 'enabled: false\n');
    const completed = await sql.begin((tx) =>
      completeAgentRunInTx(tx, {
        organizationId: orgId,
        taskId,
        agentId,
        runId: ongoing.runId,
        execId: ongoing.execId,
        resultText: 'Ongoing work finished.',
        body: 'Ongoing work finished.',
        files: [],
      }),
    );
    const resultCode = (error: unknown) =>
      error instanceof TaskError ? error.code : String(error);
    const refusedAgent = await sql
      .begin((tx) => kickAgentRun(tx, kick))
      .then(() => 'started', resultCode);
    const refusedAutomation = await sql
      .begin((tx) =>
        startWorkflowForTaskInTx(tx, {
          organizationId: orgId,
          task,
          workflowSlug: automation,
          startedByUserId: userId,
        }),
      )
      .then(() => 'started', resultCode);
    const auth = {
      organizationId: orgId,
      userId,
      role: 'owner',
      teamIds: [] as string[],
    };
    await sql.begin((tx) =>
      addTaskComment(tx, auth, { taskId, body: `@${agentId} please continue` }),
    );
    await sql`UPDATE app.tasks SET assignee_type = 'app', assignee_id = ${automation} WHERE id = ${taskId}`;
    await sql.begin((tx) =>
      addTaskComment(tx, auth, {
        taskId,
        body: `@${automation} please continue`,
      }),
    );
    const observed = await loadTaskOrThrow(sql, taskId, orgId);
    const jobs = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pgboss.job
      WHERE name = 'task.start_workflow' AND data ->> 'taskId' = ${taskId}
    `;
    record(
      'task automation disabled: new starts stop, comments persist, ongoing completion succeeds',
      completed &&
        refusedAgent === 'TASK_AUTOMATION_DISABLED' &&
        refusedAutomation === 'TASK_AUTOMATION_DISABLED' &&
        observed.status === 'in_review' &&
        observed.commentCount === 3 &&
        jobs[0]?.count === 0,
      `completed=${completed}, agent=${refusedAgent}, workflow=${refusedAutomation}, status=${observed.status}, comments=${observed.commentCount}, workflowJobs=${jobs[0]?.count}`,
    );

    await writeFile(policy, 'enabled: not-a-boolean\n');
    const unavailableAgent = await sql
      .begin((tx) => kickAgentRun(tx, kick))
      .then(() => 'started', resultCode);
    const unavailableAutomation = await sql
      .begin((tx) =>
        startWorkflowForTaskInTx(tx, {
          organizationId: orgId,
          task,
          workflowSlug: automation,
          startedByUserId: userId,
        }),
      )
      .then(() => 'started', resultCode);
    await sql`UPDATE app.tasks SET assignee_type = 'agent', assignee_id = ${agentId} WHERE id = ${taskId}`;
    await sql.begin((tx) =>
      addTaskComment(tx, auth, {
        taskId,
        body: `@${agentId} continue when configuration is restored`,
      }),
    );
    await sql`UPDATE app.tasks SET assignee_type = 'app', assignee_id = ${automation} WHERE id = ${taskId}`;
    await sql.begin((tx) =>
      addTaskComment(tx, auth, {
        taskId,
        body: `@${automation} continue when configuration is restored`,
      }),
    );
    const unavailableTask = await loadTaskOrThrow(sql, taskId, orgId);
    const unavailableJobs = await sql<{ agents: number; workflows: number }[]>`
      SELECT
        (SELECT count(*)::int FROM app.project_agent_runs
         WHERE task_id = ${taskId} AND status IN ('queued', 'running')) AS agents,
        (SELECT count(*)::int FROM pgboss.job
         WHERE name = 'task.start_workflow' AND data ->> 'taskId' = ${taskId}) AS workflows
    `;
    record(
      'task automation unavailable: explicit starts fail, both human mentions persist without new work',
      unavailableAgent === 'TASK_AUTOMATION_UNAVAILABLE' &&
        unavailableAutomation === 'TASK_AUTOMATION_UNAVAILABLE' &&
        unavailableTask.status === 'in_review' &&
        unavailableTask.commentCount === 5 &&
        unavailableJobs[0]?.agents === 0 &&
        unavailableJobs[0]?.workflows === 0,
      `agent=${unavailableAgent}, workflow=${unavailableAutomation}, status=${unavailableTask.status}, comments=${unavailableTask.commentCount}, liveAgents=${unavailableJobs[0]?.agents}, workflowJobs=${unavailableJobs[0]?.workflows}`,
    );
  } finally {
    if (previous === null) await rm(policy);
    else await writeFile(policy, previous);
  }
}
