/** Real Postgres interleavings: erasure must neither undo a newer reviewer
 * designation nor ask someone to review an approval already completed. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { updateTask, updateTaskStatus } from '../tasks/service.ts';
import { processErasure } from './service.ts';

function signal() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Keep every read/write real. Only the first routing write pauses, after
 * the task and pending review were read but before the competing commit.
 * A serialization retry must run freely against its fresh snapshot. */
function pauseFirstHandover(sql: Sql, pause: () => Promise<void>): Sql {
  let paused = false;
  const wrap = (tx: TransactionSql): TransactionSql =>
    new Proxy(tx, {
      apply(target, thisArg, args: unknown[]) {
        const strings = args[0];
        if (
          !paused &&
          Array.isArray(strings) &&
          /UPDATE app\.approvals SET\s+metadata = coalesce/.test(
            strings.join(''),
          )
        ) {
          paused = true;
          return pause().then(() => Reflect.apply(target, thisArg, args));
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
  type Callback = (tx: TransactionSql) => Promise<unknown>;
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property !== 'begin') return Reflect.get(target, property, receiver);
      return (options: string | Callback, callback?: Callback) => {
        if (typeof options === 'function') {
          return target.begin((tx) => options(wrap(tx)));
        }
        if (!callback) throw new Error('Missing transaction callback');
        return target.begin(options, (tx) => callback(wrap(tx)));
      };
    },
  });
}

export async function checkErasureReviewHandoverRaces(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  for (const rival of ['designation', 'decision'] as const) {
    const orgId = randomUUID();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const approvalId = randomUUID();
    const requestId = randomUUID();
    const subject = `erasure-race-subject-${orgId}`;
    const reviewer = `erasure-race-reviewer-${orgId}`;
    const now = Date.now();
    const auth = {
      organizationId: orgId,
      userId: ctx.userId,
      role: 'owner',
      teamIds: [] as string[],
    };
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${orgId}, 'Erasure handover race', ${`itest-erasure-race-${orgId}`}, now())
    `;
    for (const id of [subject, reviewer]) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        VALUES (${id}, 'Erasure race member', ${`${id}@example.com`}, true, now(), now())
      `;
    }
    for (const id of [ctx.userId, subject, reviewer]) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
        VALUES (${randomUUID()}, ${orgId}, ${id}, 'owner', now())
      `;
    }
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Handover race', ${ctx.userId}, ${now}, ${now})
    `;
    // The pending recipient need not be the explicit designation (a creator
    // can be selected by the fallback chain). With no matching designation
    // to clear, erasure holds no task-row write lock before its routing read.
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Waiting for review', 'in_review',
        'a0', ${ctx.userId}, 'user', ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.approvals (id, org_id, resource_type, resource_id, status,
        metadata, created_at_ms)
      VALUES (${approvalId}, ${orgId}, 'task_review', ${taskId}, 'pending',
        ${sql.json({ requestedFor: subject, taskId, projectId, round: 0 })}, ${now})
    `;
    // Directly file an isolated receipt: only this invocation runs it, so a
    // job worker cannot consume it before the barrier is installed.
    await sql`
      INSERT INTO app.gdpr_erasure_requests (id, org_id, target_user_id, reason,
        reason_code, requested_by, requested_at_ms, sla_deadline_at_ms, status)
      VALUES (${requestId}, ${orgId}, ${subject}, 'Concurrency regression',
        'consent_withdrawn', ${ctx.userId}, ${now}, ${now + 86_400_000}, 'pending')
    `;

    const reached = signal();
    const resume = signal();
    const pausedSql = pauseFirstHandover(sql, async () => {
      reached.release();
      await resume.promise;
    });
    const erasure = processErasure(pausedSql, requestId);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        reached.promise,
        erasure.then(() => {
          throw new Error('Erasure finished without reaching the handover');
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Erasure handover barrier timed out')),
            10_000,
          );
        }),
      ]);
      // These are the real competing domain writes, committed while the
      // erasure still carries its earlier task/approval snapshot.
      await transactSerializable(sql, async (tx) => {
        await tx`SET LOCAL statement_timeout = '10s'`;
        if (rival === 'designation') {
          await updateTask(tx, auth, { taskId, reviewerUserId: reviewer });
        } else {
          await updateTaskStatus(tx, auth, taskId, 'done');
        }
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      resume.release();
      await erasure;
    }

    const [task] = await sql<{ reviewer: string | null; status: string }[]>`
      SELECT reviewer_user_id AS reviewer, status FROM app.tasks
      WHERE id = ${taskId} AND org_id = ${orgId}
    `;
    const [approval] = await sql<
      { recipient: string | null; status: string }[]
    >`
      SELECT metadata->>'requestedFor' AS recipient, status FROM app.approvals
      WHERE id = ${approvalId} AND org_id = ${orgId}
    `;
    const [staleBells] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.user_notifications
      WHERE org_id = ${orgId} AND resource_id = ${approvalId}
        AND type = 'task_review_requested' AND user_id = ${ctx.userId}
    `;
    const [receipt] = await sql<{ status: string }[]>`
      SELECT status FROM app.gdpr_erasure_requests WHERE id = ${requestId}
    `;
    const routingPreserved =
      rival === 'designation'
        ? task?.reviewer === reviewer &&
          approval?.recipient === reviewer &&
          approval.status === 'pending'
        : task?.status === 'done' && approval?.status === 'completed';
    record(
      `erasure handover preserves a concurrently committed ${rival}`,
      routingPreserved && staleBells?.count === 0 && receipt?.status === 'done',
      `task=${task?.status}/${task?.reviewer === reviewer ? 'new-reviewer' : String(task?.reviewer)}, review=${approval?.status}/${approval?.recipient === reviewer ? 'new-reviewer' : approval?.recipient === ctx.userId ? 'creator' : String(approval?.recipient)}, stale requests=${staleBells?.count} (want 0), receipt=${receipt?.status} (want done)`,
    );
  }
}
