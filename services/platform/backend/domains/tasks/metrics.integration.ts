/** Real Postgres proof of the project metrics fold's SQL: every source row
 * the page's figures come from, joined and bucketed the way the fold says. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { getProjectTaskMetrics, type ProjectMetricsDay } from './metrics.ts';
import { createTask } from './service.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function sum(
  days: ProjectMetricsDay[],
  pick: (day: ProjectMetricsDay) => number,
): number {
  return days.reduce((acc, day) => acc + pick(day), 0);
}

export async function checkProjectTaskMetrics(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const projectId = randomUUID();
  const terminalProjectId = randomUUID();
  const agentId = randomUUID();
  const agentTaskId = randomUUID();
  const humanTaskId = randomUUID();
  const oldTaskId = randomUUID();
  const automation = `itest-metrics-${randomUUID()}`;
  const now = Date.now();

  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Metrics proof', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${terminalProjectId}, ${orgId}, 'Terminal creation proof', ${userId}, ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model,
      created_by, created_at_ms, updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Metrics agent', 'claude-code',
      'itest-model', ${userId}, ${now}, ${now})
  `;
  const terminalTaskIds = await transactSerializable(sql, async (tx) => {
    const doneId = await createTask(
      tx,
      {
        organizationId: orgId,
        userId,
        role: 'owner',
        teamIds: [],
      },
      {
        projectId: terminalProjectId,
        title: 'Created done',
        status: 'done',
      },
    );
    const cancelledId = await createTask(
      tx,
      {
        organizationId: orgId,
        userId,
        role: 'owner',
        teamIds: [],
      },
      {
        projectId: terminalProjectId,
        title: 'Created cancelled',
        status: 'cancelled',
      },
    );
    return { cancelledId, doneId };
  });
  const terminalStamps = await sql<
    { id: string; completedAt: number | null }[]
  >`
    SELECT id, completed_at_ms::float8 AS "completedAt"
    FROM app.tasks
    WHERE id = ${terminalTaskIds.doneId} OR id = ${terminalTaskIds.cancelledId}
  `;
  record(
    'task creation: Done and Cancelled receive completion timestamps',
    terminalStamps.length === 2 &&
      terminalStamps.every(
        (task) => typeof task.completedAt === 'number' && task.completedAt > 0,
      ),
    JSON.stringify(terminalStamps),
  );
  // An agent task filed three days ago: started two days ago, sent back
  // once yesterday, approved an hour ago.
  const agentCreated = now - 3 * DAY;
  const agentStarted = now - 2 * DAY;
  const agentDone = now - HOUR;
  // A human task in progress since five days ago, overdue since four.
  const humanCreated = now - 5 * DAY;
  // A task done long before the scan range: never counted.
  const oldCreated = now - 20 * DAY;
  const tasks = [
    {
      id: agentTaskId,
      status: 'done',
      assigneeType: 'agent',
      assigneeId: agentId,
      createdAt: agentCreated,
      statusChangedAt: agentDone,
      completedAt: agentDone,
      dueDate: null,
    },
    {
      id: humanTaskId,
      status: 'in_progress',
      assigneeType: 'user',
      assigneeId: userId,
      createdAt: humanCreated,
      statusChangedAt: humanCreated,
      completedAt: null,
      dueDate: now - 4 * DAY,
    },
    {
      id: oldTaskId,
      status: 'done',
      assigneeType: 'user',
      assigneeId: userId,
      createdAt: oldCreated,
      statusChangedAt: oldCreated + HOUR,
      completedAt: oldCreated + HOUR,
      dueDate: null,
    },
  ];
  for (const task of tasks) {
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, assignee_type,
        assignee_id, rank, status_changed_at_ms, completed_at_ms, due_date_ms,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${task.id}, ${orgId}, ${projectId}, 'Metrics task', ${task.status},
        ${task.assigneeType}, ${task.assigneeId}, 'a0', ${task.statusChangedAt},
        ${task.completedAt}, ${task.dueDate}, ${userId}, 'user',
        ${task.createdAt}, ${task.createdAt})
    `;
  }
  const activity: Array<{
    taskId: string;
    actorType: 'user' | 'agent';
    action: string;
    from: string | null;
    to: string | null;
    at: number;
  }> = [
    {
      taskId: agentTaskId,
      actorType: 'user',
      action: 'created',
      from: null,
      to: 'todo',
      at: agentCreated,
    },
    {
      taskId: agentTaskId,
      actorType: 'user',
      action: 'status.changed',
      from: 'todo',
      to: 'in_progress',
      at: agentStarted,
    },
    {
      taskId: agentTaskId,
      actorType: 'agent',
      action: 'status.changed',
      from: 'in_progress',
      to: 'in_review',
      at: agentStarted + HOUR,
    },
    {
      taskId: agentTaskId,
      actorType: 'user',
      action: 'status.changed',
      from: 'in_review',
      to: 'in_progress',
      at: now - DAY,
    },
    {
      taskId: agentTaskId,
      actorType: 'agent',
      action: 'status.changed',
      from: 'in_progress',
      to: 'in_review',
      at: now - DAY + HOUR,
    },
    {
      taskId: agentTaskId,
      actorType: 'user',
      action: 'status.changed',
      from: 'in_review',
      to: 'done',
      at: agentDone,
    },
    {
      taskId: humanTaskId,
      actorType: 'user',
      action: 'created',
      from: null,
      to: 'in_progress',
      at: humanCreated,
    },
    {
      taskId: oldTaskId,
      actorType: 'user',
      action: 'created',
      from: null,
      to: 'todo',
      at: oldCreated,
    },
    {
      taskId: oldTaskId,
      actorType: 'user',
      action: 'status.changed',
      from: 'todo',
      to: 'done',
      at: oldCreated + HOUR,
    },
  ];
  for (const row of activity) {
    await sql`
      INSERT INTO app.task_activity (org_id, task_id, project_id, actor_type,
        actor_id, action, from_value, to_value, created_at_ms)
      VALUES (${orgId}, ${row.taskId}, ${projectId}, ${row.actorType},
        ${row.actorType === 'user' ? userId : agentId}, ${row.action},
        ${row.from}, ${row.to}, ${row.at})
    `;
  }
  // Two agent runs on the agent task: one settled, one failed, each with
  // its op row's spend (12.4 + 0.6 cents → 13 once rounded).
  const runs = [
    { status: 'settled', startedAt: agentStarted, spentCents: 12.4 },
    { status: 'failed', startedAt: now - DAY, spentCents: 0.6 },
  ];
  const sessionId = `itest-metrics-session-${randomUUID()}`;
  for (const run of runs) {
    const execId = randomUUID();
    await sql`
      INSERT INTO app.project_agent_runs (org_id, project_id, task_id, agent_id,
        exec_id, session_id, status, harness, model, started_by, started_at_ms,
        deadline_at_ms, settled_at_ms, updated_at_ms)
      VALUES (${orgId}, ${projectId}, ${agentTaskId}, ${agentId}, ${execId},
        ${sessionId}, ${run.status}, 'claude-code', 'itest-model',
        ${`user:${userId}`}, ${run.startedAt}, ${run.startedAt + HOUR},
        ${run.startedAt + HOUR / 2}, ${run.startedAt + HOUR / 2})
    `;
    await sql`
      INSERT INTO app.sandbox_session_ops (org_id, session_id, exec_id, kind,
        status, spent_cents, started_at_ms, finished_at_ms)
      VALUES (${orgId}, ${sessionId}, ${execId}, 'task-agent',
        ${run.status === 'failed' ? 'failed' : 'completed'}, ${run.spentCents},
        ${run.startedAt}, ${run.startedAt + HOUR / 2})
    `;
  }
  // The approve that moved the agent task to Done.
  await sql`
    INSERT INTO app.approvals (org_id, resource_type, resource_id, status,
      approved_by, reviewed_at_ms, metadata, created_at_ms)
    VALUES (${orgId}, 'task_review', ${agentTaskId}, 'completed', ${userId},
      ${agentDone}, ${sql.json({ taskId: agentTaskId, projectId })},
      ${now - DAY + HOUR})
  `;
  // A question an automation run on this project asked a person yesterday.
  await sql`
    INSERT INTO app.automations (org_id, name, version, document, created_by, created_at_ms)
    VALUES (${orgId}, ${automation}, 1, ${sql.json({ steps: [] })}, ${userId}, ${now})
  `;
  const runRows = await sql<{ id: string }[]>`
    INSERT INTO app.automation_runs (org_id, name, version, project_id, status,
      mode, started_by, started_at_ms, finished_at_ms)
    VALUES (${orgId}, ${automation}, 1, ${projectId}, 'success', 'live',
      ${`user:${userId}`}, ${now - DAY}, ${now - DAY + HOUR})
    RETURNING id
  `;
  const automationRunId = runRows[0]?.id ?? '';
  await sql`
    INSERT INTO app.automation_human_asks (org_id, run_id, node_id, session_id,
      exec_id, question, status, expires_at_ms, task_id, created_at_ms)
    VALUES (${orgId}, ${automationRunId}, 'ask', ${sessionId}, ${randomUUID()},
      'Which one?', 'answered', ${now + DAY}, ${agentTaskId}, ${now - DAY})
  `;

  try {
    const metrics = await getProjectTaskMetrics(
      sql,
      { organizationId: orgId, userId, role: 'owner', teamIds: [] },
      projectId,
      { periodDays: 7 },
    );
    const { daily, previousDaily } = metrics;
    const today = daily[daily.length - 1];
    const created = sum(daily, (d) => d.tasksCreated);
    const completed = sum(daily, (d) => d.tasksCompleted);
    const agentCompleted = sum(daily, (d) => d.agentCompleted);
    const cycleCount = sum(daily, (d) => d.cycleTimeCount);
    const cycleSum = sum(daily, (d) => d.cycleTimeSumMs);
    const leadSum = sum(daily, (d) => d.leadTimeSumMs);
    const changes = sum(daily, (d) => d.reviewsChangesRequested);
    const passed = sum(daily, (d) => d.reviewsPassed);
    const escalations = sum(daily, (d) => d.escalations);
    const runsStarted = sum(daily, (d) => d.agentRunsStarted);
    const runsFailed = sum(daily, (d) => d.agentRunsFailed);
    const cost = sum(daily, (d) => d.totalCostCents);
    const previousActivity =
      sum(previousDaily, (d) => d.tasksCreated + d.tasksCompleted + d.wipEod) +
      sum(previousDaily, (d) => d.statusCountsEod.in_progress);
    record(
      'project task metrics fold over live rows',
      daily.length === 7 &&
        previousDaily.length === 7 &&
        created === 2 &&
        completed === 1 &&
        agentCompleted === 1 &&
        cycleCount === 1 &&
        cycleSum === agentDone - agentStarted &&
        leadSum === agentDone - agentCreated &&
        changes === 1 &&
        passed === 1 &&
        escalations === 1 &&
        runsStarted === 2 &&
        runsFailed === 1 &&
        cost === 13 &&
        today?.statusCountsEod.in_progress === 1 &&
        today.statusCountsEod.in_review === 0 &&
        today.wipEod === 1 &&
        today.overdueEod === 1 &&
        today.staleEod === 1 &&
        previousActivity === 0 &&
        !daily.some((d) => d.capped),
      `days=${daily.length}/${previousDaily.length} (want 7/7), created=${created} (want 2), completed=${completed} (want 1) agent=${agentCompleted} (want 1), cycle=${cycleCount}×${cycleSum} (want 1×${agentDone - agentStarted}), lead=${leadSum} (want ${agentDone - agentCreated}), changes=${changes} passed=${passed} escalations=${escalations} (want 1 each), runs=${runsStarted}/${runsFailed} failed (want 2/1), cost=${cost} (want 13), todayEod=${JSON.stringify(today?.statusCountsEod)} wip=${today?.wipEod} overdue=${today?.overdueEod} stale=${today?.staleEod} (want in_progress 1 / 1 / 1 / 1), previousActivity=${previousActivity} (want 0)`,
    );
  } finally {
    await sql`DELETE FROM app.automation_human_asks WHERE org_id = ${orgId} AND run_id = ${automationRunId}`;
    await sql`DELETE FROM app.automation_runs WHERE id = ${automationRunId}`;
    await sql`DELETE FROM app.automations WHERE org_id = ${orgId} AND name = ${automation}`;
    await sql`DELETE FROM app.approvals WHERE org_id = ${orgId} AND resource_id = ${agentTaskId}`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId} AND session_id = ${sessionId}`;
    await sql`DELETE FROM app.project_agent_runs WHERE project_id = ${projectId}`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
