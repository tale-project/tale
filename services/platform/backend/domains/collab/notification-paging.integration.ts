/** Real Postgres proof that a rewritten notification takes a fresh place at
 * the top of the bell (#3630). A recipient in a lane-owned organization is
 * told a task's status, then 26 later changes on other tasks — one more than
 * the web bell's first page of 25 — and the first task's status changes
 * again while its row is still unread:
 *
 * - before the rewrite, a walk in pages of 25 meets every row exactly once,
 *   and the status row, the oldest, is not on the first page;
 * - the writer rewrites that row in place: the same id and the new status,
 *   first on the first page, and the bell reads newest first; a second walk
 *   meets every row exactly once, and a pager still holding a cursor from
 *   before the rewrite never meets a row twice;
 * - a colleague told about the same task keeps their own row as it was,
 *   their bell holds none of the recipient's rows, and neither does the
 *   recipient's bell in another organization;
 * - the authenticated bell API reads the rewritten row first and pages to
 *   the same rows in the same order.
 *
 * Written through the production writer (`writeCoalescedNotification`) and
 * read through the bell's own query (`listMyNotifications`). Status rows
 * send no email, and the lane deletes its rows before it ends. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  listMyNotifications,
  type UserNotificationRow,
  writeCoalescedNotification,
} from './service.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;
type BellPage = Awaited<ReturnType<typeof listMyNotifications>>;

/** The web bell's page size (`initialNumItems` in the notifications hooks). */
const PAGE = 25;
/** Later changes on other tasks: one more than a page, so the first task's
 * row starts on the second page. */
const LATER = PAGE + 1;

const apiPage = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      params: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  nextCursor: z.number().nullable(),
});

/** Each row no newer than the one before it. */
const newestFirst = (rows: readonly UserNotificationRow[]): boolean =>
  rows.every(
    (row, i) =>
      i === 0 || (rows[i - 1]?.createdAt ?? Infinity) >= row.createdAt,
  );

/** The ids met more than once. */
const repeated = (ids: readonly string[]): string[] =>
  ids.filter((id, i) => ids.indexOf(id) !== i);

const idsOf = (pages: readonly BellPage[]): string[] =>
  pages.flatMap((page) => page.rows.map((row) => row.id));

