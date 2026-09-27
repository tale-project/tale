/** Real Postgres proof: a task description's @mentions fan out the way a
 * comment's do — on create, and for the mentions an edit adds only. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { clearOrgConfigCaches, resolveOrgSlug } from '../../lib/org-config.ts';
import { createTask, mentionTriggerPreview, updateTask } from './service.ts';

export async function checkTaskDescriptionMentions(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const ada = `desc-mention-ada-${suffix}`;
  const bob = `desc-mention-bob-${suffix}`;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const now = Date.now();
  for (const [id, name] of [
    [ada, 'Ada Brief'],
    [bob, 'Bob Brief'],
  ] as const) {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (${id}, ${name}, ${`${id}@example.com`}, true, ${new Date()},
              ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${id}`}, ${orgId}, ${id}, 'member', ${new Date()})
    `;
  }
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Description mentions', ${userId}, ${now},
            ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                    model, created_by, created_at_ms,
                                    updated_at_ms)
    VALUES (${agentId}, ${orgId}, ${projectId}, 'Brief Writer', 'claude-code',
            'itest-model', ${userId}, ${now}, ${now})
  `;
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };

  // The harness runs the production worker, and a turn it started would
  // move the card under these checks: every kick stays queued, deferred in
  // the write's own transaction before any worker can see its job.
  const deferTurns = async (tx: TransactionSql, taskId: string) => {
    await tx`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name = 'task.agent_turn'
        AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                 WHERE task_id = ${taskId})
    `;
  };
  const edit = (taskId: string, description: string) =>
    transactSerializable(sql, async (tx) => {
      await updateTask(tx, auth, { taskId, description });
      await deferTurns(tx, taskId);
    });
  const create = (title: string, description: string) =>
    transactSerializable(sql, async (tx) => {
      const taskId = await createTask(tx, auth, {
        projectId,
        title,
        description,
      });
      await deferTurns(tx, taskId);
      return taskId;
    });
  const mentionBells = async (recipient: string, taskId: string) => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.user_notifications
      WHERE org_id = ${orgId} AND user_id = ${recipient} AND type = 'mention'
        AND resource_type = 'task' AND resource_id = ${taskId}
    `;
    return rows[0]?.count ?? -1;
  };
  const agentRuns = (taskId: string) =>
    sql<
      {
        status: string;
        trigger: string | null;
        feedback: string | null;
        agentId: string;
      }[]
    >`
      SELECT status, trigger, feedback, agent_id AS "agentId"
      FROM app.project_agent_runs WHERE task_id = ${taskId}
      ORDER BY seq
    `;
  const taskState = async (taskId: string) => {
    const rows = await sql<
      {
        status: string;
        assigneeType: string | null;
        assigneeId: string | null;
      }[]
    >`
      SELECT status, assignee_type AS "assigneeType",
             assignee_id AS "assigneeId"
      FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0];
  };

  try {
    // ---- create: the teammate is belled, the agent is put to work -------
    const brief = `@${ada} and @brief.writer: draft the launch brief`;
    const taskId = await create('Launch brief', brief);
    const createdRuns = await agentRuns(taskId);
    const created = await taskState(taskId);
    const follows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.task_subscriptions
      WHERE task_id = ${taskId} AND subscriber_id = ${ada}
        AND reason = 'mention'
    `;
    const adaBells = await mentionBells(ada, taskId);
    record(
      'description mentions: a new task bells the named teammate and puts the named agent to work',
      adaBells === 1 &&
        follows[0]?.count === 1 &&
        createdRuns.length === 1 &&
        createdRuns[0]?.status === 'queued' &&
        createdRuns[0].trigger === 'mention' &&
        createdRuns[0].feedback === brief &&
        createdRuns[0].agentId === agentId &&
        created?.status === 'in_progress' &&
        created.assigneeType === 'agent' &&
        created.assigneeId === agentId,
      `bells=${adaBells} (want 1), follows=${follows[0]?.count} (want 1), runs=${createdRuns.map((run) => `${run.status}/${run.trigger}/${run.agentId === agentId}`).join(',') || 'none'} (want queued/mention/true), feedbackIsBrief=${createdRuns[0]?.feedback === brief}, task=${created?.status}/${created?.assigneeType}/${created?.assigneeId === agentId}`,
    );
    // Idle again, so a mention that fired twice would show up as a run.
    await sql`
      UPDATE app.project_agent_runs
      SET status = 'cancelled', settled_at_ms = ${Date.now()}
      WHERE task_id = ${taskId}
    `;

    // ---- edit: prose reworded around the same mentions fires nothing ----
    const reworded = `@${ada} and @brief.writer: draft the launch brief by Friday`;
    await edit(taskId, reworded);
    const rewordedRuns = await agentRuns(taskId);
    const rewordedBells = await mentionBells(ada, taskId);
    record(
      'description mentions: an edit around unchanged mentions rings and starts nothing again',
      rewordedBells === 1 && rewordedRuns.length === 1,
      `bells=${rewordedBells} (want 1, unchanged), runs=${rewordedRuns.length} (want 1, unchanged)`,
    );

    // ---- edit: only the mention the edit adds fans out -------------------
    await edit(taskId, `${reworded}, cc @${bob}`);
    const bobBells = await mentionBells(bob, taskId);
    const adaAfterAdd = await mentionBells(ada, taskId);
    const addedRuns = await agentRuns(taskId);
    record(
      'description mentions: an edit fans out only the mention it adds',
      bobBells === 1 && adaAfterAdd === 1 && addedRuns.length === 1,
      `added=${bobBells} (want 1), alreadyNamed=${adaAfterAdd} (want 1), runs=${addedRuns.length} (want 1 — the agent was already named)`,
    );
  } finally {
    await sql`
      UPDATE app.project_agent_runs
      SET status = 'cancelled', settled_at_ms = ${Date.now()}
      WHERE project_id = ${projectId} AND status IN ('queued', 'running')
    `;
  }

  // ---- task automation off: the gate the composer's chips report ---------
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
  try {
    await writeFile(policy, 'enabled: false\n');
    // The preview's read is cached; the dispatcher's is not.
    clearOrgConfigCaches();
    const quietId = await create('FAQ', 'Draft the FAQ');
    const preview = await mentionTriggerPreview(sql, auth, {
      taskId: quietId,
      slugs: [agentId],
    });
    await edit(quietId, `@${ada} and @brief.writer: draft the FAQ`);
    const quietBells = await mentionBells(ada, quietId);
    const quietRuns = await agentRuns(quietId);
    const quiet = await taskState(quietId);
    record(
      'description mentions: with task automation off the bell rings and the agent stays idle, as the preview says',
      preview[0]?.reason === 'pack_disabled' &&
        !preview[0].willTrigger &&
        quietBells === 1 &&
        quietRuns.length === 0 &&
        quiet?.assigneeType === null &&
        quiet.status === 'backlog',
      `preview=${preview[0]?.reason}/${String(preview[0]?.willTrigger)} (want pack_disabled/false), bells=${quietBells} (want 1), runs=${quietRuns.length} (want 0), task=${quiet?.status}/${String(quiet?.assigneeType)} (want backlog/null)`,
    );
  } finally {
    if (previous === null) await rm(policy);
    else await writeFile(policy, previous);
    clearOrgConfigCaches();
    await sql`DELETE FROM "member" WHERE "id" IN (${`m-${ada}`}, ${`m-${bob}`})`;
  }
}
