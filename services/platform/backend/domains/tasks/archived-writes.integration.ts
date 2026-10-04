/**
 * Real Postgres proof that an archived task's discussion and dependencies
 * stay as they were archived (#3589), through the app's and the REST API's
 * own HTTP doors. The REST comment door refused an archived task with 403
 * `TASK_ARCHIVED`, while the app's comment create, edit and delete and its
 * dependency add and remove answered 200 to a stale client and changed the
 * archived task: a discussion thread, the comment count, the edited text,
 * its edges and their activity lines.
 *
 * Now every one of them refuses with `TASK_ARCHIVED` and the task's rows,
 * activity and audit trail read as they did before, and the task read no
 * longer offers the archived task's composer (`canComment`). Three controls: an
 * archived blocker can still be dropped from an active task (the edge is the
 * blocked task's record, and the archived blocker's status no longer
 * moves), an active task keeps every verb, and the restored task takes a
 * comment again.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const refusal = z.looseObject({ error: z.string() });
const restRefusal = z.looseObject({ code: z.string() });

export async function checkArchivedTaskWrites(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const projectId = randomUUID();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${projectId}, ${orgId}, ${`Archived writes ${suffix}`}, ${userId},
            ${now}, ${now})
  `;
  let rank = 0;
  const insertTask = async (title: string): Promise<string> => {
    const id = randomUUID();
    rank += 1;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${projectId}, ${title}, 'todo',
        ${`w${suffix}${String(rank).padStart(3, '0')}`}, ${userId}, 'user',
        ${now}, ${now})
    `;
    return id;
  };
  const active = await insertTask('Active task');
  const archived = await insertTask('Task to archive');
  const blocked = await insertTask('Blocked by the archived task');
  const spare = await insertTask('Spare active task');

  const app = async (
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${base}/api/app/tasks${path}?orgId=${orgId}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  // What the task sheet is told: the composer and the comment actions
  // follow `canComment`.
  const canComment = async (taskId: string): Promise<string> => {
    const res = await fetch(`${base}/api/app/tasks/${taskId}?orgId=${orgId}`, {
      headers: { cookie },
    });
    const parsed = z
      .looseObject({ canComment: z.boolean() })
      .safeParse(await res.json());
    return parsed.success
      ? String(parsed.data.canComment)
      : `ERR ${res.status}`;
  };
  const code = (answer: { body: unknown }): string => {
    const parsed = refusal.safeParse(answer.body);
    return parsed.success ? parsed.data.error : 'none';
  };
  const commentOn = async (taskId: string, text: string) => {
    const posted = await app('POST', `/${taskId}/comments`, { body: text });
    const parsed = z
      .looseObject({ messageId: z.string() })
      .safeParse(posted.body);
    return {
      ...posted,
      messageId: parsed.success ? parsed.data.messageId : '',
    };
  };
  const edge = (blockerTaskId: string, blockedTaskId: string) => ({
    blockerTaskId,
    blockedTaskId,
  });

  // Before the archive: a comment and an edge each way, through the app.
  const first = await commentOn(archived, 'Figures checked before archive.');
  const seeded = [
    await app('POST', '/dependencies', edge(active, archived)),
    await app('POST', '/dependencies', edge(archived, blocked)),
  ];
  const archivedRes = await app('POST', `/${archived}/archive`);

  const snapshot = async (taskId: string) => {
    const [task] = await sql<
      { commentCount: number; updatedAt: number; threadId: string | null }[]
    >`
      SELECT comment_count AS "commentCount",
             updated_at_ms::float8 AS "updatedAt",
             discussion_thread_id AS "threadId"
      FROM app.tasks WHERE id = ${taskId}
    `;
    const messages = await sql<{ id: string; text: string | null }[]>`
      SELECT id, text FROM app.messages
      WHERE thread_id = ${task?.threadId ?? ''} ORDER BY "order"
    `;
    const [activity] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.task_activity
      WHERE task_id = ${taskId}
    `;
    const [audit] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.audit_logs
      WHERE org_id = ${orgId}
        AND (resource_id = ${taskId} OR metadata ->> 'taskId' = ${taskId})
    `;
    return JSON.stringify({
      task,
      messages,
      activity: activity?.count,
      audit: audit?.count,
    });
  };
  const edges = async (): Promise<string> => {
    const rows = await sql<{ blocker: string; blocked: string }[]>`
      SELECT blocker_task_id AS blocker, blocked_task_id AS blocked
      FROM app.task_dependencies WHERE project_id = ${projectId}
      ORDER BY blocker_task_id, blocked_task_id
    `;
    return rows.map((row) => `${row.blocker}>${row.blocked}`).join(',');
  };
  const name = (taskId: string): string =>
    ({
      [active]: 'active',
      [archived]: 'archived',
      [blocked]: 'blocked',
      [spare]: 'spare',
    })[taskId] ?? taskId;
  const edgeNames = async (): Promise<string> =>
    (await edges())
      .split(',')
      .filter((pair) => pair !== '')
      .map((pair) => pair.split('>').map(name).join('>'))
      .join(',');

  const before = await snapshot(archived);
  const edgesBefore = await edges();
  const sheet = `${await canComment(archived)}/${await canComment(active)}`;

  // The REST door: a key for the same person, the control the issue named.
  const [org] = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId}
  `;
  const minted = z.looseObject({ key: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ name: `itest-archived-writes-${suffix}` }),
      })
    ).json(),
  );
  const restComment = async (taskId: string) => {
    const res = await fetch(
      `${base}/api/v1/projects/${projectId}/tasks/${taskId}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${minted.success ? minted.data.key : ''}`,
          'x-organization-slug': org?.slug ?? '',
        },
        body: JSON.stringify({ body: 'Posted over REST.' }),
      },
    );
    const parsed = restRefusal.safeParse(await res.json());
    return `${res.status}/${parsed.success ? parsed.data.code : 'none'}`;
  };

  // Every write a stale client can still send to the archived task.
  const rest = await restComment(archived);
  const comment = await commentOn(archived, 'Posted after the archive.');
  const edit = await app('POST', `/comments/${first.messageId}`, {
    body: 'Edited after the archive.',
  });
  const removal = await app('DELETE', `/comments/${first.messageId}`);
  const title = await app('POST', `/${archived}`, { title: 'Renamed late' });
  const addInto = await app('POST', '/dependencies', edge(spare, archived));
  const addFrom = await app('POST', '/dependencies', edge(archived, spare));
  const removeInto = await app(
    'DELETE',
    '/dependencies',
    edge(active, archived),
  );
  const after = await snapshot(archived);
  const edgesAfter = await edges();

  const appCodes = [comment, edit, removal, title].map(
    (answer) => `${answer.status}/${code(answer)}`,
  );
  record(
    "tasks: an archived task's comment create, edit and delete refuse TASK_ARCHIVED on the app door as on the REST door, changing nothing",
    first.status === 200 &&
      first.messageId !== '' &&
      archivedRes.status === 200 &&
      sheet === 'false/true' &&
      rest === '403/TASK_ARCHIVED' &&
      appCodes.every((answer) => answer === '400/TASK_ARCHIVED') &&
      after === before,
    `seed=${first.status} archive=${archivedRes.status} canComment archived/active=${sheet} (want false/true) rest=${rest} (want 403/TASK_ARCHIVED) app comment/edit/delete/title=${appCodes.join(' ')} (want 400/TASK_ARCHIVED each) unchanged=${after === before}${after === before ? '' : ` before=${before} after=${after}`}`,
  );

  const depCodes = [addInto, addFrom, removeInto].map(
    (answer) => `${answer.status}/${code(answer)}`,
  );
  record(
    "tasks: an archived task's dependency add (either end) and remove refuse TASK_ARCHIVED, changing nothing",
    seeded.every((answer) => answer.status === 200) &&
      depCodes.every((answer) => answer === '400/TASK_ARCHIVED') &&
      edgesAfter === edgesBefore &&
      after === before,
    `seed=${seeded.map((answer) => answer.status).join('/')} add into/add from/remove=${depCodes.join(' ')} (want 400/TASK_ARCHIVED each) edges=${await edgeNames()} unchanged=${edgesAfter === edgesBefore}`,
  );

  // The controls. The archived blocker leaves the active task it blocks: the
  // edge is the blocked task's record, and its activity line lands there.
  const [blockedActivityBefore] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.task_activity
    WHERE task_id = ${blocked} AND action = 'dependency.removed'
  `;
  const freed = await app('DELETE', '/dependencies', edge(archived, blocked));
  const [blockedActivityAfter] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.task_activity
    WHERE task_id = ${blocked} AND action = 'dependency.removed'
  `;
  // An active task keeps every verb on both doors.
  const activeComment = await commentOn(active, 'Still open for comments.');
  const activeEdit = await app('POST', `/comments/${activeComment.messageId}`, {
    body: 'Edited while active.',
  });
  const activeDelete = await app(
    'DELETE',
    `/comments/${activeComment.messageId}`,
  );
  const activeAdd = await app('POST', '/dependencies', edge(spare, active));
  const activeRemove = await app(
    'DELETE',
    '/dependencies',
    edge(spare, active),
  );
  const activeRest = await restComment(active);
  // Restored, the task takes a comment again.
  const restored = await app('POST', `/${archived}/restore`);
  const restoredSheet = await canComment(archived);
  const restoredComment = await commentOn(archived, 'Back on the board.');
  const [archivedCount] = await sql<{ commentCount: number }[]>`
    SELECT comment_count AS "commentCount" FROM app.tasks
    WHERE id = ${archived}
  `;
  const controls = [
    freed,
    activeComment,
    activeEdit,
    activeDelete,
    activeAdd,
    activeRemove,
    restored,
    restoredComment,
  ].map((answer) => answer.status);
  record(
    'tasks: an archived blocker can still be dropped from an active task; an active task and a restored one keep their comments and dependencies',
    controls.every((status) => status === 200) &&
      (blockedActivityAfter?.count ?? 0) ===
        (blockedActivityBefore?.count ?? 0) + 1 &&
      activeRest === '201/none' &&
      restoredSheet === 'true' &&
      archivedCount?.commentCount === 2,
    `freed/comment/edit/delete/add/remove/restore/comment=${controls.join('/')} (want 200 each) freed activity=${blockedActivityBefore?.count}→${blockedActivityAfter?.count} (want +1) rest=${activeRest} (want 201) restored canComment=${restoredSheet} (want true) comment count=${archivedCount?.commentCount} (want 2) edges=${await edgeNames()}`,
  );
}
