/** Real Postgres proof: a task description's @mentions fan out the way a
 * comment's do — on create, and for the mentions an edit adds only. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { buildKickPrompts } from '../../core/tasks/agent_run_host.ts';
import { clearOrgConfigCaches, resolveOrgSlug } from '../../lib/org-config.ts';
import { MentionDirectoryError } from '../collab/mention-directory.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';
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
        mentionSource: string | null;
        agentId: string;
      }[]
    >`
      SELECT status, trigger, feedback, mention_source AS "mentionSource",
             agent_id AS "agentId"
      FROM app.project_agent_runs WHERE task_id = ${taskId}
      ORDER BY seq
    `;
  const taskState = async (taskId: string) => {
    const rows = await sql<
      {
        status: string;
        description: string | null;
        assigneeType: string | null;
        assigneeId: string | null;
      }[]
    >`
      SELECT status, description, assignee_type AS "assigneeType",
             assignee_id AS "assigneeId"
      FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0];
  };
  const cancelLiveRuns = () => sql`
    UPDATE app.project_agent_runs
    SET status = 'cancelled', settled_at_ms = ${Date.now()}
    WHERE project_id = ${projectId} AND status IN ('queued', 'running')
  `;
  /** The transaction with the directory's agent-instance leg failing, as in
   * `checkCollabMentions`; every other statement reaches the real handle. */
  const agentLegDown = (tx: TransactionSql): TransactionSql =>
    new Proxy(tx, {
      apply(target, thisArg, argArray: unknown[]) {
        const strings = argArray[0];
        if (
          Array.isArray(strings) &&
          strings.join('').includes('SELECT id, name FROM app.project_agents')
        ) {
          throw new Error('itest: instance listing down');
        }
        return Reflect.apply(target, thisArg, argArray);
      },
    });
  const refusal = (error: unknown) =>
    error instanceof MentionDirectoryError
      ? `${error.code}/${error.status}`
      : String(error);

  const slug = await resolveOrgSlug(sql, orgId);
  if (!slug || !process.env.TALE_CONFIG_DIR)
    throw new Error('Missing isolated policy fixture root');
  const policyDir = path.join(process.env.TALE_CONFIG_DIR, slug, 'governance');
  const policy = path.join(policyDir, 'task-automation.yml');
  let previousPolicy: Uint8Array | null | undefined;

  try {
    for (const [id, name] of [
      [ada, 'Ada Brief'],
      [bob, 'Bob Brief'],
    ] as const) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
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
      VALUES (${projectId}, ${orgId}, 'Description mentions', ${userId},
              ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                      model, created_by, created_at_ms,
                                      updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Brief Writer',
              'claude-code', 'itest-model', ${userId}, ${now}, ${now})
    `;

    // ---- create: the teammate is belled, the agent is put to work -------
    const brief = `@${ada} and @brief.writer: draft the launch brief in German`;
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
        createdRuns[0].mentionSource === 'description' &&
        createdRuns[0].feedback === null &&
        createdRuns[0].agentId === agentId &&
        created?.status === 'in_progress' &&
        created.assigneeType === 'agent' &&
        created.assigneeId === agentId,
      `bells=${adaBells} (want 1), follows=${follows[0]?.count} (want 1), runs=${createdRuns.map((run) => `${run.status}/${run.trigger}/${run.mentionSource}/${run.agentId === agentId}`).join(',') || 'none'} (want queued/mention/description/true), feedback=${JSON.stringify(createdRuns[0]?.feedback)} (want null: no copy), task=${created?.status}/${created?.assigneeType}/${created?.assigneeId === agentId}`,
    );

    // ---- an edit while the run waits: its start reads the edit -----------
    // The edit names nobody new, so nothing fires again; the queued run
    // must open on the edited description, never on the text it replaced.
    const retold = `@${ada} and @brief.writer: draft the launch brief in French`;
    await edit(taskId, retold);
    const waiting = await sql<
      { feedback: string | null; mentionSource: string | null }[]
    >`
      SELECT feedback, mention_source AS "mentionSource"
      FROM app.project_agent_runs
      WHERE task_id = ${taskId} AND status = 'queued'
    `;
    const readBrief =
      agentTurnShimHandlers(sql)['tasks/agent_runs:getTaskBriefForAgentRun'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shim answers the host's brief shape
    const startBrief = (await readBrief?.({ taskId })) as Parameters<
      typeof buildKickPrompts
    >[0]['brief'];
    const inputs = { dir: '/agent/inputs', attachments: [], outputs: [] };
    // What the turn job hands the host: the row's feedback and source.
    const stored = waiting[0];
    const prompts = buildKickPrompts({
      brief: startBrief,
      ...(stored !== undefined && stored.feedback !== null
        ? { feedback: stored.feedback }
        : {}),
      ...(stored?.mentionSource === 'description'
        ? { mentionSource: 'description' as const }
        : {}),
      outputDir: '/agent/output/brief',
      inputs,
      resumeDiscussionSince: 0,
    });
    const retoldRuns = await agentRuns(taskId);
    record(
      'description mentions: a run kicked before an edit opens on the edited description',
      waiting.length === 1 &&
        retoldRuns.length === 1 &&
        prompts.fresh.includes('in French') &&
        !prompts.fresh.includes('in German') &&
        !prompts.fresh.includes('reviewer feedback') &&
        prompts.resume.includes('in French') &&
        !prompts.resume.includes('in German'),
      `queued=${waiting.length} (want 1), runs=${retoldRuns.length} (want 1: the edit named nobody new), fresh=${prompts.fresh.includes('in French') ? 'French' : 'no French'}${prompts.fresh.includes('in German') ? '+German' : ''}${prompts.fresh.includes('reviewer feedback') ? '+feedback block' : ''} (want French only), resume=${prompts.resume.includes('in French') ? 'French' : 'no French'}${prompts.resume.includes('in German') ? '+German' : ''} (want French only)`,
    );
    // The schema holds the rule: a description kick carries no copy.
    const snapshot = await sql
      .begin(
        (tx) => tx`
          INSERT INTO app.project_agent_runs (
            org_id, project_id, task_id, agent_id, exec_id, session_id,
            status, harness, model, trigger, feedback, mention_source,
            started_by, started_at_ms, deadline_at_ms, updated_at_ms
          ) VALUES (
            ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${randomUUID()},
            ${`pa-${agentId}`}, 'cancelled', 'claude-code', 'itest-model',
            'mention', ${brief}, 'description', ${userId}, ${now},
            ${now + 60_000}, ${now}
          )
        `,
      )
      .then(
        () => 'written',
        (error: unknown) =>
          error instanceof Error && 'constraint_name' in error
            ? String(error.constraint_name)
            : String(error),
      );
    record(
      'description mentions: the schema refuses a description kick that stores a copy',
      snapshot === 'project_agent_runs_mention_source_no_snapshot',
      `insert → ${snapshot} (want project_agent_runs_mention_source_no_snapshot)`,
    );
    // Idle again, so a mention that fired twice would show up as a run.
    await cancelLiveRuns();

    // ---- edit: prose reworded around the same mentions fires nothing ----
    const reworded = `${retold} by Friday`;
    await edit(taskId, reworded);
    const rewordedRuns = await agentRuns(taskId);
    const rewordedBells = await mentionBells(ada, taskId);
    record(
      'description mentions: an edit around unchanged mentions rings and starts nothing again',
      rewordedBells === 1 && rewordedRuns.length === 1,
      `bells=${rewordedBells} (want 1, unchanged), runs=${rewordedRuns.length} (want 1, unchanged)`,
    );

    // ---- a directory that cannot be listed refuses the save -------------
    // Retryable 503 at the doors, and nothing written: not the card, not
    // the edit, not a bell.
    const downCreate = await transactSerializable(sql, (tx) =>
      createTask(agentLegDown(tx), auth, {
        projectId,
        title: 'Directory down',
        description: `@${bob} draft the FAQ`,
      }),
    ).then(
      () => 'saved',
      (error: unknown) => refusal(error),
    );
    const downCards = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.tasks
      WHERE project_id = ${projectId} AND title = 'Directory down'
    `;
    const downEdit = await transactSerializable(sql, (tx) =>
      updateTask(agentLegDown(tx), auth, {
        taskId,
        description: `${reworded}, cc @${bob}`,
      }),
    ).then(
      () => 'saved',
      (error: unknown) => refusal(error),
    );
    const afterDownEdit = await taskState(taskId);
    const bobBellsDown = await mentionBells(bob, taskId);
    record(
      'description mentions: a mention directory that cannot be listed refuses the create or the edit and writes nothing',
      downCreate === 'MENTION_DIRECTORY_UNAVAILABLE/503' &&
        downCards[0]?.count === 0 &&
        downEdit === 'MENTION_DIRECTORY_UNAVAILABLE/503' &&
        afterDownEdit?.description === reworded &&
        bobBellsDown === 0,
      `create → ${downCreate} (want MENTION_DIRECTORY_UNAVAILABLE/503), cards=${downCards[0]?.count} (want 0); edit → ${downEdit} (want MENTION_DIRECTORY_UNAVAILABLE/503), description kept=${afterDownEdit?.description === reworded}, bells=${bobBellsDown} (want 0)`,
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
    await cancelLiveRuns();

    // ---- task automation off: the gate the composer's chips report -------
    await mkdir(policyDir, { recursive: true });
    previousPolicy = await readFile(policy).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    });
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
    // Later lanes count the org's members, projects, tasks and runs: leave
    // none of this lane's behind, whichever check threw.
    if (previousPolicy === null) await rm(policy, { force: true });
    else if (previousPolicy !== undefined)
      await writeFile(policy, previousPolicy);
    clearOrgConfigCaches();
    await sql`
      DELETE FROM pgboss.job
      WHERE name = 'task.agent_turn'
        AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                 WHERE project_id = ${projectId})
    `;
    await sql`
      DELETE FROM app.user_notifications
      WHERE org_id = ${orgId}
        AND task_id IN (SELECT id FROM app.tasks
                        WHERE project_id = ${projectId})
    `;
    // Cascades to its agent, tasks, runs and subscriptions.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM "member" WHERE "id" IN (${`m-${ada}`}, ${`m-${bob}`})`;
    await sql`DELETE FROM "user" WHERE "id" IN (${ada}, ${bob})`;
  }
}
