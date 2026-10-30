/** Real Postgres proof that one write tells everyone a change concerns in a
 * few statements, and leaves each person what telling them one at a time
 * did (#4712). A task in a lane-owned organization's organization-wide
 * project is watched by fourteen people when an agent's run on it fails:
 *
 * - ten get a new failed-run notice each, emailed: one `notification.email`
 *   job per row, carrying its epoch 1;
 * - one already holds an unread notice about the task, so it is rewritten
 *   in place: the same row, a place newer than every row before it, and
 *   its email epoch moved from 1 to 2, which its new job carries;
 * - one switched agent escalations off, and one left the organization
 *   while their subscription stayed: neither gets a row, an email or a hint;
 * - every person told gets one bell hint of their own.
 *
 * Then one batched undo drops an unread assignment for one person and
 * writes the unassignment for another: no email (losing work asks nothing
 * of anyone), a hint for each.
 *
 * Written through the production emitters and writer
 * (`notifyAgentRunFailed`, `writeCoalescedNotifications`) inside
 * serializable transactions; read back from the tables. The organization
 * has no mailbox, so a job that fires sends nothing, and the lane deletes
 * its rows before it ends. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { latestOutboxId } from '../../realtime/outbox.ts';
import {
  notifyAgentRunFailed,
  writeCoalescedNotification,
  writeCoalescedNotifications,
} from './service.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

/** Watchers who get a new notice: ten, beside the four others. */
const FRESH = 10;

