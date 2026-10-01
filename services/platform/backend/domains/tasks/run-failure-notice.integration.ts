/** Real Postgres proof that a project-agent run which fails for good is
 * announced once, to the people it answers to and only to them, and that the
 * task's run card tells a final failure from one about to be retried
 * (`auto_retry_armed_at_ms`, migration 0142):
 *
 * - the arm is the migration's nullable bigint column, and unread notices
 *   are indexed by task for the dismissal every kick runs (migration 0143);
 * - a turn that fails on a code no retry changes stamps no arm and announces
 *   in the failing transaction — to the run's starter and the task's unmuted
 *   watchers who can still open the project, never to a watcher who left the
 *   organization or muted the task — and the card reads it as final, with
 *   its code;
 * - a new run on the task marks those notices read;
 * - a turn that fails on a code a retry can change stamps the arm, tells
 *   nobody, and the card reads it as pending; when the retry job then refuses
 *   for good (the starter lost the Editor role), the run is retired and
 *   announced in the job's transaction — to the people who can open the team
 *   project, not a watcher outside its team — a second delivery adds nothing,
 *   and the card reads it as final;
 * - the deadline sweep's fail stamps its code, arms nothing, announces, and
 *   reads as final.
 *
 * The queue is inert: every agent-turn and retry job this lane's writes
 * enqueue is held a day inside the writing transaction, and the lane delivers
 * the retry job itself, as pg-boss would (twice). No sandbox, provider or
 * model is touched. */
