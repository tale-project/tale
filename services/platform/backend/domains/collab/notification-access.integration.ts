/** Real Postgres proof that a task's news reaches only the people who can
 * open the task when it is written (#3631). The task sits in a one-team
 * project, watched by a team member, a muted team member, an org admin in no
 * team, a member then taken off the team through the real removal door, and
 * someone who belongs to another organization only:
 *
 * - the removal keeps the former member in the organization and keeps their
 *   subscription, and the task's access rule refuses them;
 * - after a rename, a status change, a comment and a reassignment off them,
 *   the former member holds no row carrying the new title and their badge
 *   shows nothing new, while what they were told on the team stays as it was;
 * - the team member and the admin are told the new title, the muted watcher
 *   is not, and the other organization's member gets no row here at all;
 * - back on the team, the former member hears the next change again: the
 *   subscription is a wish to be told, and access when the row is written is
 *   what lets it through.
 *
 * Read through the bell's own queries (`listMyNotifications`,
 * `myUnreadCount`). Nothing is sent: the organization has no mailbox, and
 * the lane deletes its rows before it ends. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { getUserTeamIds } from '../../auth/membership.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { addTaskComment } from '../tasks/comments.ts';
import { assignTask, updateTask, updateTaskStatus } from '../tasks/service.ts';
import {
  listMyNotifications,
  markAllNotificationsRead,
  myUnreadCount,
} from './service.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface BellRow {
  type: string;
  title: unknown;
  to: unknown;
  read: boolean;
}

export async function checkTaskNotificationAccess(
  sql: Sql,
  baseUrl: string,
  ctx: { orgId: string; userId: string; cookie: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId, cookie } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const actor = `nacc-actor-${suffix}`;
  const watcher = `nacc-watcher-${suffix}`;
  const muted = `nacc-muted-${suffix}`;
  const departed = `nacc-departed-${suffix}`;
  const admin = `nacc-admin-${suffix}`;
  const foreign = `nacc-foreign-${suffix}`;
  const people = [actor, watcher, muted, departed, admin, foreign];
  const roles = new Map([
    [actor, 'editor'],
    [watcher, 'member'],
    [muted, 'member'],
    [departed, 'member'],
    [admin, 'admin'],
  ]);
  const otherOrgId = `nacc-org-${suffix}`;
  const teamId = `nacc-team-${suffix}`;
  const projectId = randomUUID();
  const taskId = randomUUID();
  const firstTitle = `Quarterly plan ${suffix}`;
  const newTitle = `Acquisition of Contoso ${suffix}`;
  const now = Date.now();

  const authOf = async (who: string): Promise<ProjectAuthContext> => ({
    organizationId: orgId,
    userId: who,
    role: roles.get(who) ?? 'member',
    teamIds: await getUserTeamIds(sql, orgId, who),
  });
  const write = <T>(work: (tx: TransactionSql) => Promise<T>): Promise<T> =>
    transactSerializable(sql, work);
  /** This task's rows on a person's bell, newest first. */
  const bell = async (who: string, organizationId = orgId) =>
    (
      await listMyNotifications(sql, {
        organizationId,
        userId: who,
        limit: 100,
      })
    ).rows
      .filter((row) => row.taskId === taskId)
      .map((row): BellRow => ({
        type: row.type,
        title: row.params?.title ?? null,
        to: row.params?.to ?? null,
        read: row.read,
      }));
  const show = (rows: BellRow[]) =>
    JSON.stringify(rows.map((row) => [row.type, row.title, row.to, row.read]));
  const toldNew = (rows: BellRow[], type: string) =>
    rows.some((row) => row.type === type && row.title === newTitle);
  let threadIds: string[] = [];

  try {
    for (const person of people) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${person}, ${person}, ${`${person}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${otherOrgId}, 'Elsewhere', ${otherOrgId}, ${new Date()})
    `;
    for (const [person, role] of roles) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${person}`}, ${orgId}, ${person}, ${role}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${foreign}`}, ${otherOrgId}, ${foreign}, 'member',
              ${new Date()})
    `;
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (${teamId}, 'Deal room', ${orgId}, ${new Date()}, ${new Date()})
    `;
    for (const person of [actor, watcher, muted, departed]) {
      await sql`
        INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
        VALUES (${`tm-${person}`}, ${teamId}, ${person}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO app.projects (id, org_id, name, team_ids, team_id,
                                created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Deal room board', ${sql.array([teamId])},
              ${teamId}, ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${firstTitle}, 'todo',
        ${`n${suffix}`}, ${actor}, 'user', ${now}, ${now})
    `;
    // The other organization's row is one no door writes (the subscription
    // door reads the task first): what a member who left leaves behind.
    for (const [person, isMuted] of [
      [watcher, false],
      [muted, true],
      [admin, false],
      [foreign, false],
    ] as const) {
      await sql`
        INSERT INTO app.task_subscriptions (org_id, task_id, subscriber_type,
          subscriber_id, reason, muted, created_at_ms)
        VALUES (${orgId}, ${taskId}, 'user', ${person}, 'manual', ${isMuted},
                ${now})
      `;
    }

    // On the team, the member joins the discussion (which subscribes them),
    // is handed the task, and reads their bell.
    const departedOnTeam = await authOf(departed);
    await write((tx) =>
      addTaskComment(tx, departedOnTeam, { taskId, body: 'Count me in.' }),
    );
    const actorAuth = await authOf(actor);
    await write((tx) =>
      assignTask(tx, actorAuth, {
        taskId,
        assigneeType: 'user',
        assigneeId: departed,
      }),
    );
    const onTeam = await bell(departed);
    await markAllNotificationsRead(sql, orgId, departed);

    const removal = await fetch(
      `${baseUrl}/api/app/teams/members/by-id/tm-${departed}?orgId=${orgId}`,
      { method: 'DELETE', headers: { cookie } },
    );
    const removed: unknown = await removal.json().catch(() => null);
    const membership = await sql<{ role: string }[]>`
      SELECT "role" FROM "member"
      WHERE "organizationId" = ${orgId} AND "userId" = ${departed}
    `;
    const subscription = await sql`
      SELECT 1 FROM app.task_subscriptions
      WHERE task_id = ${taskId} AND subscriber_type = 'user'
        AND subscriber_id = ${departed}
    `;
    const departedTeams = await getUserTeamIds(sql, orgId, departed);
    const canRead = checkProjectAccess(
      { teamId, sharedWithTeamIds: [] },
      departedTeams,
      'member',
    ).canRead;
    record(
      'task notifications: the team-removal door keeps the member in the organization with their subscription, and the task refuses them',
      removal.status === 200 &&
        JSON.stringify(removed) === JSON.stringify({ removed: true }) &&
        membership[0]?.role === 'member' &&
        subscription.length === 1 &&
        departedTeams.length === 0 &&
        !canRead,
      `status=${removal.status} body=${JSON.stringify(removed)} role=${membership[0]?.role} subscribed=${subscription.length} teams=${JSON.stringify(departedTeams)} canRead=${canRead}`,
    );

    // An editor still on the team renames the task, moves it, comments, and
    // hands it to the watcher.
    await write((tx) => updateTask(tx, actorAuth, { taskId, title: newTitle }));
    await write((tx) => updateTaskStatus(tx, actorAuth, taskId, 'in_progress'));
    await write((tx) =>
      addTaskComment(tx, actorAuth, { taskId, body: 'The numbers are in.' }),
    );
    await write((tx) =>
      assignTask(tx, actorAuth, {
        taskId,
        assigneeType: 'user',
        assigneeId: watcher,
      }),
    );

    const departedBell = await bell(departed);
    const leaked = departedBell.filter((row) => row.title === newTitle);
    const departedUnread = await myUnreadCount(sql, orgId, departed);
    record(
      "task notifications: a member taken off the team gets no row with the task's new title (status, comment or unassignment) and no new unread",
      leaked.length === 0 && departedUnread === 0,
      `newTitleRows=${show(leaked)} unread=${departedUnread}`,
    );
    const history = departedBell.filter((row) => row.title !== newTitle);
    record(
      'task notifications: what the removed member was told on the team stays as written',
      toldOld(onTeam) &&
        show(history) === show(onTeam.map((row) => ({ ...row, read: true }))),
      `onTeam=${show(onTeam)} now=${show(history)}`,
    );

    const watcherBell = await bell(watcher);
    const adminBell = await bell(admin);
    const mutedBell = await bell(muted);
    record(
      'task notifications: a team watcher and an admin outside the team are told the new title; a muted watcher hears nothing',
      toldNew(watcherBell, 'task_status_changed') &&
        toldNew(watcherBell, 'task_commented') &&
        toldNew(watcherBell, 'task_assigned') &&
        toldNew(adminBell, 'task_status_changed') &&
        toldNew(adminBell, 'task_commented') &&
        mutedBell.length === 0,
      `watcher=${show(watcherBell)} admin=${show(adminBell)} muted=${show(mutedBell)}`,
    );

    const foreignRows = await sql<{ type: string; orgId: string }[]>`
      SELECT type, org_id AS "orgId" FROM app.user_notifications
      WHERE user_id = ${foreign}
    `;
    const foreignBell = await bell(foreign, otherOrgId);
    record(
      "task notifications: a subscription held by another organization's member writes no row here",
      foreignRows.length === 0 && foreignBell.length === 0,
      `rows=${JSON.stringify(foreignRows)} theirBell=${show(foreignBell)}`,
    );

    await sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${`tm-back-${departed}`}, ${teamId}, ${departed}, ${new Date()})
    `;
    await write((tx) => updateTaskStatus(tx, actorAuth, taskId, 'backlog'));
    const backBell = await bell(departed);
    record(
      'task notifications: back on the team, the former member hears the next change again',
      backBell.some(
        (row) =>
          row.type === 'task_status_changed' &&
          row.title === newTitle &&
          row.to === 'backlog',
      ),
      `bell=${show(backBell)}`,
    );
  } finally {
    threadIds = (
      await sql<{ threadId: string | null }[]>`
        SELECT discussion_thread_id AS "threadId" FROM app.tasks
        WHERE id = ${taskId}
      `
    )
      .map((row) => row.threadId)
      .filter((id): id is string => id !== null);
    await sql`
      DELETE FROM app.user_notifications
      WHERE task_id = ${taskId} OR user_id IN ${sql(people)}
    `;
    // Cascades to its task and subscriptions.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    if (threadIds.length > 0) {
      await sql`DELETE FROM app.threads WHERE id IN ${sql(threadIds)}`;
    }
    await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await sql`DELETE FROM "member" WHERE "userId" IN ${sql(people)}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${otherOrgId}`;
    await sql`DELETE FROM "user" WHERE "id" IN ${sql(people)}`;
  }

  /** The assignment row the member was sent on the team, with its title. */
  function toldOld(rows: BellRow[]): boolean {
    return rows.some(
      (row) => row.type === 'task_assigned' && row.title === firstTitle,
    );
  }
}