export async function checkRewrittenNotificationPaging(
  sql: Sql,
  baseUrl: string,
  ctx: { orgId: string; userId: string; cookie: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId, cookie } = ctx;
  const suffix = randomUUID();
  const laneOrgId = `npage-org-${suffix}`;
  const colleague = `npage-colleague-${suffix}`;
  const agent = `npage-agent-${suffix}`;
  const projectId = `npage-project-${suffix}`;
  const taskId = `npage-task-${suffix}`;
  const laterTaskIds = Array.from(
    { length: LATER },
    (_, i) => `npage-task-${suffix}-${i + 1}`,
  );
  const laneTaskIds = [taskId, ...laterTaskIds];
  const tell = (recipient: string, task: string, from: string, to: string) =>
    transactSerializable(sql, (tx) =>
      writeCoalescedNotification(tx, {
        organizationId: laneOrgId,
        userId: recipient,
        type: 'task_status_changed',
        titleKey: 'taskStatusChanged',
        bodyKey: 'taskStatusChangedBody',
        params: { title: `Paging ${task}`, projectId, from, to },
        resourceType: 'task',
        resourceId: task,
        taskId: task,
        actorType: 'agent',
        actorId: agent,
      }),
    );
  /** `recipient`'s bell in pages of 25 from `cursor` on, following each
   * page's `nextCursor` the way the web bell pages it. */
  const walk = async (
    recipient: string,
    cursor?: number,
  ): Promise<BellPage[]> => {
    const pages: BellPage[] = [];
    let next = cursor;
    do {
      const page = await listMyNotifications(sql, {
        organizationId: laneOrgId,
        userId: recipient,
        limit: PAGE,
        ...(next === undefined ? {} : { cursor: next }),
      });
      pages.push(page);
      next = page.nextCursor ?? undefined;
    } while (next !== undefined && pages.length < 10);
    return pages;
  };
  const colleagueRows = () => sql<
    { id: string; seq: string; createdAtMs: string; to: string | null }[]
  >`
    SELECT id, seq::text AS seq, created_at_ms::text AS "createdAtMs",
           params->>'to' AS "to"
    FROM app.user_notifications
    WHERE org_id = ${laneOrgId} AND user_id = ${colleague}
  `;

  try {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      VALUES (${colleague}, 'Paging colleague', ${`${colleague}@example.com`},
              true, ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${laneOrgId}, 'Notification paging', ${laneOrgId}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${`npage-member-${suffix}`}, ${laneOrgId}, ${userId}, 'member', ${new Date()}),
             (${`npage-member-colleague-${suffix}`}, ${laneOrgId}, ${colleague}, 'member', ${new Date()})
    `;
    // No team columns: an organization-wide project, so both members can
    // open its tasks and the writer tells them.
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${laneOrgId}, 'Notification paging', ${userId}, ${Date.now()}, ${Date.now()})
    `;
    for (const [i, id] of laneTaskIds.entries()) {
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
                               created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${id}, ${laneOrgId}, ${projectId}, ${`Paging task ${i}`}, 'todo',
                ${`${suffix}-${String(i).padStart(2, '0')}`}, ${userId}, 'user',
                ${Date.now()}, ${Date.now()})
      `;
    }

    const seeded = [
      await tell(userId, taskId, 'todo', 'in_progress'),
      await tell(colleague, taskId, 'todo', 'in_progress'),
    ];
    for (const later of laterTaskIds) {
      seeded.push(await tell(userId, later, 'todo', 'in_progress'));
    }
    const statusRowId = (
      await sql<{ id: string }[]>`
        SELECT id FROM app.user_notifications
        WHERE org_id = ${laneOrgId} AND user_id = ${userId} AND task_id = ${taskId}
      `
    )[0]?.id;
    const colleagueBefore = await colleagueRows();
    const before = await walk(userId);
    const beforeIds = idsOf(before);
    record(
      'notification paging: before the rewrite, pages of 25 meet every row once and the oldest is off the first page',
      seeded.every((outcome) => outcome === 'inserted') &&
        statusRowId !== undefined &&
        before.length === 2 &&
        beforeIds.length === LATER + 1 &&
        repeated(beforeIds).length === 0 &&
        beforeIds.includes(statusRowId) &&
        !(before[0]?.rows ?? []).some((row) => row.id === statusRowId),
      `seeded=${[...new Set(seeded)].join(',')} pages=${before.map((page) => page.rows.length).join('+')} repeated=${repeated(beforeIds).join(',')} statusRow=${statusRowId}`,
    );

    const outcome = await tell(userId, taskId, 'in_progress', 'done');
    const after = await walk(userId);
    const afterIds = idsOf(after);
    const firstPage = after[0]?.rows ?? [];
    record(
      'notification paging: the rewritten row leads the first page and the bell reads newest first',
      outcome === 'rewritten' &&
        firstPage.length === PAGE &&
        firstPage[0]?.id === statusRowId &&
        firstPage[0]?.params?.to === 'done' &&
        newestFirst(after.flatMap((page) => page.rows)),
      `outcome=${outcome} first=${firstPage[0]?.id}:${JSON.stringify(firstPage[0]?.params?.to)} statusRow=${statusRowId} onFirstPage=${firstPage.some((row) => row.id === statusRowId)} page=${after.findIndex((page) => page.rows.some((row) => row.id === statusRowId)) + 1}`,
    );
    record(
      'notification paging: after the rewrite, pages of 25 meet every row exactly once',
      after.length === 2 &&
        afterIds.length === LATER + 1 &&
        repeated(afterIds).length === 0 &&
        afterIds.every((id) => beforeIds.includes(id)),
      `pages=${after.map((page) => page.rows.length).join('+')} repeated=${repeated(afterIds).join(',')}`,
    );

    // A pager that loaded the first page before the rewrite asks for the
    // next one with the cursor it holds: the rewrite moved the row above
    // that cursor, never below it, so going on meets no row twice.
    const staleCursor = before[0]?.nextCursor ?? undefined;
    const rest =
      staleCursor === undefined ? [] : idsOf(await walk(userId, staleCursor));
    const straddled = [
      ...(before[0]?.rows ?? []).map((row) => row.id),
      ...rest,
    ];
    record(
      'notification paging: a pager holding a cursor from before the rewrite never meets a row twice',
      staleCursor !== undefined && repeated(straddled).length === 0,
      `cursor=${staleCursor} rest=${rest.length} repeated=${repeated(straddled).join(',')} statusRowInRest=${rest.includes(statusRowId ?? '')}`,
    );

    const colleagueAfter = await colleagueRows();
    const colleagueBell = idsOf(await walk(colleague));
    const homeBell = (
      await listMyNotifications(sql, {
        organizationId: orgId,
        userId,
        limit: 100,
      })
    ).rows.filter(
      (row) => row.taskId !== null && laneTaskIds.includes(row.taskId),
    );
    record(
      'notification paging: the rewrite leaves other people and organizations untouched',
      colleagueBefore.length === 1 &&
        colleagueBefore[0]?.to === 'in_progress' &&
        JSON.stringify(colleagueAfter) === JSON.stringify(colleagueBefore) &&
        colleagueBell.length === 1 &&
        colleagueBell[0] === colleagueBefore[0]?.id &&
        homeBell.length === 0,
      `colleague=${JSON.stringify(colleagueAfter)} colleagueBell=${colleagueBell.length} homeBell=${homeBell.length}`,
    );

    const api: { status: number; ids: string[]; firstTo?: unknown } = {
      status: 0,
      ids: [],
    };
    let cursor: number | null | undefined;
    for (let page = 0; page < 10 && cursor !== null; page += 1) {
      const response = await fetch(
        `${baseUrl}/api/app/collab/notifications?orgId=${laneOrgId}&limit=${PAGE}${cursor === undefined ? '' : `&cursor=${cursor}`}`,
        { headers: { cookie } },
      );
      api.status = response.status;
      if (!response.ok) break;
      const payload = apiPage.parse(await response.json());
      if (page === 0) api.firstTo = payload.rows[0]?.params?.to;
      api.ids.push(...payload.rows.map((row) => row.id));
      cursor = payload.nextCursor;
    }
    record(
      'notification paging: the authenticated bell API reads the rewritten row first and pages to the same rows',
      api.status === 200 &&
        api.ids[0] === statusRowId &&
        api.firstTo === 'done' &&
        api.ids.join() === afterIds.join(),
      `status=${api.status} first=${api.ids[0]}:${JSON.stringify(api.firstTo)} rows=${api.ids.length} sameOrder=${api.ids.join() === afterIds.join()}`,
    );
  } finally {
    await sql`DELETE FROM app.user_notifications WHERE org_id = ${laneOrgId}`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${laneOrgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${laneOrgId}`;
    await sql`DELETE FROM "user" WHERE "id" = ${colleague}`;
  }
}