import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { createTaskList } from '../../jobs/task-list.ts';
import {
  failAgentRun,
  failAgentRunFromTurn,
  getLatestAgentRunCardForTask,
  kickAgentRun,
} from './agent-runs.ts';
import { aroundTransactions } from './retry-eligibility.integration.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkAgentRunFailureNotice(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const starter = `notice-starter-${suffix}`;
  const watcher = `notice-watcher-${suffix}`;
  const departed = `notice-departed-${suffix}`;
  const outsider = `notice-outsider-${suffix}`;
  const people = [starter, watcher, departed, outsider];
  const members = [starter, watcher, outsider];
  const teamId = `notice-team-${suffix}`;
  const projectId = randomUUID();
  const teamProjectId = randomUUID();
  const projects = [projectId, teamProjectId];
  const agentId = randomUUID();
  const teamAgentId = randomUUID();
  const now = Date.now();

  // Every task and retry job this lane's writes enqueue stays queued a day:
  // held in the writing transaction, before any worker can see it.
  const holdJobs = async (tx: TransactionSql) => {
    await tx`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name IN ('task.agent_turn', 'task.agent_retry')
        AND state = 'created'
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id IN ${sql(projects)})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id IN ${sql(projects)}))
    `;
  };
  const held = aroundTransactions(sql, { after: holdJobs });
  const retryHandler = createTaskList({ sql: held })['task.agent_retry'];
  if (retryHandler === undefined) {
    throw new Error('itest: the retry handler is missing');
  }

  /** An agent-owned task at In progress the owner created. */
  const mkTask = async (
    project: string,
    agent: string,
    title: string,
  ): Promise<string> => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${project}, ${title}, 'in_progress',
        ${`n${suffix}${title.length}`}, 'agent', ${agent}, ${userId}, 'user',
        ${now}, ${now})
    `;
    return taskId;
  };
  const watch = (taskId: string, who: string, muted = false) => sql`
    INSERT INTO app.task_subscriptions (org_id, task_id, subscriber_type,
      subscriber_id, reason, muted, created_at_ms)
    VALUES (${orgId}, ${taskId}, 'user', ${who}, 'manual', ${muted}, ${now})
  `;
  /** A run the starter kicked, working now. */
  const liveRun = async (
    project: string,
    taskId: string,
    agent: string,
  ): Promise<{ runId: string; execId: string }> => {
    const execId = `exec-notice-${randomUUID().slice(0, 8)}`;
    const started = Date.now();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, launched_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${project}, ${taskId}, ${agent}, ${execId},
        ${`pa-${agent}`}, 'running', 'claude-code', 'itest-model',
        ${starter}, ${started - 2_000}, ${started - 1_000},
        ${started + 3_600_000}, ${started}
      ) RETURNING id
    `;
    return { runId: rows[0]?.id ?? '', execId };
  };
  const noticesOf = (taskId: string) =>
    sql<{ userId: string; bodyKey: string; read: boolean }[]>`
      SELECT user_id AS "userId", body_key AS "bodyKey", read
      FROM app.user_notifications
      WHERE org_id = ${orgId} AND task_id = ${taskId}
        AND type = 'agent_run_failed'
      ORDER BY user_id
    `;
  const markOf = async (runId: string) =>
    (
      await sql<
        { armed: number | null; retired: number | null; code: string | null }[]
      >`
        SELECT auto_retry_armed_at_ms::float8 AS armed,
               auto_retry_refused_at_ms::float8 AS retired,
               failure_code AS code
        FROM app.project_agent_runs WHERE id = ${runId}
      `
    )[0];
  const cardOf = async (taskId: string) => {
    const card = await getLatestAgentRunCardForTask(sql, orgId, taskId);
    return card === null
      ? null
      : {
          status: card.status,
          failureCode: card.failureCode ?? null,
          retryPending: card.retryPending === true,
        };
  };
  /** Who was told, with which body. */
  const told = (rows: { userId: string; bodyKey: string }[]) =>
    JSON.stringify(rows.map((row) => [row.userId, row.bodyKey]));

  try {
    for (const person of people) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${person}, ${person}, ${`${person}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
    }
    // The departed watcher keeps its subscription but no membership.
    for (const person of members) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${person}`}, ${orgId}, ${person},
                ${person === starter ? 'editor' : 'member'}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (${teamId}, 'Notice squad', ${orgId}, ${new Date()}, ${new Date()})
    `;
    for (const person of [starter, watcher]) {
      await sql`
        INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
        VALUES (${`tm-${person}`}, ${teamId}, ${person}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Failed-run notice', ${userId}, ${now},
              ${now})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, team_ids, created_by,
                                created_at_ms, updated_at_ms)
      VALUES (${teamProjectId}, ${orgId}, 'Failed-run notice (team)',
              ${sql.array([teamId])}, ${userId}, ${now}, ${now})
    `;
    for (const [agent, project] of [
      [agentId, projectId],
      [teamAgentId, teamProjectId],
    ] as const) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                        model, created_by, created_at_ms,
                                        updated_at_ms)
        VALUES (${agent}, ${orgId}, ${project}, 'Notice agent', 'claude-code',
                'itest-model', ${userId}, ${now}, ${now})
      `;
    }

    const column = await sql<{ type: string; nullable: string }[]>`
      SELECT data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'project_agent_runs'
        AND column_name = 'auto_retry_armed_at_ms'
    `;
    const applied = await sql<{ name: string }[]>`
      SELECT name FROM app_migrations
      WHERE name IN ('0142_project_agent_runs_auto_retry_armed.sql',
                     '0143_user_notifications_unread_task.sql')
    `;
    // The kick's dismissal reads unread rows by task through this index.
    const index = await sql<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE schemaname = 'app' AND tablename = 'user_notifications'
        AND indexname = 'user_notifications_unread_task'
    `;
    record(
      'failed-run notice: the retry arm is the migration’s nullable bigint column, and unread notices are indexed by task',
      column[0]?.type === 'bigint' &&
        column[0].nullable === 'YES' &&
        applied.length === 2 &&
        index.length === 1,
      `column=${JSON.stringify(column)} applied=${applied.length} index=${JSON.stringify(index)}`,
    );

    // ---- a failure no retry changes: told at once ------------------------
    const spentTask = await mkTask(projectId, agentId, 'Spent limit');
    await watch(spentTask, watcher);
    await watch(spentTask, departed);
    await watch(spentTask, outsider, true);
    const spent = await liveRun(projectId, spentTask, agentId);
    await failAgentRunFromTurn(held, {
      runId: spent.runId,
      execId: spent.execId,
      error: 'itest: the organization spend cap refused the run',
      failureCode: 'budget_exceeded',
    });
    const spentMark = await markOf(spent.runId);
    const spentNotices = await noticesOf(spentTask);
    const spentCard = await cardOf(spentTask);
    const spentWant = told([
      { userId: starter, bodyKey: 'agentRunFailedBudgetBody' },
      { userId: watcher, bodyKey: 'agentRunFailedBudgetBody' },
    ]);
    record(
      'failed-run notice: a failure no retry changes arms nothing, tells the starter and the watchers who can still open the project — not one who left the organization, not one who muted the task — and reads as final',
      spentMark?.armed === null &&
        spentMark.code === 'budget_exceeded' &&
        told(spentNotices) === spentWant &&
        spentNotices.every((row) => !row.read) &&
        JSON.stringify(spentCard) ===
          JSON.stringify({
            status: 'failed',
            failureCode: 'budget_exceeded',
            retryPending: false,
          }),
      `mark=${JSON.stringify(spentMark)} told=${told(spentNotices)} (want ${spentWant}) card=${JSON.stringify(spentCard)}`,
    );

    await held.begin(async (tx) => {
      await kickAgentRun(tx, {
        organizationId: orgId,
        projectId,
        taskId: spentTask,
        agentId,
        harness: 'claude-code',
        model: 'itest-model',
        startedBy: starter,
      });
    });
    const answered = await noticesOf(spentTask);
    record(
      'failed-run notice: a new run on the task marks its unread notices read',
      answered.length === 2 && answered.every((row) => row.read),
      `notices=${JSON.stringify(answered)}`,
    );

    // ---- armed, then refused for good by the retry job -------------------
    const crashTask = await mkTask(teamProjectId, teamAgentId, 'Crashed turn');
    await watch(crashTask, watcher);
    await watch(crashTask, outsider);
    const crash = await liveRun(teamProjectId, crashTask, teamAgentId);
    await failAgentRunFromTurn(held, {
      runId: crash.runId,
      execId: crash.execId,
      error: 'itest: the harness exited before the turn completed',
      failureCode: 'turn_crashed',
    });
    const armedMark = await markOf(crash.runId);
    const armedNotices = await noticesOf(crashTask);
    const armedCard = await cardOf(crashTask);
    const jobs = await sql<{ data: unknown }[]>`
      SELECT data FROM pgboss.job
      WHERE name = 'task.agent_retry'
        AND data ->> 'expectedRunId' = ${crash.runId}
    `;
    record(
      'failed-run notice: a failure a retry can change stamps the arm with it, tells nobody, and reads as pending',
      typeof armedMark?.armed === 'number' &&
        armedNotices.length === 0 &&
        armedCard?.retryPending === true &&
        jobs.length === 1,
      `mark=${JSON.stringify(armedMark)} notices=${armedNotices.length} card=${JSON.stringify(armedCard)} retry jobs=${jobs.length}`,
    );

    // The starter may no longer work the task: the retry is refused for
    // good. pg-boss delivers at least once — the same job again.
    await sql`UPDATE "member" SET "role" = 'member' WHERE "id" = ${`m-${starter}`}`;
    const log = console.log;
    console.log = () => undefined;
    try {
      await retryHandler(jobs[0]?.data);
      await retryHandler(jobs[0]?.data);
    } finally {
      console.log = log;
    }
    const refusedMark = await markOf(crash.runId);
    const refusedNotices = await noticesOf(crashTask);
    const refusedCard = await cardOf(crashTask);
    const refusedWant = told([
      { userId: starter, bodyKey: 'agentRunFailedBody' },
      { userId: watcher, bodyKey: 'agentRunFailedBody' },
    ]);
    record(
      'failed-run notice: the retry job’s refusal for good retires the run and tells once — the starter and the watcher in the team project’s team, not one outside it — and the card reads it as final',
      typeof refusedMark?.retired === 'number' &&
        told(refusedNotices) === refusedWant &&
        refusedCard?.retryPending === false &&
        refusedCard.failureCode === 'turn_crashed',
      `mark=${JSON.stringify(refusedMark)} told=${told(refusedNotices)} (want ${refusedWant}) card=${JSON.stringify(refusedCard)}`,
    );

    // ---- the deadline sweep ----------------------------------------------
    const lateTask = await mkTask(projectId, agentId, 'Past its deadline');
    const late = await liveRun(projectId, lateTask, agentId);
    const swept = await failAgentRun(held, {
      organizationId: orgId,
      runId: late.runId,
      execId: late.execId,
      error: 'the agent run ran past its time limit and was stopped',
      failureCode: 'deadline',
    });
    const lateMark = await markOf(late.runId);
    const lateNotices = await noticesOf(lateTask);
    const lateCard = await cardOf(lateTask);
    record(
      'failed-run notice: the deadline sweep stamps its code, arms nothing, tells the starter, and reads as final',
      swept &&
        lateMark?.armed === null &&
        lateMark.code === 'deadline' &&
        told(lateNotices) ===
          told([{ userId: starter, bodyKey: 'agentRunFailedBody' }]) &&
        JSON.stringify(lateCard) ===
          JSON.stringify({
            status: 'failed',
            failureCode: 'deadline',
            retryPending: false,
          }),
      `swept=${swept} mark=${JSON.stringify(lateMark)} told=${told(lateNotices)} card=${JSON.stringify(lateCard)}`,
    );
  } finally {
    await sql`
      DELETE FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_retry')
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id IN ${sql(projects)})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id IN ${sql(projects)}))
    `;
    // The notices' debounced emails find their rows gone and send nothing.
    await sql`
      DELETE FROM app.user_notifications
      WHERE org_id = ${orgId} AND task_id IN (
        SELECT id FROM app.tasks WHERE project_id IN ${sql(projects)})
    `;
    // Cascades to their agents, tasks, runs and subscriptions.
    await sql`DELETE FROM app.projects WHERE id IN ${sql(projects)}`;
    await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await sql`DELETE FROM "member" WHERE "userId" IN ${sql(people)}`;
    await sql`DELETE FROM "user" WHERE "id" IN ${sql(people)}`;
  }
}