export async function checkNotificationFanOut(
  sql: Sql,
  record: Recorder,
): Promise<void> {
  const suffix = randomUUID();
  const laneOrgId = `nfan-org-${suffix}`;
  const projectId = `nfan-project-${suffix}`;
  const taskId = `nfan-task-${suffix}`;
  const fresh = Array.from(
    { length: FRESH },
    (_, i) => `nfan-watcher-${i + 1}-${suffix}`,
  );
  const twin = `nfan-twin-${suffix}`;
  const muted = `nfan-muted-${suffix}`;
  const departed = `nfan-departed-${suffix}`;
  const members = [...fresh, twin, muted];
  const people = [...members, departed];
  const task = {
    id: taskId,
    organizationId: laneOrgId,
    projectId,
    title: `Compare the two offers ${suffix}`,
  };
  const failureNotice = {
    organizationId: laneOrgId,
    type: 'agent_run_failed',
    titleKey: 'agentRunFailed',
    bodyKey: 'agentRunFailedBody',
    params: { title: task.title, projectId },
    resourceType: 'task',
    resourceId: taskId,
    taskId,
    actorType: 'agent',
    actorId: `nfan-agent-${suffix}`,
  } as const;
  const assignment = (type: 'task_assigned' | 'task_unassigned') =>
    ({
      organizationId: laneOrgId,
      type,
      titleKey: type === 'task_assigned' ? 'taskAssigned' : 'taskUnassigned',
      bodyKey:
        type === 'task_assigned' ? 'taskAssignedBody' : 'taskUnassignedBody',
      params: { title: task.title, projectId },
      resourceType: 'task',
      resourceId: taskId,
      taskId,
      actorType: 'user',
      actorId: twin,
      ...(type === 'task_unassigned' ? { undoes: true } : {}),
    }) as const;
  /** This task's rows of `type`, by person. */
  const rowsOf = async (type: string) =>
    new Map(
      (
        await sql<
          { userId: string; id: string; seq: string; emailEpoch: string }[]
        >`
          SELECT user_id AS "userId", id, seq::text AS seq,
                 email_epoch::text AS "emailEpoch"
          FROM app.user_notifications
          WHERE org_id = ${laneOrgId} AND task_id = ${taskId}
            AND type = ${type}
        `
      ).map((row) => [row.userId, row]),
    );
  /** The epochs the queued `notification.email` jobs carry, by row. */
  const emailsFor = async (notificationIds: readonly string[]) => {
    const jobs = await sql<{ notificationId: string; epoch: string }[]>`
      SELECT data->>'notificationId' AS "notificationId",
             data->>'epoch' AS epoch
      FROM pgboss.job
      WHERE name = 'notification.email'
        AND data->>'notificationId' = ANY(${[...notificationIds]}::text[])
      ORDER BY created_on
    `;
    const epochs = new Map<string, string[]>();
    for (const job of jobs) {
      epochs.set(job.notificationId, [
        ...(epochs.get(job.notificationId) ?? []),
        job.epoch,
      ]);
    }
    return epochs;
  };
  /** Who the bell hints since `cursor` went to, in the lane's organization. */
  const hintedSince = async (cursor: string) =>
    (
      await sql<{ userId: string | null }[]>`
        SELECT user_id AS "userId" FROM app_realtime.outbox
        WHERE org_id = ${laneOrgId} AND entity = 'notification'
          AND id > ${cursor}::bigint
        ORDER BY id
      `
    ).map((row) => row.userId);
  const sameSet = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((item) => b.includes(item));

  try {
    for (const person of people) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${person}, 'Fan-out watcher', ${`${person}@example.com`},
                true, ${new Date()}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${laneOrgId}, 'Notification fan-out', ${laneOrgId}, ${new Date()})
    `;
    for (const person of members) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`nfan-member-${person}`}, ${laneOrgId}, ${person}, 'member',
                ${new Date()})
      `;
    }
    // No team columns: an organization-wide project, so every member can
    // open its task and only the departed watcher cannot.
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${laneOrgId}, 'Notification fan-out', ${twin},
              ${Date.now()}, ${Date.now()})
    `;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
                             created_by, created_by_type, created_at_ms,
                             updated_at_ms)
      VALUES (${taskId}, ${laneOrgId}, ${projectId}, ${task.title},
              'in_progress', ${`nfan-${suffix}`}, ${twin}, 'user',
              ${Date.now()}, ${Date.now()})
    `;
    for (const person of people) {
      await sql`
        INSERT INTO app.task_subscriptions (
          org_id, task_id, subscriber_type, subscriber_id, reason,
          created_at_ms
        ) VALUES (${laneOrgId}, ${taskId}, 'user', ${person}, 'manual',
                  ${Date.now()})
      `;
    }
    await sql`
      INSERT INTO app.notification_preferences (user_id, org_id, escalation,
                                                updated_at_ms)
      VALUES (${muted}, ${laneOrgId}, false, ${Date.now()})
    `;

    // The twin's unread notice from an earlier failure of the same task.
    const seeded = await transactSerializable(sql, (tx) =>
      writeCoalescedNotification(tx, { ...failureNotice, userId: twin }),
    );
    const before = (await rowsOf('agent_run_failed')).get(twin);
    const seqBefore = (
      await sql<{ max: string | null }[]>`
        SELECT max(seq)::text AS max FROM app.user_notifications
      `
    )[0]?.max;
    const outboxBefore = await latestOutboxId(sql);

    const counted = await transactSerializable(sql, (tx) =>
      notifyAgentRunFailed(tx, {
        task,
        agentId: failureNotice.actorId,
        starterUserId: null,
        failureCode: 'deadline',
      }),
    );
    const notices = await rowsOf('agent_run_failed');
    const rewritten = notices.get(twin);
    record(
      'notification fan-out: one write tells every watcher who can open the task, and nobody else',
      seeded === 'inserted' &&
        counted === members.length &&
        sameSet([...notices.keys()], [...fresh, twin]),
      `seeded=${seeded} counted=${counted} told=${[...notices.keys()].length} muted=${notices.has(muted)} departed=${notices.has(departed)}`,
    );
    record(
      'notification fan-out: an unread notice is rewritten in place, newest, with its email epoch moved on',
      before !== undefined &&
        rewritten?.id === before.id &&
        before.emailEpoch === '1' &&
        rewritten.emailEpoch === '2' &&
        BigInt(rewritten.seq) > BigInt(seqBefore ?? '0'),
      `before=${JSON.stringify(before)} after=${JSON.stringify(rewritten)} seqBefore=${seqBefore}`,
    );

    const emails = await emailsFor([...notices.values()].map((row) => row.id));
    const freshEmails = fresh.map((person) =>
      emails.get(notices.get(person)?.id ?? ''),
    );
    record(
      'notification fan-out: each row is emailed by one job carrying its own epoch',
      freshEmails.every((epochs) => epochs?.join() === '1') &&
        emails.get(rewritten?.id ?? '')?.join() === '1,2' &&
        [...notices.values()].every(
          (row) => row.emailEpoch === (row.userId === twin ? '2' : '1'),
        ),
      `fresh=${JSON.stringify(freshEmails)} twin=${JSON.stringify(emails.get(rewritten?.id ?? ''))}`,
    );

    const hinted = await hintedSince(outboxBefore);
    record(
      'notification fan-out: every person told gets one bell hint of their own',
      sameSet(hinted, [...fresh, twin]),
      `hinted=${hinted.length} unnarrowed=${hinted.filter((id) => id === null).length} muted=${hinted.includes(muted)} departed=${hinted.includes(departed)}`,
    );

    // One undo for two people: the first still holds the assignment unread.
    const [assigned, never] = fresh;
    if (assigned === undefined || never === undefined) {
      throw new Error('the lane needs two fresh watchers');
    }
    await transactSerializable(sql, (tx) =>
      writeCoalescedNotification(tx, {
        ...assignment('task_assigned'),
        userId: assigned,
      }),
    );
    const assignmentRow = (await rowsOf('task_assigned')).get(assigned);
    const undoCursor = await latestOutboxId(sql);
    const undone = await transactSerializable(sql, (tx) =>
      writeCoalescedNotifications(tx, assignment('task_unassigned'), [
        assigned,
        never,
      ]),
    );
    const assignedAfter = await rowsOf('task_assigned');
    const unassigned = await rowsOf('task_unassigned');
    const undoEmails = await emailsFor(
      [...unassigned.values()].map((row) => row.id),
    );
    record(
      'notification fan-out: one undo drops an unread twin and is news to someone without one',
      assignmentRow !== undefined &&
        undone.get(assigned) === 'cancelled' &&
        undone.get(never) === 'inserted' &&
        !assignedAfter.has(assigned) &&
        sameSet([...unassigned.keys()], [never]) &&
        undoEmails.size === 0 &&
        sameSet(await hintedSince(undoCursor), [assigned, never]),
      `outcomes=${JSON.stringify(Object.fromEntries(undone))} assignedLeft=${assignedAfter.has(assigned)} unassigned=${[...unassigned.keys()].length} emails=${undoEmails.size}`,
    );
  } finally {
    await sql`DELETE FROM app.user_notifications WHERE org_id = ${laneOrgId}`;
    await sql`DELETE FROM app.notification_preferences WHERE org_id = ${laneOrgId}`;
    // Cascades to its task and the task's subscriptions.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${laneOrgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${laneOrgId}`;
    await sql`DELETE FROM "user" WHERE "id" IN ${sql(people)}`;
  }
}
