/** Real Postgres proof of the chat → task link (`tasks.source_thread_id`,
 * migration 0144):
 *
 * - the link is the migration's nullable text column, indexed per
 *   organization for the tasks that have one;
 * - a task names the conversation it was handed over from only when its
 *   creator can read that conversation: a Member's own chat, or one its owner
 *   shared with a project the Member can open — never someone else's
 *   unshared chat (`TASK_SOURCE_THREAD_NOT_FOUND`, nothing written);
 * - the chat lists the tasks made from it that the reader can open: the
 *   owner sees every one, a Member not the one filed in a team project
 *   outside their teams.
 *
 * No task is created at In progress, so no agent run or job is involved. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { createThread, setThreadSharedWithProject } from '../chat/threads.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { createTask } from './service.ts';
import { listTasksFromThread } from './source-thread.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : String(error);
}

export async function checkTaskSourceThread(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const reader = `source-reader-${suffix}`;
  const teamId = `source-team-${suffix}`;
  const projectId = randomUUID();
  const teamProjectId = randomUUID();
  const now = Date.now();
  const threads: string[] = [];

  try {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified",
                          "createdAt", "updatedAt")
      VALUES (${reader}, 'Source Reader', ${`${reader}@example.com`}, true,
              ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${reader}`}, ${orgId}, ${reader}, 'member', ${new Date()})
    `;
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (${teamId}, 'Source squad', ${orgId}, ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Hand-over', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, team_ids, created_by,
                                created_at_ms, updated_at_ms)
      VALUES (${teamProjectId}, ${orgId}, 'Hand-over (team)',
              ${sql.array([teamId])}, ${userId}, ${now}, ${now})
    `;

    const column = await sql<{ type: string; nullable: string }[]>`
      SELECT data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'tasks'
        AND column_name = 'source_thread_id'
    `;
    const index = await sql<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'app' AND tablename = 'tasks'
        AND indexname = 'tasks_source_thread'
    `;
    record(
      'task source: the link is the migration’s nullable text column, indexed',
      column[0]?.type === 'text' &&
        column[0].nullable === 'YES' &&
        index.length === 1,
      `column=${JSON.stringify(column)} index=${index.length}`,
    );

    const ownerAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId,
      role: 'owner',
    });
    const readerAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: reader,
      role: 'member',
    });
    const ownerThread = await createThread(sql, {
      organizationId: orgId,
      userId,
      kind: 'chat',
      title: 'Compare the offers',
      projectId,
    });
    threads.push(ownerThread);
    const readerThread = await createThread(sql, {
      organizationId: orgId,
      userId: reader,
      kind: 'chat',
      title: 'My own chat',
    });
    threads.push(readerThread);

    const create = (
      auth: typeof ownerAuth,
      project: string,
      title: string,
      sourceThreadId: string,
    ) =>
      transactSerializable(sql, (tx) =>
        createTask(tx, auth, {
          projectId: project,
          title,
          status: 'todo',
          sourceThreadId,
        }),
      );

    // ---- who may name which conversation --------------------------------
    const own = await create(
      readerAuth,
      projectId,
      'From my chat',
      readerThread,
    );
    let refused = '';
    try {
      await create(readerAuth, projectId, 'Not my chat', ownerThread);
    } catch (error) {
      refused = codeOf(error);
    }
    const strays = await sql<{ id: string }[]>`
      SELECT id FROM app.tasks
      WHERE org_id = ${orgId} AND title = 'Not my chat'
        AND project_id = ${projectId}
    `;
    await setThreadSharedWithProject(
      sql,
      { organizationId: orgId, userId },
      ownerThread,
      true,
    );
    const fromShared = await create(
      readerAuth,
      projectId,
      'From the shared chat',
      ownerThread,
    );
    const stored = await sql<{ id: string; source: string | null }[]>`
      SELECT id, source_thread_id AS source FROM app.tasks
      WHERE id IN ${sql([own, fromShared])}
    `;
    const sourceOf = (id: string) =>
      stored.find((row) => row.id === id)?.source ?? null;
    record(
      'task source: a Member names their own chat and one shared with a project they can open, never an unshared chat of someone else',
      sourceOf(own) === readerThread &&
        sourceOf(fromShared) === ownerThread &&
        refused === 'TASK_SOURCE_THREAD_NOT_FOUND' &&
        strays.length === 0,
      `own=${sourceOf(own)} shared=${sourceOf(fromShared)} refused=${refused} (want TASK_SOURCE_THREAD_NOT_FOUND) strays=${strays.length}`,
    );

    // ---- what the chat lists, per reader --------------------------------
    const teamOnly = await create(
      ownerAuth,
      teamProjectId,
      'Filed with a team',
      ownerThread,
    );
    const ownerList = await listTasksFromThread(sql, ownerAuth, ownerThread);
    const readerList = await listTasksFromThread(sql, readerAuth, ownerThread);
    record(
      'task source: the chat lists the tasks made from it that the reader can open',
      JSON.stringify(ownerList.map((row) => row.id)) ===
        JSON.stringify([teamOnly, fromShared]) &&
        JSON.stringify(readerList.map((row) => row.id)) ===
          JSON.stringify([fromShared]) &&
        readerList[0]?.projectName === 'Hand-over' &&
        readerList[0].outputCount === 0,
      `owner=${JSON.stringify(ownerList.map((row) => row.title))} reader=${JSON.stringify(readerList.map((row) => row.title))}`,
    );
  } finally {
    // Cascades to their tasks.
    await sql`DELETE FROM app.projects WHERE id IN ${sql([projectId, teamProjectId])}`;
    if (threads.length > 0) {
      await sql`DELETE FROM app.threads WHERE id IN ${sql(threads)}`;
    }
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await sql`DELETE FROM "member" WHERE "userId" = ${reader}`;
    await sql`DELETE FROM "user" WHERE "id" = ${reader}`;
  }
}
