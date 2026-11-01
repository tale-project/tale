/** Handoffs by mention on real PostgreSQL: a live agent run's comment
 * through the native `task_comment` tool records the handoff, and the
 * handoff starts the agent it names once that run has ended [TASK-R88].
 * The containing review lane owns these fixture rows and holds all queued
 * agent work. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import type { ProjectAuthContext } from '../projects/service.ts';
import type { Fixtures, Recorder } from './delegated-start.integration.ts';
import { processMentionHandoff } from './mention-handoff-runner.ts';
import { updateTaskReviewContextConfiguration } from './review-context.ts';
import { getPendingReviewForTask, requestTaskReview } from './reviews.ts';
import { loadTaskOrThrow } from './service.ts';

type Body = Record<string, unknown>;

interface Fixture {
  sql: Sql;
  orgId: string;
  projectId: string;
  implementerId: string;
  auth: ProjectAuthContext;
  fx: Fixtures;
  sessions: Set<string>;
  record: Recorder;
  dispatch: (token: string, args: unknown, tool?: string) => Promise<Body>;
  tokenFor: (
    sessionId: string,
    execId?: string,
    grants?: string[],
  ) => Promise<string>;
  addRun: (
    taskId: string,
    agentId: string,
    status?: string,
    sessionId?: string,
  ) => Promise<{ id: string; execId: string; sessionId: string }>;
}

const mention = (name: string, id: string) => `[@${name}](mention:agent/${id})`;

export async function checkMentionHandoffs(f: Fixture): Promise<void> {
  const { sql, orgId, projectId, fx } = f;
  const report = (name: string, ok: boolean, detail = '') =>
    f.record(`mention handoff: ${name}`, ok, detail);
  const writerAgent = randomUUID();
  const ungrantedAgent = randomUUID();
  const successor = randomUUID();
  const reviewer = randomUUID();
  const contextTaskId = await fx.insertTask({
    projectId,
    title: 'Handoff review context',
  });
  const tasks = [contextTaskId];
  const newTask = async (title: string) => {
    const taskId = await fx.insertTask({ projectId, title });
    tasks.push(taskId);
    return taskId;
  };
  const handoffs = (taskId: string) => sql<
    { id: string; agentId: string; approvalId: string | null }[]
  >`
    SELECT id, agent_id AS "agentId", approval_id AS "approvalId"
    FROM app.task_mention_handoffs
    WHERE org_id = ${orgId} AND task_id = ${taskId}
  `;
  const activity = async (taskId: string) =>
    (
      await sql<{ action: string; toValue: string | null }[]>`
        SELECT action, to_value AS "toValue" FROM app.task_activity
        WHERE task_id = ${taskId} AND action LIKE 'mention_handoff.%'
        ORDER BY id
      `
    ).map((row) => `${row.action}:${row.toValue}`);
  const runsOf = (taskId: string, agentId: string) => sql<
    { id: string; startedBy: string }[]
  >`
    SELECT id, started_by AS "startedBy" FROM app.project_agent_runs
    WHERE org_id = ${orgId} AND task_id = ${taskId} AND agent_id = ${agentId}
  `;
  // What the run's end and the watchdog ask the job for, called directly.
  const takeUp = async (taskId: string) => {
    for (const handoff of await handoffs(taskId))
      await processMentionHandoff(sql, {
        organizationId: orgId,
        taskId,
        handoffId: handoff.id,
      });
  };
  // A live run of the writing agent on a role task of its own: the task it
  // comments on is not the task the run works.
  const writer = async (agentId: string) => {
    const roleTask = await fx.insertTask({
      projectId,
      title: 'Handoff writer role',
      status: 'in_progress',
      agentId,
    });
    tasks.push(roleTask);
    const run = await f.addRun(roleTask, agentId, 'running');
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${run.sessionId}, 'active', 'project_agent', ${agentId}, 'itest:mention-handoff', ${fx.now}, ${fx.now + 3_600_000})`;
    f.sessions.add(run.sessionId);
    const token = await f.tokenFor(run.sessionId, run.execId, [
      'task_get',
      'task_comment',
    ]);
    return {
      ...run,
      comment: (taskId: string, body: string) =>
        f.dispatch(token, { taskId, body }, 'task_comment'),
    };
  };
  try {
    await fx.insertAgent(writerAgent, projectId, 'Handoff writer');
    await fx.insertAgent(
      ungrantedAgent,
      projectId,
      'Handoff writer, no starts',
    );
    await fx.insertAgent(successor, projectId, 'Handoff successor');
    await fx.insertAgent(reviewer, projectId, 'Handoff reviewer');
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_get','task_comment','task_start_agent']::text[] WHERE id = ${writerAgent}`;
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_get','task_comment']::text[] WHERE id = ${ungrantedAgent}`;
    await sql`UPDATE app.project_agents SET tools = ARRAY['task_review','task_get']::text[] WHERE id = ${reviewer}`;
    await transactSerializable(sql, (tx) =>
      updateTaskReviewContextConfiguration(
        tx,
        f.auth,
        {
          projectId,
          taskId: contextTaskId,
          reviewerAgentId: reviewer,
          enabled: true,
        },
        null,
      ),
    );
    const author = await writer(writerAgent);
    const starters = await sql<{ startedBy: string }[]>`
      SELECT started_by AS "startedBy" FROM app.project_agent_runs
      WHERE id = ${author.id}
    `;
    const authorStarter = starters[0]?.startedBy ?? '';

    const idle = await newTask('Handed on by mention');
    const asked = await author.comment(
      idle,
      `Ready for the next step, ${mention('Handoff successor', successor)}.`,
    );
    const recorded = await handoffs(idle);
    await takeUp(idle);
    report(
      'an agent’s mention waits while the writing run works another task',
      asked.status === 'ok' &&
        recorded.length === 1 &&
        recorded[0]?.agentId === successor &&
        (await handoffs(idle)).length === 1 &&
        (await runsOf(idle, successor)).length === 0,
      `asked=${JSON.stringify(asked)} handoffs=${recorded.length}`,
    );

    const inert = await newTask('Mentions that hand nothing on');
    await author.comment(
      inert,
      `> ${mention('Handoff successor', successor)} wrote this earlier.`,
    );
    await author.comment(
      inert,
      `Noted by ${mention('Handoff writer', writerAgent)} itself.`,
    );
    report(
      'a quoted mention and a mention of the writer itself hand nothing on',
      (await handoffs(inert)).length === 0 &&
        (await activity(inert)).length === 0,
      JSON.stringify(await activity(inert)),
    );

    const ungranted = await writer(ungrantedAgent);
    const refusedTask = await newTask('Named by an agent that starts none');
    await ungranted.comment(
      refusedTask,
      `${mention('Handoff successor', successor)}, take it from here.`,
    );
    const refusal = await activity(refusedTask);
    report(
      'a writer without task_start_agent hands nothing on and records why',
      (await handoffs(refusedTask)).length === 0 &&
        refusal.join() === 'mention_handoff.refused:no_start_grant',
      JSON.stringify(refusal),
    );

    const reviewed = await fx.insertTask({
      projectId,
      title: 'Reviewed after a mention',
      status: 'in_review',
      agentId: f.implementerId,
    });
    tasks.push(reviewed);
    const source = await f.addRun(reviewed, f.implementerId);
    await sql`UPDATE app.tasks SET reviewer_agent_id = ${reviewer} WHERE id = ${reviewed}`;
    await transactSerializable(sql, async (tx) =>
      requestTaskReview(tx, {
        task: await loadTaskOrThrow(tx, reviewed, orgId),
        trigger: { kind: 'agent_run', runId: source.id },
      }),
    );
    const pending = await getPendingReviewForTask(sql, orgId, reviewed);
    await author.comment(
      reviewed,
      `Over to you, ${mention('Handoff reviewer', reviewer)}.`,
    );
    const targeted = await handoffs(reviewed);

    await sql`UPDATE app.project_agent_runs
      SET status = 'settled', settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE id = ${author.id}`;
    await takeUp(idle);
    const started = await runsOf(idle, successor);
    const handedOn = await loadTaskOrThrow(sql, idle, orgId);
    report(
      'once the writing run ended the named agent starts with its starter',
      started.length === 1 &&
        started[0]?.startedBy === authorStarter &&
        handedOn.assigneeType === 'agent' &&
        handedOn.assigneeId === successor &&
        (await handoffs(idle)).length === 0 &&
        (await activity(idle)).join() ===
          `mention_handoff.started:${successor}`,
      `runs=${JSON.stringify(started)} starter=${authorStarter} activity=${JSON.stringify(await activity(idle))}`,
    );

    await takeUp(reviewed);
    const after = await getPendingReviewForTask(sql, orgId, reviewed);
    const reviewTask = await loadTaskOrThrow(sql, reviewed, orgId);
    report(
      'a mention of the routed reviewer starts it on a review context and keeps the review pending',
      pending !== null &&
        targeted[0]?.approvalId === pending.approvalId &&
        (await runsOf(contextTaskId, reviewer)).length === 1 &&
        (await runsOf(reviewed, reviewer)).length === 0 &&
        reviewTask.status === 'in_review' &&
        after?.approvalId === pending.approvalId &&
        (await handoffs(reviewed)).length === 0 &&
        (await activity(reviewed)).join() ===
          `mention_handoff.started:${reviewer}`,
      `targeted=${JSON.stringify(targeted)} status=${reviewTask.status} activity=${JSON.stringify(await activity(reviewed))}`,
    );
  } finally {
    await sql`DELETE FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_retry', 'task.agent_retry_recheck', 'task.mention_handoff')
        AND (data ->> 'taskId' = ANY(${tasks})
          OR data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
            WHERE org_id = ${orgId} AND task_id = ANY(${tasks})))`;
    await sql`DELETE FROM app.task_review_contexts WHERE org_id = ${orgId} AND task_id = ANY(${tasks})`;
  }
}
